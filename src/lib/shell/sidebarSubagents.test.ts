import { describe, expect, it } from 'vitest';
import type { AgentRow } from '$lib/agentProgress';
import type { SubagentInfo } from '$lib/chat.svelte';
import type { SessionStatus } from '$lib/sessionStatus';
import { GroupPlaces, changedGroup, heldList, orderedList, sameList, type Entry, type ListItem } from './sidebarGroups';
import { NO_SUBAGENTS, SUBAGENT_ROWS, SUBAGENT_STAY_MS, arrivals, nextFold, subagentsOf, subagentsShown, withSubagents, type SubagentSource, type Subagents } from './sidebarSubagents';

const agent = (id: string, state: AgentRow['state'] = 'running', endedAt = 0): AgentRow => ({
	id,
	label: id,
	model: '',
	state,
	startedAt: 1,
	durationMs: 0,
	endedAt,
	activity: '',
	toolUseId: '',
	prompt: '',
	result: '',
	error: '',
	type: '',
	tokens: 0,
	toolCalls: 0
});
const ids = (s: Subagents) => [...s.rows.map((r) => r.id), ...(s.more ? [`+${s.more}`] : [])];

describe('subagentsShown', () => {
	it('lists none for a turn without sub-agents', () => {
		expect(subagentsShown([], { running: true, endedAt: 0, now: 0 })).toBe(NO_SUBAGENTS);
	});

	it('lists the first four while the turn runs, then how many more', () => {
		const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => agent(id));
		expect(SUBAGENT_ROWS).toBe(4);
		expect(ids(subagentsShown(rows.slice(0, 3), { running: true, endedAt: 0, now: 5 }))).toEqual(['a', 'b', 'c']);
		expect(ids(subagentsShown(rows.slice(0, 4), { running: true, endedAt: 0, now: 5 }))).toEqual(['a', 'b', 'c', 'd']);
		const six = subagentsShown(rows, { running: true, endedAt: 0, now: 5 });
		expect(ids(six)).toEqual(['a', 'b', 'c', 'd', '+2']);
		expect(six.foldAt).toBe(0);
	});

	it('keeps a finished one in its place, and the running ones after it', () => {
		const rows = [agent('a', 'done', 3), agent('b'), agent('c', 'failed', 4), agent('d'), agent('e')];
		expect(ids(subagentsShown(rows, { running: true, endedAt: 0, now: 5 }))).toEqual(['a', 'b', 'c', 'd', '+1']);
	});

	it('stays 30 s after the turn ends, then folds', () => {
		const rows = [agent('a', 'done', 900), agent('b', 'done', 950)];
		expect(SUBAGENT_STAY_MS).toBe(30_000);
		const at = (now: number) => subagentsShown(rows, { running: false, endedAt: 1000, now });
		expect(ids(at(1000))).toEqual(['a', 'b']);
		expect(at(1000).foldAt).toBe(31_000);
		expect(ids(at(30_999))).toEqual(['a', 'b']);
		expect(at(31_000)).toBe(NO_SUBAGENTS);
	});

	it('waits for the last of them: one still at work holds them all; the wait starts when it ends', () => {
		const rows = [agent('a', 'done', 900), agent('bg')];
		const working = subagentsShown(rows, { running: false, endedAt: 1000, now: 60_000 });
		expect([ids(working), working.foldAt]).toEqual([['a', 'bg'], 0]);
		const ended = [agent('a', 'done', 900), agent('bg', 'done', 70_000)];
		expect(subagentsShown(ended, { running: false, endedAt: 1000, now: 99_999 }).foldAt).toBe(100_000);
		expect(subagentsShown(ended, { running: false, endedAt: 1000, now: 100_000 })).toBe(NO_SUBAGENTS);
	});

	it('takes a shorter wait (the fixture) and lists none when no end is known', () => {
		const rows = [agent('a', 'done', 0)];
		expect(subagentsShown(rows, { running: false, endedAt: 1000, now: 1500, stay: 600 }).foldAt).toBe(1600);
		expect(subagentsShown(rows, { running: false, endedAt: 0, now: 1 })).toBe(NO_SUBAGENTS);
	});
});

