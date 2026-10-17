// The navigator's 对话 list by state (design.md, "Navigator"): 等你处理
// (waiting for an answer or failed), 进行中, 已完成 (unread first), each
// with a heading and its count, empty groups left out. Or by time, newest
// first, as before.
//
// A conversation's place in its group is set when it enters the group and
// does not follow its activity after that, so rows move only when their
// state changes, and then to the top of the new group. While the reader's
// pointer is in the list or a row's menu is open, rows change their look
// only and keep their places (`heldList`); the order catches up after.
//
// The list is flat (headings, and the sub-agents under a conversation, are
// items too: sidebarSubagents.ts), so one keyed each can move every row and
// heading with `animate:` (moveRow in ui/motion.ts).
import type { SessionStatus } from '$lib/sessionStatus';

export type StateGroup = 'waiting' | 'working' | 'done';
export const STATE_GROUPS: readonly StateGroup[] = ['waiting', 'working', 'done'];
export type ListOrder = 'state' | 'time';

export function stateGroup(status: SessionStatus): StateGroup {
	if (status?.kind === 'input' || status?.kind === 'failed') return 'waiting';
	if (status?.kind === 'running') return 'working';
	return 'done';
}

export interface ListRow<T> {
	kind: 'row';
	key: string;
	group: StateGroup;
	item: T;
}
export interface ListHead {
	kind: 'head';
	key: `group:${StateGroup}`;
	group: StateGroup;
	n: number;
}
/** A sub-agent under its conversation (`parent`, the row's key), in the
 *  conversation's group; `item` is the conversation's. */
export interface ListChild<T, A = unknown> {
	kind: 'child';
	key: string;
	group: StateGroup;
	parent: string;
	agent: A;
	item: T;
}
/** The row after the first sub-agents: how many more there are. */
export interface ListMore<T> {
	kind: 'more';
	key: string;
	group: StateGroup;
	parent: string;
	n: number;
	item: T;
}
export type ListItem<T, A = unknown> = ListRow<T> | ListHead | ListChild<T, A> | ListMore<T>;
/** An item under a conversation's row (a sub-agent, or how many more). */
export const isUnder = <T, A>(it: ListItem<T, A>): it is ListChild<T, A> | ListMore<T> => it.kind === 'child' || it.kind === 'more';

/** What the list needs of a conversation. */
export interface Entry<T> {
	id: string;
	status: SessionStatus;
	/** Its last activity (the time order, and its place the first time it is seen). */
	at: number;
	item: T;
}

/** A conversation's place in its group: when it entered it (`at`, newest
 *  first), and the order it entered in (`seq`) for those that entered
 *  together, so later activity never reorders them. */
export interface Place {
	at: number;
	seq: number;
}

