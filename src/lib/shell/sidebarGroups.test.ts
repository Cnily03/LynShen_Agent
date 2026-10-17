import { describe, expect, it } from 'vitest';
import type { SessionStatus } from '$lib/sessionStatus';
import { GroupPlaces, changedGroup, heldList, orderedList, readListOrder, sameList, stateGroup, writeListOrder, type Entry, type ListItem } from './sidebarGroups';

const S = {
	ask: { kind: 'input', ask: 'approve', what: '' } as SessionStatus,
	failed: { kind: 'failed', message: 'x' } as SessionStatus,
	running: { kind: 'running' } as SessionStatus,
	unread: { kind: 'unread' } as SessionStatus,
	idle: null as SessionStatus
};
const entry = (id: string, status: SessionStatus, at: number): Entry<string> => ({ id, status, at, item: id });
const keys = (items: ListItem<string>[]) => items.map((it) => (it.kind === 'head' ? `[${it.group} ${it.n}]` : it.key));

describe('stateGroup', () => {
	it('puts waiting and failed together, then working, then the rest', () => {
		expect([S.ask, S.failed, S.running, S.unread, S.idle].map(stateGroup)).toEqual(['waiting', 'waiting', 'working', 'done', 'done']);
	});
});

describe('orderedList by state', () => {
	it('groups with headings and counts, leaves empty groups out, unread first in 已完成', () => {
		const places = new GroupPlaces();
		const { items } = orderedList([entry('a', S.idle, 50), entry('b', S.running, 40), entry('c', S.unread, 30), entry('d', S.ask, 20), entry('e', S.failed, 10)], 'state', places, { now: 100 });
		expect(keys(items)).toEqual(['[waiting 2]', 'd', 'e', '[working 1]', 'b', '[done 2]', 'c', 'a']);
		const none = orderedList([entry('a', S.idle, 1)], 'state', new GroupPlaces(), { now: 100 });
		expect(keys(none.items)).toEqual(['[done 1]', 'a']);
	});

	it('moves a row only when its state changes, then to the top of its new group', () => {
		const places = new GroupPlaces();
		const first = orderedList([entry('a', S.running, 30), entry('b', S.running, 20), entry('c', S.idle, 10)], 'state', places, { now: 100 });
		expect(keys(first.items)).toEqual(['[working 2]', 'a', 'b', '[done 1]', 'c']);
		// b gets newer activity: it keeps its place.
		const busy = orderedList([entry('a', S.running, 30), entry('b', S.running, 90), entry('c', S.idle, 10)], 'state', places, { now: 200 });
		expect(keys(busy.items)).toEqual(['[working 2]', 'a', 'b', '[done 1]', 'c']);
		// a finishes: to the top of 已完成 (read), above c.
		const done = orderedList([entry('a', S.idle, 30), entry('b', S.running, 90), entry('c', S.idle, 10)], 'state', places, { now: 300 });
		expect(keys(done.items)).toEqual(['[working 1]', 'b', '[done 2]', 'a', 'c']);
		// c starts again: the top of 进行中.
		const again = orderedList([entry('a', S.idle, 30), entry('b', S.running, 90), entry('c', S.running, 10)], 'state', places, { now: 400 });
		expect(keys(again.items)).toEqual(['[working 2]', 'c', 'b', '[done 1]', 'a']);
	});

	it('keeps the order of rows that entered a group together, whatever their activity after', () => {
		const places = new GroupPlaces();
		orderedList([entry('a', S.idle, 30), entry('b', S.idle, 20)], 'state', places, { now: 100 });
		// Both start in the same update: a (more recent) above b.
		const both = orderedList([entry('a', S.running, 30), entry('b', S.running, 20)], 'state', places, { now: 200 });
		expect(keys(both.items)).toEqual(['[working 2]', 'a', 'b']);
		// b gets newer activity (the list passes the newest first): no move.
		const later = orderedList([entry('b', S.running, 300), entry('a', S.running, 30)], 'state', places, { now: 300 });
		expect(keys(later.items)).toEqual(['[working 2]', 'a', 'b']);
	});

	it('keeps the places of the conversations a filter hides', () => {
		const places = new GroupPlaces();
		const all = [entry('a', S.idle, 30), entry('b', S.idle, 20), entry('c', S.running, 10)];
		orderedList(all, 'state', places, { now: 100 });
		// c finishes: the top of 已完成, above a and b.
		const done = [entry('a', S.idle, 30), entry('b', S.idle, 20), entry('c', S.idle, 10)];
		expect(keys(orderedList(done, 'state', places, { now: 200 }).items)).toEqual(['[done 3]', 'c', 'a', 'b']);
		// A filter shows a only for a while; c keeps its place after.
		orderedList([done[0]], 'state', places, { now: 300, listed: ['a', 'b', 'c'] });
		expect(keys(orderedList(done, 'state', places, { now: 400 }).items)).toEqual(['[done 3]', 'c', 'a', 'b']);
	});

	it('shows `limit` rows of 已完成 and the active one, never cuts the other groups', () => {
		const entries = [entry('w', S.ask, 99), ...Array.from({ length: 10 }, (_, i) => entry(`d${i}`, S.idle, 50 - i))];
		const { items, hidden } = orderedList(entries, 'state', new GroupPlaces(), { now: 100, limit: 3, active: 'd8' });
		expect(keys(items)).toEqual(['[waiting 1]', 'w', '[done 10]', 'd0', 'd1', 'd2', 'd8']);
		expect(hidden).toBe(6);
	});
});

