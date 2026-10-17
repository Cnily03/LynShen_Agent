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
		expect(followAfterScroll(at(537), 677, 696, false)).toBe(true);
		expect(followAfterScroll(at(665), 549, 552, false)).toBe(true);
		// An answered approval removed at once.
		expect(followAfterScroll(at(665, 870), 205, 352, false)).toBe(true);
		// The event comes after a reply has grown the content again: no longer
		// at the end, and still not the reader's move. Following is kept as it was.
		expect(followAfterScroll(at(665, 1234), 529, 532, false)).toBeNull();
	});

	it('stops when the reader scrolls up, also from the end and near it', () => {
		expect(followAfterScroll(at(518), 680, 696, true)).toBe(false);
		expect(followAfterScroll(at(518), 300, 696, true)).toBe(false);
		expect(followAfterScroll(at(665, 1234), 529, 532, true)).toBe(false);
	});

	it('follows again once the view moves down near the end, not far from it', () => {
		expect(followAfterScroll(at(518), 650, 600, true)).toBe(true);
		expect(followAfterScroll(at(518), 696, 650, false)).toBe(true);
		expect(followAfterScroll(at(518), 400, 300, true)).toBe(false);
	});

	it('is at the end with nothing to scroll', () => {
		expect(followAfterScroll(at(900, 800), 0, 120, true)).toBe(true);
	});
});

describe('ReaderInput', () => {
	const make = () => {
		let t = 1000;
		const input = new ReaderInput(() => t);
		return { input, later: (ms: number) => (t += ms) };
	};
	const field = (tagName: string, isContentEditable = false) => ({ tagName, isContentEditable }) as unknown as EventTarget;

	it('is the reader while a primary pointer is held in the view', () => {
		const { input } = make();
		expect(input.active).toBe(false);
		input.down({ button: 2 });
		expect(input.active).toBe(false);
		input.down({ button: 0 });
		expect(input.active).toBe(true);
		input.up();
		expect(input.active).toBe(false);
	});

	it('is the reader for a moment after a scroll key outside a text field', () => {
		const { input, later } = make();
		input.key({ key: 'PageUp', target: field('MAIN') });
		expect(input.active).toBe(true);
		later(700);
		expect(input.active).toBe(true);
		later(200);
		expect(input.active).toBe(false);
	});

	it('is not the reader for other keys or keys typed in a text field', () => {
		const { input } = make();
		input.key({ key: 'Enter', target: field('MAIN') });
		input.key({ key: 'ArrowUp', target: field('DIV', true) });
		input.key({ key: 'PageUp', target: field('TEXTAREA') });
		input.key({ key: ' ', target: field('INPUT') });
		expect(input.active).toBe(false);
	});
});
