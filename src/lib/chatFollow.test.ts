import { describe, expect, it } from 'vitest';
import { ReaderInput, followAfterScroll, followTop, shortOfEnd } from './chatFollow';

/** A scroller 500 px high over `height` px of content, scrolled to `scrollTop`,
 *  whose latest user message starts `userAt` px into the content. */
function view(height: number, scrollTop: number, userAt: number | null) {
	const scroller = {
		scrollHeight: height,
		clientHeight: 500,
		scrollTop,
		getBoundingClientRect: () => ({ top: 0 })
	} as unknown as HTMLElement;
	const row = { getBoundingClientRect: () => ({ top: (userAt ?? 0) - scrollTop }) };
	const content = { querySelectorAll: () => (userAt === null ? [] : [row]) } as unknown as HTMLElement;
	return { scroller, content };
}

describe('followTop', () => {
	it('goes to the end while idle', () => {
		const { scroller, content } = view(2000, 100, 900);
		expect(followTop(scroller, content, false)).toBe(1500);
	});

	it('follows a short reply to the end', () => {
		const { scroller, content } = view(1300, 700, 1000);
		expect(followTop(scroller, content, true)).toBe(800);
		expect(shortOfEnd(scroller, 800)).toBe(false);
	});

	it('holds a reply that fills the view with its message at the top', () => {
		const { scroller, content } = view(3000, 700, 1000);
		expect(followTop(scroller, content, true)).toBe(984);
		expect(shortOfEnd(scroller, 984)).toBe(true);
	});

	it('never backs up to a message above the view', () => {
		const { scroller, content } = view(3000, 2400, 1000);
		expect(followTop(scroller, content, true)).toBe(2400);
		const none = view(3000, 2400, null);
		expect(followTop(none.scroller, none.content, true)).toBe(2400);
	});
});

describe('followAfterScroll', () => {
	// 1214 px of content; the view 518 px high, then taller as a card below it closes.
	const at = (clientHeight: number, scrollHeight = 1214) => ({ scrollHeight, clientHeight });

	it('keeps following when the layout moves the view up (a card below the list closed, the content shrank)', () => {
		// The recap card collapsing: 696 -> 677 -> 549, each time at the very end.
		expect(followAfterScroll(at(537), 677, 696, false, true)).toBe(true);
		expect(followAfterScroll(at(665), 549, 552, false, true)).toBe(true);
		// An answered approval removed at once.
		expect(followAfterScroll(at(665, 870), 205, 352, false, true)).toBe(true);
		// The event comes after a reply has grown the content again: no longer
		// at the end, and still not the reader's move. Following is kept as it was.
		expect(followAfterScroll(at(665, 1234), 529, 532, false, true)).toBeNull();
	});

	it('stops when the reader scrolls up, also from the end and near it', () => {
		expect(followAfterScroll(at(518), 680, 696, true, false)).toBe(false);
		expect(followAfterScroll(at(518), 300, 696, true, false)).toBe(false);
		expect(followAfterScroll(at(665, 1234), 529, 532, true, true)).toBe(false);
	});

	it('takes a move up with no size change for the reader, with no input seen (a scrollbar, autoscroll, assistive technology)', () => {
		expect(followAfterScroll(at(518), 600, 696, false, false)).toBe(false);
		expect(followAfterScroll(at(518), 694, 696, false, false)).toBe(false);
	});

	it('follows again once the view moves down near the end, not far from it', () => {
		expect(followAfterScroll(at(518), 650, 600, true, false)).toBe(true);
		expect(followAfterScroll(at(518), 696, 650, false, true)).toBe(true);
		expect(followAfterScroll(at(518), 400, 300, true, false)).toBe(false);
	});

	it('is at the end with nothing to scroll', () => {
		expect(followAfterScroll(at(900, 800), 0, 120, true, false)).toBe(true);
	});
});

describe('ReaderInput', () => {
	const list = { id: 'list' };
	const inList = new Set<unknown>();
	const view = { contains: (node: unknown) => node === list || inList.has(node) };
	const make = () => {
		let t = 1000;
		const input = new ReaderInput(() => view, () => t);
		return { input, later: (ms: number) => (t += ms) };
	};
	const el = (tagName: string, { editable = false, pressable = false, inside = true } = {}) => {
		const node = { tagName, isContentEditable: editable, closest: () => (pressable ? node : null) };
		if (inside) inList.add(node);
		return node as unknown as EventTarget;
	};

	it('is the reader while the primary or the middle button is held in the view', () => {
		const { input } = make();
		expect(input.active).toBe(false);
		input.down({ button: 2 });
		expect(input.active).toBe(false);
		input.down({ button: 0 });
		expect(input.active).toBe(true);
		input.up();
		expect(input.active).toBe(false);
		input.down({ button: 1 });
		expect(input.active).toBe(true);
	});

	it('is the reader for a moment after a scroll key in the list or on the page', () => {
		const { input, later } = make();
		input.key({ key: 'PageUp', target: el('DIV') });
		expect(input.active).toBe(true);
		later(700);
		expect(input.active).toBe(true);
		later(200);
		expect(input.active).toBe(false);
		input.key({ key: 'ArrowUp', target: el('BODY', { inside: false }) });
		expect(input.active).toBe(true);
	});

	it('is not the reader for other keys, keys in a text field or outside the list, or a space that presses a button', () => {
		const { input } = make();
		input.key({ key: 'Enter', target: el('DIV') });
		input.key({ key: 'ArrowUp', target: el('DIV', { editable: true }) });
		input.key({ key: 'PageUp', target: el('TEXTAREA') });
		input.key({ key: 'ArrowDown', target: el('DIV', { inside: false }) });
		input.key({ key: ' ', target: el('BUTTON', { pressable: true }) });
		expect(input.active).toBe(false);
	});
});
