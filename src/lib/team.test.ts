import { describe, it, expect, beforeEach } from 'vitest';
import { ChatState } from './chat.svelte';
import { agentRows, mergeView, planSummary, teamSummary } from './agentProgress';
import { setLocale } from './i18n';

// Frames as the LynShen engine sends them for the agent team (工作组).
const W = '/root/auth_fix';
const WORKDIR = '/repo/.lynshen/agents/auth_fix-1712345678901';
const frames = {
	spawnStart: { type: 'tool_start', call_id: 'c1', name: 'spawn_agent' },
	spawnArgs: {
		type: 'tool_update',
		call_id: 'c1',
		name: 'spawn_agent',
		output: '{"task_name":"auth_fix","message":"Fix the login check","role":"worker","isolation":"worktree"}'
	},
	spawnDone: {
		type: 'tool_output',
		call_id: 'c1',
		name: 'spawn_agent',
		output: JSON.stringify({ task_name: 'auth_fix', path: W, status: 'running', workdir: WORKDIR }),
		is_error: false
	},
	running: { type: 'subagent_lifecycle', path: W, status: 'running', message: 'started', label: 'auth_fix', model: 'gpt-5.5', tool_use_id: 'c1', role: 'worker', plan_step: '2' },
	done: { type: 'subagent_lifecycle', path: W, status: 'completed', message: 'finished', label: 'auth_fix', model: 'gpt-5.5', tool_use_id: 'c1', role: 'worker', plan_step: '2', files_changed: ['src/auth.ts', 'src/auth.test.ts'] },
	plan: {
		type: 'plan',
		plan: [
			{ step: 'Read the auth module', status: 'completed', agent: '/root/scan' },
			{ step: 'Fix the login check', status: 'in_progress', files: ['src/auth.ts'] },
			{ step: 'Review the diff', status: 'pending' }
		]
	}
};

