// The LynShen sandbox as the conversation sees it (notes: sandbox contract):
// what an approval request says about a sandbox crossing, the answers the
// card can give, the `sandbox` state the engine reports and the
// `escalated` record of a crossing that ran without asking. Every field is
// optional on the wire: an engine from before the contract sends none, and
// then nothing here applies (the card stays the plain allow / deny one).

/** What an approval is about. */
export type ApprovalKind = 'edit' | 'command' | 'escalation' | 'outside_write' | 'elevation' | 'rule' | 'tool';
export const APPROVAL_KINDS: readonly ApprovalKind[] = ['edit', 'command', 'escalation', 'outside_write', 'elevation', 'rule', 'tool'];

/** How far an allow reaches: this call, the session, or saved as a rule. */
export type ApprovalScope = 'once' | 'session' | 'project';
const SCOPES: readonly ApprovalScope[] = ['once', 'session', 'project'];

export type SandboxMode = 'read-only' | 'workspace-write' | 'full-access';
export const SANDBOX_MODES: readonly SandboxMode[] = ['read-only', 'workspace-write', 'full-access'];

/** Where a writable directory comes from. */
export type DirectorySource = 'session' | 'project' | 'global';

/** The sandbox fields of an `approval_request`. */
export interface SandboxRequest {
	kind: ApprovalKind;
	/** Asked in every mode (the hard-ask list, ask rules). */
	mustAsk: boolean;
	/** The model's reason. */
	justification: string;
	cwd: string;
	/** The shell command as the model wrote it. */
	command: string;
	/** Paths outside the working directory this call writes. */
	paths: string[];
	/** The directory the "add as writable" answer adds. */
	dirSuggestion: string;
	/** The command prefix a session or saved allow covers. */
	prefix: string;
	/** What the engine lets this request be allowed for. */
	scopes: ApprovalScope[];
	/** `terminal`: the user runs it in a terminal; `uac`: Windows asks after the approval. */
	elevation: 'terminal' | 'uac' | null;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : []);

export const isApprovalKind = (v: unknown): v is ApprovalKind => APPROVAL_KINDS.includes(v as ApprovalKind);

/** The sandbox fields of an approval request; null when it has none (an
 *  older engine, or another backend whose `scopes` mean something else). */
export function parseSandboxRequest(ev: Record<string, unknown>): SandboxRequest | null {
	if (!isApprovalKind(ev.kind)) return null;
	const scopes = strs(ev.scopes).filter((s): s is ApprovalScope => SCOPES.includes(s as ApprovalScope));
	return {
		kind: ev.kind,
		mustAsk: ev.must_ask === true,
		justification: str(ev.justification).trim(),
		cwd: str(ev.cwd),
		command: str(ev.command).trim(),
		paths: strs(ev.paths),
		dirSuggestion: str(ev.dir_suggestion),
		prefix: str(ev.prefix).trim(),
		// No list: allow once only, the least the engine can mean.
		scopes: scopes.length ? scopes : ['once'],
		elevation: ev.elevation === 'terminal' || ev.elevation === 'uac' ? ev.elevation : null
	};
}

/** The answers a card offers, from what the engine allows. A `must_ask`
 *  request gets nothing beyond its scopes either. */
export interface ApprovalChoices {
	/** 允许一次 (always there: every scope list allows once). */
	once: boolean;
	/** 本会话: commands starting with the prefix, edits for an edit request,
	 *  the tool for another tool's. */
	session: boolean;
	/** 始终允许: the prefix saved as an allow rule. */
	project: boolean;
	/** The write answers (本会话 / 加入可写目录) and the directory they name. */
	pathSession: boolean;
	pathProject: boolean;
	target: string;
	/** 在终端里运行 (only where a terminal can be opened). */
	terminal: boolean;
}

export function approvalChoices(req: SandboxRequest, opts: { terminal?: boolean } = {}): ApprovalChoices {
	const has = (s: ApprovalScope) => req.scopes.includes(s);
	// The write answers name only the directory the engine suggests: it
	// suggests none for the home directory, a root or the credentials, and
	// none for a request it allows once only (must_ask). Its scopes are
	// about command prefixes: a write outside the workspace is allowed once
	// with them, and for its directory with these.
	const target = req.mustAsk ? '' : req.dirSuggestion;
	// A write outside the working directory is answered for its directory;
	// a command that also names one gets both kinds of answer.
	const commandAnswers = req.kind !== 'outside_write';
	// A session allow of an edit is "edits no longer ask", of another tool
	// "this tool no longer asks"; of a command it covers a prefix, so it
	// needs one.
	const sessionOk = has('session') && (req.kind === 'edit' || req.kind === 'tool' || !!req.prefix);
	return {
		once: true,
		session: commandAnswers && sessionOk,
		project: commandAnswers && has('project') && !!req.prefix,
		pathSession: !!target,
		pathProject: !!target,
		target,
		terminal: req.elevation === 'terminal' && !!req.command && !!opts.terminal
	};
}

