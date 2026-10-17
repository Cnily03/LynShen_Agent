// What the conversation shows of a turn's progress: its todo list (the plan)
// and the subagents it runs, as the plan and subagents cards at the top right
// of the chat and the subagent cards in the message list read them. Pure: the components pass
// in the chat's state and a clock.

import type { AgentRun, BoardTask, PlanStep, SubagentInfo, TaskStatus, TeamAgent, TeamBudget, WorkflowRun } from './chat.svelte';
import { AFTER_RUN, runState, type RunState } from './agentTrace';

export type StepState = 'pending' | 'active' | 'done' | 'skipped';

/** A plan step's status as one of four (engines say in_progress, inProgress, completed …). */
export function stepState(status: string): StepState {
	switch (status) {
		case 'in_progress':
		case 'inProgress':
		case 'active':
		case 'running':
			return 'active';
		case 'completed':
		case 'done':
			return 'done';
		case 'skipped':
		case 'cancelled':
		case 'canceled':
			return 'skipped';
		default:
			return 'pending';
	}
}

export interface PlanSummary {
	/** `agent`: the path of the subagent that owns the step ('' for none). */
	steps: { text: string; state: StepState; agent: string; files: string[] }[];
	/** Steps done or skipped. */
	done: number;
	total: number;
	/** The step being worked on (the first active one, else the first pending
	 *  one while work remains); -1 when there is none. */
	current: number;
}

/** The plan's steps and progress. A step's owner is the agent the plan
 *  names, else the team agent that reports working on it (`plan_step`: the
 *  step's text or its 1-based number). */
export function planSummary(plan: PlanStep[], team: Record<string, Pick<TeamAgent, 'planStep'>> = {}): PlanSummary {
	const indexOf = (key: string) => (/^\d+$/.test(key) ? Number(key) - 1 : plan.findIndex((p) => p.step.trim() === key));
	const byStep = new Map<number, string>();
	for (const [path, a] of Object.entries(team)) {
		const at = a.planStep === null ? -1 : indexOf(a.planStep);
		if (at >= 0 && !byStep.has(at)) byStep.set(at, path);
	}
	const steps = plan.map((p, i) => ({ text: p.step, state: stepState(p.status), agent: p.agent || byStep.get(i) || '', files: p.files ?? [] }));
	const done = steps.filter((s) => s.state === 'done' || s.state === 'skipped').length;
	let current = steps.findIndex((s) => s.state === 'active');
	if (current < 0 && done < steps.length && done > 0) current = steps.findIndex((s) => s.state === 'pending');
	return { steps, done, total: steps.length, current };
}

/** One subagent as the subagents card and its spawn card show it. */
export interface AgentRow {
	/** The id its conversation is read by (agent_runs / lifecycle path). */
	id: string;
	label: string;
	model: string;
	state: RunState;
	startedAt: number;
	/** Its reported running time, ms. */
	durationMs: number;
	/** When this client saw it end, ms (0: not seen). */
	endedAt: number;
	/** Its latest action, in one line. */
	activity: string;
	/** The call that started it. */
	toolUseId: string;
	prompt: string;
	result: string;
	error: string;
	/** Its kind as the engine names it (claude's subagent_type, e.g. Explore); '' when unknown. */
	type: string;
	/** Tokens and tool calls so far (the agent trace; 0 when the engine sends none). */
	tokens: number;
	toolCalls: number;
	/** A Workflow (claude), not one agent: opens the trace's run list. */
	workflow?: boolean;
	/** Workflow agents finished out of all. */
	progress?: { done: number; total: number };
	/** The engine's own word for its state: `conflict` and `budget_exhausted`
	 *  say more than `state`. */
	status?: string;
	/** Its role in the agent team ('' for none). */
	role?: string;
	/** What the agent team knows of it: plan step, worktree, merge. */
	team?: TeamAgent;
	/** It runs in the background: past the end of the turn that started it. */
	background?: boolean;
	/** Best-of-N: the group of attempts it belongs to, and its number (1-based). */
	attemptGroup?: string;
	attempt?: number;
	/** A close_agent op was sent for it and it has not stopped yet. */
	stopping?: boolean;
}

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? '';