describe('agent team state', () => {
	beforeEach(() => setLocale('zh'));

	it('keeps a subagent’s role, plan step, worktree and changed files', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		for (const f of [frames.spawnStart, frames.spawnArgs, frames.spawnDone, frames.running]) c.handle(f);
		expect(c.subagents[W]).toMatchObject({ status: 'running', role: 'worker', model: 'gpt-5.5', toolUseId: 'c1' });
		expect(c.team[W]).toEqual({
			role: 'worker',
			planStep: '2',
			workdir: WORKDIR,
			worktree: true,
			files: [],
			pending: null,
			merge: null,
			background: false,
			attemptGroup: null,
			attempt: null,
			diff: null
		});
		c.handle(frames.done);
		expect(c.team[W]!.files).toEqual(['src/auth.ts', 'src/auth.test.ts']);
		// A lifecycle frame without the new fields leaves them as they were.
		c.handle({ type: 'subagent_lifecycle', path: W, status: 'message', message: 'queued message' });
		expect(c.team[W]).toMatchObject({ role: 'worker', planStep: '2', files: ['src/auth.ts', 'src/auth.test.ts'] });
		// The next turn drops the finished agent from `subagents`, not from the team.
		c.handle({ type: 'status', message: 'ready' });
		c.handle({ type: 'connecting' });
		expect(c.subagents[W]).toBeUndefined();
		expect(c.team[W]!.worktree).toBe(true);
	});

	it('tells a worktree by the engine’s word or by where it lies', () => {
		const c = new ChatState();
		c.handle({ type: 'subagent_lifecycle', path: '/root/a', status: 'running', message: '', role: 'explorer', workdir: '/repo', isolation: 'none' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/b', status: 'running', message: '', workdir: '/repo/.lynshen/agents/b-1' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/c', status: 'running', message: '', workdir: '/tmp/w', isolation: 'worktree' });
		expect([c.team['/root/a']!.worktree, c.team['/root/b']!.worktree, c.team['/root/c']!.worktree]).toEqual([false, true, true]);
		// A plain lifecycle frame (no team fields) makes no team entry.
		c.handle({ type: 'subagent_lifecycle', path: '/root/d', status: 'running', message: '' });
		expect(c.team['/root/d']).toBeUndefined();
		// plan_step null clears it.
		c.handle({ type: 'subagent_lifecycle', path: '/root/a', status: 'running', message: '', plan_step: 'Fix the login check' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/a', status: 'running', message: '', plan_step: null });
		expect(c.team['/root/a']!.planStep).toBeNull();
	});

	it('reads the files and workdir list_agents and agent_runs name', () => {
		const c = new ChatState();
		c.handle({ type: 'tool_start', call_id: 'l1', name: 'list_agents' });
		c.handle({
			type: 'tool_output',
			call_id: 'l1',
			name: 'list_agents',
			is_error: false,
			output: JSON.stringify({
				agents: [{ task_name: W, name: 'auth_fix', status: { completed: 'done' }, workdir: WORKDIR, result: { workdir: WORKDIR, files_changed: ['a.ts'] } }]
			})
		});
		expect(c.team[W]).toMatchObject({ workdir: WORKDIR, worktree: true, files: ['a.ts'] });
		c.handle({ type: 'agent_runs', workflows: [], agents: [{ id: '/root/rev', label: 'rev', state: 'running', role: 'reviewer', plan_step: '3' }] });
		expect(c.team['/root/rev']).toMatchObject({ role: 'reviewer', planStep: '3', worktree: false });
	});

	it('shows agent messages as one line and keeps them per agent', () => {
		const c = new ChatState();
		c.handle({ type: 'agent_message', from: W, to: 'parent', summary: 'The login check is fixed; tests pass' });
		c.handle({ type: 'agent_message', from: 'parent', to: '/root/scan', summary: 'Stop after the auth module' });
		c.handle({ type: 'agent_message', from: W, to: 'parent', summary: '' });
		expect(c.messages).toEqual([
			{ kind: 'agent_message', from: W, to: 'parent', summary: 'The login check is fixed; tests pass' },
			{ kind: 'agent_message', from: 'parent', to: '/root/scan', summary: 'Stop after the auth module' }
		]);
		expect(c.messagesOf(W).map((m) => m.summary)).toEqual(['The login check is fixed; tests pass']);
		expect(c.messagesOf('/root/scan')).toHaveLength(1);
	});

	it('sends merge_agent and takes its answer', () => {
		const c = new ChatState();
		for (const f of [frames.spawnStart, frames.spawnArgs, frames.spawnDone, frames.done]) c.handle(f);
		expect(c.mergeAgent(W, 'apply')).toEqual({ op: 'merge_agent', target: W, action: 'apply' });
		expect(c.team[W]!.pending).toBe('apply');
		c.handle({ type: 'merge_result', target: W, action: 'apply', ok: false, files: [], conflicts: ['src/auth.ts'] });
		expect(c.team[W]).toMatchObject({ pending: null, merge: { action: 'apply', ok: false, conflicts: ['src/auth.ts'] } });
		expect(c.team[W]!.files).toEqual(['src/auth.ts', 'src/auth.test.ts']);
		c.mergeAgent(W, 'discard');
		c.handle({ type: 'merge_result', target: W, action: 'discard', ok: true, files: [], conflicts: [] });
		expect(c.team[W]!.merge).toMatchObject({ action: 'discard', ok: true });
	});

	it('marks a merge an older engine refuses as failed, quietly', () => {
		const c = new ChatState();
		c.handle(frames.done);
		c.handle({ type: 'subagent_lifecycle', path: W, status: 'completed', message: '', workdir: WORKDIR });
		c.mergeAgent(W, 'apply');
		c.handle({ type: 'error', message: 'unknown op: merge_agent' });
		expect(c.messages).toEqual([]);
		expect(c.lastError).toBeNull();
		expect(c.team[W]).toMatchObject({ pending: null, merge: { ok: false, error: '当前引擎还不能合并子智能体的改动，请更新 Aogiri 后再试。' } });
	});

	it('keeps the team budget of the turn', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		c.handle({ type: 'team_budget', used: 120_000, limit: 400_000 });
		expect(c.teamBudget).toEqual({ used: 120_000, limit: 400_000 });
		c.handle({ type: 'status', message: 'ready' });
		expect(c.teamBudget).not.toBeNull();
		c.handle({ type: 'connecting' });
		expect(c.teamBudget).toBeNull();
	});

	it('ends an agent stopped by the budget or left in conflict', () => {
		const c = new ChatState();
		c.handle({ type: 'subagent_lifecycle', path: '/root/a', status: 'running', message: '' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/a', status: 'budget_exhausted', message: 'team budget used up' });
		c.handle({ type: 'subagent_lifecycle', path: W, status: 'running', message: '', workdir: WORKDIR, files_changed: ['a.ts'] });
		c.handle({ type: 'subagent_lifecycle', path: W, status: 'conflict', message: '' });
		expect(c.subagents['/root/a']!.endedAt).toBeGreaterThan(0);
		expect(c.subagents[W]!.endedAt).toBeGreaterThan(0);
		const rows = agentRows({ runs: { workflows: [], agents: [] }, subagents: c.subagents, team: c.team });
		expect(rows.map((r) => [r.id, r.state, r.status])).toEqual([
			['/root/a', 'stopped', 'budget_exhausted'],
			[W, 'done', 'conflict']
		]);
		expect(mergeView(rows[1]!)).toMatchObject({ state: 'conflict', actionable: true });
	});

	it('shows a worktree the model merged or discarded itself as done with', () => {
		const c = new ChatState();
		c.handle({ type: 'subagent_lifecycle', path: W, status: 'running', message: '', workdir: WORKDIR, files_changed: ['a.ts'] });
		c.handle({ type: 'subagent_lifecycle', path: W, status: 'merged', message: '' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/b', status: 'running', message: '', workdir: `${WORKDIR}-b`, isolation: 'worktree', files_changed: ['b.ts'] });
		c.handle({ type: 'subagent_lifecycle', path: '/root/b', status: 'discarded', message: '' });
		const rows = agentRows({ runs: { workflows: [], agents: [] }, subagents: c.subagents, team: c.team });
		expect(rows.map((r) => [r.state, mergeView(r).state, mergeView(r).actionable])).toEqual([
			['done', 'applied', false],
			['done', 'discarded', false]
		]);
	});

	it('keeps a run’s failure past the next turn, a reopened session and the discard of its worktree', () => {
		// 0.10.0: four agents failed at once (HTTP 403); the session reopened
		// (its agents restored without their errors, "Done"), the next turn
		// started and the model discarded their worktrees. They read as done.
		const c = new ChatState();
		const P = '/root/cards_ironclad';
		const ERR = 'LLM API returned HTTP 403 Forbidden: model not in plan';
		const trace = (state: string, error = '', activity = '') => ({
			type: 'agent_runs',
			workflows: [],
			agents: [{ id: P, label: '临川', model: 'claude-sonnet-5', state, error, activity, started_at: 1000, duration_ms: 430, type: 'subagent', isolation: 'worktree', workdir: WORKDIR }]
		});
		const rows = () => agentRows({ runs: c.agentRuns, subagents: c.subagents, team: c.team, failed: c.failedAgents, since: c.turnStartedAt || Number.MAX_SAFE_INTEGER });
		c.handle({ type: 'connecting' });
		c.handle({ type: 'subagent_lifecycle', path: P, status: 'running', message: 'started' });
		c.handle(trace('running', '', 'Starting'));
		c.handle({ type: 'subagent_lifecycle', path: P, status: 'errored', message: ERR });
		c.handle(trace('errored', ERR, 'Failed'));
		expect(rows().map((r) => [r.state, r.error])).toEqual([['failed', ERR]]);
		c.handle({ type: 'status', message: 'ready' });
		c.handle(trace('errored', '', 'Done'));
		c.handle({ type: 'connecting' });
		c.handle({ type: 'subagent_lifecycle', path: P, status: 'discarded', message: 'worktree discarded' });
		c.handle(trace('discarded', '', 'Done'));
		const [row] = rows();
		expect(row).toMatchObject({ id: P, state: 'failed', status: 'discarded', error: ERR, activity: ERR });
		expect(teamSummary(planSummary([]), rows(), null, false)).toMatchObject({ agents: 1, running: 0 });
		// It runs again: no longer failed.
		c.handle({ type: 'subagent_lifecycle', path: P, status: 'pending', message: 'resumed' });
		expect(c.failedAgents).toEqual({});
	});

	it('reads plan steps with their owner and files', () => {
		const c = new ChatState();
		c.handle(frames.plan);
		expect(c.plan[0]).toEqual({ step: 'Read the auth module', status: 'completed', agent: '/root/scan' });
		expect(c.plan[1]).toEqual({ step: 'Fix the login check', status: 'in_progress', files: ['src/auth.ts'] });
		c.handle(frames.running);
		// Step 2 names no agent: the one working on it (plan_step "2") owns it.
		expect(planSummary(c.plan, c.team).steps.map((s) => s.agent)).toEqual(['/root/scan', W, '']);
	});

	it('sums up the turn for the subagents card', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		c.handle({
			type: 'plan',
			plan: [
				{ step: 'a', status: 'completed' },
				{ step: 'b', status: 'completed' },
				{ step: 'c', status: 'completed' },
				{ step: 'd', status: 'in_progress' },
				{ step: 'e', status: 'pending' }
			]
		});
		c.handle({ type: 'subagent_lifecycle', path: '/root/x', status: 'running', message: '' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/y', status: 'running', message: '' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/z', status: 'completed', message: '' });
		c.handle({ type: 'team_budget', used: 120_000, limit: 400_000 });
		const rows = agentRows({ runs: c.agentRuns, subagents: c.subagents, team: c.team });
		expect(teamSummary(planSummary(c.plan, c.team), rows, c.teamBudget, true)).toEqual({
			steps: { done: 3, total: 5 },
			agents: 3,
			running: 2,
			budget: { used: '120k', limit: '400k', level: 'ok' }
		});
	});
});
