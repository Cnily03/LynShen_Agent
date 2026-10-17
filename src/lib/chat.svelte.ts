import type { AgentEvent } from './protocol';
import { loadProfile, profileKey, rememberProfile, type BackendProfile } from '$lib/backendProfile';
import { isBackendId, type BackendId } from './backends/types';
import { caps } from './backends';
import {
	EDIT_TOOLS,
	MODE_LABEL_KEYS,
	fromEngineMode,
	initialApprovalMode,
	modeOfEngineName,
	parseHunks,
	parseQuestions,
	reconcileMode,
	refusedApprovalMode,
	toEngineMode,
	type AlwaysScope,
	type ApprovalHunk,
	type ApprovalMode,
	type EngineApprovalMode,
	type Question
} from './approval';
import {
	parseEscalation,
	parseSandboxRequest,
	parseSandboxState,
	type EscalationRecord,
	type SandboxRequest,
	type SandboxState
} from './sandbox/request';
import { t } from './i18n';
import { AFTER_RUN, runState } from './agentTrace';
import { costUsd } from './pricing';
import { pendingCost, sumCosts, type BillingCost } from './sessionCost';
import { CacheWatch } from './cacheMiss';
import { breakdownTotal, parseBreakdown, type RequestParts } from './composer/contextUsage';
import { parseMcpServersEvent, type McpServerView } from './mcp';
import { parseSubagentResult } from './agents/subagentResult';
import { parseDelivery } from './delivery';
import { sentLabel } from './attachments';
import { parseReplyStyle, type ReplyStyleState } from './styles';
import {
	matchMessage,
	parseSessionMessage,
	readSessionMessageEvent,
	sendTarget,
	type SessionMessageView
} from './sessions/sessionMessage';
import { sessionInbox } from './sessions/inbox.svelte';
import { endLive, liveText, startLive } from './liveText';

/** Where a sent message is before its reply starts: accepted locally, the
 *  engine is connecting to the model gateway, connected and waiting for the
 *  first token, or the turn failed first. Unset once the reply streams. */
export type SendState = 'sending' | 'connecting' | 'waiting' | 'failed';

/** One user turn's totals, stamped on its last assistant message. */
export interface TurnStats {
	elapsed: number;
	/** Time to the first streamed output, ms. */
	ttft?: number;
	inTokens: number;
	outTokens: number;
	files: number;
	added: number;
	removed: number;
	tools: number;
	cost: number;
	billingTurns?: string[];
	billing?: BillingCost;
	model: string;
	/** Reply segments (assistant messages split by tool calls) in the turn. */
	segments: number;
}

/** The model request in flight, for the live timer: which stage it is in and
 *  when that stage began. `connect`: request sent, no response yet; `ttft`:
 *  connected, waiting for the first token; `output`: tokens streaming. */
/** A request that waits for the user: an action to allow, a question, a
 *  plan, an MCP form. */
export interface PendingApproval {
	callId: string;
	name: string;
	summary: string;
	subagentId: string | null;
	hunks: ApprovalHunk[] | null;
	/** Present for a claude AskUserQuestion — render an interactive picker. */
	questions?: Question[] | null;
	/** An MCP elicitation asking the user to open a page (claude). */
	url?: string;
	/** Where an always-allow can be kept, when the engine says (codex). */
	scopes?: AlwaysScope[];
	/** A LynShen sandbox request: its kind, reason, scopes (absent from
	 *  an engine before the sandbox contract). */
	sandbox?: SandboxRequest;
}

export interface CallTiming {
	phase: 'connect' | 'ttft' | 'output';
	since: number;
}

export type Msg =
	| { kind: 'user'; text: string; state?: SendState; images?: string[] }
	| {
			kind: 'assistant';
			text: string;
			tokens?: number;
			elapsed?: number;
			/** This segment's own time: from the request that produced it until
			 *  its tool call or the end of the turn, ms. */
			segMs?: number;
			uuid?: string;
			turn?: TurnStats;
			/** Cut off for a steered message (`response_interrupted`): the
			 *  engine keeps none of it, so a reloaded transcript lacks it. */
			interrupted?: boolean;
			/** The turn's recap card, once the reader chose (recap.ts): its
			 *  receipt shows under this reply. In memory only. */
			recap?: { choice: 'picked' | 'skipped' | 'closed'; what: string; at: number };
	  }
	| {
			kind: 'reasoning';
			text: string;
			/** The reader's view: folded to its heading (and, while it streams,
			 *  one scrolling line) unless they open it. */
			collapsed: boolean;
			/** Still receiving deltas. */
			live?: boolean;
			/** When the block's first delta arrived (live turns only). */
			startedAt?: number;
			/** How long the model thought, once the block ended. */
			durationMs?: number;
			/** Cut off for a steered message, like a reply. */
			interrupted?: boolean;
	  }
	| {
			kind: 'tool';
			callId: string;
			name: string;
			output: string;
			running: boolean;
			isError: boolean;
			/** The Task subagent that made this call (claude). */
			subagent?: string;
			/** A subagent call's arguments as the engine showed them before its
			 *  output replaced them (the agent's name and task; send_to_session:
			 *  the conversation and the message). */
			args?: string;
			/** The turn stopped before the call's output came: the engine kept
			 *  none for it. */
			cut?: boolean;
			/** The output was let go of while the chat was hidden
			 *  (`releaseOutputs`): what the card showed, hashed, so only the
			 *  same output fills it in again. */
			released?: string;
			/** When the call started here (live calls only): the work status
			 *  line counts the step from it. */
			startedAt?: number;
			/** What the call acts on, as the engine named it while it ran:
			 *  lynshen's first update for a command, `started: <command>`,
			 *  which its later updates (the output so far) replace. */
			target?: string;
	  }
	| { kind: 'system'; text: string }
	| { kind: 'error'; text: string }
	/** Context compaction: running (summary tokens `written` so far), then
	 *  done (the context's tokens `before` and `after`, the `summary`) or
	 *  failed. `live`: it ran in front of the user, not a replay. */
	| {
			kind: 'compaction';
			state: 'running' | 'done' | 'failed';
			before: number;
			after?: number;
			written: number;
			since: number;
			summary?: string;
			error?: string;
			live?: boolean;
	  }
	/** A message one agent of the team sent another (`agent_message`): agent
	 *  paths, or `parent` for the main agent; one line. */
	| { kind: 'agent_message'; from: string; to: string; summary: string }
	/** A plan the engine proposes in plan mode (`proposed_plan`): `text` is
	 *  its Markdown; status pending / approved / revising. */
	| { kind: 'plan'; id: string; title: string; text: string; status: string }
	/** A sandbox crossing that ran without asking (`escalated`): one line. */
	| { kind: 'escalation'; record: EscalationRecord };

export interface TreeNode {
	id: string;
	parent_id: string | null;
	label: string;
	active: boolean;
}
export interface ModelOption {
	/** The id submitted to switch models (an alias like "opus[1m]" for claude). */
	model: string;
	/** Human-facing concrete model to display when it differs from `model`
	 *  (e.g. claude's resolvedModel "claude-opus-4-8" behind the alias "opus"). */
	label?: string;
	/** Original model id for vendor-icon matching, when `label` is a compact
	 *  name that no longer contains the vendor keyword (e.g. "Opus 4.8"). */
	vendor?: string;
	active: boolean;
	context_window: number;
	max_output_tokens: number;
	reasoning_efforts: string[];
	/** What the model takes as input ("text", "image"); absent from older engines. */
	input_modalities?: string[];
	/** false: configured not to think (config.json `reasoning`). */
	reasoning?: boolean;
	/** false: not in the engine's catalog, only marking what runs. */
	listed?: boolean;
}
export interface ResumeItem {
	id: string;
	label: string;
	detail: string;
	active: boolean;
}
export type Picker =
	| { kind: 'tree'; nodes: TreeNode[] }
	| { kind: 'model'; models: ModelOption[]; activeEffort: string }
	// `backend`: whose conversations the items are, when not this chat's own
	// (the project history lists LynShen conversations in any chat).
	| {
			kind: 'resume';
			items: ResumeItem[];
			backend?: BackendId;
			/** The project's history picker (source tabs), not an engine's /resume. */
			history?: boolean;
			/** Whose saved conversations are listed; claude / codex ones import,
			 *  opencode ones continue in OpenCode on a copy, dsh ones become
			 *  LynShen conversations. */
			source?: 'lynshen' | 'claude' | 'codex' | 'opencode' | 'dsh';
	  }
	| { kind: 'checkpoint'; items: ResumeItem[] }
	| null;

export interface Goal {
	objective: string;
	status: string;
	token_budget: number | null;
	tokens_used: number;
	time_used_seconds: number;
}
export interface CommandItem {
	command: string;
	marker: string | null;
	args?: string;
	description?: string;
}
export interface PlanStep {
	step: string;
	status: string;
	/** The subagent that owns the step (its path), when the plan assigns one. */
	agent?: string;
	/** The files the step expects to write. */
	files?: string[];
}

/** A plan step as the engines send it (`plan` / `update_plan`). */
function planStep(raw: Record<string, unknown>): PlanStep {
	const files = arr<unknown>(raw.files).filter((f): f is string => typeof f === 'string' && f !== '');
	return {
		step: str(raw.step),
		status: str(raw.status),
		...(str(raw.agent) ? { agent: str(raw.agent) } : {}),
		...(files.length ? { files } : {})
	};
}

/** What became of a subagent's worktree changes (`merge_result`). */
export interface MergeResult {
	action: 'apply' | 'discard';
	ok: boolean;
	files: string[];
	conflicts: string[];
	/** Why it failed when there are no conflicts to name. */
	error: string;
}

/** A subagent of the agent team as its events report it: its role, the plan
 *  step it works on, where it writes, the files it changed and what became
 *  of them. Kept for the session: its worktree stays until it is merged or
 *  discarded, past the turn that ran it. */
export interface TeamAgent {
	role: string;
	/** The plan step it works on, as the engine names it: the step's text or
	 *  its 1-based number; null for none. */
	planStep: string | null;
	/** Its working directory; a worktree of its own when `worktree`. */
	workdir: string;
	worktree: boolean;
	/** Files it changed (relative to its workdir). */
	files: string[];
	/** The merge_agent op sent and not answered yet. */
	pending: 'apply' | 'discard' | null;
	merge: MergeResult | null;
	/** It runs in the background: past the end of the turn that started it,
	 *  and its result may start a turn of its own. */
	background: boolean;
	/** Best-of-N: the group of attempts at one task it belongs to, and which
	 *  attempt it is (1-based); null for none. */
	attemptGroup: string | null;
	attempt: number | null;
	/** Lines its worktree changes add and remove (git diff), once read. */
	diff: { added: number; removed: number } | null;
}

/** A team agent nothing is known of yet. */
const blankTeam = (): TeamAgent => ({
	role: '',
	planStep: null,
	workdir: '',
	worktree: false,
	files: [],
	pending: null,
	merge: null,
	background: false,
	attemptGroup: null,
	attempt: null,
	diff: null
});

/** A task of the team's task board (`task_board`), as the engine words it. */
export type TaskStatus = 'pending' | 'claimed' | 'completed' | 'failed' | 'blocked';
const TASK_STATUS: TaskStatus[] = ['pending', 'claimed', 'completed', 'failed', 'blocked'];

export interface BoardTask {
	id: string;
	title: string;
	detail: string;
	status: TaskStatus;
	/** The agent (path) that claimed it; null for none. */
	owner: string | null;
	/** Tasks (ids) that must complete first. */
	dependsOn: string[];
	role: string;
	files: string[];
	result: string;
	/** When it last changed (engine clock, ms). */
	updatedAt: number;
}

function boardTask(raw: Record<string, unknown>): BoardTask {
	const strings = (v: unknown) => arr<unknown>(v).filter((x): x is string => typeof x === 'string' && x !== '');
	return {
		id: str(raw.id),
		title: str(raw.title),
		detail: str(raw.detail),
		status: TASK_STATUS.includes(raw.status as TaskStatus) ? (raw.status as TaskStatus) : 'pending',
		owner: str(raw.owner) || null,
		dependsOn: strings(raw.depends_on),
		role: str(raw.role),
		files: strings(raw.files),
		result: str(raw.result),
		updatedAt: num(raw.updated_at)
	};
}

/** One message between the agents of the team (`agent_message`). */
export interface AgentMessage {
	from: string;
	to: string;
	summary: string;
	at: number;
}

/** The team's token use in this turn against its limit (0: none). */
export interface TeamBudget {
	used: number;
	limit: number;
}

/** A subagent's workdir is a worktree of its own: the engine says so, or it
 *  lies where the engine makes them (`<cwd>/.lynshen/agents/<task>-<ms>`). */
const isWorktree = (workdir: string, isolation: string) =>
	isolation === 'worktree' || (isolation === '' && /[\\/]\.lynshen[\\/]agents[\\/][^\\/]+[\\/]?$/.test(workdir));

/** Mode names as a client sends them to the daemon (see backends/lynshen.ts). */
/** The engine's refusals of an `approve` that leave the request waiting:
 *  `add_dir` naming no existing directory or one it never makes writable
 *  (home, a root, credentials), a scope or prefix it does not offer
 *  (LynShen core `approve_with`). */
