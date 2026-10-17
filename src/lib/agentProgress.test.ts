import { describe, it, expect } from 'vitest';
import {
	agentOfCall,
	agentOutcome,
	agentRows,
	compactTokens,
	mergeView,
	porcelainFiles,
	teamSummary,
	planShown,
	planSummary,
	rowElapsed,
	shortElapsed,
	shortPath,
	spawnPayload,
	stepState,
	waitTargets,
	type AgentRow
} from './agentProgress';
import type { AgentRun, TeamAgent, WorkflowRun } from './chat.svelte';

const run = (over: Partial<AgentRun>): AgentRun => ({
	id: 'a1',
	label: '',
	phase: 0,
	model: '',
	state: 'running',
	startedAt: 1000,
	durationMs: 0,
	tokens: 0,
	toolCalls: 0,
	prompt: '',
	result: '',
	error: '',
	type: 'subagent',
	toolUseId: '',
	activity: '',
	effort: '',
	...over
});

describe('plan summary', () => {
	it('reads every engine’s step words as four', () => {
		expect(['pending', 'in_progress', 'inProgress', 'completed', 'skipped', 'odd'].map(stepState)).toEqual([
			'pending',
			'active',
			'active',
			'done',
			'skipped',
			'pending'
		]);
	});

	it('counts done steps and finds the current one', () => {
		const p = planSummary([
			{ step: 'Read', status: 'completed' },
			{ step: 'Fix', status: 'in_progress' },
			{ step: 'Test', status: 'pending' }
		]);
		expect([p.done, p.total, p.current]).toEqual([1, 3, 1]);
		// No step marked active: the first one still to do, once work began.
		expect(planSummary([{ step: 'a', status: 'completed' }, { step: 'b', status: 'pending' }]).current).toBe(1);
		expect(planSummary([{ step: 'a', status: 'pending' }]).current).toBe(-1);
		expect(planSummary([{ step: 'a', status: 'skipped' }, { step: 'b', status: 'completed' }]).done).toBe(2);
	});

	it('shows a plan of this turn, or an open one while a turn runs', () => {
		const open = planSummary([{ step: 'a', status: 'pending' }]);
		const done = planSummary([{ step: 'a', status: 'completed' }]);
		expect(planShown(open, true, false)).toBe(true);
		expect(planShown(open, false, false)).toBe(false);
		expect(planShown(done, false, true)).toBe(true);
		expect(planShown(planSummary([]), true, true)).toBe(false);
	});
});