/** Lifecycle words that are not news (an agent queued, started, finished). */
const QUIET = new Set(['', 'reserved', 'started', 'finished', 'queued message', 'close requested']);

export interface RowInput {
	runs: { workflows: WorkflowRun[]; agents: AgentRun[] };
	subagents: Record<string, SubagentInfo>;
	/** The latest call a claude subagent made, by its label, in one line. */
	lastTool?: (label: string) => string;
	/** Only runs started since (ms), besides the running ones and the ones the
	 *  lifecycle still lists; 0 keeps every run. */
	since?: number;
	/** The agent team by agent path (roles, worktrees, merges). */
	team?: Record<string, TeamAgent>;
	/** Agents asked to stop, by path (ChatState.stopRequested). */
	stopping?: Record<string, unknown>;
	/** Agents whose last run failed, by path, with its error
	 *  (ChatState.failedAgents). */
	failed?: Record<string, string>;
}

/** How an agent's run ended, as every view shows it, and its error. One
 *  whose run failed stays failed once its worktree is merged, discarded or
 *  conflicts: the engine then reports that word in place of the failure.
 *  `word` is the engine's state word, `error` the error it reports with it,
 *  `failure` the error ChatState.failedAgents kept of its last run that
 *  failed (undefined: none). */
export function agentOutcome(word: string, error: string, failure?: string): { state: RunState; error: string } {
	const state = runState(word);
	if (state === 'failed' || (AFTER_RUN.has(word) && (error || failure !== undefined))) return { state: 'failed', error: error || failure || '' };
	return { state, error };
}

/** The subagents to show, oldest first: the agent trace's runs (when the engine
 *  sends one), joined with what their lifecycle events say, then the
 *  subagents only the lifecycle (or a spawn call) reports. */
export function agentRows({ runs, subagents, lastTool, since = 0, team = {}, stopping = {}, failed = {} }: RowInput): AgentRow[] {
	const rows: AgentRow[] = [];
	const seen = new Set<string>();
	// A few seconds of slack: the engine stamps a run with its own clock.
	const recent = (state: RunState, startedAt: number, id: string) =>
		state === 'running' || state === 'queued' || id in subagents || !since || startedAt >= since - 5000;
	for (const w of runs.workflows) {
		const state = runState(w.status);
		if (!recent(state, w.startedAt, w.id)) continue;
		seen.add(w.id);
		const done = w.agents.filter((a) => !['running', 'queued'].includes(runState(a.state))).length;
		const live = w.agents.filter((a) => runState(a.state) === 'running');
		rows.push({
			id: w.id,
			label: w.name || firstLine(w.description) || w.id,
			model: '',
			state,
			startedAt: w.startedAt,
			durationMs: w.durationMs,
			endedAt: 0,
			activity: live.length ? live.map((a) => a.label).filter(Boolean).join(' · ') : firstLine(w.description),
			toolUseId: w.toolUseId,
			prompt: w.description,
			result: '',
			error: '',
			type: '',
			tokens: w.tokens,
			toolCalls: 0,
			workflow: true,
			progress: { done, total: w.agents.length }
		});
	}
	for (const a of runs.agents) {
		const life = subagents[a.id];
		const { state, error } = agentOutcome(a.state || life?.status || '', a.error, failed[a.id]);
		if (!a.id || !recent(state, a.startedAt, a.id)) continue;
		seen.add(a.id);
		const label = a.label || life?.label || a.id;
		rows.push({
			id: a.id,
			label: shortPath(label),
			model: a.model || life?.model || '',
			state,
			...teamOf(a.id, team, TEAM_STATUS.has(life?.status ?? '') ? life!.status : a.state || life?.status || '', life, state, stopping),
			startedAt: a.startedAt || life?.startedAt || 0,
			durationMs: a.durationMs,
			endedAt: life?.endedAt ?? 0,
			activity: activityOf(state, a.activity, lastTool?.(label) ?? '', life?.message ?? '', a.result, error, a.prompt),
			toolUseId: a.toolUseId || life?.toolUseId || '',
			prompt: a.prompt,
			result: a.result,
			error,
			type: a.type,
			tokens: a.tokens,
			toolCalls: a.toolCalls
		});
	}
	for (const [id, life] of Object.entries(subagents)) {
		if (seen.has(id)) continue;
		const { state, error } = agentOutcome(life.status, runState(life.status) === 'failed' ? life.message : '', failed[id]);
		const label = life.label || id;
		rows.push({
			id,
			label: shortPath(label),
			model: life.model ?? '',
			state,
			...teamOf(id, team, life.status, life, state, stopping),
			startedAt: life.startedAt ?? 0,
			durationMs: life.endedAt && life.startedAt ? life.endedAt - life.startedAt : 0,
			endedAt: life.endedAt ?? 0,
			activity: activityOf(state, '', lastTool?.(label) ?? '', life.message, '', error, ''),
			toolUseId: life.toolUseId ?? '',
			prompt: '',
			result: '',
			error,
			type: '',
			tokens: 0,
			toolCalls: 0
		});
	}
	return rows;
}