const APPROVE_REFUSED =
	/^(not an existing absolute directory: |add_dir persist |call \S+ can be allowed only |call \S+ has no command prefix|prefix `|.+ cannot be made writable: )/;
const PENDING_MODES: Record<string, ApprovalMode> = { manual: 'ask', 'auto-edit': 'edits', auto: 'auto', 'full-access': 'all', plan: 'plan' };
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const arr = <T>(v: unknown) => (Array.isArray(v) ? (v as T[]) : []);

/** Count added/removed lines in a unified-diff-ish string (ignoring +++/--- file
 *  headers). Used to attribute an edit's line delta to its turn. */
/** A claude task type (`local_workflow`, `local_bash`, …) as the user says it. */
export function taskKindLabel(kind: string): string {
	const known = ['local_workflow', 'local_bash', 'local_agent', 'monitor'];
	const key = known.find((k) => kind === k || kind.startsWith(k)) ?? 'other';
	return t(`chat.taskKind.${key}`);
}

function fallbackReason(reason: string): string {
	const known = ['overloaded', 'server_error', 'model_not_found', 'permission_denied', 'refusal'];
	return t(`chat.fallbackReason.${known.includes(reason) ? reason : 'other'}`);
}

/** A subagent as its lifecycle events (and, on an older LynShen engine, its
 *  spawn_agent call) report it: by path / task id. */
export interface SubagentInfo {
	status: string;
	message: string;
	label?: string;
	model?: string;
	/** The call that started it (spawn_agent / Agent). */
	toolUseId?: string;
	/** When this client first saw it, and saw it end (ms). */
	startedAt?: number;
	endedAt?: number;
	/** Its role (explorer, worker, reviewer or a custom one). */
	role?: string;
	/** It runs in the background (see TeamAgent.background). */
	background?: boolean;
}

/** The lifecycle words of an agent that has stopped for good (`conflict`:
 *  done, its changes did not merge; `budget_exhausted`: stopped by the
 *  team's token budget). */
const FINAL_AGENT = [
	'completed',
	'done',
	'failed',
	'errored',
	'stopped',
	'interrupted',
	'closed',
	'killed',
	'cancelled',
	'conflict',
	'merged',
	'discarded',
	'budget_exhausted'
];

/** Subagent transcripts a chat keeps besides the one shown. */
const SUBAGENT_TRANSCRIPTS_KEPT = 3;

/** Calls that start a subagent: their arguments name it. */
const SUBAGENT_CALLS = new Set(['spawn_agent', 'Task', 'Agent']);

/** A proposed plan's status as the engine words it. */
const PLAN_STATUS = ['pending', 'approved', 'revising'];
const planStatus = (v: unknown) => (typeof v === 'string' && PLAN_STATUS.includes(v) ? v : 'pending');

/** One agent of a Workflow, or a Task subagent (claude's agent trace). */
export interface AgentRun {
	id: string;
	label: string;
	/** Workflow agents: their phase index. */
	phase: number;
	model: string;
	/** running / done / completed / failed / stopped / queued … as the engine says. */
	state: string;
	startedAt: number;
	durationMs: number;
	tokens: number;
	toolCalls: number;
	prompt: string;
	result: string;
	error: string;
	/** Task subagents: the subagent type and the Agent call that started it. */
	type: string;
	toolUseId: string;
	/** Its latest action in one line (lynshen), and its reasoning effort. */
	activity: string;
	effort: string;
}
export interface WorkflowRun {
	id: string;
	toolUseId: string;
	name: string;
	description: string;
	status: string;
	startedAt: number;
	durationMs: number;
	tokens: number;
	toolCalls: number;
	phases: { index: number; title: string }[];
	agents: AgentRun[];
}

function agentRun(raw: Record<string, unknown>): AgentRun {
	const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
	return {
		id: str(raw.id),
		label: str(raw.label),
		phase: n(raw.phase),
		model: str(raw.model),
		state: str(raw.state) || str(raw.status),
		startedAt: n(raw.started_at),
		durationMs: n(raw.duration_ms),
		tokens: n(raw.tokens),
		toolCalls: n(raw.tool_calls),
		prompt: str(raw.prompt),
		result: str(raw.result) || str(raw.summary),
		error: str(raw.error),
		type: str(raw.type),
		toolUseId: str(raw.tool_use_id),
		activity: str(raw.activity),
		effort: str(raw.effort)
	};
}

type ToolMsg = Extract<Msg, { kind: 'tool' }>;

/** An output as the JSON object most tools return, else null. */
function outputObject(output: string): Record<string, unknown> | null {
	if (!output.startsWith('{')) return null;
	try {
		const value = JSON.parse(output) as unknown;
		return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Whether `text` is over `max` bytes in UTF-8, as the engine measures. */
function utf8Over(text: string, max: number): boolean {
	// A UTF-16 unit is one to three bytes, a surrogate pair four.
	if (text.length > max) return true;
	if (text.length * 3 <= max) return false;
	let bytes = 0;
	for (let i = 0; i < text.length && bytes <= max; i++) {
		const c = text.charCodeAt(i);
		bytes += c < 0x80 ? 1 : c < 0x800 || (c >= 0xd800 && c < 0xe000) ? 2 : 3;
	}
	return bytes > max;
}

/** The engine keeps a call's output as the model saw it (agent-core
 *  `project_model_output`), and its replay sends that one: an output over
 *  16 KB comes back as 4 KB excerpts, a diff over 8 KB as a 4 KB one, and a
 *  read without its text. Whether the replay shows what the card shows: a
 *  read card shows only the file it read (and an error), and the engine
 *  keeps those. */
export function replayShows(name: string, output: string): boolean {
	const o = outputObject(output);
	const text = (v: unknown) => typeof v === 'string' && v !== '';
	if (name === 'read' && o && ((o.kind === 'image' && text(o.base64)) || (text(o.content) && text(o.hashlines)))) return true;
	if (utf8Over(output, 16 * 1024)) return false;
	return !(typeof o?.diff === 'string' && utf8Over(o.diff, 8 * 1024));
}

/** What a tool card shows of `output`, hashed with its length, to tell the
 *  same output again: a read card shows the file it read and an error, any
 *  other card the whole output. */
function shownPrint(name: string, output: string): string {
	const o = name === 'read' ? outputObject(output) : null;
	const shown = o ? JSON.stringify([o.path ?? null, o.error ?? null]) : output;
	let hash = 0x811c9dc5;
	for (let i = 0; i < shown.length; i++) hash = Math.imul(hash ^ shown.charCodeAt(i), 0x01000193);
	return `${shown.length}:${hash >>> 0}`;
}

/** A tool card the engine recorded: not a Task subagent's call, and not one
 *  the turn stopped before its output came (`cut`). */
const recorded = (m: Msg): m is ToolMsg => m.kind === 'tool' && !m.subagent && !m.cut && !m.running;

/** The messages of a `transcript` replay. */
function replayMessages(items: Record<string, unknown>[]): Msg[] {
	return items
		.map((it): Msg | null => {
			const role = str(it.role);
			if (role === 'user' && str(it.content) === AUTO_CONTINUE) return { kind: 'system', text: t('chat.autoRetry.resumed') };
			if (role === 'user') {
				const images = arr<string>(it.images).filter((p) => typeof p === 'string');
				return { kind: 'user', text: str(it.content), ...(images.length ? { images } : {}) };
			}
			if (role === 'assistant') return { kind: 'assistant', text: str(it.content) };
			if (role === 'tool')
				return {
					kind: 'tool',
					callId: '',
					name: str(it.name),
					output: boundedOutput(str(it.output)),
					running: false,
					isError: false
				};
			if (role === 'branch') return { kind: 'system', text: `branch: ${str(it.label)}` };
			if (role === 'compaction') return { kind: 'compaction', state: 'done', before: 0, written: 0, since: 0, summary: str(it.summary) };
			if (role === 'plan') return { kind: 'plan', id: str(it.id), title: str(it.title), text: str(it.content), status: planStatus(it.status) };
			if (role === 'agent_message' && (str(it.summary) || str(it.content)))
				return { kind: 'agent_message', from: str(it.from), to: str(it.to), summary: str(it.summary) || str(it.content) };
			// A sandbox crossing, where the transcript keeps them (same fields as `escalated`).
			if (role === 'escalated') return { kind: 'escalation', record: parseEscalation(it) };
			return null;
		})
		.filter((m): m is Msg => m !== null);
}

/** Whether every one of `want` is in `have`, in order. */
function inOrder<A, B>(want: A[], have: B[], same: (have: B, want: A) => boolean): boolean {
	let j = 0;
	for (const w of want) {
		while (j < have.length && !same(have[j]!, w)) j++;
		if (j++ >= have.length) return false;
	}
	return true;
}

/** `shown` (what a chat shows) with the outputs it let go of filled in from
 *  `replayed` (the engine's replay of it), when the two are the same
 *  conversation: the same tool calls, each output let go of the same again,
 *  and every message and reply of the replay shown, in order. What the
 *  engine does not keep (reasoning, notices, a reply or a call cut short, a
 *  blank segment, a message its hook refused) or keeps otherwise (a
 *  command's expanded text, a message with images) does not count. Each
 *  message stays where it is. Null when they differ. */
export function refilled(shown: Msg[], replayed: Msg[]): Msg[] | null {
	const tools = replayed.filter((m): m is ToolMsg => m.kind === 'tool');
	if (shown.filter(recorded).length !== tools.length) return null;
	const users = (list: Msg[]) => list.filter((m) => m.kind === 'user') as Extract<Msg, { kind: 'user' }>[];
	const sameUser = (have: Extract<Msg, { kind: 'user' }>, want: Extract<Msg, { kind: 'user' }>) =>
		have.text.trim() === want.text.trim() || have.text.trimStart().startsWith('/') || !!have.images?.length;
	if (!inOrder(users(replayed), users(shown), sameUser)) return null;
	// A provider may keep a reasoning block as reply text.
	const replies = (list: Msg[], reasoning: boolean) =>
		list.filter((m) => m.kind === 'assistant' || (reasoning && m.kind === 'reasoning')) as { text: string }[];
	const sameText = (have: { text: string }, want: { text: string }) => have.text.trim() === want.text.trim();
	if (!inOrder(replies(replayed, false), replies(shown, true), sameText)) return null;
	let i = 0;
	const out: Msg[] = [];
	for (const m of shown) {
		if (!recorded(m)) {
			out.push(m);
			continue;
		}
		const r = tools[i++]!;
		if (r.name !== m.name || (m.released !== undefined && shownPrint(m.name, r.output) !== m.released)) return null;
		if (m.released === undefined) out.push(m);
		else {
			const card: ToolMsg = { ...m, output: r.output };
			delete card.released;
			out.push(card);
		}
	}
	return out;
}

/** Messages by user turn: each starts at a user message, the first holds
 *  what comes before any. */
function byTurn(messages: Msg[]): Msg[][] {
	const turns: Msg[][] = [[]];
	for (const m of messages) {
		if (m.kind === 'user') turns.push([m]);
		else turns[turns.length - 1]!.push(m);
	}
	return turns;
}

/** The replay of a conversation that moved on, or was rewound, while a chat
 *  that let go of its outputs missed its events: the turns both have stay
 *  as shown (`refilled`), and the replay's own turns follow. */
export function merged(shown: Msg[], replayed: Msg[]): Msg[] {
	const mine = byTurn(shown);
	const theirs = byTurn(replayed);
	const out: Msg[] = [];
	let n = 0;
	for (; n < mine.length && n < theirs.length; n++) {
		const turn = refilled(mine[n]!, theirs[n]!);
		if (!turn) break;
		out.push(...turn);
	}
	return [...out, ...theirs.slice(n).flat()];
}

export function countDiffLines(diff: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of diff.split('\n')) {
		if (line.startsWith('+') && !line.startsWith('+++')) added++;
		else if (line.startsWith('-') && !line.startsWith('---')) removed++;
	}
	return { added, removed };
}

/** One user turn's worth of file edits, for the turn-level diff timeline. */
export interface TurnDiff {
	index: number;
	text: string;
	files: { path: string; added: number; removed: number }[];
	added: number;
	removed: number;
}

/** Reactive chat state projected from the engine's AgentEvent stream. */
/** A failed model request being re-sent: attempt `attempt` of `max`, after
 *  `delayMs` from `at` (ms), because of `reason` (the provider's error). */
/** What an automatic retry sends when the failed turn is kept (autoRetry.ts).
 *  Recognised again in a reloaded transcript, where it shows as a note. */
/** What a tool card keeps of an output in memory: a long one (a build log,
 *  a big file read) keeps its head and tail. Structured (JSON) outputs are
 *  kept whole when they fit, else their string fields are cut the same way,
 *  so a card still parses them. The engine's session keeps the full output. */
const TOOL_OUTPUT_MAX = 64 * 1024;
export function boundedOutput(output: string): string {
	if (output.length <= TOOL_OUTPUT_MAX) return output;
	const cut = (text: string, max: number) =>
		text.length <= max ? text : `${text.slice(0, max / 2)}\n… (${text.length - max} characters not shown) …\n${text.slice(-max / 2)}`;
	try {
		const value = JSON.parse(output) as unknown;
		if (value && typeof value === 'object' && !Array.isArray(value)) {
			const out: Record<string, unknown> = {};
			// An image's pixels are kept whole (cut, they would not decode).
			for (const [k, v] of Object.entries(value as Record<string, unknown>))
				out[k] = typeof v === 'string' && k !== 'base64' ? cut(v, TOOL_OUTPUT_MAX / 2) : v;
			const text = JSON.stringify(out);
			if (text.length <= TOOL_OUTPUT_MAX * 2 || typeof out.base64 === 'string') return text;
		}
	} catch {
		/* plain text */
	}
	return cut(output, TOOL_OUTPUT_MAX);
}

export const AUTO_CONTINUE = '继续（连接中断后自动重试）';

export interface RetryState {
	attempt: number;
	max: number;
	reason: string;
	delayMs: number;
	at: number;
}

/** A session's title before the daemon names it. */
export const UNTITLED = 'New session';

/** A session title as the UI shows it: the stored placeholder (or none) reads
 *  in the interface language. */
export const shownTitle = (title: string) => (!title || title === UNTITLED ? t('shell.newChat') : title);

/** The context by category (`context_breakdown`): `kind` is `used`,
 *  `deferred` (tools loaded only when called), `buffer` (kept free for
 *  auto-compaction) or `free`. */
export type ContextBreakdown =
	| {
			total: number;
			max: number;
			categories: { name: string; tokens: number; kind: string }[];
			memoryFiles: { path: string; tokens: number }[];
			error?: undefined;
	  }
	| { error: string };

export class ChatState {
	/** Set by the page: invoked when the agent's `browser_open` tool succeeds,
	 *  so the embedded browser panel navigates to the requested URL. Static —
	 *  there's one browser panel regardless of which session's agent asked. */
	static onBrowserOpen: ((url: string) => void) | null = null;

	/** Set by the page: invoked with the file paths a successful edit tool
	 *  touched, so the built-in editor can auto-reload open tabs (⌘K flow). */
	static onFilesEdited: ((paths: string[]) => void) | null = null;
	/** A turn failed (see autoRetry.ts). `started`: the engine had begun it. */
	static onTurnFailed: ((chat: ChatState, message: string, started: boolean) => void) | null = null;

	/** The automatic retry waiting to pick a failed turn back up (autoRetry.ts). */
	autoRetry = $state<RetryState | null>(null);
	/** Automatic retries since the user last sent a message. */
	autoRetries = 0;
	/** The engine's last turn is an automatic "continue" (no bubble of its own). */
	lastTurnAuto = false;
	/** When this run last sent or finished a turn here, ms (0: not yet). */
	activeAt = $state(0);
	/** Where the messages of that turn start. */
	#autoFrom = -1;

	/** Which engine backend drives this session ('lynshen' default). Set once at
	 *  session creation; the `caps()` helper gates UI surfaces off it. */
	backendId: BackendId = 'lynshen';

	/** For 'acp' sessions: which registry agent backs it, and its display name
	 *  (shown instead of the generic ACP label). Set once at session creation. */
	acpAgentId = '';
	acpAgentName = '';
	/** The ACP agent is OpenCode (`isOpencodeAgent`): approval modes and the
	 *  LynShen gateway switch (`caps()` gives it OpenCode's). Known from the
	 *  agent picked, else from its registry entry when the session starts. */
	acpOpencode = $state(false);

	messages = $state<Msg[]>([]);
	provider = $state('');
	model = $state('');
	/** Compact display name for `model` when a backend provides one (claude's
	 *  "Opus 4.8 (1M)"); falls back to `model` in the UI when empty. */
	modelLabel = $state('');
	cwd = $state('');
	/** The engine runs this session as a chat (its directory is ~/.lynshen/chats). */
	get isChatMode() {
		return /[\\/]\.lynshen[\\/]chats([\\/]|$)/.test(this.cwd);
	}
	sessionId = $state('');
	effort = $state('');
	efforts = $state<string[]>([]);
	/** What the running model takes as input, as the engine reports it
	 *  (`model_status.input_modalities`); null: not reported (a draft, an
	 *  older engine, another backend). */
	inputModalities = $state<string[] | null>(null);
	/** Claude Code: ultracode (standing Workflow orchestration) is on, and
	 *  this model offers it. */
	ultracode = $state(false);
	ultracodeAvailable = $state(false);
	engineState = $state('starting');
	// True from session creation until the engine emits its first event — i.e.
	// while the claude/codex/lynshen child is still booting. Drives the spawn
	// loading animation in the empty chat area.
	booting = $state(true);
	// Set while the store (re)starts this chat's engine; what the user sends
	// meanwhile is held and delivered once it is up (router holdOps).
	restarting = $state(false);
	// Last model catalog seen (from a `model_view`), so the picker popover can open
	// instantly from cache while a fresh `/model` round-trip refreshes it.
	modelCatalog = $state<ModelOption[]>([]);
	/** model_view replies to absorb without opening the menu. */
	silentModelView = 0;
	modelCatalogEffort = $state('');
	// File-checkpoint sha captured just before each user turn (index = turn), so a
	// rewind can restore the working tree to that turn's state (codex/claude, where
	// the engine only rewinds the conversation, not files).
	fileCheckpoints = $state<Record<number, string>>({});
	contextTokens = $state(0);
	/** The engine's next request by part (lynshen `context_usage.breakdown`);
	 *  null when the engine reports the conversation only. */
	requestParts = $state<RequestParts | null>(null);
	/** Tokens the next request holds: the whole request when the engine
	 *  breaks it down, else the conversation (`tokens`). */
	get contextUsed() {
		return this.requestParts ? breakdownTotal(this.requestParts) : this.contextTokens;
	}
	/** What the context holds, by category, as last asked (`context_usage`). */
	contextBreakdown = $state<ContextBreakdown | null>(null);
	contextWindow = $state(0);
	contextLimit = $state(0);
	cost = $state(0);
	billing = $state<BillingCost | null>(null);
	billingError = $state('');
	#billingTurns: Record<string, BillingCost> = {};
	#turnBillingIds: string[] = [];
	pendingMessages = $state<string[]>([]);
	/** The queued message being steered into the running turn: it left the
	 *  queue (`status: steering`) and shows once its `user_message` comes,
	 *  after the running tool if one runs. */
	steering = $state<string | null>(null);
	/** The last queued message the engine took back (`unqueued`), for the
	 *  pane to return its text to the message box; `seq` tells repeats apart. */
	unqueued = $state<{ text: string; seq: number } | null>(null);
	picker = $state<Picker>(null);
	/** The daemon names the conversation (and keeps a rename); until then
	 *  this placeholder. */
	title = $state(UNTITLED);
	pendingFill = $state<string | null>(null);
	// Files to attach in the composer once its pane is up (a requirement's
	// screenshots when a session starts on it).
	pendingAttach = $state<string[]>([]);
	trustPrompt = $state<{ cwd: string; repoRoot: string | null } | null>(null);
	goal = $state<Goal | null>(null);
	plan = $state<PlanStep[]>([]);
	/** What waits for the user's answer, in the order it came: an engine
	 *  can ask several at once (parallel tool calls, background subagents),
	 *  and each waits until it is answered. The card shows the first
	 *  (`pendingApproval`) and its place, "第 1/3 个". */
	pendingApprovals = $state<PendingApproval[]>([]);
	/** How many requests of this run (since none waited) are settled: after
	 *  one of three, the card says "第 2/3 个". */
	approvalsSettled = $state(0);
	/** The request in front of the queue, or null. Set to null, it drops that
	 *  one; set to a request, that request goes in front (in place of one
	 *  with its call id). */
	get pendingApproval(): PendingApproval | null {
		return this.pendingApprovals[0] ?? null;
	}
	set pendingApproval(request: PendingApproval | null) {
		if (!request) this.#settle(this.pendingApprovals.slice(1));
		else this.pendingApprovals = [request, ...this.pendingApprovals.filter((a) => a.callId !== request.callId)];
	}
	/** The front request's place in this run, when more than one is in it. */
	get approvalPlace(): { n: number; of: number } | null {
		const of = this.approvalsSettled + this.pendingApprovals.length;
		return this.pendingApprovals.length && of > 1 ? { n: this.approvalsSettled + 1, of } : null;
	}
	/** A request is settled (answered, or its call ran or went): out of the queue. */
	#dropApproval(callId: string) {
		if (this.pendingApprovals.some((a) => a.callId === callId)) this.#settle(this.pendingApprovals.filter((a) => a.callId !== callId));
	}
	#settle(rest: PendingApproval[]) {
		this.approvalsSettled = rest.length ? this.approvalsSettled + this.pendingApprovals.length - rest.length : 0;
		this.pendingApprovals = rest;
	}
	/** Nothing waits any more (the turn ended or failed). */
	#clearApprovals() {
		this.approvalsSettled = 0;
		this.pendingApprovals = [];
	}
	/** What this session's commands may do, as the engine last said
	 *  (`sandbox`); null until it says (an engine before the contract never does). */
	sandbox = $state<SandboxState | null>(null);
	/** The reply style this conversation uses, as the engine last said
	 *  (`reply_style`); null until it says (an engine before reply styles
	 *  never does). */
	replyStyle = $state<ReplyStyleState | null>(null);
	/** A sandbox request just answered here: an engine that cannot take the
	 *  answer (a directory that does not exist, a scope it does not offer)
	 *  says so in an `error` and keeps the request waiting, so its card comes
	 *  back (see `error`). Gone once the call runs or another request comes. */
	#answered: { approval: PendingApproval; at: number } | null = null;
	/** The conversation is open in its engine's TUI (on this or another
	 *  client): its GUI ops wait until the TUI exits. */
	inTerminal = $state(false);
	/** An MCP server's sign-in page, to open once (codex mcp_login). */
	mcpLoginUrl = $state('');
	/** Subagents by id; `label` names them when the id doesn't (claude's task ids).
	 *  Finished ones stay until the next turn starts. */
	subagents = $state<Record<string, SubagentInfo>>({});
	/** The latest tool call each Task subagent made, by its label (claude
	 *  attributes the calls of a subagent to it, `tool_start.subagent`). */
	subagentLastTool = $state<Record<string, Extract<Msg, { kind: 'tool' }>>>({});
	/** The agent team by agent path: roles, plan steps, worktrees and merges
	 *  (see TeamAgent). Unlike `subagents`, kept past the turn. */
	team = $state<Record<string, TeamAgent>>({});
	/** Messages between the agents of the team, oldest first. */
	agentMessages = $state<AgentMessage[]>([]);
	/** The team's token use in the running (or last) turn; null until the
	 *  engine reports one. */
	teamBudget = $state<TeamBudget | null>(null);
	/** The team's task board as the engine last sent it (a whole snapshot
	 *  each time); null until it sends one. */
	taskBoard = $state<BoardTask[] | null>(null);
	/** Agents a close_agent op was sent for, by path (ms), until their
	 *  lifecycle says they stopped. */
	stopRequested = $state<Record<string, number>>({});
	/** Agents whose last run failed, by path, with the error it ended in (''
	 *  when the engine gave none), until they run again. Kept past the turn,
	 *  as `team` is: the engine's next word for one can be what became of its
	 *  worktree (merged, discarded, a conflict) in place of the failure, and
	 *  an engine that reopens the session restores its agents without their
	 *  errors (agentOutcome). */
	failedAgents = $state<Record<string, string>>({});
	/** Best-of-N: the attempt picked in each group (pick_attempt sent). */
	attemptPicks = $state<Record<string, string>>({});
	/** Messages between this conversation and others (`session_message`),
	 *  sent and received, oldest first. */
	sessionMessages = $state<SessionMessageView[]>([]);
	/** The message each `send_to_session` call sent, by call id → its id in
	 *  `sessionMessages`. */
	sendLinks = $state<Record<string, number>>({});
	/** The engine has sent an agent trace (`agent_runs`): it answers the trace ops
	 *  (an older LynShen engine refuses them). */
	agentRunsSeen = $state(false);
	/** When the current (or last) turn started and ended, ms (0: not this run). */
	turnStartedAt = $state(0);
	turnEndedAt = $state(0);
	/** When the plan last changed, ms. */
	planAt = $state(0);
	/** The proposed plan the next message revises (its id); null otherwise. */
	planRevising = $state<string | null>(null);
	/** The mode before plan mode, which approving a plan offers first. */
	modeBeforePlan = $state<ApprovalMode | null>(null);
	/** Background work of a claude session (Workflow, background shell or
	 *  agent, Monitor), as the engine last listed it; `message` is the latest
	 *  progress line. Per engine process: a restart clears it. */
	bgTasks = $state<{ id: string; kind: string; description: string; message: string }[]>([]);
	/** A background shell's output tail, by task id, once asked for. */
	taskOutputs = $state<Record<string, { output: string; truncated: boolean; error: string }>>({});
	/** /btw answers: asked beside the conversation, never part of it. */
	sideAnswers = $state<{ question: string; answer: string; error: string; pending: boolean }[]>([]);
	/** The engine's guess at the next prompt (claude), until the user types or sends. */
	suggestion = $state('');
	/** Claude fast mode: on, can be asked for, and whether thinking summaries
	 *  show (null: the engine has no such switch). */
	fast = $state(false);
	fastAvailable = $state(false);
	thinkingSummaries = $state<boolean | null>(null);
	/** Claude's Workflows and Task subagents (agent_runs), oldest first. */
	agentRuns = $state<{ workflows: WorkflowRun[]; agents: AgentRun[] }>({ workflows: [], agents: [] });
	/** A subagent's own conversation by agent id: its task, then its messages. */
	subagentTranscripts = $state<Record<string, { task: string; messages: Msg[]; error: string }>>({});
	/** The subagent the agent trace panel shows (null: the run list). */
	agentFocus = $state<string | null>(null);
	/** Claude's permission rules (list_permission_rules), once asked for. */
	permissionRules = $state<{
		rules: { behavior: string; source: string; rule: string; editability: string }[];
		directories: { path: string; source: string }[];
	} | null>(null);
	// Latest engine rate-limit / quota notice, shown as a persistent banner until
	// the engine reports the limit cleared (status back to normal). null = no limit.
	rateLimit = $state<{ level: 'warning' | 'limited'; message: string; resetsAt: number | null } | null>(null);
	/** The official plan's usage (Claude subscription, ChatGPT plan) as the
	 *  engine last reported it; null for API-key and gateway sessions. */
	planUsage = $state<{
		plan: string | null;
		windows: { key: string; used: number; resetsAt: number | null; minutes: number | null }[];
	} | null>(null);
	// Compact ring buffer of the most recent raw engine frames (summarized), for the
	// diagnostics trace — lets a mis-parsed / dropped tool frame be inspected.
	frameTrace = $state<string[]>([]);
	commands = $state<CommandItem[]>([]);
	totalIn = $state(0);
	totalOut = $state(0);
	/** Prompt tokens of the requests that reported cache figures, and the
	 *  part of them read from the provider's prompt cache (session sums). */
	cacheInput = $state(0);
	cacheRead = $state(0);
	/** Average prompt-cache hit rate (0–1); null until a request reports cache figures. */
	get cacheHitRate(): number | null {
		return this.cacheInput > 0 ? Math.min(1, this.cacheRead / this.cacheInput) : null;
	}
	unseen = $state(false);
	/** The last turn ended in an error (its message); cleared by the next one. */
	lastError = $state<string | null>(null);
	compactionTokens = $state(0);
	/** The model request failed and is being re-sent (lynshen engine); null
	 *  once output flows again or the turn ends. */
	retry = $state<RetryState | null>(null);
	// Files the agent edited this session (drives the Changes panel).
	changedFiles = $state<string[]>([]);
	// Per user-turn file edits (path → added/removed line counts), keyed by the
	// 0-based user-turn index — drives the turn-level diff timeline.
	turnEdits = $state<Record<number, Record<string, { added: number; removed: number }>>>({});
	/** The agent's own edits per file (the edit tools' unified diffs, oldest
	 *  first), so 还原 can undo exactly them and keep the user's changes. */
	agentDiffs: Record<string, string[]> = {};
	// Approval policy, enforced engine-side ('ask' ↔ read-only, 'edits' ↔
	// auto-edit, 'all' ↔ full-auto). The engine is the source of truth: this
	// mirrors its `approval_mode` events, except right after engine startup where
	// the desktop pushes its persisted mode (see `pendingModeSync`).
	approvalMode = $state<ApprovalMode>('ask');
	// Set when the engine announces its startup approval mode and it differs
	// from the desktop's persisted mode: the page must send `set_approval_mode`
	// with this value and clear it. Re-armed on every engine `startup` event, so
	// crash auto-restarts / provider switches re-push the mode too.
	pendingModeSync = $state<EngineApprovalMode | null>(null);
	// A mode the user picked that the engine applies only once the running
	// turn ends (Codex, or Claude in or out of full access); null otherwise.
	approvalPending = $state<ApprovalMode | null>(null);
	// The long-lived agent this session belongs to (empty for other sessions).
	// It runs in the agent's approval mode, set on the Agent page: the startup
	// sync never pushes the desktop's mode over it, and its mode is not
	// persisted as the desktop's.
	agent = $state('');
	// Show the engine's approval mode as it is and never push this client's
	// last choice onto it at startup (the remote page: the session belongs to
	// the computer, and only an explicit pick there changes its mode).
	followEngineMode = false;
	// Whether this engine incarnation's startup approval_mode was processed;
	// later approval_mode events are engine-driven changes (e.g. /approvals).
	#modeSynced = false;
	// The mode this engine last said it is in (its `approval_mode`), to fall
	// back to when it refuses a mode it does not know.
	#engineMode = '';
	/** Modes this engine refused as unknown (an engine older than them): the
	 *  picker shows them disabled and Shift+Tab skips them. */
	unsupportedModes = $state<ApprovalMode[]>([]);
	// Latest MCP servers view from this session's engine (emitted at startup and
	// after every state change/mutation). null until the first event arrives.
	// Settings reads this off the *active* session's ChatState — the engine's MCP
	// config is global, so any live session's engine is an authoritative source.
	mcpServers = $state<McpServerView[] | null>(null);
	// A rewind targeted at a specific rendered user message: the page sets this
	// before sending `/rewind`, and the checkpoint_view handler resolves it to a
	// concrete turn id (positional: the i-th user turn matches the i-th user message).
	rewindIntent = $state<{ userIndex: number; text: string } | null>(null);
	pendingRewind = $state<{ id: string; text: string } | null>(null);

	// Engine crash auto-restart bookkeeping (driven by the page on agent-exit).
	// $state so the diagnostics panel reflects restarts live.
	restarts = $state(0);
	restartWindowStart: number | null = null;
	/** Hosted: consecutive failed attempts to reach the daemon (see
	 *  SessionStore#engineFailed); reset with the crash budget. */
	daemonRetries = 0;
	// Set when a claude --resume target isn't found: the next restart must NOT
	// resume the same doomed id (it would crash-loop). One-shot — consumed by the
	// store's restartSession, which then comes up fresh.
	resumeBroken = false;
	/** Skip the next `transcript` replay (see its handler). */
	keepNextTranscript = false;
	/** A request of the running turn that missed the prompt cache. One-shot —
	 *  consumed by the page, which offers to stop the turn. */
	cacheMiss: { input: number; cached: number } | null = null;
	#cacheWatch = new CacheWatch();
	// Set while an intentional provider-switch restart is in flight, so the exit it
	// causes isn't treated as a crash to auto-restart.
	switching = false;

	#assistantIdx = -1;
	#reasoningIdx = -1;
	/** The messages streaming now, whose deltas are recorded for the view
	 *  (liveText.ts). Held by object: a replaced transcript moves them. */
	#live = new Set<Msg>();
	/** The live per-request timer (see CallTiming); null between requests. */
	call = $state<CallTiming | null>(null);
	/** This session's total running time: the sum of its turns, ms. Kept per
	 *  session in localStorage under `#runKey` (see bindRunKey). */
	runMs = $state(0);
	#runKey = '';
	// When the request behind the current reply segment started.
	#segStart: number | null = null;
	#turnSegments = 0;
	// Set once the engine reports a USD estimate via context_usage.
	// While false we estimate cost client-side from token usage × model pricing
	// (claude/codex don't report cost).
	#engineCost = false;
	#turnStart: number | null = null;
	#pendingUserEcho: string | null = null;
	// This turn's running totals (see TurnStats), and the user message whose
	// send state is still shown.
	#sending: Extract<Msg, { kind: 'user' }> | null = null;
	#firstOutput: number | null = null;
	#turnIn = 0;
	#turnOut = 0;
	#turnTools = 0;
	#turnCostStart = 0;
	#lastTurn: TurnStats | null = null;
	// Fast lookup for the tool message backing a call_id, so tool_update/tool_output
	// don't scan the whole transcript. Populated on tool_start; invalidated when the
	// message array is replaced wholesale (transcript). #tool() falls back to a scan
	// on a miss (e.g. transcript-restored tools, which carry no call_id).
	#toolsByCallId = new Map<string, Extract<Msg, { kind: 'tool' }>>();
	/** The background agents whose results start the next turn (a marked
	 *  `<subagent_result>` user item), and the ones that ended between turns:
	 *  they stay listed through the next turn. */
	#woke = new Set<string>();
	#endedIdle = new Set<string>();
	/** Tool outputs were let go of (see `releaseOutputs`). */
	#released = false;
	/** The next transcript is the snapshot of a chat shown again after
	 *  letting go of its outputs (see `armRefill`). */
	#refillNext = false;

	/** `backend`: the engine behind the session, whose picker the saved mode
	 *  must fit (a LynShen session starts in 自动, see initialApprovalMode). */
	constructor(backend: BackendId = 'lynshen') {
		this.backendId = backend;
		let saved: string | null = null;
		try {
			saved = localStorage.getItem('lynshen-approval-mode');
		} catch {
			/* no localStorage (e.g. tests) */
		}
		this.approvalMode = initialApprovalMode(saved, caps({ backendId: backend }).sandbox);
	}

	/** The pending approval was answered (its op sent): its card goes. */
	approvalAnswered() {
		const approval = this.pendingApproval;
		this.#answered = approval?.sandbox ? { approval, at: Date.now() } : null;
		this.pendingApproval = null;
	}

	/** Set the approval mode locally and persist it (the caller is responsible
	 *  for pushing it to the engine via `set_approval_mode`). Also invoked by the
	 *  approval_mode event handler so engine-driven changes persist too. */
	setApprovalMode(mode: ApprovalMode) {
		if (mode === 'plan' && this.approvalMode !== 'plan') this.modeBeforePlan = this.approvalMode;
		this.approvalMode = mode;
		try {
			localStorage.setItem('lynshen-approval-mode', mode);
		} catch {
			/* no localStorage (e.g. tests) */
		}
	}

	/** Show a just-sent user message immediately, before the engine echoes it.
	 *  The echo is de-duplicated in the `user_message` handler. */
	optimisticUser(content: string, images?: string[], auto = false) {
		this.activeAt = Date.now();
		if (!auto) {
			this.autoRetries = 0;
			this.autoRetry = null;
		}
		this.lastTurnAuto = false;
		this.lastError = null;
		this.#trackSend({ kind: 'user', text: content, state: 'sending', ...(images?.length ? { images } : {}) });
		this.#pendingUserEcho = content;
		this.#resetCurrent();
	}

	/** Sends an automatic "continue" without a bubble: its echo (and its turn
	 *  in a reloaded transcript) shows as a note. */
	autoContinue(content: string) {
		this.lastTurnAuto = true;
		this.#autoFrom = this.messages.length;
		this.lastError = null;
		this.#pendingUserEcho = content;
		this.#resetCurrent();
	}

	/** The last user bubble: its index among user turns, and what it said. */
	lastUserTurn(): { index: number; text: string; images?: string[] } | null {
		let index = -1;
		let last: Extract<Msg, { kind: 'user' }> | null = null;
		for (const m of this.messages)
			if (m.kind === 'user') {
				index++;
				last = m;
			}
		return last ? { index, text: last.text, ...(last.images?.length ? { images: last.images } : {}) } : null;
	}

	/** The engine's last turn produced something worth keeping: text or a tool
	 *  call (reasoning alone is not kept by the engines across a retry). */
	turnHadOutput(): boolean {
		let from = this.messages.findLastIndex((m) => m.kind === 'user');
		if (this.lastTurnAuto) from = Math.max(from, this.#autoFrom - 1);
		return this.messages
			.slice(from + 1)
			.some((m) => m.kind === 'tool' || (m.kind === 'assistant' && m.text.trim() !== ''));
	}

	/** A failed turn is being retried: its error goes (the retry's note says
	 *  why), and so does the reply it was streaming, which the engines did not
	 *  keep (Claude Code keeps a finished one, which has its uuid). The message
	 *  it failed on is no longer marked failed. */
	clearFailure() {
		while (this.messages.at(-1)?.kind === 'error') this.messages.pop();
		for (let last = this.messages.at(-1); last?.kind === 'reasoning' || (last?.kind === 'assistant' && !last.uuid); last = this.messages.at(-1))
			this.messages.pop();
		const user = this.messages.findLast((m) => m.kind === 'user');
		if (user?.kind === 'user' && user.state === 'failed') delete user.state;
		this.lastError = null;
		this.#resetCurrent();
	}

	/** Stamp the turn's total elapsed onto its last assistant message. */
	#endTurn() {
		this.activeAt = Date.now();
		// A compaction cut short (stopped, the engine gone) is not left spinning.
		const compaction = this.#compaction();
		if (compaction) {
			compaction.state = 'failed';
			compaction.error = t('chat.compaction.stopped');
		}
		if (this.#turnStart !== null) this.turnEndedAt = this.activeAt;
		this.#collapseReasoning();
		if (this.#sending?.state !== 'failed') this.#setSend(null);
		this.call = null;
		if (this.#turnStart === null) return;
		const now = Date.now();
		this.#closeSegment(now);
		const elapsed = now - this.#turnStart;
		this.#addRun(elapsed);
		const edits = Object.values(this.turnEdits[this.userTurns - 1] ?? {});
		const turn: TurnStats = {
			elapsed,
			...(this.#firstOutput !== null ? { ttft: this.#firstOutput - this.#turnStart } : {}),
			inTokens: this.#turnIn,
			outTokens: this.#turnOut,
			files: edits.length,
			added: edits.reduce((n, e) => n + e.added, 0),
			removed: edits.reduce((n, e) => n + e.removed, 0),
			tools: this.#turnTools,
			cost: this.cost - this.#turnCostStart,
			billingTurns: [...this.#turnBillingIds],
			billing: this.#turnBilling(this.#turnBillingIds),
			model: this.model,
			segments: this.#turnSegments
		};
		this.#turnStart = null;
		this.#firstOutput = null;
		this.#turnIn = this.#turnOut = this.#turnTools = this.#turnSegments = 0;
		this.#segStart = null;
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const m = this.messages[i];
			if (m.kind === 'assistant' && !m.interrupted) {
				m.elapsed = elapsed;
				m.turn = turn;
				this.#lastTurn = m.turn;
				break;
			}
		}
	}

	/** Start showing the send state of a user message being pushed. */
	#trackSend(m: Extract<Msg, { kind: 'user' }>) {
		this.messages.push(m);
		// The proxied copy, so later state changes render.
		const pushed = this.messages[this.messages.length - 1];
		if (pushed?.kind === 'user') this.#sending = pushed;
	}

	#setSend(state: SendState | null) {
		if (!this.#sending) return;
		if (state) this.#sending.state = state;
		else {
			delete this.#sending.state;
			this.#sending = null;
		}
	}

	/** The reply started streaming: the sent message has arrived. */
	#outputStarted() {
		this.retry = null;
		const now = Date.now();
		if (this.#firstOutput === null && this.#turnStart !== null) this.#firstOutput = now;
		if (this.call?.phase !== 'output') this.call = { phase: 'output', since: now };
		this.#setSend(null);
	}

	/** A model request was sent. lynshen then reports the connection
	 *  (`thinking_start`); the other engines only the first token, so their
	 *  wait counts as the time to it. */
	#requestStarted() {
		const now = Date.now();
		this.#closeSegment(now);
		this.#segStart = now;
		this.call = { phase: this.backendId === 'lynshen' ? 'connect' : 'ttft', since: now };
	}

	/** The open reply segment ends (its tool call, a new request, the turn's
	 *  end): stamp its own time. Text after it starts a new segment. */
	#closeSegment(now: number) {
		const m = this.#assistantIdx >= 0 ? this.messages[this.#assistantIdx] : null;
		if (m?.kind === 'assistant' && m.segMs === undefined && this.#segStart !== null) {
			m.segMs = now - this.#segStart;
			this.#turnSegments++;
		}
		this.#endLive(this.#assistantIdx);
		this.#assistantIdx = -1;
	}

	/** Keys this chat's running total to its session and loads what it ran
	 *  before (the transcript replay carries no timing). */
	bindRunKey(key: string) {
		this.#runKey = key;
		try {
			this.runMs = Number(localStorage.getItem(`lynshen-run-ms:${key}`)) || 0;
		} catch {
			/* no localStorage (e.g. tests) */
		}
	}

	#addRun(ms: number) {
		this.runMs += ms;
		if (!this.#runKey) return;
		try {
			localStorage.setItem(`lynshen-run-ms:${this.#runKey}`, String(this.runMs));
		} catch {
			/* no localStorage (e.g. tests) */
		}
	}

	/** A turn's timer and totals start (idempotent within the turn). */
	#startTurn() {
		if (this.#turnStart !== null) return;
		this.#turnStart = Date.now();
		this.turnStartedAt = this.#turnStart;
		// The agents a finished turn ran leave with it (their team entries,
		// and worktrees still to merge, stay). A background agent that ended
		// between turns stays for this one: its result is what this turn
		// (often one it started itself) takes up.
		this.turnEndedAt = 0;
		for (const [id, a] of Object.entries(this.subagents))
			if (a.endedAt && !this.#woke.has(id) && !(a.background && this.#endedIdle.has(id))) delete this.subagents[id];
		this.#woke.clear();
		this.#endedIdle.clear();
		this.teamBudget = null;
		this.#segStart = this.#turnStart;
		this.#firstOutput = null;
		this.#turnIn = this.#turnOut = this.#turnTools = this.#turnSegments = 0;
		this.#turnCostStart = this.cost;
		this.#turnBillingIds = [];
		this.#lastTurn = null;
	}

	#turnBilling(ids: string[]): BillingCost | undefined {
		const rows = ids.map(id => this.#billingTurns[id]).filter(Boolean);
		return rows.some(row => row.gateway_requests > 0) ? sumCosts(rows) : undefined;
	}

	get busy() {
		return ['streaming', 'connecting', 'compacting', 'steering'].includes(this.engineState);
	}

	/** Nothing is under way here and nothing waits on the user: no turn, no
	 *  message being sent or queued, no question, retry or background work,
	 *  and the conversation is not open in a TUI (whose snapshot carries no
	 *  transcript). Only such a chat lets go of its tool outputs
	 *  (`releaseOutputs`). */
	get settled(): boolean {
		if (this.engineState !== 'ready' || this.booting || this.restarting || this.switching || this.inTerminal) return false;
		if (this.pendingApproval || this.trustPrompt || this.pendingRewind || this.pendingMessages.length) return false;
		if (this.#sending || this.#pendingUserEcho !== null || this.autoRetry || this.retry) return false;
		if (this.bgTasks.length || Object.values(this.subagents).some((a) => !FINAL_AGENT.includes(a.status))) return false;
		return !this.messages.some((m) => m.kind === 'tool' && m.running);
	}

	/** Lets go of what a hidden, settled chat can get back from its engine:
	 *  the outputs of the tool cards whose replay shows the same again
	 *  (`replayShows`; a long log or diff stays, as the engine keeps only an
	 *  excerpt of it), the subagent transcripts and background task output it
	 *  fetched. The rest (turn stats, reasoning, notices) stays. The snapshot
	 *  the engine sends when the chat is shown again fills the outputs back
	 *  in (`armRefill`). */
	releaseOutputs() {
		// New message objects: a deep state proxy keeps the value an object
		// was created with, so emptying `output` through it frees nothing.
		this.messages = this.messages.map((m) =>
			recorded(m) && m.output && replayShows(m.name, m.output) ? { ...m, output: '', released: shownPrint(m.name, m.output) } : m
		);
		this.#toolsByCallId.clear();
		this.subagentTranscripts = {};
		this.taskOutputs = {};
		this.#released = true;
	}

	/** The chat is shown again after letting go of its outputs: the next
	 *  transcript (the snapshot of its session) fills them back in, and what
	 *  only this chat knew stays. A transcript sent meanwhile while hidden (a
	 *  rewind, a fork, the TUI's exit) shows as it would in any chat. */
	armRefill() {
		if (this.#released) this.#refillNext = true;
	}

	/** Meta/status notices (retrying, compaction, stderr, engine warnings, restart
	 *  notices) — kept out of the conversation bubble stream and shown in the
	 *  collapsible status strip instead. Real conversation (user/assistant/
	 *  reasoning/tool) and errors stay inline. */
	/** How many of statusLog the user has seen (opened the notices since). */
	statusSeen = $state(0);

	get statusLog(): string[] {
		const out: string[] = [];
		for (const m of this.messages) if (m.kind === 'system') out.push(m.text);
		return out;
	}

	/** Number of user turns in the transcript (one per sent message). */
	get userTurns() {
		return this.messages.filter((m) => m.kind === 'user').length;
	}

	/** Aggregate turn-timing stats (from assistant `elapsed` stamps) for the
	 *  diagnostics panel: completed turns, total and mean wall-clock. */
	get turnTiming(): { turns: number; totalMs: number; meanMs: number } {
		let turns = 0;
		let totalMs = 0;
		for (const m of this.messages) {
			if (m.kind === 'assistant' && typeof m.elapsed === 'number') {
				turns++;
				totalMs += m.elapsed;
			}
		}
		return { turns, totalMs, meanMs: turns ? Math.round(totalMs / turns) : 0 };
	}

	/** Message-kind histogram for the diagnostics panel. */
	get messageStats(): Record<string, number> {
		const out: Record<string, number> = {};
		for (const m of this.messages) out[m.kind] = (out[m.kind] ?? 0) + 1;
		return out;
	}

	/** Per-turn file-change timeline: one entry per user turn that edited files,
	 *  newest first, with the turn's prompt and its files' ±line counts. A
	 *  turn a subagent's result or another conversation's message started is
	 *  named by its line, not its mark. */
	get turnTimeline(): TurnDiff[] {
		const userTexts: string[] = [];
		for (const m of this.messages)
			if (m.kind === 'user')
				userTexts.push(parseSubagentResult(m.text) || parseSessionMessage(m.text) ? (parseDelivery(m.text)?.label ?? m.text) : sentLabel(m.text));
		const out: TurnDiff[] = [];
		for (const [key, bucket] of Object.entries(this.turnEdits)) {
			const index = Number(key);
			const files = Object.entries(bucket).map(([path, c]) => ({ path, added: c.added, removed: c.removed }));
			if (!files.length) continue;
			out.push({
				index,
				text: userTexts[index] ?? '',
				files,
				added: files.reduce((s, f) => s + f.added, 0),
				removed: files.reduce((s, f) => s + f.removed, 0)
			});
		}
		return out.sort((a, b) => b.index - a.index);
	}

	/** For a claude rewind to the `userIndex`-th user turn: the transcript uuid of
	 *  the assistant message ending the previous turn — the `--resume-session-at`
	 *  target. Null when rewinding to the first turn (restart fresh). */
	claudeRewindTarget(userIndex: number): string | null {
		let count = 0;
		let lastUuid: string | null = null;
		for (const m of this.messages) {
			if (m.kind === 'user') {
				if (count === userIndex) return lastUuid;
				count++;
			} else if (m.kind === 'assistant' && m.uuid) {
				lastUuid = m.uuid;
			}
		}
		return lastUuid;
	}

	/** Drop the `userIndex`-th user turn and everything after it — used by codex's
	 *  local view truncation on a thread/rollback rewind (the engine rewinds its
	 *  own history; we mirror it in the projected transcript). */
	truncateToUserTurn(userIndex: number) {
		// Drop per-turn diffs for the dropped turns (index >= userIndex).
		for (const key of Object.keys(this.turnEdits)) {
			if (Number(key) >= userIndex) delete this.turnEdits[Number(key)];
		}
		let count = 0;
		for (let i = 0; i < this.messages.length; i++) {
			if (this.messages[i].kind === 'user') {
				if (count === userIndex) {
					this.messages = this.messages.slice(0, i);
					return;
				}
				count++;
			}
		}
	}

	/** Whether this session has something the engine actually persisted to resume.
	 *  A fresh session (id assigned at startup but no user turn yet) was never saved,
	 *  so a native TUI could not resume it. */
	get resumable() {
		return this.sessionId !== '' && this.messages.some((m) => m.kind === 'user');
	}

	/** The activity phase shown by the bottom indicator. O(1) — checks the last message. */
	get phase(): 'connecting' | 'waiting' | 'generating' | 'tool' | 'compacting' | null {
		if (this.engineState === 'compacting') return 'compacting';
		if (!this.busy) return null;
		const last = this.messages[this.messages.length - 1];
		if (last?.kind === 'tool') return last.running ? 'tool' : 'waiting';
		// Content is the source of truth: if the tail message has streamed text we're
		// generating, regardless of a stale 'connecting' engine state.
		if ((last?.kind === 'assistant' || last?.kind === 'reasoning') && last.text.length > 0)
			return 'generating';
		if (this.engineState === 'connecting') return 'connecting';
		return 'waiting';
	}

	closePicker() {
		this.picker = null;
	}

	/** The compaction now running: the conversation's last card (status
	 *  notes may follow it; they show elsewhere). */
	#compaction() {
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const m = this.messages[i];
			if (m.kind === 'compaction' && m.state === 'running') return m;
			if (m.kind !== 'system') return null;
		}
		return null;
	}

	#pushCompaction() {
		this.messages.push({ kind: 'compaction', state: 'running', before: this.contextTokens, written: 0, since: Date.now(), live: true });
		// The pushed object is wrapped by the state proxy: hand back that one.
		return this.messages[this.messages.length - 1] as Extract<Msg, { kind: 'compaction' }>;
	}

	/** A compaction that finished, waiting for the context's new size. */
	#compactedCard: Extract<Msg, { kind: 'compaction' }> | null = null;

	#resetCurrent() {
		for (const m of this.#live) endLive(m);
		this.#live.clear();
		this.#assistantIdx = -1;
		this.#reasoningIdx = -1;
	}

	/** The message at `idx` now streams: its deltas are recorded for the view. */
	#startLive(idx: number) {
		const m = this.messages[idx]!;
		startLive(m);
		this.#live.add(m);
	}

	/** The message at `idx` no longer streams: views read its text whole. */
	#endLive(idx: number) {
		const m = idx >= 0 ? this.messages[idx] : undefined;
		if (m && this.#live.delete(m)) endLive(m);
	}

	/** End the active reasoning block once its tool call or the answer
	 *  starts (or the turn ends), recording how long the model thought. It
	 *  stays as the reader left it: folded unless they opened it. */
	#collapseReasoning() {
		if (this.#reasoningIdx >= 0) {
			const m = this.messages[this.#reasoningIdx];
			if (m?.kind === 'reasoning') {
				m.live = false;
				if (m.startedAt !== undefined && m.durationMs === undefined) m.durationMs = Date.now() - m.startedAt;
			}
			this.#endLive(this.#reasoningIdx);
			this.#reasoningIdx = -1;
		}
	}

	/** Clear the running flag on any tool card still marked running once a turn
	 *  ends — guards against a permanent spinner when a tool_output is never
	 *  delivered (see the `status` handler). Such a call was cut short: the
	 *  engine kept no output for it. */
	#finishStuckTools() {
		for (const m of this.messages) {
			if (m.kind === 'tool' && m.running) {
				m.running = false;
				m.cut = true;
			}
		}
	}

	/** Summarize a raw engine frame into one trace line and keep the last 200.
	 *  Deliberately compact (type + the few fields that matter for tool tracking)
	 *  so the diagnostics trace stays readable and cheap. `parsed`: the frame
	 *  already parsed (a long transcript is not parsed twice). */
	captureFrame(raw: string, parsed?: unknown) {
		let summary: string;
		try {
			const o = (parsed ?? JSON.parse(raw)) as Record<string, unknown>;
			const type = typeof o.type === 'string' ? o.type : '?';
			if (type === 'stream_event') {
				const ev = (o.event ?? {}) as Record<string, unknown>;
				const et = str(ev.type);
				const cb = (ev.content_block ?? {}) as Record<string, unknown>;
				const d = (ev.delta ?? {}) as Record<string, unknown>;
				const detail = cb.type ? `${str(cb.type)}${cb.name ? `:${str(cb.name)}` : ''}` : str(d.type);
				summary = `stream_event/${et}${detail ? ` ${detail}` : ''}`;
			} else if (type === 'user') {
				const content = ((o.message as Record<string, unknown>)?.content ?? []) as unknown;
				const tr = Array.isArray(content) ? content.find((b) => (b as Record<string, unknown>)?.type === 'tool_result') : null;
				summary = tr ? `user/tool_result ${str((tr as Record<string, unknown>).tool_use_id)}` : 'user/message';
			} else if (type === 'assistant') {
				const content = ((o.message as Record<string, unknown>)?.content ?? []) as unknown[];
				const kinds = Array.isArray(content) ? content.map((b) => str((b as Record<string, unknown>).type)).join(',') : '';
				summary = `assistant [${kinds}]`;
			} else if (type === 'system') {
				summary = `system/${str(o.subtype)}`;
			} else {
				summary = `${type}${o.subtype ? `/${str(o.subtype)}` : ''}`;
			}
			if (o.parent_tool_use_id) summary += ' ⤷sub';
		} catch {
			summary = `⚠ unparseable (${raw.length}b): ${raw.slice(0, 60)}`;
		}
		this.frameTrace.push(summary);
		if (this.frameTrace.length > 200) this.frameTrace.splice(0, this.frameTrace.length - 200);
	}

	#tool(callId: string): Extract<Msg, { kind: 'tool' }> | undefined {
		const hit = this.#toolsByCallId.get(callId);
		if (hit) return hit;
		for (let i = this.messages.length - 1; i >= 0; i--) {
			const m = this.messages[i];
			if (m.kind === 'tool' && m.callId === callId) return m;
		}
		return undefined;
	}

	#remember(patch: BackendProfile) {
		rememberProfile(profileKey(this.backendId, this.acpAgentId), patch);
	}

	/** A draft (no engine yet) shows what its backend reported last time. */
	seedFromProfile() {
		const p = loadProfile(profileKey(this.backendId, this.acpAgentId));
		this.provider = p.provider ?? '';
		this.model = p.model ?? '';
		this.modelLabel = p.modelLabel ?? '';
		this.effort = p.effort ?? '';
		this.efforts = p.efforts ?? [];
		this.contextWindow = p.contextWindow ?? 0;
		this.modelCatalog = p.catalog ?? [];
		this.modelCatalogEffort = p.catalogEffort ?? '';
		this.commands = p.commands ?? [];
	}

	/** A model picked for a draft. No engine reports it yet, so the context
	 *  gauge takes its window from the list it was picked from (`window`, else
	 *  the draft's model list; 0 when unknown, which hides the gauge) and has
	 *  no compaction limit until the engine starts and reports both. Without
	 *  this the gauge kept the window of the model the backend ran last
	 *  (ticket #34: a GPT model's 922K beside DeepSeek V4.1 Flash, whose
	 *  provider was set to 400K). */
	pickDraftModel(model: string, label = '', window?: number) {
		this.model = model;
		this.modelLabel = label;
		this.contextWindow = window ?? this.modelCatalog.find((m) => m.model === model)?.context_window ?? 0;
		this.contextLimit = 0;
	}

	/** A spawn_agent call finished: an engine that reports its subagents
	 *  only there (LynShen before the agent trace) names the agent in the
	 *  output (`path`, `task_name`, `status`). */
	#spawned(callId: string, output: string, args: string) {
		let out: Record<string, unknown>;
		try {
			out = JSON.parse(output) as Record<string, unknown>;
		} catch {
			return;
		}
		const path = str(out.path);
		if (!path) return;
		const prev = this.subagents[path];
		this.subagents[path] = {
			...prev,
			status: prev?.status ?? (str(out.status) || 'running'),
			message: prev?.message ?? '',
			label: prev?.label ?? (str(out.nickname) || str(out.task_name) || undefined),
			toolUseId: prev?.toolUseId ?? callId,
			startedAt: prev?.startedAt ?? Date.now()
		};
		// The call's arguments name its role and isolation; its output, the workdir.
		let input: Record<string, unknown> = {};
		try {
			const v = JSON.parse(args) as unknown;
			if (v && typeof v === 'object' && !Array.isArray(v)) input = v as Record<string, unknown>;
		} catch {
			/* no arguments shown */
		}
		this.#noteTeam(path, { ...input, ...out });
	}

	/** A list_agents call's answer names each agent's workdir and, once it
	 *  finished, the files it changed (`agents[].task_name` is its path). */
	#listed(output: string) {
		let out: Record<string, unknown>;
		try {
			out = JSON.parse(output) as Record<string, unknown>;
		} catch {
			return;
		}
		for (const a of arr<Record<string, unknown>>(out.agents)) {
			const path = str(a?.task_name);
			if (!path.startsWith('/')) continue;
			const result = a.result && typeof a.result === 'object' ? (a.result as Record<string, unknown>) : {};
			this.#noteTeam(path, { ...result, ...a, files_changed: result.files_changed });
		}
	}

	/** Records how an agent's run ended (failedAgents): a failure with its
	 *  error (an error already known stays when this one has none), and any
	 *  other state but the team's words for its worktree drops it. */
	#noteOutcome(path: string, status: string, error: string) {
		if (AFTER_RUN.has(status)) return;
		if (runState(status) === 'failed') this.failedAgents[path] = error || this.failedAgents[path] || '';
		else if (path in this.failedAgents) delete this.failedAgents[path];
	}

	/** Records what an event says of a team agent: `role`, `plan_step`,
	 *  `workdir`, `isolation`, `files_changed`, `background`, `attempt_group`
	 *  and `attempt` (each only when present). */
	#noteTeam(path: string, raw: Record<string, unknown>) {
		const prev = this.team[path];
		const role = str(raw.role);
		const step = raw.plan_step;
		const workdir = str(raw.workdir);
		const files = Array.isArray(raw.files_changed)
			? arr<unknown>(raw.files_changed).filter((f): f is string => typeof f === 'string' && f !== '')
			: null;
		const named = typeof step === 'string' && step.trim() ? step.trim() : typeof step === 'number' ? String(step) : '';
		const background = typeof raw.background === 'boolean' ? raw.background : null;
		const group = str(raw.attempt_group);
		const attempt = typeof raw.attempt === 'number' && raw.attempt >= 1 ? Math.floor(raw.attempt) : null;
		if (!prev && !role && !named && !workdir && !files?.length && !background && !group) return;
		const dir = workdir || prev?.workdir || '';
		const base = prev ?? blankTeam();
		this.team[path] = {
			...base,
			role: role || base.role,
			planStep: named || (step === null ? null : base.planStep),
			workdir: dir,
			worktree: base.worktree || isWorktree(dir, str(raw.isolation)),
			files: files ?? base.files,
			background: background ?? base.background,
			attemptGroup: group || base.attemptGroup,
			attempt: attempt ?? base.attempt
		};
	}

	/** The op that merges a subagent's worktree into the project (`apply`)
	 *  or drops it (`discard`); marks the agent as waiting for the answer. */
	mergeAgent(target: string, action: 'apply' | 'discard'): { op: 'merge_agent'; target: string; action: 'apply' | 'discard' } {
		const a = this.team[target];
		if (a) a.pending = action;
		return { op: 'merge_agent', target, action };
	}

	/** The op that stops one subagent; marks it as stopping until its
	 *  lifecycle says it ended. */
	closeAgent(target: string): { op: 'close_agent'; target: string } {
		this.stopRequested[target] = Date.now();
		return { op: 'close_agent', target };
	}

	/** Best-of-N: the op that merges `target`'s attempt and discards the
	 *  other attempts of `group`; marks each as waiting for its merge_result. */
	pickAttempt(group: string, target: string): { op: 'pick_attempt'; group: string; target: string } {
		this.attemptPicks[group] = target;
		for (const [path, a] of Object.entries(this.team)) if (a.attemptGroup === group) a.pending = path === target ? 'apply' : 'discard';
		return { op: 'pick_attempt', group, target };
	}

	/** The messages an agent sent or received, oldest first. */
	messagesOf(path: string): AgentMessage[] {
		return this.agentMessages.filter((m) => m.from === path || m.to === path);
	}

	/** The message a `send_to_session` call sent, as its events report it. */
	sendOf(callId: string): SessionMessageView | undefined {
		const id = callId ? this.sendLinks[callId] : undefined;
		return id === undefined ? undefined : this.sessionMessages.find((m) => m.id === id);
	}

	#nextMessageId = 1;

	/** A `session_message` event: this conversation's end of a message to or
	 *  from another one. `session` (the daemon's routing field) says which end
	 *  this is; the event names both. */
	#sessionMessage(ev: AgentEvent) {
		const msg = readSessionMessageEvent(ev);
		if (!msg) return;
		sessionInbox.note(msg);
		const own = str(ev.session) || this.sessionId;
		// An end not known yet is taken for the sender's: only it has a call
		// to link the message to.
		const outgoing = !own || msg.from === own;
		const known = matchMessage(this.sessionMessages, msg);
		if (known) {
			known.status = msg.status;
			if (msg.fromTitle) known.fromTitle = msg.fromTitle;
			if (msg.toTitle) known.toTitle = msg.toTitle;
			return;
		}
		const id = this.#nextMessageId++;
		this.sessionMessages.push({ ...msg, id, outgoing, at: Date.now() });
		if (!outgoing) return;
		// The call that sent it: the latest send_to_session not linked yet
		// that names no other conversation (its arguments may not show).
		const linked = new Set(Object.keys(this.sendLinks));
		const call = this.messages.findLast((m) => {
			if (m.kind !== 'tool' || m.name !== 'send_to_session' || !m.callId || linked.has(m.callId)) return false;
			const target = sendTarget(m);
			return !target || target === msg.to;
		});
		if (call?.kind === 'tool') this.sendLinks[call.callId] = id;
	}

	handle(ev: AgentEvent) {
		// The engine has spoken — the child is up, so the boot animation ends.
		this.booting = false;
		switch (ev.type) {
			case 'startup':
				// An engine that recovered from a failed resume in-process (codex
				// opens a fresh thread) is fine: its new id is resumable.
				this.resumeBroken = false;
				// A new engine reports its own plan, if any (a switch to the gateway
				// has none).
				this.planUsage = null;
				this.model = str(ev.model);
				this.cwd = str(ev.cwd);
				if (str(ev.session_id)) this.sessionId = str(ev.session_id);
				this.contextWindow = num(ev.context_window);
				this.#cacheWatch.reset();
				// A fresh engine incarnation (first start, crash auto-restart or
				// provider switch) announces its approval mode next — re-arm the
				// startup sync so the desktop's persisted mode is pushed again.
				this.#modeSynced = false;
				break;
			case 'approval_mode_pending': {
				const mode = str(ev.mode);
				this.approvalPending = mode ? (PENDING_MODES[mode] ?? fromEngineMode(mode)) : null;
				break;
			}
			case 'approval_mode': {
				const engineMode = str(ev.mode);
				if (fromEngineMode(engineMode)) this.#engineMode = engineMode;
				if (this.agent || this.followEngineMode) {
					this.approvalMode = reconcileMode(this.approvalMode, engineMode);
					break;
				}
				if (!this.#modeSynced) {
					// Startup announcement: the desktop's persisted mode wins — ask the
					// page to push it if the engine (default read-only) differs.
					this.#modeSynced = true;
					if (engineMode !== toEngineMode(this.approvalMode)) {
						this.pendingModeSync = toEngineMode(this.approvalMode);
						break;
					}
				}
				// Post-sync the engine is the source of truth (e.g. a manually typed
				// /approvals, or the ack of our own set_approval_mode).
				this.setApprovalMode(reconcileMode(this.approvalMode, engineMode));
				break;
			}
			case 'model_status':
				if (str(ev.model) !== this.model) this.#cacheWatch.reset();
				this.provider = str(ev.provider);
				this.model = str(ev.model);
				this.modelLabel = str(ev.model_label);
				this.effort = str(ev.reasoning_effort);
				this.efforts = arr<string>(ev.reasoning_efforts);
				this.inputModalities = Array.isArray(ev.input_modalities) ? arr<string>(ev.input_modalities) : null;
				this.ultracode = ev.ultracode === true;
				this.ultracodeAvailable = ev.ultracode_available === true;
				this.fast = ev.fast === true;
				this.fastAvailable = ev.fast_available === true;
				this.thinkingSummaries = typeof ev.thinking_summaries === 'boolean' ? ev.thinking_summaries : null;
				this.engineState = str(ev.state) || this.engineState;
				this.contextWindow = num(ev.context_window);
				this.contextLimit = num(ev.context_limit);
				this.#remember({
					provider: this.provider,
					model: this.model,
					modelLabel: this.modelLabel,
					effort: this.effort,
					efforts: this.efforts,
					contextWindow: this.contextWindow
				});
				break;
			case 'user_message': {
				const text = str(ev.content);
				this.steering = null;
				// Skip the echo of a message we already showed optimistically. The
				// echo need not be the last message: claude's --replay-user-messages
				// re-emits the user turn AFTER the assistant reply, so the optimistic
				// bubble is no longer at the tail — match on the pending echo alone.
				if (this.#pendingUserEcho === text) {
					this.#pendingUserEcho = null;
					this.#resetCurrent();
					break;
				}
				// A real, non-optimistic user message (e.g. a queued send that was
				// never shown optimistically) — clear any stale echo so it can't
				// later swallow an identical message.
				this.#pendingUserEcho = null;
				this.lastError = null;
				// Sent from elsewhere (another device, a queue): the user's own turn,
				// so no retry of the turn before it is still due.
				this.lastTurnAuto = false;
				this.autoRetries = 0;
				this.autoRetry = null;
				// A background subagent's result starting a turn by itself: it
				// renders as a line (parseDelivery), and the agents stay listed
				// through the turn it starts.
				const woke = parseSubagentResult(text);
				if (woke && this.#turnStart === null) for (const path of woke.paths) this.#woke.add(path);
				// Another conversation's message, delivered: it no longer waits.
				const own = str(ev.session) || this.sessionId;
				if (own) for (const m of parseSessionMessage(text) ?? []) sessionInbox.arrived(own, m.from, m.body);
				// No send state: claude echoes after the reply, when it would stick.
				const images = arr<string>(ev.images).filter((p) => typeof p === 'string');
				this.messages.push({ kind: 'user', text, ...(images.length ? { images } : {}) });
				this.#resetCurrent();
				break;
			}
			case 'assistant_start':
				// The engine fires this eagerly at turn start, before reasoning. Don't
				// create the message here — let the first delta create it, so reasoning
				// (which streams first) is rendered above the answer.
				this.#endLive(this.#assistantIdx);
				this.#assistantIdx = -1;
				break;
			case 'assistant_delta': {
				this.#outputStarted();
				if (this.#assistantIdx < 0) {
					this.#collapseReasoning();
					this.messages.push({ kind: 'assistant', text: '' });
					this.#assistantIdx = this.messages.length - 1;
					this.#startLive(this.#assistantIdx);
				}
				const m = this.messages[this.#assistantIdx];
				if (m?.kind === 'assistant') {
					const delta = str(ev.delta);
					m.text += delta;
					liveText(m)?.append(delta);
				}
				break;
			}
			case 'response_interrupted': {
				// The response streaming now was cut off for a steered message and
				// the engine keeps none of it. What streamed of it stays where it
				// is, finished and marked; the next deltas start new messages
				// after the steered one.
				const reply = this.#assistantIdx >= 0 ? this.messages[this.#assistantIdx] : undefined;
				if (reply?.kind === 'assistant') reply.interrupted = true;
				const thought = this.#reasoningIdx >= 0 ? this.messages[this.#reasoningIdx] : undefined;
				if (thought?.kind === 'reasoning') thought.interrupted = true;
				this.#collapseReasoning();
				this.#closeSegment(Date.now());
				this.call = null;
				break;
			}
			case 'thinking_start':
				// lynshen: the gateway answered; the first token is on its way.
				if (this.#sending?.state === 'connecting' || this.#sending?.state === 'sending') this.#setSend('waiting');
				if (this.call) this.call = { phase: 'ttft', since: Date.now() };
				break;
			case 'reasoning_delta': {
				this.#outputStarted();
				if (this.#reasoningIdx < 0) {
					this.messages.push({ kind: 'reasoning', text: '', collapsed: true, live: true, startedAt: Date.now() });
					this.#reasoningIdx = this.messages.length - 1;
					// The view reads the newest part from the deltas (liveText.ts).
					this.#startLive(this.#reasoningIdx);
				}
				const m = this.messages[this.#reasoningIdx];
				if (m?.kind === 'reasoning') {
					const delta = str(ev.delta);
					m.text += delta;
					liveText(m)?.append(delta);
				}
				break;
			}
			case 'tool_start':
				this.#outputStarted();
				this.#turnTools++;
				// The request is done; its tools run untimed. Text after them is a
				// new segment, below the tool cards.
				this.call = null;
				this.#closeSegment(Date.now());
				// One reasoning block per round: collapse this round's reasoning once
				// its tool call appears, so the next round starts a fresh block.
				this.#collapseReasoning();
				{
					const callId = str(ev.call_id);
					const toolMsg: Extract<Msg, { kind: 'tool' }> = {
						kind: 'tool',
						callId,
						name: str(ev.name),
						output: '',
						running: true,
						isError: false,
						startedAt: Date.now(),
						...(str(ev.subagent) ? { subagent: str(ev.subagent) } : {})
					};
					this.messages.push(toolMsg);
					// Index the proxied copy: writes to the raw object would not render
					// once the card has read it (tool_update / tool_output never showed).
					const pushed = this.messages[this.messages.length - 1];
					if (callId && pushed?.kind === 'tool') this.#toolsByCallId.set(callId, pushed);
					if (pushed?.kind === 'tool' && pushed.subagent) this.subagentLastTool[pushed.subagent] = pushed;
				}
				break;
			case 'tool_update': {
				const t = this.#tool(str(ev.call_id));
				if (t) {
					t.output = boundedOutput(str(ev.output));
					if (SUBAGENT_CALLS.has(t.name) || t.name === 'send_to_session') t.args = t.output;
					const started = /^started: (.+)/.exec(t.output)?.[1]?.trim();
					if (started && !t.target) t.target = started;
				}
				break;
			}
			case 'tool_output': {
				// The call ran: it was decided here, on another device, or by
				// a mode switch, so its card goes.
				this.#dropApproval(str(ev.call_id));
				if (this.#answered?.approval.callId === str(ev.call_id)) this.#answered = null;
				// Engines that do not announce each request (codex) start the next
				// one once the tools are back.
				this.#segStart = Date.now();
				const t = this.#tool(str(ev.call_id));
				if (t) {
					t.output = boundedOutput(str(ev.output));
					t.running = false;
					t.isError = ev.is_error === true;
					// Its output came after all: the engine kept it.
					if (t.cut) delete t.cut;
				}
				if (str(ev.name) === 'spawn_agent' && ev.is_error !== true) this.#spawned(str(ev.call_id), str(ev.output), t?.args ?? '');
				if (str(ev.name) === 'list_agents' && ev.is_error !== true) this.#listed(str(ev.output));
				// A successful browser_open acknowledgement carries the URL the agent
				// wants shown — drive the embedded browser panel.
				if (ev.is_error !== true && str(ev.name) === 'browser_open') {
					try {
						const out = JSON.parse(str(ev.output)) as Record<string, unknown>;
						if (typeof out.url === 'string' && out.url) ChatState.onBrowserOpen?.(out.url);
					} catch {
						/* non-JSON output */
					}
				}
				// Record files touched by a successful edit tool for the Changes panel.
				if (ev.is_error !== true && EDIT_TOOLS.includes(str(ev.name))) {
					try {
						const out = JSON.parse(str(ev.output)) as Record<string, unknown>;
						const paths = [out.path, ...(Array.isArray(out.paths) ? out.paths : [])];
						const edited: string[] = [];
						// One file's edit: keep its diff (bounded) for an exact undo,
						// by the project-relative name its diff header carries.
						const label = /^\+\+\+ b\/(.+)$/m.exec(str(out.diff))?.[1];
						if (label && typeof out.path === 'string' && !Array.isArray(out.paths)) {
							const list = (this.agentDiffs[label] ??= []);
							if (list.length < 200) list.push(str(out.diff));
						}
						for (const p of paths) {
							if (typeof p === 'string' && p) {
								edited.push(p);
								if (!this.changedFiles.includes(p)) this.changedFiles.push(p);
							}
						}
						// Attribute the edit's ±line counts to the current user turn.
						if (edited.length) {
							const turn = this.userTurns - 1;
							if (turn >= 0) {
								const { added, removed } = countDiffLines(str(out.diff));
								const bucket = (this.turnEdits[turn] ??= {});
								for (const p of edited) {
									const cur = (bucket[p] ??= { added: 0, removed: 0 });
									cur.added += added;
									cur.removed += removed;
								}
							}
							ChatState.onFilesEdited?.(edited);
						}
					} catch (e) {
						/* non-JSON output */
						console.warn('tool_output JSON parse failed', e);
					}
				}
				break;
			}
			case 'assistant_uuid': {
				// Stamp the transcript uuid on the active/last assistant turn (claude
				// rewind resume-at target).
				const uuid = str(ev.uuid);
				if (uuid) {
					let m = this.#assistantIdx >= 0 ? this.messages[this.#assistantIdx] : null;
					if (m?.kind !== 'assistant') {
						for (let i = this.messages.length - 1; i >= 0; i--) {
							if (this.messages[i].kind === 'assistant') {
								m = this.messages[i];
								break;
							}
						}
					}
					if (m?.kind === 'assistant') m.uuid = uuid;
				}
				break;
			}
			case 'session_usage': {
				this.billingError = str(ev.billing_error);
				if (ev.totals) {
					const totals = ev.totals as unknown as BillingCost;
					// Keep the last settled figures visible if the ledger is offline.
					if (!this.billingError || !this.billing) {
						this.billing = totals.gateway_requests > 0 ? totals : null;
						for (const row of arr<BillingCost & { turn_id: string }>(ev.turns)) this.#billingTurns[row.turn_id] = row;
						for (const m of this.messages) {
							if (m.kind === 'assistant' && m.turn) m.turn.billing = this.#turnBilling(m.turn.billingTurns ?? []);
						}
					}
				}
				break;
			}
			case 'context_breakdown':
				this.contextBreakdown = ev.error
					? { error: str(ev.error) }
					: {
							total: num(ev.total),
							max: num(ev.max),
							categories: arr<Record<string, unknown>>(ev.categories).map((c) => ({
								name: str(c.name),
								tokens: num(c.tokens),
								kind: str(c.kind) || 'used'
							})),
							memoryFiles: arr<Record<string, unknown>>(ev.memory_files).map((f) => ({ path: str(f.path), tokens: num(f.tokens) }))
						};
				break;
			case 'context_usage':
				this.contextTokens = num(ev.tokens);
				if (this.#compactedCard) {
					this.#compactedCard.after = this.contextTokens;
					this.#compactedCard = null;
				}
				this.requestParts = parseBreakdown(ev.breakdown);
				if (typeof ev.cost === 'number') {
					this.cost = ev.cost;
					this.#engineCost = true;
				}
				break;
			case 'pending_messages':
				this.pendingMessages = arr<string>(ev.messages);
				break;
			case 'unqueued':
				this.unqueued = { text: str(ev.text), seq: (this.unqueued?.seq ?? 0) + 1 };
				break;
			case 'tree_view':
				this.picker = { kind: 'tree', nodes: arr<TreeNode>(ev.nodes) };
				break;
			case 'model_view':
				this.modelCatalog = arr<ModelOption>(ev.models);
				this.modelCatalogEffort = str(ev.active_effort);
				this.#remember({ catalog: this.modelCatalog, catalogEffort: this.modelCatalogEffort });
				// A background refresh (the model list changed) updates the list
				// without opening the menu.
				if (this.silentModelView > 0) {
					this.silentModelView--;
					break;
				}
				this.picker = {
					kind: 'model',
					models: arr<ModelOption>(ev.models),
					activeEffort: str(ev.active_effort)
				};
				break;
			case 'resume_view':
				this.picker = {
					kind: 'resume',
					items: arr<ResumeItem>(ev.items),
					...(isBackendId(str(ev.backend)) ? { backend: str(ev.backend) as BackendId } : {}),
					...(ev.history === true ? { history: true, source: 'lynshen' as const } : {})
				};
				break;
			case 'checkpoint_view': {
				const items = arr<ResumeItem>(ev.items);
				// A pencil-driven rewind targets a specific user message by position;
				// resolve it to a turn id and confirm instead of opening the picker.
				if (this.rewindIntent) {
					const target = items[this.rewindIntent.userIndex];
					const text = this.rewindIntent.text;
					this.rewindIntent = null;
					if (target) {
						this.pendingRewind = { id: target.id, text };
						break;
					}
				}
				this.picker = { kind: 'checkpoint', items };
				break;
			}
			case 'transcript': {
				// A claude conversation reopened under this chat (restart, yolo,
				// gateway switch, rewind): the replay is plain text without tool
				// cards or message uuids, so the messages held here stay.
				if (this.keepNextTranscript) {
					this.keepNextTranscript = false;
					this.#resetCurrent();
					break;
				}
				const replay = replayMessages(arr<Record<string, unknown>>(ev.items));
				// The message array is reassigned below and restored tool entries
				// carry no call_id, so the fast-lookup map is now stale — clear it
				// and let #tool() fall back to scanning.
				this.#toolsByCallId.clear();
				// Shown again after letting go of its tool outputs (armRefill): the
				// same conversation fills them back in where they are, and what only
				// this chat knew (reasoning, notices, turn stats, errors, call ids,
				// the reply streaming now) stays.
				const refill = this.#refillNext;
				this.#refillNext = false;
				const same = refill ? refilled(this.messages, replay) : null;
				if (same) {
					this.messages = same;
					break;
				}
				// A message sent just before the snapshot arrived (a session that
				// opens with its first message) is not in it yet: keep its bubble.
				// If the snapshot already has it, its echo came with it.
				const pending = this.#pendingUserEcho;
				const sent = pending === null ? undefined : this.messages.findLast((m) => m.kind === 'user' && m.text === pending);
				// One that moved on or was rewound elsewhere while its events were
				// missed keeps the turns both have and shows the replay's own.
				this.messages = refill ? merged(this.messages, replay) : replay;
				// The team's messages, as the panel and the agent's view list them.
				this.agentMessages = this.messages.flatMap((m) => (m.kind === 'agent_message' ? [{ from: m.from, to: m.to, summary: m.summary, at: 0 }] : []));
				if (pending !== null) {
					const last = this.messages.findLast((m) => m.kind === 'user');
					if (last?.kind === 'user' && last.text === pending) this.#pendingUserEcho = null;
					else if (sent && !this.messages.includes(sent)) this.messages.push(sent);
				}
				this.#resetCurrent();
				break;
			}
			case 'fill_input':
				this.pendingFill = str(ev.content);
				break;
			case 'trust_prompt':
				this.trustPrompt = {
					cwd: str(ev.cwd),
					repoRoot: typeof ev.repo_root === 'string' ? ev.repo_root : null
				};
				break;
			case 'retrying':
				// The request is sent again from the start: what it streamed so far
				// is replaced. A request's tool calls arrive only once it completed,
				// so the text, reasoning and plan still being drafted at the end are
				// this request's.
				for (let last = this.messages.at(-1); last; last = this.messages.at(-1)) {
					if (last.kind !== 'assistant' && last.kind !== 'reasoning' && !(last.kind === 'plan' && last.status === 'drafting')) break;
					this.messages.pop();
				}
				this.#resetCurrent();
				// Shown live at the end of the transcript (RetryNotice), not as a log line.
				this.retry = {
					attempt: num(ev.attempt),
					max: num(ev.max_attempts),
					reason: str(ev.reason),
					delayMs: num(ev.delay_ms),
					at: Date.now()
				};
				break;
			case 'resume_failed':
				// The engine couldn't resume the session id — restart fresh instead of
				// looping on the same doomed --resume.
				this.resumeBroken = true;
				break;
			case 'compaction_progress': {
				this.compactionTokens = num(ev.output_tokens);
				const card = this.#compaction();
				if (card) card.written = this.compactionTokens;
				break;
			}
			case 'compaction_end': {
				this.compactionTokens = 0;
				this.#cacheWatch.reset();
				if (this.engineState === 'compacting') this.engineState = 'streaming';
				// Engines that announce only the end (claude, codex) get the divider alone.
				const card = this.#compaction() ?? this.#pushCompaction();
				card.state = 'done';
				if (str(ev.summary)) card.summary = str(ev.summary);
				// The context's new size comes with the next context_usage.
				this.#compactedCard = card;
				break;
			}
			case 'compaction_failed': {
				const card = this.#compaction() ?? this.#pushCompaction();
				card.state = 'failed';
				card.error = str(ev.error);
				break;
			}
			case 'goal':
				this.goal = ev.goal ? (ev.goal as unknown as Goal) : null;
				break;
			case 'plan': {
				const next = arr<Record<string, unknown>>(ev.plan)
					.filter((p) => p && typeof p === 'object')
					.map(planStep);
				if (JSON.stringify(next) !== JSON.stringify(this.plan)) this.planAt = Date.now();
				this.plan = next;
				break;
			}
			case 'approval_request': {
				// A LynShen sandbox request names its kind; its `scopes` are the
				// sandbox's (once / session / project), not codex's always-allow ones.
				const sandbox = parseSandboxRequest(ev as Record<string, unknown>);
				this.#answered = null;
				// After the ones already waiting; one asked again keeps its place.
				const request: PendingApproval = {
					callId: str(ev.call_id),
					name: str(ev.name),
					summary: str(ev.summary),
					subagentId: typeof ev.subagent_id === 'string' && ev.subagent_id ? ev.subagent_id : null,
					hunks: parseHunks(ev.hunks),
					questions: parseQuestions(ev.questions),
					...(str(ev.url) ? { url: str(ev.url) } : {}),
					...(sandbox ? { sandbox } : Array.isArray(ev.scopes) ? { scopes: arr<AlwaysScope>(ev.scopes) } : {})
				};
				const at = this.pendingApprovals.findIndex((a) => a.callId === request.callId);
				this.pendingApprovals = at < 0 ? [...this.pendingApprovals, request] : this.pendingApprovals.map((a, i) => (i === at ? request : a));
				break;
			}
			case 'sandbox':
				this.sandbox = parseSandboxState(ev as Record<string, unknown>);
				break;
			case 'reply_style':
				this.replyStyle = parseReplyStyle(ev as Record<string, unknown>);
				break;
			case 'escalated':
				this.messages.push({ kind: 'escalation', record: parseEscalation(ev as Record<string, unknown>) });
				break;
			// The conversation moved to its engine's own TUI on some client, or
			// came back: the transcript that follows is the whole conversation,
			// what the TUI added included.
			case 'surface':
				this.inTerminal = ev.surface === 'tui';
				if (ev.surface === 'gui') this.keepNextTranscript = false;
				break;
			case 'mcp_login':
				this.mcpLoginUrl = str(ev.url);
				break;
			case 'command_list':
				this.commands = arr<CommandItem>(ev.commands);
				this.#remember({ commands: this.commands });
				break;
			case 'usage': {
				if (typeof ev.billing_turn === 'string') {
					const id = ev.billing_turn;
					if (ev.billing_gateway === true) {
						const row = this.#billingTurns[id] ?? pendingCost();
						// A further request on a known turn is not yet in its settled snapshot.
						this.#billingTurns[id] = { ...row, pending_requests: Math.max(1, row.pending_requests) };
						this.billing = { ...(this.billing ?? pendingCost()), pending_requests: Math.max(1, this.billing?.pending_requests ?? 0) };
					}
					const ids = this.#turnStart !== null ? this.#turnBillingIds : this.#lastTurn ? (this.#lastTurn.billingTurns ??= []) : [];
					if (!ids.includes(id)) ids.push(id);
					if (this.#turnStart === null && this.#lastTurn) this.#lastTurn.billing = this.#turnBilling(ids);
				}
				const out = num(ev.output_tokens);
				const inn = num(ev.input_tokens);
				// Engines without cache figures (acp) leave the field out.
				if (typeof ev.cached_input_tokens === 'number') {
					const cached = ev.cached_input_tokens;
					if (this.#cacheWatch.check(inn, cached) && this.busy) this.cacheMiss = { input: inn, cached };
					this.cacheInput += inn;
					this.cacheRead += Math.min(cached, inn);
				}
				this.totalIn += inn;
				this.totalOut += out;
				// Estimate cost from tokens when the engine doesn't report it itself.
				if (!this.#engineCost) this.cost += costUsd(this.model, inn, out);
				if (this.#turnStart !== null) {
					this.#turnIn += inn;
					this.#turnOut += out;
				} else if (this.#lastTurn) {
					// claude reports the turn's usage after the turn ended.
					this.#lastTurn.inTokens += inn;
					this.#lastTurn.outTokens += out;
					this.#lastTurn.cost = this.cost - this.#turnCostStart;
				}
				// Prefer the active assistant message (lynshen reports usage per
				// message, mid-turn). When it's already reset — e.g. claude reports
				// one usage at the end of the turn, after the assistant finished —
				// fall back to the last assistant message, matching #endTurn's
				// elapsed stamping so tokens and time land on the same bubble.
				let m = this.#assistantIdx >= 0 ? this.messages[this.#assistantIdx] : null;
				if (m?.kind !== 'assistant') {
					m = null;
					for (let i = this.messages.length - 1; i >= 0; i--) {
						if (this.messages[i].kind === 'assistant') {
							m = this.messages[i];
							break;
						}
					}
				}
				if (m?.kind === 'assistant') m.tokens = (m.tokens ?? 0) + out;
				break;
			}
			case 'subagent_lifecycle': {
				const path = str(ev.path);
				if (!path) break;
				const prev = this.subagents[path];
				// `message`: a message was queued for it, its state is unchanged.
				const status = str(ev.status) === 'message' ? (prev?.status ?? 'running') : str(ev.status);
				const now = Date.now();
				const ended = FINAL_AGENT.includes(status);
				this.subagents[path] = {
					status,
					message: str(ev.message) || (str(ev.status) === 'message' ? (prev?.message ?? '') : ''),
					...((str(ev.label) || prev?.label) ? { label: str(ev.label) || prev?.label } : {}),
					...((str(ev.model) || prev?.model) ? { model: str(ev.model) || prev?.model } : {}),
					...((str(ev.tool_use_id) || prev?.toolUseId) ? { toolUseId: str(ev.tool_use_id) || prev?.toolUseId } : {}),
					...((str(ev.role) || prev?.role) ? { role: str(ev.role) || prev?.role } : {}),
					...((ev.background === true || (prev?.background && ev.background !== false)) ? { background: true } : {}),
					startedAt: prev?.startedAt ?? now,
					...(ended ? { endedAt: prev?.endedAt ?? now } : {})
				};
				if (ended) delete this.stopRequested[path];
				if (ended && !prev?.endedAt && this.#turnStart === null) this.#endedIdle.add(path);
				this.#noteTeam(path, ev);
				this.#noteOutcome(path, status, str(ev.message));
				break;
			}
			// The team's task board: a whole snapshot each time (and again on
			// reconnect), so it replaces what was here.
			case 'task_board':
				this.taskBoard = arr<Record<string, unknown>>(ev.tasks)
					.filter((x) => x && typeof x === 'object' && str(x.id))
					.map(boardTask);
				break;
			// The agent team (工作组): messages between its agents, the answer
			// to a merge of a worktree, the turn's token budget.
			case 'agent_message': {
				const msg = { from: str(ev.from), to: str(ev.to), summary: str(ev.summary) };
				if (!msg.summary) break;
				this.agentMessages.push({ ...msg, at: Date.now() });
				this.#collapseReasoning();
				this.#closeSegment(Date.now());
				this.messages.push({ kind: 'agent_message', ...msg });
				break;
			}
			// A message between this conversation and another one moved on
			// (queued, delivered, replied).
			case 'session_message':
				this.#sessionMessage(ev);
				break;
			case 'merge_result': {
				const target = str(ev.target);
				if (!target) break;
				const action = ev.action === 'discard' ? 'discard' : 'apply';
				const files = arr<unknown>(ev.files).filter((f): f is string => typeof f === 'string');
				const prev = this.team[target] ?? blankTeam();
				this.team[target] = {
					...prev,
					worktree: true,
					files: files.length ? files : prev.files,
					pending: null,
					merge: {
						action,
						ok: ev.ok === true,
						files,
						conflicts: arr<unknown>(ev.conflicts).filter((f): f is string => typeof f === 'string'),
						error: str(ev.error) || str(ev.message)
					}
				};
				break;
			}
			case 'team_budget':
				this.teamBudget = { used: Math.max(0, num(ev.used)), limit: Math.max(0, num(ev.limit)) };
				break;
			// The plan as the model writes it: one message grows, and the
			// proposed_plan with the same id completes it.
			case 'plan_draft': {
				const id = str(ev.id);
				const known = this.messages.find((m) => m.kind === 'plan' && m.id === id);
				if (known?.kind === 'plan') {
					if (str(ev.title)) known.title = str(ev.title);
					known.text += str(ev.append);
				} else {
					this.#collapseReasoning();
					this.#closeSegment(Date.now());
					this.messages.push({ kind: 'plan', id, title: str(ev.title), text: str(ev.append), status: 'drafting' });
				}
				break;
			}
			case 'proposed_plan': {
				const id = str(ev.id);
				const plan = { kind: 'plan' as const, id, title: str(ev.title), text: str(ev.markdown), status: planStatus(ev.status) };
				const known = this.messages.find((m) => m.kind === 'plan' && m.id === id);
				if (known?.kind === 'plan') Object.assign(known, plan);
				else {
					this.#collapseReasoning();
					this.#closeSegment(Date.now());
					this.messages.push(plan);
				}
				if (plan.status !== 'pending' && this.planRevising === id) this.planRevising = null;
				break;
			}
			case 'background_tasks': {
				const before = new Map(this.bgTasks.map((x) => [x.id, x.message]));
				this.bgTasks = arr<Record<string, unknown>>(ev.tasks).map((x) => ({
					id: str(x.id),
					kind: str(x.kind),
					description: str(x.description),
					message: before.get(str(x.id)) ?? ''
				}));
				break;
			}
			case 'task_progress': {
				const task = this.bgTasks.find((x) => x.id === str(ev.task_id));
				if (task) task.message = str(ev.message);
				break;
			}
			case 'task_done':
				this.messages.push({
					kind: 'system',
					text: t('chat.taskDone', {
						kind: taskKindLabel(str(ev.kind)),
						status: t(`chat.taskStatus.${['completed', 'failed', 'stopped'].includes(str(ev.status)) ? str(ev.status) : 'completed'}`),
						summary: str(ev.summary)
					})
				});
				break;
			case 'task_output':
				this.taskOutputs[str(ev.task_id)] = {
					output: str(ev.output),
					truncated: ev.truncated === true,
					error: str(ev.error)
				};
				break;
			case 'side_answer': {
				const q = str(ev.question);
				const entry = this.sideAnswers.find((x) => x.pending && x.question === q);
				const answer = { question: q, answer: str(ev.answer), error: str(ev.error), pending: false };
				if (entry) Object.assign(entry, answer);
				else this.sideAnswers.push(answer);
				break;
			}
			case 'prompt_suggestion':
				this.suggestion = str(ev.text);
				break;
			case 'model_fallback':
				this.messages.push({
					kind: 'system',
					text: t('chat.modelFallback', { from: str(ev.from), to: str(ev.to), reason: fallbackReason(str(ev.reason)) })
				});
				break;
			case 'agent_runs': {
				this.agentRunsSeen = true;
				const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
				this.agentRuns = {
					workflows: arr<Record<string, unknown>>(ev.workflows).map((w) => ({
						id: str(w.id),
						toolUseId: str(w.tool_use_id),
						name: str(w.name),
						description: str(w.description),
						status: str(w.status),
						startedAt: n(w.started_at),
						durationMs: n(w.duration_ms),
						tokens: n(w.tokens),
						toolCalls: n(w.tool_calls),
						phases: arr<Record<string, unknown>>(w.phases).map((p) => ({ index: n(p.index), title: str(p.title) })),
						agents: arr<Record<string, unknown>>(w.agents).map(agentRun)
					})),
					agents: arr<Record<string, unknown>>(ev.agents).map(agentRun)
				};
				for (const a of arr<Record<string, unknown>>(ev.agents)) {
					const id = str(a.id);
					if (!id) continue;
					this.#noteTeam(id, a);
					if (this.stopRequested[id] && FINAL_AGENT.includes(str(a.state) || str(a.status))) delete this.stopRequested[id];
					this.#noteOutcome(id, str(a.state) || str(a.status), str(a.error));
				}
				break;
			}
			case 'subagent_transcript': {
				const items = arr<Record<string, unknown>>(ev.items);
				// The first user item is the subagent's task; the rest is its work.
				const task = items[0] && str(items[0].role) === 'user' ? str(items[0].content) : '';
				const messages = items
					.slice(task ? 1 : 0)
					.map((it): Msg | null => {
						const role = str(it.role);
						if (role === 'assistant') return { kind: 'assistant', text: str(it.content) };
						if (role === 'reasoning') return { kind: 'reasoning', text: str(it.content), collapsed: true };
						if (role === 'user') return { kind: 'system', text: str(it.content) };
						if (role === 'tool')
							return {
								kind: 'tool',
								callId: str(it.call_id),
								name: str(it.name),
								// The call's arguments name what it acted on until its output does.
								output: boundedOutput(str(it.output) || (it.input && typeof it.input === 'object' ? JSON.stringify(it.input) : str(it.input))),
								running: it.running === true,
								isError: it.is_error === true
							};
						return null;
					})
					.filter((m): m is Msg => m !== null);
				// The panel shows one at a time and asks again when it opens one:
				// only the latest few are kept.
				const id = str(ev.agent_id);
				const kept = Object.keys(this.subagentTranscripts).filter((k) => k !== id && k !== this.agentFocus);
				for (const old of kept.slice(0, Math.max(0, kept.length - SUBAGENT_TRANSCRIPTS_KEPT + 1)))
					delete this.subagentTranscripts[old];
				this.subagentTranscripts[id] = { task, messages, error: str(ev.error) };
				break;
			}
			case 'permission_rules':
				this.permissionRules = {
					rules: arr<Record<string, unknown>>(ev.rules).map((r) => ({
						behavior: str(r.behavior),
						source: str(r.source),
						rule: str(r.rule),
						editability: str(r.editability)
					})),
					directories: arr<Record<string, unknown>>(ev.directories).map((d) => ({ path: str(d.path), source: str(d.source) }))
				};
				break;
			case 'plan_usage': {
				const windows = arr<Record<string, unknown>>(ev.windows)
					.filter((w) => typeof w.used === 'number')
					.map((w) => ({
						key: str(w.key),
						used: w.used as number,
						resetsAt: typeof w.resets_at === 'number' ? w.resets_at : null,
						minutes: typeof w.minutes === 'number' ? w.minutes : null
					}));
				this.planUsage = windows.length ? { plan: typeof ev.plan === 'string' ? ev.plan : null, windows } : null;
				break;
			}
			case 'rate_limit': {
				const level = ev.level === 'limited' ? 'limited' : ev.level === 'warning' ? 'warning' : null;
				if (!level) {
					this.rateLimit = null; // limit cleared → drop the banner
					break;
				}
				const resetsAt = typeof ev.resets_at === 'number' && ev.resets_at > 0 ? ev.resets_at : null;
				this.rateLimit = { level, message: str(ev.message), resetsAt };
				break;
			}
			case 'connecting':
				this.engineState = 'connecting';
				this.suggestion = '';
				this.#startTurn();
				this.#requestStarted();
				if (this.#sending?.state === 'sending') this.#setSend('connecting');
				break;
			case 'compaction_start':
				this.engineState = 'compacting';
				this.compactionTokens = 0;
				if (!this.#compaction()) this.#pushCompaction();
				break;
			case 'status': {
				const msg = str(ev.message);
				const m = msg.match(/^(?:new|resumed) session (\S+)/);
				if (m) this.sessionId = m[1];
				// Steering takes the first queued message (the queue update follows).
				if (msg === 'steering' && this.engineState !== 'steering') this.steering = this.pendingMessages[0] ?? null;
				this.engineState = msg;
				// A status event with no error means the (possibly just-restarted) engine
				// is healthy again, so clear the crash auto-restart budget. This replaces
				// the old time-window reset, which cleared the counter merely because 30s
				// had elapsed even if every attempt had crashed.
				if (!ev.error) {
					this.restarts = 0;
					this.restartWindowStart = null;
					this.daemonRetries = 0;
				}
				if (!this.busy) {
					this.retry = null;
					// Not taken in this turn: it runs as the next one.
					this.steering = null;
					// A turn ended without an error: a later failure is a new one,
					// with its own automatic retries.
					if (this.#turnStart !== null) this.autoRetries = 0;
					this.#endTurn();
					// A turn that ends on its thinking (stopped, or no answer) still
					// records how long it thought.
					this.#collapseReasoning();
					this.#resetCurrent();
					this.#clearApprovals();
					// Safety net: a lost tool_output (e.g. a subagent frame whose
					// tool_result never mapped) would otherwise leave a card spinning
					// forever — the turn is over, so nothing is still running.
					this.#finishStuckTools();
				}
				break;
			}
			case 'mcp_servers':
				this.mcpServers = parseMcpServersEvent(ev);
				break;
			case 'info':
				this.messages.push({ kind: 'system', text: str(ev.message) });
				break;
			// Nobody was watching this hosted session, so a gated call was
			// recorded for the desk instead of prompting here.
			case 'action_deferred': {
				// A sandbox request says why the agent asked.
				const why = str(ev.justification).trim();
				this.messages.push({
					kind: 'system',
					text: why
						? t('chat.actionDeferredWhy', { name: str(ev.name), summary: str(ev.summary), why })
						: t('chat.actionDeferred', { name: str(ev.name), summary: str(ev.summary) })
				});
				break;
			}
			case 'action_decided':
				this.messages.push({
					kind: 'system',
					text: t(ev.decision === 'allow' ? 'chat.actionAllowed' : 'chat.actionDenied', {
						id: str(ev.id)
					})
				});
				break;
			case 'error': {
				// An engine older than a mode refuses it as unknown: the session
				// stays in the mode the engine is in, and the picker stops
				// offering the refused one.
				const refusedMode = refusedApprovalMode(str(ev.message));
				if (refusedMode) {
					if (!this.unsupportedModes.includes(refusedMode)) this.unsupportedModes.push(refusedMode);
					if (this.pendingModeSync && modeOfEngineName(this.pendingModeSync) === refusedMode) this.pendingModeSync = null;
					const kept = (this.#engineMode && fromEngineMode(this.#engineMode)) || 'ask';
					if (this.approvalMode === refusedMode) this.approvalMode = kept;
					this.messages.push({ kind: 'system', text: t('chat.modeUnsupported', { mode: t(MODE_LABEL_KEYS[refusedMode]), kept: t(MODE_LABEL_KEYS[kept]) }) });
					break;
				}
				// The engine did not take the answer just given to a sandbox
				// request and keeps it waiting (its words say why): the card
				// comes back, and the turn goes on.
				const answered = this.#answered;
				if (answered && !this.pendingApprovals.some((a) => a.callId === answered.approval.callId) && Date.now() - answered.at < 15_000 && APPROVE_REFUSED.test(str(ev.message))) {
					this.#answered = null;
					// Waiting again: no longer one of the settled.
					this.approvalsSettled = Math.max(0, this.approvalsSettled - 1);
					this.pendingApproval = answered.approval;
					this.messages.push({ kind: 'system', text: t('chat.approvalRefused', { msg: str(ev.message) }) });
					break;
				}
				// An engine without the agent trace refuses its ops: nothing failed.
				// A daemon from before context categories answers a Claude Code
				// session's context_usage in its own words.
				// Nor does an engine before the sandbox contract change its sandbox
				// (Settings sends only after a `sandbox` event; this is the fallback).
				const refused =
					/^unknown op: (agent_runs|subagent_transcript|merge_agent|pick_attempt|close_agent|context_usage|set_sandbox|add_directory|remove_directory)$/.exec(str(ev.message)) ??
					/^Claude Code sessions do not support (context_usage)$/.exec(str(ev.message));
				if (refused) {
					if (refused[1] === 'context_usage') this.contextBreakdown = { error: str(ev.message) };
					if (refused[1] === 'subagent_transcript' && this.agentFocus && !this.subagentTranscripts[this.agentFocus])
						this.subagentTranscripts[this.agentFocus] = { task: '', messages: [], error: t('dock.agents.noTranscript') };
					// An engine before the agent team: the merges sent are not coming.
					if (refused[1] === 'merge_agent' || refused[1] === 'pick_attempt') {
						for (const a of Object.values(this.team))
							if (a.pending) {
								a.merge = { action: a.pending, ok: false, files: [], conflicts: [], error: t('chat.team.mergeUnsupported') };
								a.pending = null;
							}
						if (refused[1] === 'pick_attempt') this.attemptPicks = {};
					}
					// …nor are the stops.
					if (refused[1] === 'close_agent' && Object.keys(this.stopRequested).length) {
						this.stopRequested = {};
						this.messages.push({ kind: 'system', text: t('chat.team.stopUnsupported') });
					}
					break;
				}
				// The conversation runs in its TUI: the daemon answers a panel's
				// request (agents, turns, goal…) with this. Nothing failed; the
				// panel fills in once the conversation is back here.
				if (/^the conversation is open in its terminal/.test(str(ev.message))) break;
				// An op this engine does not know yet (the daemon still runs the
				// previous release): it refused one request, the turn goes on.
				const unknownOp = /^unknown op: (\w+)$/.exec(str(ev.message));
				if (unknownOp) {
					this.messages.push({ kind: 'system', text: t('chat.opUnsupported') });
					break;
				}
				// Agent team v2 switched off: a stop or pick sent just before
				// comes back undone, and nothing failed.
				const off = /^(close_agent|pick_attempt) is not available: agent team v2 /.exec(str(ev.message));
				if (off) {
					if (off[1] === 'pick_attempt') {
						for (const a of Object.values(this.team)) if (a.attemptGroup && a.attemptGroup in this.attemptPicks) a.pending = null;
						this.attemptPicks = {};
					} else this.stopRequested = {};
					this.messages.push({ kind: 'system', text: t('chat.team.v2Off') });
					break;
				}
				this.retry = null;
				// A turn was being sent or run (not, say, a refused command).
				const started = this.#turnStart !== null;
				const inTurn = started || this.#sending !== null;
				const last = this.messages[this.messages.length - 1];
				this.lastError = str(ev.message);
				this.#clearApprovals();
				this.#setSend('failed');
				this.#sending = null;
				// The engines can report one failure twice (the item, then the turn).
				if (!(last?.kind === 'error' && last.text === str(ev.message)))
					this.messages.push({ kind: 'error', text: str(ev.message) });
				this.#endTurn();
				this.#resetCurrent();
				if (inTurn) ChatState.onTurnFailed?.(this, str(ev.message), started);
				break;
			}
		}
	}
}