describe('subagent rows', () => {
	it('joins the agent trace with the lifecycle and prefers the engine’s activity', () => {
		const rows = agentRows({
			runs: {
				workflows: [],
				agents: [run({ id: '/root/scan_auth', label: '', model: 'gpt-5.5', activity: 'Read src/auth.ts', toolUseId: 'call_1' })]
			},
			subagents: { '/root/scan_auth': { status: 'running', message: 'started', label: 'scan_auth', startedAt: 900 } }
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: '/root/scan_auth', label: 'scan_auth', model: 'gpt-5.5', state: 'running', activity: 'Read src/auth.ts', toolUseId: 'call_1' });
	});

	it('falls back to the subagent’s last call, then its lifecycle message, then its task', () => {
		const base = { runs: { workflows: [], agents: [] } };
		const [byTool] = agentRows({ ...base, subagents: { t1: { status: 'running', message: 'Reading', label: 'Scan auth' } }, lastTool: (l) => (l === 'Scan auth' ? 'Read auth.ts' : '') });
		expect(byTool!.activity).toBe('Read auth.ts');
		const [byMessage] = agentRows({ ...base, subagents: { t1: { status: 'running', message: 'Reading the config', label: 'Scan' } } });
		expect(byMessage!.activity).toBe('Reading the config');
		const [quiet] = agentRows({ ...base, subagents: { t1: { status: 'running', message: 'started' } } });
		expect(quiet!.activity).toBe('');
		const [task] = agentRows({ runs: { workflows: [], agents: [run({ prompt: 'Find the bug\nin auth' })] }, subagents: {} });
		expect(task!.activity).toBe('Find the bug');
	});

	it('shows a finished agent’s result and a failed one’s error', () => {
		const rows = agentRows({
			runs: { workflows: [], agents: [run({ id: 'a', state: 'completed', result: 'Found 2 issues\n…' }), run({ id: 'b', state: 'failed', error: 'timeout' })] },
			subagents: {}
		});
		expect(rows.map((r) => [r.state, r.activity])).toEqual([
			['done', 'Found 2 issues'],
			['failed', 'timeout']
		]);
	});

	it('keeps a failed run failed once its worktree is discarded, merged or conflicts', () => {
		expect(agentOutcome('errored', 'LLM API returned HTTP 403')).toEqual({ state: 'failed', error: 'LLM API returned HTTP 403' });
		// The engine still sends the error with the later word…
		expect(agentOutcome('discarded', 'LLM API returned HTTP 403')).toEqual({ state: 'failed', error: 'LLM API returned HTTP 403' });
		// …or, having reopened the session, none: the one ChatState kept.
		expect(agentOutcome('discarded', '', 'LLM API returned HTTP 403')).toEqual({ state: 'failed', error: 'LLM API returned HTTP 403' });
		expect(agentOutcome('merged', '', '')).toEqual({ state: 'failed', error: '' });
		expect(agentOutcome('conflict', '', 'boom').state).toBe('failed');
		// A run that did not fail: as the engine says.
		expect(agentOutcome('discarded', '')).toEqual({ state: 'done', error: '' });
		expect(agentOutcome('merged', '')).toEqual({ state: 'done', error: '' });
		expect(agentOutcome('completed', '', 'old')).toEqual({ state: 'done', error: '' });
		expect(agentOutcome('running', '', 'old').state).toBe('running');
	});

	it('shows an errored agent whose worktree was discarded as failed, with its error', () => {
		// The owner's case: four agents failed at once (HTTP 403); the engine
		// reopened the session (restored: no error, "Done") and the model
		// discarded their worktrees.
		const failed = { '/root/cards_ironclad': 'LLM API returned HTTP 403 Forbidden: model not in plan\nrequest id 7f3c' };
		const runs = {
			workflows: [],
			agents: [run({ id: '/root/cards_ironclad', label: '临川', state: 'discarded', durationMs: 430, activity: 'Done' })]
		};
		const [row] = agentRows({ runs, subagents: { '/root/cards_ironclad': { status: 'discarded', message: 'worktree discarded' } }, failed });
		expect(row).toMatchObject({ state: 'failed', status: 'discarded', error: failed['/root/cards_ironclad'], activity: 'LLM API returned HTTP 403 Forbidden: model not in plan' });
		// Restored before the discard: errored, but no error and "Done".
		const [restored] = agentRows({ runs: { workflows: [], agents: [run({ id: 'a', state: 'errored', activity: 'Done' })] }, subagents: {} });
		expect(restored).toMatchObject({ state: 'failed', error: '', activity: '' });
		// Known from its lifecycle only.
		const [life] = agentRows({ runs: { workflows: [], agents: [] }, subagents: { '/root/w': { status: 'discarded', message: 'worktree discarded' } }, failed: { '/root/w': 'boom' } });
		expect(life).toMatchObject({ state: 'failed', error: 'boom', activity: 'boom' });
		// Not counted as running; counted as failed.
		expect(teamSummary(planSummary([]), [row!, restored!, life!], null, false)).toMatchObject({ agents: 3, running: 0 });
	});

	it('lists a workflow as one row with its progress', () => {
		const w: WorkflowRun = {
			id: 'w1',
			toolUseId: 'call_w',
			name: 'review',
			description: 'Review the diff',
			status: 'running',
			startedAt: 1,
			durationMs: 0,
			tokens: 0,
			toolCalls: 0,
			phases: [],
			agents: [run({ id: 'x', state: 'completed', label: 'Find' }), run({ id: 'y', state: 'running', label: 'Verify' })]
		};
		const [row] = agentRows({ runs: { workflows: [w], agents: [] }, subagents: {} });
		expect(row).toMatchObject({ workflow: true, label: 'review', progress: { done: 1, total: 2 }, activity: 'Verify' });
	});

	it('keeps old finished runs out once a turn started after them', () => {
		const runs = { workflows: [], agents: [run({ id: 'old', state: 'completed', startedAt: 1000 }), run({ id: 'new', startedAt: 90_000 })] };
		expect(agentRows({ runs, subagents: {}, since: 60_000 }).map((r) => r.id)).toEqual(['new']);
		expect(agentRows({ runs, subagents: {} }).map((r) => r.id)).toEqual(['old', 'new']);
	});

	it('reads lifecycle-only subagents (older engines) and their time', () => {
		const [row] = agentRows({ runs: { workflows: [], agents: [] }, subagents: { '/root/w': { status: 'errored', message: 'boom', startedAt: 10, endedAt: 2010 } } });
		expect(row).toMatchObject({ label: 'w', state: 'failed', error: 'boom', durationMs: 2000 });
	});

	it('times a running agent from its start', () => {
		const row = { state: 'running', startedAt: 1000, durationMs: 0, endedAt: 0 } as AgentRow;
		expect(rowElapsed(row, 4000)).toBe(3000);
		expect(rowElapsed({ ...row, state: 'done', durationMs: 1200 }, 9000)).toBe(1200);
		expect(rowElapsed({ ...row, state: 'done', endedAt: 1500 }, 9000)).toBe(500);
	});

	it('writes running times short', () => {
		expect([800, 8_400, 65_000, 3_720_000].map(shortElapsed)).toEqual(['0s', '8s', '1m05s', '1h02m']);
	});

	it('finds the agent a spawn call started', () => {
		const rows = [{ toolUseId: 'c1', id: 'a' }, { toolUseId: 'c2', id: 'b' }] as AgentRow[];
		expect(agentOfCall(rows, 'c2')?.id).toBe('b');
		expect(agentOfCall(rows, '')).toBeUndefined();
		expect(shortPath('/root/scan_auth')).toBe('scan_auth');
		expect(shortPath('Scan auth')).toBe('Scan auth');
	});
});