describe('subagentsOf', () => {
	const life = (status: string, endedAt?: number): SubagentInfo => ({ status, message: '', startedAt: 1, ...(endedAt ? { endedAt } : {}) });
	const chat = (o: Partial<SubagentSource>): SubagentSource => ({ agentRuns: { workflows: [], agents: [] }, subagents: {}, team: {}, turnStartedAt: 0, turnEndedAt: 0, busy: false, ...o });

	it('lists the turn’s sub-agents, as the subagents card does', () => {
		const c = chat({ turnStartedAt: 100, subagents: { '/root/a': life('running'), '/root/b': life('completed', 150) } });
		expect(ids(subagentsOf(c, 200))).toEqual(['/root/a', '/root/b']);
		// The turn ends: they stay, then fold.
		c.subagents['/root/a'] = life('completed', 300);
		c.turnEndedAt = 400;
		expect(subagentsOf(c, 500).foldAt).toBe(400 + SUBAGENT_STAY_MS);
		expect(subagentsOf(c, 400 + SUBAGENT_STAY_MS)).toBe(NO_SUBAGENTS);
	});

	it('leaves out the runs of earlier turns (the agent trace)', () => {
		const run = (id: string, state: string, startedAt: number) => ({ id, label: id, phase: 0, model: '', state, startedAt, durationMs: 0, tokens: 0, toolCalls: 0, prompt: '', result: '', error: '', type: '', toolUseId: '', activity: '', effort: '' });
		const c = chat({ turnStartedAt: 100_000, agentRuns: { workflows: [], agents: [run('old', 'completed', 1000), run('new', 'running', 100_500)] } });
		expect(ids(subagentsOf(c, 101_000))).toEqual(['new']);
	});

	it('with no turn seen (opened from history): the ones at work, and the ones seen ending a moment ago', () => {
		const c = chat({ subagents: { a: life('completed', 50), b: life('running') } });
		expect(ids(subagentsOf(c, 100))).toEqual(['a', 'b']);
		c.subagents.b = life('completed', 120);
		expect(subagentsOf(c, 130).foldAt).toBe(120 + SUBAGENT_STAY_MS);
		expect(subagentsOf(c, 120 + SUBAGENT_STAY_MS)).toBe(NO_SUBAGENTS);
		// An engine at work holds them, whatever the turn's clock says.
		expect(ids(subagentsOf({ ...c, busy: true }, 1e9))).toEqual(['a', 'b']);
	});

	it('lists none for a conversation whose sub-agents ended before this client saw them', () => {
		const run = { id: 'old', label: 'old', phase: 0, model: '', state: 'completed', startedAt: 5, durationMs: 0, tokens: 0, toolCalls: 0, prompt: '', result: '', error: '', type: '', toolUseId: '', activity: '', effort: '' };
		expect(subagentsOf(chat({ agentRuns: { workflows: [], agents: [run] } }), 100)).toBe(NO_SUBAGENTS);
	});
});

const S = { running: { kind: 'running' } as SessionStatus, idle: null as SessionStatus };
const entry = (id: string, status: SessionStatus, at: number): Entry<string> => ({ id, status, at, item: id });
const keys = (items: ListItem<string>[]) => items.map((it) => (it.kind === 'head' ? `[${it.group} ${it.n}]` : it.kind === 'more' ? `${it.key} ${it.n}` : it.key));
const subs = (rows: AgentRow[], more = 0): Subagents => ({ rows, more, foldAt: 0 });