/** Lifecycle words the agent trace does not know. */
const TEAM_STATUS = new Set(['conflict', 'merged', 'discarded', 'budget_exhausted']);

/** What a row says of the agent team: the engine's state word (the
 *  lifecycle's `conflict` / `budget_exhausted` win over the trace's), the
 *  role, the team entry, whether it runs in the background, its attempt and
 *  whether it is being stopped. */
function teamOf(
	id: string,
	team: Record<string, TeamAgent>,
	status: string,
	life: SubagentInfo | undefined,
	state: RunState,
	stopping: Record<string, unknown>
): Pick<AgentRow, 'status' | 'role' | 'team' | 'background' | 'attemptGroup' | 'attempt' | 'stopping'> {
	const entry = team[id];
	return {
		status,
		role: entry?.role || life?.role || '',
		...(entry ? { team: entry } : {}),
		...(entry?.background || life?.background ? { background: true } : {}),
		...(entry?.attemptGroup ? { attemptGroup: entry.attemptGroup, ...(entry.attempt ? { attempt: entry.attempt } : {}) } : {}),
		...(stopping[id] && (state === 'running' || state === 'queued') ? { stopping: true } : {})
	};
}

/** A finished agent whose worktree was discarded and whose run did not
 *  fail: its changes are gone, so it is no success, and the views show it
 *  in grey rather than done. */
export const discardedRun = (row: Pick<AgentRow, 'state' | 'status'>) => row.state === 'done' && row.status === 'discarded';

/** Still at work: running, or queued to run. */
export const isLive = (row: Pick<AgentRow, 'state'>) => row.state === 'running' || row.state === 'queued';

/** A row with a stop button: one agent (not a Workflow) still at work and
 *  not being stopped already. */
export const canStop = (row: Pick<AgentRow, 'state' | 'workflow' | 'stopping'>) => isLive(row) && !row.workflow && !row.stopping;

/** Files a worktree agent changed that are neither merged nor dropped (as
 *  far as this client knows). */
export function unmergedFiles(row: Pick<AgentRow, 'team' | 'status'>): number {
	const a = row.team;
	if (!a?.worktree || a.merge?.ok || row.status === 'merged' || row.status === 'discarded') return 0;
	return a.files.length;
}

/** A LynShen agent path (`/root/scan_auth`) by its own name. */
export const shortPath = (label: string) => (label.startsWith('/') ? label.split('/').filter(Boolean).pop() || label : label);