describe('spawn and wait payloads', () => {
	it('reads the agent a spawn call names', () => {
		expect(spawnPayload('{"task_name":"scan","path":"/root/scan","status":"running"}')).toEqual({ name: 'scan', task: '', path: '/root/scan' });
		expect(spawnPayload('{"description":"Scan auth","prompt":"Find the bug"}')).toMatchObject({ name: 'Scan auth', task: 'Find the bug' });
		expect(spawnPayload('not json')).toEqual({ name: '', task: '', path: '' });
		// LynShen names its agents: the nickname is what the card shows.
		expect(spawnPayload('{"task_name":"starcore_ui","nickname":"青岚","path":"/root/starcore_ui"}').name).toBe('青岚');
	});

	it('reads which agents a wait names and their states', () => {
		expect(waitTargets('{"status":{"/root/a":"running","/root/b":{"completed":"ok"},"/root/c":{"errored":"x"},"/root/d":"closed"},"timed_out":true}')).toEqual([
			{ id: '/root/a', state: 'running', timedOut: true },
			{ id: '/root/b', state: 'done', timedOut: true },
			{ id: '/root/c', state: 'failed', timedOut: true },
			{ id: '/root/d', state: 'stopped', timedOut: true }
		]);
		expect(waitTargets('{"description":"pong: completed\\nping: running"}').map((w) => [w.id, w.state])).toEqual([
			['pong', 'done'],
			['ping', 'running']
		]);
		expect(waitTargets('')).toEqual([]);
	});
});

