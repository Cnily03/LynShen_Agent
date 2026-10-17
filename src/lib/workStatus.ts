// What the work status line under the transcript says (Indicator.svelte):
// the step the turn is on as a verb and its object ("正在运行 pnpm vitest
// run"), when the step began, and the tool call it is, for its details. The
// words carry the stage; the line has one sign for all of them.
import type { CallTiming, Msg } from '$lib/chat.svelte';
import { parseToolOutput, toolTarget } from '$lib/toolSummary';

export type WorkPhase = 'connecting' | 'waiting' | 'generating' | 'tool' | 'compacting';
type ToolMsg = Extract<Msg, { kind: 'tool' }>;

export interface WorkStep {
	/** The verb's key under `chat.work`. */
	verb: string;
	/** What it acts on (a file, a command, a search, a tool's name); '' for nothing. */
	object: string;
	/** When the step began, if the chat knows: `exact` for a tool call (its
	 *  start), otherwise the start of the request stage it falls in, which a
	 *  status line shown afresh may count from. */
	since: number | null;
	exact: boolean;
	/** The running tool call, for its details. */
	call: ToolMsg | null;
	/** Changes when the step does (the timer starts again). */
	key: string;
}

/** The verb for each tool the engines report; others are "calling <name>". */
const TOOL_VERBS: Record<string, string> = {
	read: 'reading',
	write: 'writingFile',
	str_replace: 'editing',
	hashline_edit: 'editing',
	apply_patch: 'editing',
	bash: 'running',
	exec_command: 'running',
	write_stdin: 'running',
	ripgrep: 'searching',
	ls: 'listing',
	outline: 'outlining',
	web_search: 'searchingWeb',
	web_fetch: 'fetching',
	generate_image: 'image',
	Task: 'agents',
	Agent: 'agents',
	spawn_agent: 'agents',
	send_message: 'agents',
	close_agent: 'agents',
	list_agents: 'agents',
	agent_sendInput: 'agents',
	agent_sendMessage: 'agents',
	agent_closeAgent: 'agents',
	agent_interruptAgent: 'agents',
	agent_resumeAgent: 'agents',
	agent_listAgents: 'agents',
	wait_agent: 'waitingAgents',
	agent_wait: 'waitingAgents',
	TodoWrite: 'planning',
	update_plan: 'planning',
	list_sessions: 'sessions',
	read_session: 'sessions',
	send_to_session: 'sessions'
};

/** An MCP tool's own name (`mcp__server__tool` → `tool`). */
const shortName = (name: string) => (name.startsWith('mcp__') ? name.split('__').slice(2).join('__') || name : name);

function toolStep(m: ToolMsg): WorkStep {
	const verb = TOOL_VERBS[m.name] ?? (m.name.startsWith('browser_') ? 'browser' : 'tool');
	// The engine's card (claude, codex) names the target while the call runs;
	// lynshen names a command once, as it starts (chat.svelte.ts `target`).
	const object = verb === 'tool' ? shortName(m.name) : toolTarget(m.name, parseToolOutput(m.output)) || m.target || '';
	return { verb, object, since: m.startedAt ?? null, exact: m.startedAt !== undefined, call: m, key: `tool:${m.callId || m.name}` };
}

/** The step the turn is on (`phase`: ChatState.phase); null when nothing runs. */
export function workStep(phase: WorkPhase | (string & {}) | null, call: CallTiming | null, messages: readonly Msg[]): WorkStep | null {
	if (!phase) return null;
	const last = messages[messages.length - 1];
	const stage = (verb: string): WorkStep => ({ verb, object: '', since: call?.since ?? null, exact: false, call: null, key: verb });
	switch (phase) {
		case 'compacting':
			return stage('compacting');
		case 'tool':
			return last?.kind === 'tool' ? toolStep(last) : stage('tool');
		case 'connecting':
			return stage('connecting');
		case 'waiting':
			// Sent, not connected yet (lynshen reports the connection).
			return stage(call?.phase === 'connect' ? 'connecting' : 'thinking');
		case 'generating':
			return stage(last?.kind === 'assistant' ? 'writing' : 'thinking');
		default:
			return null;
	}
}

/** Whole seconds, then minutes: `24s`, `3m05s`. */
export function workElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}
