// Tool-approval plumbing shared by the composer picker, the approval card and
// ChatState. The engine owns the auto-approval decision (set via the
// `set_approval_mode` op); the desktop only maps its UI modes onto the
// engine's, reconciles from `approval_mode` events, and builds structured
// `approve` ops — including per-hunk partial approvals for edit tools.

// The shared 3-mode enum drives lynshen/codex; claude additionally exposes
// 'plan' (read-only planning) and 'auto' (model auto-approves tool calls),
// gated behind BackendCaps.extendedApprovalModes so only the claude picker
// offers them. plan/auto map 1:1 between the UI and engine layers.
export type ApprovalMode = 'ask' | 'plan' | 'auto' | 'edits' | 'all';
export type EngineApprovalMode = 'read-only' | 'plan' | 'auto' | 'auto-edit' | 'full-auto';

// File-mutating tools the engine gates (the rest it gates are shell tools).
// Still used by ChatState to feed the Changes panel from tool_output events.
export const EDIT_TOOLS = ['write', 'edit', 'str_replace', 'hashline_edit', 'apply_patch'];

const UI_TO_ENGINE: Record<ApprovalMode, EngineApprovalMode> = {
	ask: 'read-only',
	plan: 'plan',
	auto: 'auto',
	edits: 'auto-edit',
	all: 'full-auto'
};
const ENGINE_TO_UI: Record<EngineApprovalMode, ApprovalMode> = {
	'read-only': 'ask',
	plan: 'plan',
	auto: 'auto',
	'auto-edit': 'edits',
	'full-auto': 'all'
};

/** Desktop picker mode → the engine's `set_approval_mode` string. */
export function toEngineMode(mode: ApprovalMode): EngineApprovalMode {
	return UI_TO_ENGINE[mode];
}

/** Engine `approval_mode` event string → desktop mode (null when unknown). */
export function fromEngineMode(mode: string): ApprovalMode | null {
	return (ENGINE_TO_UI as Record<string, ApprovalMode>)[mode] ?? null;
}

/** Reconcile the local mode from an engine `approval_mode` event: the engine is
 *  the source of truth, but an unrecognized string keeps the current mode. */
export function reconcileMode(current: ApprovalMode, engineMode: string): ApprovalMode {
	return fromEngineMode(engineMode) ?? current;
}

export function buildSetApprovalModeOp(mode: ApprovalMode): {
	op: 'set_approval_mode';
	mode: EngineApprovalMode;
} {
	return { op: 'set_approval_mode', mode: toEngineMode(mode) };
}

/** The order every picker lists the modes in, numbered 1–5 in the composer's
 *  menu, as Claude Code's (ask permissions, accept edits, plan, auto, bypass):
 *  谨慎 / 自动改文件 / 计划 / 自动 / 全自动. A backend without some of them
 *  keeps the others in this order. */
export const MODE_ORDER: readonly ApprovalMode[] = ['ask', 'edits', 'plan', 'auto', 'all'];

/** Each mode's name in the UI (i18n keys). */
export const MODE_LABEL_KEYS: Record<ApprovalMode, string> = {
	ask: 'chat.approvalAsk',
	edits: 'chat.approvalEdits',
	plan: 'chat.approvalPlan',
	auto: 'chat.approvalAuto',
	all: 'chat.approvalAll'
};

/** The modes a session's picker offers, in MODE_ORDER. An agent's session
 *  shows the agent's four (changed on its page); a LynShen session all five
 *  (全自动 keeps the sandbox boundary; 完全访问, the sandbox off, is only in
 *  Settings); claude and codex too, with their native plan and auto modes. */
export function approvalModeKeys(
	c: { sandbox: boolean; extendedApprovalModes: boolean; planMode: boolean },
	agent = false
): ApprovalMode[] {
	if (agent) return ['ask', 'edits', 'auto', 'all'];
	if (c.sandbox || c.extendedApprovalModes) return [...MODE_ORDER];
	if (c.planMode) return ['ask', 'edits', 'plan', 'all'];
	return ['ask', 'edits', 'all'];
}

/** The mode after `current` in `keys` (Shift+Tab), skipping the modes this
 *  engine refused; `current` itself when nothing else is left. */
export function nextApprovalMode(keys: readonly ApprovalMode[], current: ApprovalMode, refused: readonly ApprovalMode[] = []): ApprovalMode {
	const usable = keys.filter((k) => k === current || !refused.includes(k));
	const i = usable.indexOf(current);
	return usable.length ? usable[(i + 1) % usable.length] : current;
}

/** The desktop mode an engine names, in the LynShen engine's words (manual,
 *  auto-edit, auto, full-access, plan) or the desktop's (read-only,
 *  full-auto); null when it is neither. */
export function modeOfEngineName(name: string): ApprovalMode | null {
	const lynshen: Record<string, ApprovalMode> = { manual: 'ask', 'full-access': 'all' };
	return lynshen[name] ?? fromEngineMode(name);
}

/** The mode an engine refused as unknown (an engine older than that mode
 *  says "unknown approval mode 'auto': use …"); null for any other error. */
export function refusedApprovalMode(message: string): ApprovalMode | null {
	const m = /^unknown approval mode '([^']*)'/.exec(message.trim());
	return m ? modeOfEngineName(m[1]) : null;
}

/** A new session's mode from the one saved last (any backend's). LynShen
 *  sessions start in 自动 and keep only 全自动 from before; the others keep
 *  自动改文件 or 全自动 and otherwise start in 谨慎. Plan is never carried
 *  over. */
