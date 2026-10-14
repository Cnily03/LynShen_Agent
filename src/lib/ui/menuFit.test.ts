import { describe, expect, it } from 'vitest';
import { MENU_EDGE, MENU_MIN_HEIGHT, bandWithin, fitMenu, nextRow, scrollToShow, wheelScrolls } from './menuFit';

// A window 825 tall: the title bar to 48, the conversation's scroller from
// 48 to 715 (the composer below it), the new conversation's picker at 374.
const scroller = { top: 48, bottom: 715 };
const picker = { top: 364, bottom: 384 };

describe('fitMenu', () => {
	it('keeps a long list below its anchor, inside the scroller, short of its edge', () => {
		const got = fitMenu({ anchor: picker, band: scroller, natural: 1300, preferred: 'down' });
		expect(got.side).toBe('down');
		expect(got.maxHeight).toBe(715 - MENU_EDGE - (384 + 6));
	});

	it('leaves a list that fits as tall as it is (the limit is above it)', () => {
		const got = fitMenu({ anchor: picker, band: scroller, natural: 120, preferred: 'down' });
		expect(got.side).toBe('down');
		expect(got.maxHeight).toBeGreaterThanOrEqual(120);
	});

	it('opens on the other side when the list does not fit and there is more room there', () => {
		const low = { top: 600, bottom: 620 };
		const got = fitMenu({ anchor: low, band: scroller, natural: 400, preferred: 'down' });
		expect(got.side).toBe('up');
		expect(got.maxHeight).toBe(600 - 8 - (48 + MENU_EDGE));
	});

	it('stays on its side when the other has less room, or when told not to turn', () => {
		const high = { top: 100, bottom: 120 };
		expect(fitMenu({ anchor: high, band: scroller, natural: 2000, preferred: 'down' }).side).toBe('down');
		const low = { top: 600, bottom: 620 };
		expect(fitMenu({ anchor: low, band: scroller, natural: 400, preferred: 'down', flip: false }).side).toBe('down');
	});

	it('an up menu turns down only when that has more room', () => {
		const composer = { top: 730, bottom: 760 };
		const got = fitMenu({ anchor: composer, band: { top: 48, bottom: 825 }, natural: 900, preferred: 'up' });
		expect(got.side).toBe('up');
		expect(got.maxHeight).toBe(730 - 8 - (48 + MENU_EDGE));
	});

	it('never goes below the least height, even with no room', () => {
		const got = fitMenu({ anchor: { top: 700, bottom: 714 }, band: { top: 690, bottom: 715 }, natural: 500, preferred: 'down' });
		expect(got.maxHeight).toBe(MENU_MIN_HEIGHT);
	});
});

describe('bandWithin', () => {
	it('is the window cut by each clipping ancestor', () => {
		const band = bandWithin({ top: 0, bottom: 825 }, [
			{ top: 48, bottom: 715, fade: 0 },
			{ top: 0, bottom: 800, fade: 0 }
		]);
		expect(band).toEqual({ top: 48, bottom: 715 });
	});

	it('leaves out the masked edges of a scroller (glass)', () => {
		expect(bandWithin({ top: 0, bottom: 825 }, [{ top: 48, bottom: 715, fade: 28 }])).toEqual({ top: 76, bottom: 687 });
	});

	it('starts below the toasts over the menu', () => {
		expect(bandWithin({ top: 0, bottom: 825 }, [{ top: 48, bottom: 715, fade: 0 }], 104)).toEqual({ top: 104, bottom: 715 });
	});
});

describe('wheelScrolls', () => {
	it('moves a list that has somewhere to go', () => {
		expect(wheelScrolls(0, 500, 40)).toBe(true);
		expect(wheelScrolls(200, 500, -40)).toBe(true);
	});

	it('holds at the ends and with nothing to scroll, so the page behind stays put', () => {
		expect(wheelScrolls(0, 500, -40)).toBe(false);
		expect(wheelScrolls(500, 500, 40)).toBe(false);
		expect(wheelScrolls(0, 0, 40)).toBe(false);
		expect(wheelScrolls(0, 500, 0)).toBe(false);
	});
});

describe('scrollToShow', () => {
	it('scrolls down just enough to show a row below the view', () => {
		expect(scrollToShow(0, 300, 320, 50, 6)).toBe(320 + 50 + 6 - 300);
	});

	it('scrolls up to a row above the view', () => {
		expect(scrollToShow(400, 300, 100, 50, 6)).toBe(94);
		expect(scrollToShow(400, 300, 2, 50, 6)).toBe(0);
	});

	it('leaves a row in view where it is', () => {
		expect(scrollToShow(100, 300, 200, 50, 6)).toBe(100);
	});
});

describe('nextRow', () => {
	it('starts at the first row going down and the last going up', () => {
		expect(nextRow('ArrowDown', -1, 5)).toBe(0);
		expect(nextRow('ArrowUp', -1, 5)).toBe(4);
	});

	it('goes round at either end', () => {
		expect(nextRow('ArrowDown', 4, 5)).toBe(0);
		expect(nextRow('ArrowUp', 0, 5)).toBe(4);
	});

	it('jumps to the ends with Home and End, and ignores other keys', () => {
		expect(nextRow('Home', 3, 5)).toBe(0);
		expect(nextRow('End', 1, 5)).toBe(4);
		expect(nextRow('a', 1, 5)).toBeNull();
		expect(nextRow('ArrowDown', -1, 0)).toBeNull();
	});
});