describe('withSubagents', () => {
	it('puts a conversation’s sub-agents after its row, in its group, then how many more', () => {
		const { items } = orderedList([entry('p', S.running, 30), entry('q', S.running, 20), entry('r', S.idle, 10)], 'state', new GroupPlaces(), { now: 100 });
		const list = withSubagents(items, (row) => (row.key === 'p' ? subs([agent('a'), agent('b'), agent('c'), agent('d')], 2) : row.key === 'r' ? subs([agent('x', 'done', 5)]) : NO_SUBAGENTS));
		expect(keys(list)).toEqual(['[working 2]', 'p', 'sub:p:a', 'sub:p:b', 'sub:p:c', 'sub:p:d', 'more:p 2', 'q', '[done 1]', 'r', 'sub:r:x']);
		expect(list.filter((it) => it.kind !== 'head').map((it) => it.group)).toEqual(['working', 'working', 'working', 'working', 'working', 'working', 'working', 'done', 'done']);
		const child = list[2];
		expect(child.kind === 'child' && [child.parent, child.agent.id, child.item]).toEqual(['p', 'a', 'p']);
	});

	it('does the same in the time order', () => {
		const { items } = orderedList([entry('p', S.idle, 30), entry('q', S.running, 20)], 'time', new GroupPlaces());
		expect(keys(withSubagents(items, (row) => (row.key === 'q' ? subs([agent('a')]) : NO_SUBAGENTS)))).toEqual(['p', 'q', 'sub:q:a']);
	});

	it('moves the sub-agents with their conversation when it changes group (they pass over the others too)', () => {
		const places = new GroupPlaces();
		const of = (row: { key: string }) => (row.key === 'p' ? subs([agent('a'), agent('b')]) : NO_SUBAGENTS);
		const before = withSubagents(orderedList([entry('p', S.running, 30), entry('q', S.idle, 20)], 'state', places, { now: 100 }).items, of);
		const after = withSubagents(orderedList([entry('p', S.idle, 30), entry('q', S.idle, 20)], 'state', places, { now: 200 }).items, of);
		expect(keys(before)).toEqual(['[working 1]', 'p', 'sub:p:a', 'sub:p:b', '[done 1]', 'q']);
		expect(keys(after)).toEqual(['[done 2]', 'p', 'sub:p:a', 'sub:p:b', 'q']);
		expect([...changedGroup(before, after)]).toEqual(['p', 'sub:p:a', 'sub:p:b']);
	});
});

describe('the list held, with sub-agents', () => {
	const of = (n: number) => (row: { key: string }) => (row.key === 'p' ? subs(['a', 'b', 'c', 'd', 'e'].slice(0, Math.min(n, 4)).map((id) => agent(id)), Math.max(0, n - 4)) : NO_SUBAGENTS);
	const base = orderedList([entry('p', S.running, 30), entry('q', S.idle, 20)], 'state', new GroupPlaces(), { now: 100 }).items;

	it('lets new sub-agents wait for the hold to end (they would move the rows below)', () => {
		const shown = withSubagents(base, of(0));
		const next = withSubagents(base, of(2));
		expect(keys(heldList(shown, next))).toEqual(keys(shown));
		expect(keys(next)).toEqual(['[working 1]', 'p', 'sub:p:a', 'sub:p:b', '[done 1]', 'q']);
	});

	it('keeps folding sub-agents until the hold ends, unless their conversation is gone', () => {
		const shown = withSubagents(base, of(5));
		const folded = withSubagents(base, of(0));
		expect(keys(heldList(shown, folded))).toEqual(['[working 1]', 'p', 'sub:p:a', 'sub:p:b', 'sub:p:c', 'sub:p:d', 'more:p 1', '[done 1]', 'q']);
		const gone = orderedList([entry('q', S.idle, 20)], 'state', new GroupPlaces(), { now: 100 }).items;
		expect(keys(heldList(shown, gone))).toEqual(['[working 0]', '[done 1]', 'q']);
	});

	it('shows a count that changes, and the look of each, in place', () => {
		const shown = withSubagents(base, of(5));
		const six = withSubagents(base, (row) => (row.key === 'p' ? subs(['a', 'b', 'c', 'd'].map((id) => agent(id, id === 'a' ? 'done' : 'running')), 2) : NO_SUBAGENTS));
		const held = heldList(shown, six);
		expect(keys(held)).toContain('more:p 2');
		const a = held.find((it) => it.key === 'sub:p:a');
		expect(a?.kind === 'child' && a.agent.state).toBe('done');
	});

	it('keeps the group of a conversation’s sub-agents with its row while held', () => {
		const places = new GroupPlaces();
		const shown = withSubagents(orderedList([entry('p', S.running, 30)], 'state', places, { now: 100 }).items, of(1));
		const next = withSubagents(orderedList([entry('p', S.idle, 30)], 'state', places, { now: 200 }).items, of(1));
		expect(heldList(shown, next).filter((it) => it.kind !== 'head').map((it) => it.group)).toEqual(['working', 'working']);
	});
});