/** The feedback the deny carries after 在终端里运行 (the contract's text, for the model). */
export const TERMINAL_FEEDBACK = '用户会在自己的终端里运行这条命令，等用户告诉你结果。';

/** The answer to a sandbox approval request. */
export type SandboxAnswer =
	| { type: 'once' }
	| { type: 'session' }
	| { type: 'project' }
	| { type: 'dir'; path: string; persist: 'session' | 'project' }
	| { type: 'deny'; feedback?: string };

export interface SandboxApproveOp {
	op: 'approve';
	call_id: string;
	decision: 'allow' | 'deny';
	scope?: ApprovalScope;
	add_dir?: { path: string; persist: 'session' | 'project' };
	feedback?: string;
}

/** The `approve` op for an answer. A plain allow leaves `scope` out (once is
 *  the default); the engine's prefix is the one it applies. */
export function buildSandboxApproveOp(callId: string, answer: SandboxAnswer): SandboxApproveOp {
	const allow = { op: 'approve' as const, call_id: callId, decision: 'allow' as const };
	switch (answer.type) {
		case 'once':
			return allow;
		case 'session':
		case 'project':
			return { ...allow, scope: answer.type };
		case 'dir':
			return { ...allow, add_dir: { path: answer.path, persist: answer.persist } };
		case 'deny': {
			const feedback = answer.feedback?.trim();
			return { op: 'approve', call_id: callId, decision: 'deny', ...(feedback ? { feedback } : {}) };
		}
	}
}

/** The `sandbox` event: what this session's commands may do. */
export interface SandboxState {
	mode: SandboxMode | '';
	network: boolean;
	/** The system sandbox is in force (false on Windows and in full access). */
	enforced: boolean;
	/** Why the sandbox cannot run, with the fix (bwrap missing, AppArmor). */
	unavailable: string;
	directories: { path: string; mode: 'ro' | 'rw'; source: DirectorySource }[];
}

export function parseSandboxState(ev: Record<string, unknown>): SandboxState {
	const dirs = Array.isArray(ev.directories) ? ev.directories : [];
	return {
		mode: SANDBOX_MODES.includes(ev.mode as SandboxMode) ? (ev.mode as SandboxMode) : '',
		network: ev.network !== false,
		enforced: ev.enforced === true,
		unavailable: str(ev.unavailable),
		directories: dirs.flatMap((d) => {
			const m = d && typeof d === 'object' ? (d as Record<string, unknown>) : null;
			if (!m || !str(m.path)) return [];
			const source: DirectorySource = m.source === 'project' || m.source === 'global' ? m.source : 'session';
			return [{ path: str(m.path), mode: m.mode === 'ro' ? 'ro' : 'rw', source }];
		})
	};
}

/** Whether this session's commands run without isolation: the engine says
 *  so, or, before it says anything, the computer is Windows (no system
 *  sandbox there). */
export function commandsIsolated(state: SandboxState | null, windows: boolean): boolean {
	return state ? state.enforced : !windows;
}

/** A crossing that ran without asking (`escalated`): one line in the
 *  conversation. */
export interface EscalationRecord {
	callId: string;
	what: ApprovalKind | '';
	command: string;
	justification: string;
	cwd: string;
	paths: string[];
	/** Who let it through: the mode (全自动), an allow rule, the safety model. */
	by: 'mode' | 'rule' | 'classifier' | '';
}

export function parseEscalation(ev: Record<string, unknown>): EscalationRecord {
	return {
		callId: str(ev.call_id),
		what: isApprovalKind(ev.kind) ? ev.kind : '',
		command: str(ev.command).trim(),
		justification: str(ev.justification).trim(),
		cwd: str(ev.cwd),
		paths: strs(ev.paths),
		by: ev.by === 'mode' || ev.by === 'rule' || ev.by === 'classifier' ? ev.by : ''
	};
}

/** A path's last part, for a button label (the full path is its title). */
export function baseName(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, '');
	return trimmed.slice(Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\')) + 1) || trimmed || path;
}

/** The first line of a text (a command or reason shown on one line). */
export const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? '';

/** Whether the computer this page runs on is Windows (`<html data-os>`). */
export function onWindows(): boolean {
	return typeof document !== 'undefined' && document.documentElement.dataset.os === 'windows';
}
