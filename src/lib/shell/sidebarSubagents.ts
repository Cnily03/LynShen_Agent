// The sub-agents under their conversation in the navigator's 对话 list
// (design.md, "Navigator"). While a conversation's turn runs sub-agents, the
// ones running and the ones just finished list under its row: the first
// SUBAGENT_ROWS in the order they started, then one row for how many more.
// They are the subagents card's rows (agentProgress.ts, `agentRows` for the
// turn), so the two never disagree. Once the turn has ended and none of them
// is at work, they stay SUBAGENT_STAY_MS, then fold.
//
// They are items of the list itself (`withSubagents`), after their
// conversation's row and in its group, so they move with it when it changes
// group, and the rows below make room for them with the same move.
import { agentRows, isLive, type AgentRow } from '$lib/agentProgress';
import type { ChatState } from '$lib/chat.svelte';
import type { ListItem, ListRow } from './sidebarGroups';

/** Sub-agents listed under a conversation; more show as one row. */
export const SUBAGENT_ROWS = 4;
/** How long they stay once the turn has ended and none is at work, ms. */
export const SUBAGENT_STAY_MS = 30_000;

/** What the list reads of a conversation (ChatState). */
export type SubagentSource = Pick<ChatState, 'agentRuns' | 'subagents' | 'team' | 'failedAgents' | 'turnStartedAt' | 'turnEndedAt' | 'busy'>;

export interface Subagents {
	/** The ones listed, oldest first (at most SUBAGENT_ROWS). */
	rows: AgentRow[];
	/** How many more there are. */
	more: number;
	/** When they fold (ms); 0 while the turn runs or one of them is at work. */
	foldAt: number;
}

export const NO_SUBAGENTS: Subagents = Object.freeze({ rows: [], more: 0, foldAt: 0 }) as Subagents;

/** The sub-agents to list, given the turn's (`rows`, oldest first):
 *  every one while the turn runs (`running`) or one of them is at work;
 *  after that, until `stay` after the turn ended (`endedAt`) or the last
 *  of them did, whichever is later. With no end known, none. */
export function subagentsShown(
	rows: readonly AgentRow[],
	{ running, endedAt, now, stay = SUBAGENT_STAY_MS, limit = SUBAGENT_ROWS }: { running: boolean; endedAt: number; now: number; stay?: number; limit?: number }
): Subagents {
	if (!rows.length) return NO_SUBAGENTS;
	let foldAt = 0;
	if (!running && !rows.some(isLive)) {
		const last = Math.max(endedAt, ...rows.map((r) => r.endedAt));
		foldAt = last + stay;
		if (!last || now >= foldAt) return NO_SUBAGENTS;
	}
	return { rows: rows.slice(0, limit), more: Math.max(0, rows.length - limit), foldAt };
}

/** A conversation's sub-agents to list at `now`: its turn's, as the
 *  subagents card lists them. The turn runs while its engine is at work or
 *  until it ends (`turnEndedAt`); a sub-agent's end is when this client saw
 *  it end. */
export function subagentsOf(chat: SubagentSource, now: number, stay = SUBAGENT_STAY_MS): Subagents {
	const rows = agentRows({
		runs: chat.agentRuns,
		subagents: chat.subagents,
		team: chat.team,
		failed: chat.failedAgents,
		since: chat.turnStartedAt || Number.MAX_SAFE_INTEGER
	});
	const running = chat.busy || (chat.turnStartedAt > 0 && !chat.turnEndedAt);
	return subagentsShown(rows, { running, endedAt: chat.turnEndedAt, now, stay });
}

/** The list with each conversation's sub-agents after its row, in its
 *  group (`of`: a row's; keyed `sub:<conversation>:<agent>`), and how many
 *  more after them (`more:<conversation>`). */
export function withSubagents<T>(items: readonly ListItem<T>[], of: (row: ListRow<T>) => Subagents): ListItem<T, AgentRow>[] {
	const out: ListItem<T, AgentRow>[] = [];
	for (const it of items) {
		out.push(it as ListItem<T, AgentRow>);
		if (it.kind !== 'row') continue;
		const subs = of(it);
		for (const agent of subs.rows) out.push({ kind: 'child', key: `sub:${it.key}:${agent.id}`, group: it.group, parent: it.key, agent, item: it.item });
		if (subs.more) out.push({ kind: 'more', key: `more:${it.key}`, group: it.group, parent: it.key, n: subs.more, item: it.item });
	}
	return out;
}

/** The earliest time any of them folds (0: none will). */
export function nextFold(all: Iterable<Subagents>): number {
	let at = 0;
	for (const s of all) if (s.foldAt && (!at || s.foldAt < at)) at = s.foldAt;
	return at;
}

/** Sub-agents coming in fade in after the rows below start to make room
 *  (SUBAGENT_DELAY), one after the other under their conversation
 *  (SUBAGENT_STEP apart): the delay of each new one, by key. `starts` keeps
 *  when the last one under each conversation starts (ms, on `now`'s clock)
 *  from one update to the next, so ones that arrive in quick succession (an
 *  engine event each) still come in one after the other. */
export const SUBAGENT_DELAY = 80;
export const SUBAGENT_STEP = 120;
export function arrivals<T, A>(
	before: readonly ListItem<T, A>[],
	after: readonly ListItem<T, A>[],
	now = 0,
	starts = new Map<string, number>()
): Map<string, number> {
	for (const [parent, at] of starts) if (at < now) starts.delete(parent);
	const had = new Set(before.map((it) => it.key));
	const delays = new Map<string, number>();
	for (const it of after) {
		if ((it.kind !== 'child' && it.kind !== 'more') || had.has(it.key)) continue;
		const last = starts.get(it.parent);
		const start = Math.max(now + SUBAGENT_DELAY, last === undefined ? 0 : last + SUBAGENT_STEP);
		starts.set(it.parent, start);
		delays.set(it.key, start - now);
	}
	return delays;
}