/** When each conversation entered its group: its place there. */
export class GroupPlaces {
	#seen = new Map<string, Place & { group: StateGroup }>();
	#seq = 0;
	/** Its place in `group`: kept while it stays there; `now` when it moves in
	 *  (the top); its last activity the first time it is seen. */
	place(id: string, group: StateGroup, at: number, now: number): Place {
		const seen = this.#seen.get(id);
		if (seen?.group === group) return seen;
		const place = { group, at: seen ? Math.max(now, at) : at, seq: this.#seq++ };
		this.#seen.set(id, place);
		return place;
	}
	/** Forget the conversations no longer listed. */
	keep(ids: Iterable<string>) {
		const keep = new Set(ids);
		for (const id of this.#seen.keys()) if (!keep.has(id)) this.#seen.delete(id);
	}
}

/** The list in `order`. By state: headings and rows, `limit` rows of 已完成
 *  shown (and the active one wherever it is); by time: rows only. `listed`:
 *  every conversation the list has, filtered out or not (a filter does not
 *  make a conversation lose its place); the entries by default. */
export function orderedList<T>(
	entries: readonly Entry<T>[],
	order: ListOrder,
	places: GroupPlaces,
	{ now = Date.now(), limit = Infinity, active = '', listed }: { now?: number; limit?: number; active?: string; listed?: Iterable<string> } = {}
): { items: ListItem<T>[]; hidden: number } {
	const sorted = entries.map((e, i) => ({ e, i, group: stateGroup(e.status) }));
	if (order === 'time') {
		sorted.sort((a, b) => b.e.at - a.e.at || a.i - b.i);
		const shown = cut(sorted, limit, active);
		return { items: shown.map(({ e, group }) => ({ kind: 'row', key: e.id, group, item: e.item })), hidden: sorted.length - shown.length };
	}
	const placed = sorted.map((x) => ({ ...x, place: places.place(x.e.id, x.group, x.e.at, now) }));
	places.keep(listed ?? entries.map((e) => e.id));
	const items: ListItem<T>[] = [];
	let hidden = 0;
	for (const group of STATE_GROUPS) {
		const rows = placed
			.filter((x) => x.group === group)
			.sort((a, b) => (group === 'done' ? unread(b.e) - unread(a.e) : 0) || b.place.at - a.place.at || a.place.seq - b.place.seq);
		if (!rows.length) continue;
		const shown = group === 'done' ? cut(rows, limit, active) : rows;
		hidden += rows.length - shown.length;
		items.push({ kind: 'head', key: `group:${group}`, group, n: rows.length });
		for (const { e } of shown) items.push({ kind: 'row', key: e.id, group, item: e.item });
	}
	return { items, hidden };
}

const unread = (e: Entry<unknown>) => (e.status?.kind === 'unread' ? 1 : 0);

/** The first `limit`, and the active one wherever it is. */
function cut<X extends { e: Entry<unknown> }>(rows: X[], limit: number, active: string): X[] {
	if (rows.length <= limit) return rows;
	const top = rows.slice(0, limit);
	const current = rows.find((x) => x.e.id === active);
	return current && !top.includes(current) ? [...top, current] : top;
}

/** The list while it is held: the rows in the places they show (with what
 *  they show now: their look, the headings' counts), new rows where the
 *  next order puts them, rows gone left out. A heading or a sub-agent not
 *  shown yet waits for the hold to end, and so does a sub-agent that folds
 *  (while its conversation is listed): either would move the rows below. */
export function heldList<T, A>(shown: readonly ListItem<T, A>[], next: readonly ListItem<T, A>[]): ListItem<T, A>[] {
	const fresh = new Map(next.map((it) => [it.key, it]));
	const out: ListItem<T, A>[] = [];
	for (const it of shown) {
		const now = fresh.get(it.key);
		// A row (and what is under it) keeps the group it shows in (its
		// place) until the hold ends.
		if (now) out.push(now.kind !== 'head' && it.kind !== 'head' ? { ...now, group: it.group } : now);
		else if (it.kind === 'head') out.push({ ...it, n: 0 });
		else if (isUnder(it) && fresh.has(it.parent)) out.push(it);
	}
	// New rows: after the nearest row before them in the next order that shows.
	const placed = new Set(out.map((it) => it.key));
	next.forEach((it, i) => {
		// (Only rows: a heading or a sub-agent waits.)
		if (it.kind !== 'row' || placed.has(it.key)) return;
		let at = 0;
		for (let j = i - 1; j >= 0; j--) {
			const k = out.findIndex((o) => o.key === next[j].key);
			if (k >= 0) {
				at = k + 1;
				break;
			}
		}
		out.splice(at, 0, it);
		placed.add(it.key);
	});
	return out;
}

const ORDER_KEY = 'lynshen-sidebar-order';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

/** The 对话 order the user chose: by state unless they chose time. */
export function readListOrder(store: Store): ListOrder {
	try {
		return store.getItem(ORDER_KEY) === 'time' ? 'time' : 'state';
	} catch {
		return 'state';
	}
}

export function writeListOrder(store: Store, order: ListOrder): void {
	try {
		store.setItem(ORDER_KEY, order);
	} catch {
		/* private mode: for this run only */
	}
}

/** The same items in the same places, with the same groups and counts (a
 *  row's look comes from its conversation, a sub-agent's from its
 *  conversation's sub-agents, not from the list). */
export function sameList<T, A>(a: readonly ListItem<T, A>[], b: readonly ListItem<T, A>[]): boolean {
	return (
		a.length === b.length &&
		a.every((x, i) => {
			const y = b[i];
			if (x.key !== y.key || x.group !== y.group || x.kind !== y.kind) return false;
			if (x.kind === 'head' || x.kind === 'more') return x.n === (y as ListHead | ListMore<T>).n;
			return same(x.item, (y as ListRow<T>).item);
		})
	);
}

/** Two list items that render the same: the same object, or records whose
 *  object fields are the same objects (the navigator's {s, p, at, i}). */
function same(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
	return Object.entries(a).every(([k, v]) => typeof v !== 'object' || v === (b as Record<string, unknown>)[k]);
}

/** The rows that changed group between two lists, with the sub-agents
 *  under them: they pass over the others while they move. */
export function changedGroup<T, A>(before: readonly ListItem<T, A>[], after: readonly ListItem<T, A>[]): Set<string> {
	const was = new Map(before.filter((it) => it.kind !== 'head').map((it) => [it.key, it.group]));
	return new Set(after.filter((it) => it.kind !== 'head' && was.has(it.key) && was.get(it.key) !== it.group).map((it) => it.key));
}