function activityOf(
	state: RunState,
	activity: string,
	tool: string,
	message: string,
	result: string,
	error: string,
	prompt: string
): string {
	// A failed one by its error only: its last action, or the word an engine
	// that reopened the session gives every agent it restores ("Done"), says
	// nothing of the failure (the views show the state word instead).
	if (state === 'failed') return firstLine(error);
	if (state === 'done' && result) return firstLine(result);
	const said = QUIET.has(message) ? '' : message;
	return firstLine(activity) || tool || firstLine(said) || (state === 'running' || state === 'queued' ? firstLine(prompt) : '');
}

/** How long an agent has run (running: since it started), ms. */
export function rowElapsed(row: AgentRow, now: number): number {
	if (row.state === 'running' && row.startedAt > 0) return Math.max(row.durationMs, now - row.startedAt);
	if (row.durationMs > 0) return row.durationMs;
	return row.endedAt && row.startedAt ? row.endedAt - row.startedAt : 0;
}

/** The subagent a spawn call started (by the call's id). */
export const agentOfCall = (rows: AgentRow[], callId: string) => (callId ? rows.find((r) => r.toolUseId === callId) : undefined);

/** The subagent a spawn call started: by the call's id, else by the path
 *  its arguments or output name. */
export function spawnAgentRow(rows: AgentRow[], callId: string, args: string, output: string): AgentRow | undefined {
	const row = agentOfCall(rows, callId);
	if (row) return row;
	const path = spawnPayload(output).path || spawnPayload(args).path;
	return path ? rows.find((r) => r.id === path) : undefined;
}

/** Best-of-N: the agents of each attempt group, by attempt number. */
export function attemptGroups(rows: AgentRow[]): Map<string, AgentRow[]> {
	const groups = new Map<string, AgentRow[]>();
	for (const r of rows) if (r.attemptGroup) groups.set(r.attemptGroup, [...(groups.get(r.attemptGroup) ?? []), r]);
	for (const list of groups.values())
		list.sort((a, b) => (a.attempt ?? Number.MAX_SAFE_INTEGER) - (b.attempt ?? Number.MAX_SAFE_INTEGER) || a.startedAt - b.startedAt);
	return groups;
}

/** Best-of-N: where one attempt is, as its group card says it: open (no
 *  pick yet), picked and on its way (`merging` / `discarding`), merged or
 *  discarded, or a pick that conflicted or failed. */
export type AttemptState = 'open' | 'merging' | 'discarding' | 'merged' | 'discarded' | 'conflict' | 'failed';

export function attemptState(row: Pick<AgentRow, 'state' | 'status' | 'team'>): AttemptState {
	const a = row.team;
	if (a?.pending) return a.pending === 'apply' ? 'merging' : 'discarding';
	if (a?.merge?.ok) return a.merge.action === 'apply' ? 'merged' : 'discarded';
	if (row.status === 'merged') return 'merged';
	if (row.status === 'discarded') return 'discarded';
	if (a?.merge?.conflicts.length || row.status === 'conflict') return 'conflict';
	if (a?.merge) return 'failed';
	return 'open';
}

/** Lines a `git diff --numstat` adds and removes in all (binary files count none). */
export function numstatTotals(out: string): { added: number; removed: number } {
	let added = 0;
	let removed = 0;
	for (const line of out.split('\n')) {
		const m = /^(\d+|-)\t(\d+|-)\t/.exec(line);
		if (!m) continue;
		if (m[1] !== '-') added += Number(m[1]);
		if (m[2] !== '-') removed += Number(m[2]);
	}
	return { added, removed };
}

/** Tool names that start a subagent, and the ones that wait for subagents. */
export const SPAWN_TOOLS = new Set(['spawn_agent', 'Task', 'Agent']);
export const WAIT_TOOLS = new Set(['wait_agent', 'agent_wait']);

/** What a spawn call's own payload says (its arguments or its output):
 *  the agent's name and task, for an engine that sends no trace. */
