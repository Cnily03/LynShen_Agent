// Engine-adapter contract: one adapter instance per live session translates
// between the desktop's native (lynshen-dialect) protocol and the backend
// CLI's own wire format. See src/lib/backends/README.md for the full contract
// (ordering guarantees, approval bridging, how onStart is invoked).

import type { Op, AgentEvent } from '$lib/protocol';

export type BackendId = 'lynshen' | 'codex' | 'claude' | 'acp';

export const BACKEND_IDS: BackendId[] = ['lynshen', 'codex', 'claude', 'acp'];

/** An ACP session's registry agent: id and display name, and whether it is
 *  OpenCode (`isOpencodeAgent`), whose sessions have approval modes and the
 *  LynShen gateway switch. */
export interface AcpAgentRef {
	id: string;
	name: string;
	opencode?: boolean;
}

/** The backends with a single well-known binary (probe rows, path overrides).
 *  'acp' is excluded: it launches whichever agent the registry entry names. */
export const NATIVE_BACKEND_IDS: BackendId[] = ['lynshen', 'codex', 'claude'];

/** Display names (brand names — not localized). The 'acp' label is a generic
 *  fallback; sessions display their registry entry's name instead. */
export const BACKEND_LABELS: Record<BackendId, string> = {
	lynshen: 'LynShen',
	codex: 'Codex',
	claude: 'Claude Code',
	acp: 'ACP'
};

export function isBackendId(v: unknown): v is BackendId {
	return v === 'lynshen' || v === 'codex' || v === 'claude' || v === 'acp';
}

/** Restore path: unknown / missing backend ids collapse to 'lynshen'. */
export function normalizeBackendId(v: unknown): BackendId {
	return isBackendId(v) ? v : 'lynshen';
}

/**
 * What a backend can do, from the desktop UI's point of view. Every flag gates
 * one or more UI surfaces (see `caps()` in ./index.ts and the README's
 * capability map); adapters declare a conservative subset and widen it as
 * their translation grows.
 */
export interface BackendCaps {
	/** Engine-enforced auto-approval policy (set_approval_mode / approval_mode). */
	approvalModes: boolean;
	/** Backend exposes claude's extra approval modes ('plan' + 'auto') in the
	 *  picker, on top of the shared ask/edits/all trio. */
	extendedApprovalModes: boolean;
	/** A plan approval mode: the agent researches and proposes a plan, and
	 *  works once the user approves it (claude, codex and lynshen). */
	planMode: boolean;
	/** Per-hunk partial approval of edit tools (approve op with `hunks`). */
	hunkApproval: boolean;
	/** Queue-jumping a busy turn (steer op + queued-messages strip). */
	steer: boolean;
	/** Taking a queued message back before it runs (unqueue op): the engine
	 *  holds the queue rather than the agent's own input stream. */
	unqueue: boolean;
	/** Interrupting a running turn. */
	interrupt: boolean;
	/** Conversation branch tree (/tree, tree_view picker). */
	branchTree: boolean;
	/** Goal / plan tracking (goal + plan events, right-dock tabs). */
	goals: boolean;
	/** Skills marketplace (/skills install …). */
	skills: boolean;
	/** MCP server management ops (mcp_list / mcp_set / …). */
	mcpManage: boolean;
	/** Checkpoints / rewind (/rewind, checkpoint_view). */
	checkpoints: boolean;
	/** Context-usage reporting (context_usage events → context ring). */
	contextUsage: boolean;
	/** Manual context compaction (/compact palette entry + compaction events). */
	compact: boolean;
	/** In-chat model picker (/model, model_view) + provider switching. */
	modelPicker: boolean;
	/** Resuming persisted conversations (/resume, resume_view). */
	resume: boolean;
	/** Subagent lifecycle reporting. */
	subagents: boolean;
	/** Full transcript replay on resume (transcript events). */
	transcriptReplay: boolean;
	/** Generic slash-command support (/compact, /stats, custom commands…). */
	slashCommands: boolean;
	/** The engine keeps its own MCP config (claude): its servers can be toggled
	 *  and reconnected per session, not added or edited here. */
	mcpEngineOwned: boolean;
	/** Always-allow rules can be saved for the project or the user, and the
	 *  engine lists its permission rules (claude). */
	ruleScopes: boolean;
	/** `/btw <question>`: answered beside the conversation (side_answer events). */
	sideQuestions: boolean;
	/** The agent trace panel: Workflows and subagents with their own
	 *  conversations (agent_runs / subagent_transcript). */
	agentTrace: boolean;
	/** What the context holds, by category (`context_usage` → `context_breakdown`). */
	contextBreakdown: boolean;
	/** The LynShen sandbox: the composer's 谨慎 / 计划 / 自动 / 全自动, the
	 *  notice when commands run without isolation, the sandbox approval card
	 *  (kind, reason, scopes) and the escalation records. */
	sandbox: boolean;
	/** Reply styles (回复风格): the composer's style rows, `set_style` and
	 *  the `reply_style` event. Only LynShen's own prompt carries one. */
	replyStyles: boolean;
}

/** Normalized events are the existing lynshen AgentEvent dialect — adapters
 *  emit that dialect so ChatState stays untouched. */
export type NormalizedEvent = AgentEvent;

/** Raw stderr line forwarded by the Rust side for piped-stderr backends. */
export interface StderrPayload {
	__stderr: string;
}

export function isStderrPayload(raw: unknown): raw is StderrPayload {
	return (
		typeof raw === 'object' &&
		raw !== null &&
		typeof (raw as Record<string, unknown>).__stderr === 'string'
	);
}

/** Outbound channel handed to an adapter: writes one raw line (= one frame)
 *  to the session child's stdin. */
export interface AdapterIO {
	sendLine(line: string): void;
}

/** Session context available when the child starts. */
export interface SessionCtx {
	/** Project working directory the child was spawned in. */
	cwd: string;
	/** Preferred model, when the desktop knows one. */
	model?: string;
	/** The desktop's persisted approval mode ('ask' | 'edits' | 'all'). */
	approvalMode: string;
	/** The DESKTOP session id (the routing key for `sendLine`) — not the
	 *  engine's own conversation id. */
	sessionId: string;
	/** Engine conversation id to resume instead of starting fresh, for backends
	 *  whose resume is a protocol call rather than a spawn flag (codex
	 *  `thread/resume`). Set on crash auto-restart and saved-tab restore. */
	resume?: string;
}

/**
 * One adapter instance per session (`createLynShenAdapter()`).
 */
export interface EngineAdapter {
	readonly id: BackendId;
	readonly caps: BackendCaps;
	/** Called once each time the child process starts (initial spawn AND every
	 *  restart); may send handshake frames and reset per-process state. */
	onStart(io: AdapterIO, ctx: SessionCtx): void;
	/** One raw stdout line (parsed JSON, or a {__stderr} payload) → zero or
	 *  more normalized lynshen-style AgentEvents, in order. */
	translate(raw: unknown): NormalizedEvent[];
	/** Outgoing desktop Op → raw stdin lines (one frame each). Return null when
	 *  the op is unsupported — the caller surfaces a notice to the user. */
	encodeOp(op: Op): string[] | null;
}
