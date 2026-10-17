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
// The list is flat (headings are items too), so one keyed each can move
// every row and heading with `animate:` (moveRow in ui/motion.ts).
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
export type ListItem<T> = ListRow<T> | ListHead;

/** What the list needs of a conversation. */
export interface Entry<T> {
	id: string;
	status: SessionStatus;
	/** Its last activity (the time order, and its place the first time it is seen). */
	at: number;
	item: T;
}

/** When each conversation entered its group: its place there. */
export class GroupPlaces {
	#seen = new Map<string, { group: StateGroup; at: number }>();
	/** Its place in `group`: kept while it stays there; `now` when it moves in
	 *  (the top); its last activity the first time it is seen. */
	place(id: string, group: StateGroup, at: number, now: number): number {
		const seen = this.#seen.get(id);
		if (seen?.group === group) return seen.at;
		const place = seen ? Math.max(now, at) : at;
		this.#seen.set(id, { group, at: place });
		return place;
	}
	/** Forget the conversations no longer listed. */
	keep(ids: Iterable<string>) {
		const keep = new Set(ids);
		for (const id of this.#seen.keys()) if (!keep.has(id)) this.#seen.delete(id);
	}
}

/** The list in `order`. By state: headings and rows, `limit` rows of 已完成
 *  shown (and the active one wherever it is); by time: rows only. */
export function orderedList<T>(
	entries: readonly Entry<T>[],
	order: ListOrder,
	places: GroupPlaces,
	{ now = Date.now(), limit = Infinity, active = '' }: { now?: number; limit?: number; active?: string } = {}
): { items: ListItem<T>[]; hidden: number } {
	const sorted = entries.map((e, i) => ({ e, i, group: stateGroup(e.status) }));
	if (order === 'time') {
		sorted.sort((a, b) => b.e.at - a.e.at || a.i - b.i);
		const shown = cut(sorted, limit, active);
		return { items: shown.map(({ e, group }) => ({ kind: 'row', key: e.id, group, item: e.item })), hidden: sorted.length - shown.length };
	}
	const placed = sorted.map((x) => ({ ...x, place: places.place(x.e.id, x.group, x.e.at, now) }));
	places.keep(entries.map((e) => e.id));
	const items: ListItem<T>[] = [];
	let hidden = 0;
	for (const group of STATE_GROUPS) {
		const rows = placed
			.filter((x) => x.group === group)
			.sort((a, b) => (group === 'done' ? unread(b.e) - unread(a.e) : 0) || b.place - a.place || a.i - b.i);
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
 *  next order puts them, rows gone left out. A heading not shown yet waits
 *  for the hold to end. */
export function heldList<T>(shown: readonly ListItem<T>[], next: readonly ListItem<T>[]): ListItem<T>[] {
	const fresh = new Map(next.map((it) => [it.key, it]));
	const out: ListItem<T>[] = [];
	for (const it of shown) {
		const now = fresh.get(it.key);
		// A row keeps the group it shows in (its place) until the hold ends.
		if (now) out.push(now.kind === 'row' && it.kind === 'row' ? { ...now, group: it.group } : now);
		else if (it.kind === 'head') out.push({ ...it, n: 0 });
	}
	// New rows: after the nearest row before them in the next order that shows.
	const placed = new Set(out.map((it) => it.key));
	next.forEach((it, i) => {
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

/** The rows that changed group between two lists: they pass over the others
 *  while they move. */
export function changedGroup<T>(before: readonly ListItem<T>[], after: readonly ListItem<T>[]): Set<string> {
	const was = new Map(before.filter((it) => it.kind === 'row').map((it) => [it.key, it.group]));
	return new Set(after.filter((it) => it.kind === 'row' && was.has(it.key) && was.get(it.key) !== it.group).map((it) => it.key));
}