export function spawnPayload(output: string): { name: string; task: string; path: string } {
	const o = parse(output);
	const s = (k: string) => (typeof o?.[k] === 'string' ? (o[k] as string) : '');
	return {
		name: s('nickname') || s('description') || s('task_name') || s('name'),
		task: s('prompt') || s('message') || s('task'),
		path: s('path')
	};
}

export type WaitState = RunState | 'unknown';

/** The agents a wait call names and their states, from its output:
 *  `{"status": {"/root/x": "running" | {"completed": …} | {"errored": …}}}`
 *  (LynShen), or Codex's `{"description": "label: status\n…"}`. */
export function waitTargets(output: string): { id: string; state: WaitState; timedOut: boolean }[] {
	const o = parse(output);
	if (!o) return [];
	const timedOut = o.timed_out === true;
	if (o.status && typeof o.status === 'object' && !Array.isArray(o.status)) {
		return Object.entries(o.status as Record<string, unknown>).map(([id, v]) => ({
			id,
			state:
				typeof v === 'string'
					? runState(v === 'errored' ? 'failed' : v === 'interrupted' || v === 'closed' ? 'stopped' : v)
					: v && typeof v === 'object'
						? 'completed' in v
							? 'done'
							: 'errored' in v
								? 'failed'
								: 'unknown'
						: 'unknown',
			timedOut
		}));
	}
	if (typeof o.description === 'string') {
		return o.description
			.split(/\n|,\s*/)
			.map((line) => line.trim())
			.filter(Boolean)
			.map((line) => {
				const m = /^(.*?):\s*(\w+)$/.exec(line);
				return m ? { id: m[1]!, state: runState(m[2]!), timedOut } : { id: line, state: 'unknown' as const, timedOut };
			});
	}
	return [];
}

