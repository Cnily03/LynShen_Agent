import { describe, expect, it } from 'vitest';
import { fromEdge, swipeStep, turn } from './deck';

describe('等你处理, one by one', () => {
	it('turns a card on a sideways swipe of 44 px or more', () => {
		expect(swipeStep(-44, 0)).toBe(1);
		expect(swipeStep(60, 10)).toBe(-1);
		expect(swipeStep(-43, 0)).toBe(0);
		// Mostly vertical: the page scrolled.
		expect(swipeStep(-60, 70)).toBe(0);
	});

	it('leaves the screen edges to the system', () => {
		expect(fromEdge(10, 390)).toBe(true);
		expect(fromEdge(370, 390)).toBe(true);
		expect(fromEdge(24, 390)).toBe(false);
		expect(fromEdge(195, 390)).toBe(false);
	});

	it('stops at the ends and says which', () => {
		expect(turn(0, 1, 3)).toEqual({ at: 1, hit: null });
		expect(turn(2, 1, 3)).toEqual({ at: 2, hit: 'last' });
		expect(turn(0, -1, 3)).toEqual({ at: 0, hit: 'first' });
	});
});