describe('sameList with sub-agents', () => {
	const base = orderedList([entry('p', S.running, 30)], 'state', new GroupPlaces(), { now: 100 }).items;
	it('is the same list when only a sub-agent’s state changed (its look is read live)', () => {
		const a = withSubagents(base, () => subs([agent('a')]));
		const b = withSubagents(base, () => subs([agent('a', 'done', 5)]));
		expect(sameList(a, b)).toBe(true);
	});
	it('differs when one comes or goes, or the count of more changes', () => {
		const one = withSubagents(base, () => subs([agent('a')]));
		expect(sameList(one, withSubagents(base, () => subs([agent('a'), agent('b')])))).toBe(false);
		expect(sameList(withSubagents(base, () => subs([agent('a')], 1)), withSubagents(base, () => subs([agent('a')], 2)))).toBe(false);
		expect(sameList(one, withSubagents(base, () => NO_SUBAGENTS))).toBe(false);
	});
});

describe('arrivals', () => {
	it('staggers new sub-agents 120 ms apart after 80 ms, per conversation; the ones shown already do not count', () => {
		const items = orderedList([entry('p', S.running, 30), entry('q', S.running, 20)], 'state', new GroupPlaces(), { now: 100 }).items;
		const before = withSubagents(items, (row) => (row.key === 'p' ? subs([agent('a')]) : NO_SUBAGENTS));
		const after = withSubagents(items, (row) => (row.key === 'p' ? subs([agent('a'), agent('b'), agent('c'), agent('d')], 1) : subs([agent('x')])));
		expect([...arrivals(before, after)]).toEqual([
			['sub:p:b', 80],
			['sub:p:c', 200],
			['sub:p:d', 320],
			['more:p', 440],
			['sub:q:x', 80]
		]);
	});

	it('keeps the steps for ones that arrive in quick succession, an update each', () => {
		const items = orderedList([entry('p', S.running, 30)], 'state', new GroupPlaces(), { now: 100 }).items;
		const list = (n: number) => withSubagents(items, () => subs(['a', 'b', 'c'].slice(0, n).map((id) => agent(id))));
		const starts = new Map<string, number>();
		expect([...arrivals(list(0), list(1), 1000, starts)]).toEqual([['sub:p:a', 80]]);
		expect([...arrivals(list(1), list(2), 1010, starts)]).toEqual([['sub:p:b', 190]]);
		expect([...arrivals(list(2), list(3), 1020, starts)]).toEqual([['sub:p:c', 300]]);
		// Later: the first of a new batch again.
		expect([...arrivals(list(0), list(1), 5000, starts)]).toEqual([['sub:p:a', 80]]);
	});
});

describe('nextFold', () => {
	it('is the earliest fold to come', () => {
		expect(nextFold([NO_SUBAGENTS, { rows: [], more: 0, foldAt: 900 }, { rows: [], more: 0, foldAt: 400 }])).toBe(400);
		expect(nextFold([NO_SUBAGENTS])).toBe(0);
	});
});