function parse(output: string): Record<string, unknown> | null {
	try {
		const v = JSON.parse(output);
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/** Whether the plan is worth showing: it changed in this turn, or the turn
 *  running now still has steps to do. */
export const planShown = (plan: PlanSummary, busy: boolean, planFresh: boolean) =>
	plan.total > 0 && (planFresh || (busy && plan.done < plan.total));

/** A running time as the cards show it: 8s, 1m05s, 1h02m. */
export function shortElapsed(ms: number): string {
	const s = Math.max(0, Math.floor(ms / 1000));
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	if (m < 60) return `${m}m${String(s % 60).padStart(2, '0')}s`;
	return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}m`;
}

/** A token count as the subagents card shows it: 950, 18.4k, 120k, 1.2M. */
export function compactTokens(n: number): string {
	const v = Math.max(0, Math.round(n));
	if (v >= 1_000_000) return `${trimZero((v / 1_000_000).toFixed(1))}M`;
	if (v >= 100_000) return `${Math.round(v / 1000)}k`;
	if (v >= 1000) return `${trimZero((v / 1000).toFixed(1))}k`;
	return String(v);
}
const trimZero = (s: string) => s.replace(/\.0$/, '');

/** The turn in numbers: steps done, subagents (running ones while any run),
 *  and the team's tokens against its budget when it has one. */
export interface TeamSummary {
	steps: { done: number; total: number } | null;
	agents: number;
	running: number;
	/** `warn` from 80% of the limit, `over` once it is used up. */
	budget: { used: string; limit: string; level: 'ok' | 'warn' | 'over' } | null;
}

export function teamSummary(plan: PlanSummary, rows: AgentRow[], budget: TeamBudget | null, showPlan: boolean): TeamSummary {
	const limit = budget && budget.limit > 0 ? budget.limit : 0;
	return {
		steps: showPlan && plan.total ? { done: plan.done, total: plan.total } : null,
		agents: rows.length,
		running: rows.filter((r) => r.state === 'running' || r.state === 'queued').length,
		budget:
			budget && limit
				? {
						used: compactTokens(budget.used),
						limit: compactTokens(limit),
						level: budget.used >= limit ? 'over' : budget.used >= limit * 0.8 ? 'warn' : 'ok'
					}
				: null
	};
}

/** Where a worktree agent's changes are: none to merge, ready, a merge on
 *  its way, merged or dropped, or a merge that conflicted or failed. */
export type MergeState = 'none' | 'ready' | 'pending' | 'applied' | 'discarded' | 'conflict' | 'failed';

export interface MergeView {
	state: MergeState;
	/** Files it changed (merged ones once applied). */
	files: string[];
	conflicts: string[];
	error: string;
	/** Its changes can be viewed, merged or dropped now: it no longer runs,
	 *  and they are neither merged nor dropped nor on their way. */
	actionable: boolean;
}

export function mergeView(row: Pick<AgentRow, 'state' | 'status' | 'team'>): MergeView {
	const a = row.team;
	const none: MergeView = { state: 'none', files: [], conflicts: [], error: '', actionable: false };
	if (!a?.worktree) return none;
	const idle = row.state !== 'running' && row.state !== 'queued';
	const view = (state: MergeState, actionable: boolean, extra: Partial<MergeView> = {}): MergeView => ({
		state,
		files: a.files,
		conflicts: [],
		error: '',
		actionable,
		...extra
	});
	if (a.pending) return view('pending', false);
	const m = a.merge;
	if (m?.ok) return view(m.action === 'apply' ? 'applied' : 'discarded', false, m.files.length ? { files: m.files } : {});
	// The model merged or discarded it itself (merge_agent as a tool call).
	if (row.status === 'merged') return view('applied', false);
	if (row.status === 'discarded') return view('discarded', false);
	if ((m && m.conflicts.length) || row.status === 'conflict') return view('conflict', idle, { conflicts: m?.conflicts ?? [] });
	if (m) return view('failed', idle, { error: m.error });
	return a.files.length ? view('ready', idle) : none;
}

/** The paths `git status --porcelain` lists (a rename by its new name, a
 *  quoted path unquoted): what a worktree agent changed, when the engine
 *  does not say. */
export function porcelainFiles(out: string): string[] {
	const files: string[] = [];
	for (const line of out.split('\n')) {
		if (line.length < 4 || line.startsWith('##')) continue;
		let path = line.slice(3);
		const arrow = path.indexOf(' -> ');
		if (arrow >= 0) path = path.slice(arrow + 4);
		if (path.startsWith('"') && path.endsWith('"')) path = path.slice(1, -1).replace(/\\(["\\])/g, '$1');
		if (path && !files.includes(path)) files.push(path);
	}
	return files;
}

/** The task board's sections in the order the panel shows them: the work
 *  under way first, then what waits, what failed and what is done. */
export const BOARD_ORDER: TaskStatus[] = ['claimed', 'blocked', 'pending', 'failed', 'completed'];

/** The board's tasks by state (sections without tasks left out), each in
 *  the board's own order. */
export function boardGroups(tasks: BoardTask[]): { status: TaskStatus; tasks: BoardTask[] }[] {
	return BOARD_ORDER.map((status) => ({ status, tasks: tasks.filter((x) => x.status === status) })).filter((g) => g.tasks.length);
}

/** The tasks one task still waits for: its dependencies not completed (an id
 *  the board does not list counts as waiting, by its id). */
export function waitingOn(task: BoardTask, tasks: BoardTask[]): { id: string; title: string }[] {
	return task.dependsOn
		.map((id) => ({ id, dep: tasks.find((x) => x.id === id) }))
		.filter(({ dep }) => dep?.status !== 'completed')
		.map(({ id, dep }) => ({ id, title: dep?.title ?? '' }));
}

/** Tasks done and in all. */
export function boardProgress(tasks: BoardTask[]): { done: number; total: number } {
	return { done: tasks.filter((x) => x.status === 'completed').length, total: tasks.length };
}