export function initialApprovalMode(saved: string | null, sandbox: boolean): ApprovalMode {
	if (sandbox) return saved === 'all' ? 'all' : 'auto';
	return saved === 'edits' || saved === 'all' ? saved : 'ask';
}

/** Whether a claude approval-mode change to `mode` must go through an engine
 *  respawn (spawned with `--permission-mode bypassPermissions` + `--resume`)
 *  rather than a live `set_permission_mode` control frame: claude does not honor
 *  a runtime switch INTO bypassPermissions (no system/status follow-up, so the
 *  UI never reconciles). Every other mode switches live. Non-claude backends
 *  never respawn. */
export function needsClaudeYoloRespawn(backendId: string, mode: EngineApprovalMode): boolean {
	return backendId === 'claude' && mode === 'full-auto';
}

// --- per-hunk approval ------------------------------------------------------

/** One selectable hunk of a pending edit, from `approval_request.hunks`. */
export interface ApprovalHunk {
	id: string;
	file: string;
	header: string;
	lines: string[];
}

/** Parse the `hunks` field of an approval_request event. Non-arrays (absent /
 *  null → whole-call approval) and malformed entries collapse to null. */
export function parseHunks(v: unknown): ApprovalHunk[] | null {
	if (!Array.isArray(v)) return null;
	const hunks: ApprovalHunk[] = [];
	for (const item of v) {
		if (!item || typeof item !== 'object') return null;
		const h = item as Record<string, unknown>;
		if (typeof h.id !== 'string' || h.id === '') return null;
		hunks.push({
			id: h.id,
			file: typeof h.file === 'string' ? h.file : '',
			header: typeof h.header === 'string' ? h.header : '',
			lines: Array.isArray(h.lines) ? h.lines.map(String) : []
		});
	}
	return hunks;
}

export const allHunkIds = (hunks: ApprovalHunk[]) => hunks.map((h) => h.id);

/** Toggle one hunk id in a selection, preserving the hunk-list order semantics
 *  (the returned array only contains ids, order = insertion). */
export function toggleHunk(selected: string[], id: string): string[] {
	return selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
}

export type SelectionState = 'all' | 'some' | 'none';

export function selectionState(hunks: ApprovalHunk[], selected: string[]): SelectionState {
	const picked = hunks.filter((h) => selected.includes(h.id)).length;
	if (picked === 0) return 'none';
	return picked === hunks.length ? 'all' : 'some';
}

/** This session only, saved for this project, or for every project. */
export type AlwaysScope = 'session' | 'project' | 'user' | 'rule';

export interface ApproveOp {
	op: 'approve';
	call_id: string;
	decision: 'allow' | 'deny';
	hunks?: string[];
	always?: boolean;
	/** Where an always-allow rule is kept (claude); the session when absent. */
	always_scope?: AlwaysScope;
	/** AskUserQuestion answers, keyed by the full question text → picked label(s).
	 *  Fed back to the model as the tool result via the permission response. */
	answers?: Record<string, string>;
	/** LynShen sandbox: how far the allow reaches (once when absent). */
	scope?: 'once' | 'session' | 'project';
	/** LynShen sandbox: allow and make this directory writable. */
	add_dir?: { path: string; persist: 'session' | 'project' };
	/** LynShen sandbox: with a deny, what the model should do instead. */
	feedback?: string;
}

/** A claude AskUserQuestion prompt (the model asking the user to choose). */
export interface Question {
	question: string;
	header?: string;
	options: { label: string; description?: string }[];
	multiSelect: boolean;
}

/** Parse the `questions` field of an AskUserQuestion approval_request. */
export function parseQuestions(raw: unknown): Question[] | null {
	if (!Array.isArray(raw)) return null;
	const out: Question[] = [];
	for (const q of raw) {
		const m = q && typeof q === 'object' ? (q as Record<string, unknown>) : null;
		if (!m || typeof m.question !== 'string') continue;
		const options: Question['options'] = [];
		for (const o of Array.isArray(m.options) ? m.options : []) {
			const om = o && typeof o === 'object' ? (o as Record<string, unknown>) : null;
			if (om && typeof om.label === 'string') {
				options.push({
					label: om.label,
					...(typeof om.description === 'string' ? { description: om.description } : {})
				});
			}
		}
		out.push({
			question: m.question,
			...(typeof m.header === 'string' ? { header: m.header } : {}),
			options,
			multiSelect: m.multiSelect === true
		});
	}
	return out.length ? out : null;
}

/**
 * Build the structured `approve` op. Engine combination rules are enforced
 * here so an invalid payload can never be constructed:
 * - `hunks` (partial approval) is only valid with `decision: 'allow'`;
 * - `always` applies to the whole call and is incompatible with `hunks`.
 */
export function buildApproveOp(
	callId: string,
	decision: 'allow' | 'deny',
	opts: { hunks?: string[]; always?: boolean; scope?: AlwaysScope } = {}
): ApproveOp {
	if (opts.hunks && opts.always) throw new Error('always approval cannot select hunks');
	if (opts.hunks && decision !== 'allow') throw new Error('hunks require decision: allow');
	const op: ApproveOp = { op: 'approve', call_id: callId, decision };
	if (opts.hunks) op.hunks = opts.hunks;
	if (opts.always) op.always = true;
	if (opts.always && opts.scope && opts.scope !== 'session') op.always_scope = opts.scope;
	return op;
}