describe('agent team', () => {
	const team = (over: Partial<TeamAgent> = {}): TeamAgent => ({
		role: 'worker',
		planStep: null,
		workdir: '/repo/.lynshen/agents/w-1',
		worktree: true,
		files: ['a.ts', 'b.ts'],
		pending: null,
		merge: null,
		background: false,
		attemptGroup: null,
		attempt: null,
		diff: null,
		...over
	});
	const row = (over: Partial<AgentRow> = {}) => ({ state: 'done' as const, status: 'completed', team: team(), ...over });

	it('writes token counts short', () => {
		expect([0, 950, 1000, 18_400, 120_000, 400_400, 1_000_000, 1_250_000].map(compactTokens)).toEqual([
			'0',
			'950',
			'1k',
			'18.4k',
			'120k',
			'400k',
			'1M',
			'1.3M'
		]);
	});

	it('sums up steps, subagents and the budget', () => {
		const plan = planSummary([
			{ step: 'a', status: 'completed' },
			{ step: 'b', status: 'pending' }
		]);
		const rows = [{ state: 'running' }, { state: 'done' }] as AgentRow[];
		expect(teamSummary(plan, rows, null, true)).toEqual({ steps: { done: 1, total: 2 }, agents: 2, running: 1, budget: null });
		// No limit: no budget part; the plan hidden: no steps part.
		expect(teamSummary(plan, rows, { used: 5000, limit: 0 }, false)).toMatchObject({ steps: null, budget: null });
		expect(teamSummary(plan, rows, { used: 330_000, limit: 400_000 }, true).budget).toEqual({ used: '330k', limit: '400k', level: 'warn' });
		expect(teamSummary(plan, rows, { used: 401_000, limit: 400_000 }, true).budget?.level).toBe('over');
	});

	it('names each step’s owner: the plan’s agent, else the one on that step', () => {
		const p = planSummary(
			[
				{ step: 'a', status: 'completed', agent: '/root/x', files: ['x.ts'] },
				{ step: 'b', status: 'pending' },
				{ step: 'c', status: 'pending' }
			],
			// By number (1-based) or by the step's text; the first claim wins.
			{ '/root/y': { planStep: '2' }, '/root/z': { planStep: 'b' }, '/root/w': { planStep: '9' } }
		);
		expect(p.steps.map((s) => [s.agent, s.files])).toEqual([
			['/root/x', ['x.ts']],
			['/root/y', []],
			['', []]
		]);
	});

	it('offers a worktree agent’s changes once it stopped, until merged or dropped', () => {
		expect(mergeView(row({ team: undefined })).state).toBe('none');
		expect(mergeView(row({ team: team({ worktree: false }) })).state).toBe('none');
		expect(mergeView(row({ team: team({ files: [] }) })).state).toBe('none');
		expect(mergeView(row())).toMatchObject({ state: 'ready', files: ['a.ts', 'b.ts'], actionable: true });
		expect(mergeView(row({ state: 'running' }))).toMatchObject({ state: 'ready', actionable: false });
		expect(mergeView(row({ team: team({ pending: 'apply' }) }))).toMatchObject({ state: 'pending', actionable: false });
		const applied = { action: 'apply' as const, ok: true, files: ['a.ts'], conflicts: [], error: '' };
		expect(mergeView(row({ team: team({ merge: applied }) }))).toMatchObject({ state: 'applied', files: ['a.ts'], actionable: false });
		expect(mergeView(row({ team: team({ merge: { ...applied, action: 'discard', files: [] } }) }))).toMatchObject({ state: 'discarded', actionable: false });
		const conflict = { ...applied, ok: false, files: [], conflicts: ['b.ts'] };
		expect(mergeView(row({ team: team({ merge: conflict }) }))).toMatchObject({ state: 'conflict', conflicts: ['b.ts'], actionable: true });
		expect(mergeView(row({ status: 'conflict' }))).toMatchObject({ state: 'conflict', conflicts: [] });
		expect(mergeView(row({ team: team({ merge: { ...conflict, conflicts: [], error: 'not a git repository' } }) }))).toMatchObject({
			state: 'failed',
			error: 'not a git repository',
			actionable: true
		});
	});

	it('reads the files git status lists', () => {
		expect(porcelainFiles(' M src/a.ts\n?? new/\nR  old.ts -> new.ts\n?? "with space.ts"\n')).toEqual(['src/a.ts', 'new/', 'new.ts', 'with space.ts']);
		expect(porcelainFiles('')).toEqual([]);
	});

	it('carries the team’s role and state words on the rows', () => {
		const rows = agentRows({
			runs: { workflows: [], agents: [run({ id: '/root/w', state: 'completed' })] },
			subagents: { '/root/w': { status: 'budget_exhausted', message: '', role: 'worker' } },
			team: { '/root/w': team({ role: 'reviewer' }) }
		});
		expect(rows[0]).toMatchObject({ state: 'done', status: 'budget_exhausted', role: 'reviewer' });
		expect(rows[0]!.team?.files).toEqual(['a.ts', 'b.ts']);
	});
});