describe('orderedList by time', () => {
	it('lists rows only, newest first, as before', () => {
		const { items } = orderedList([entry('a', S.idle, 10), entry('b', S.ask, 30), entry('c', S.running, 20)], 'time', new GroupPlaces());
		expect(keys(items)).toEqual(['b', 'c', 'a']);
	});
});

describe('heldList', () => {
	it('keeps the places shown while held: new looks and counts, new rows where they belong, rows gone left out', () => {
		const places = new GroupPlaces();
		const shown = orderedList([entry('a', S.running, 30), entry('b', S.running, 20), entry('c', S.idle, 10)], 'state', places, { now: 100 }).items;
		// a finishes and a new conversation n starts, while the pointer is in the list.
		const next = orderedList([entry('a', S.idle, 30), entry('b', S.running, 20), entry('c', S.idle, 10), entry('n', S.running, 300)], 'state', places, { now: 300 }).items;
		expect(keys(next)).toEqual(['[working 2]', 'n', 'b', '[done 2]', 'a', 'c']);
		const held = heldList(shown, next);
		expect(keys(held)).toEqual(['[working 2]', 'n', 'a', 'b', '[done 2]', 'c']);
		// c is closed meanwhile.
		const without = orderedList([entry('a', S.idle, 30), entry('b', S.running, 20), entry('n', S.running, 300)], 'state', places, { now: 400 }).items;
		const later = heldList(held, without);
		expect(keys(later)).toEqual(['[working 2]', 'n', 'a', 'b', '[done 1]']);
	});

	it('keeps an emptied group heading until the hold ends, and shows a new one only after', () => {
		const places = new GroupPlaces();
		const shown = orderedList([entry('a', S.ask, 30), entry('b', S.idle, 20)], 'state', places, { now: 100 }).items;
		const next = orderedList([entry('a', S.running, 30), entry('b', S.idle, 20)], 'state', places, { now: 200 }).items;
		expect(keys(heldList(shown, next))).toEqual(['[waiting 0]', 'a', '[done 1]', 'b']);
	});
});

describe('the order the user chose', () => {
	it('is by state unless they chose time, kept across restarts', () => {
		const data = new Map<string, string>();
		const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
		expect(readListOrder(store)).toBe('state');
		writeListOrder(store, 'time');
		expect(readListOrder(store)).toBe('time');
		writeListOrder(store, 'state');
		expect(readListOrder(store)).toBe('state');
	});
});

describe('changedGroup', () => {
	it('names the rows that land in another group, also after a hold', () => {
		const places = new GroupPlaces();
		const shown = orderedList([entry('a', S.running, 30), entry('b', S.running, 20), entry('c', S.idle, 10)], 'state', places, { now: 100 }).items;
		const next = orderedList([entry('a', S.idle, 30), entry('b', S.running, 20), entry('c', S.idle, 10)], 'state', places, { now: 200 }).items;
		expect([...changedGroup(shown, next)]).toEqual(['a']);
		// Held, a stays where it shows; released, it is the one that crosses.
		const held = heldList(shown, next);
		expect([...changedGroup(shown, held)]).toEqual([]);
		expect([...changedGroup(held, next)]).toEqual(['a']);
	});
});

describe('sameList', () => {
	it('is true when only a conversation\'s activity changed, false when a row moves or a count changes', () => {
		const s = { a: { id: 'a' }, b: { id: 'b' } };
		const rows = (at: number, order: ('a' | 'b')[] = ['a', 'b'], status = S.running) =>
			orderedList(order.map((k, i) => ({ id: k, status: k === 'a' ? status : S.running, at: at - i, item: { s: s[k], at: at - i } })), 'state', new GroupPlaces(), { now: 1 }).items;
		expect(sameList(rows(10), rows(20))).toBe(true);
		expect(sameList(rows(10), rows(10, ['b', 'a']))).toBe(false);
		expect(sameList(rows(10), rows(10, ['a', 'b'], S.idle))).toBe(false);
	});
});
