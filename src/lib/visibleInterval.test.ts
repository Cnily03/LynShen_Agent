import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { visibleInterval } from './visibleInterval';

// The page's visibility, as a document stands in for it (no DOM here).
let hidden = false;
const page = new EventTarget();
Object.defineProperty(page, 'hidden', { get: () => hidden });

describe('visibleInterval', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		hidden = false;
		vi.stubGlobal('document', page);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});
	const show = (h: boolean) => {
		hidden = h;
		page.dispatchEvent(new Event('visibilitychange'));
	};

	it('ticks while the page shows, not while it is hidden, and once at once when it shows again', () => {
		const fn = vi.fn();
		const stop = visibleInterval(fn, 1000);
		vi.advanceTimersByTime(3000);
		expect(fn).toHaveBeenCalledTimes(3);
		show(true);
		vi.advanceTimersByTime(10_000);
		expect(fn).toHaveBeenCalledTimes(3);
		show(false);
		expect(fn).toHaveBeenCalledTimes(4);
		vi.advanceTimersByTime(1000);
		expect(fn).toHaveBeenCalledTimes(5);
		stop();
		vi.advanceTimersByTime(5000);
		show(true);
		show(false);
		expect(fn).toHaveBeenCalledTimes(5);
	});

	it('starts stopped on a hidden page', () => {
		hidden = true;
		const fn = vi.fn();
		const stop = visibleInterval(fn, 100);
		vi.advanceTimersByTime(1000);
		expect(fn).not.toHaveBeenCalled();
		show(false);
		expect(fn).toHaveBeenCalledTimes(1);
		stop();
	});
});
