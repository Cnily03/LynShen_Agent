import { describe, expect, it } from 'vitest';
import { defaultEffort, effortLabel, stepStop, stopAt } from './effort';

describe('effort helpers', () => {
	it('defaults to the provider default, else medium, else the first tier', () => {
		expect(defaultEffort(['default', 'none', 'low', 'medium', 'high', 'xhigh'])).toBe('default');
		expect(defaultEffort(['none', 'low', 'default'])).toBe('default');
		expect(defaultEffort(['low', 'medium', 'high'])).toBe('medium');
		expect(defaultEffort(['low', 'high'])).toBe('low');
		expect(defaultEffort([])).toBe('');
	});

	it('labels efforts', () => {
		expect(effortLabel('high')).toBe('High');
		expect(effortLabel('xhigh')).toBe('XHigh');
		expect(effortLabel('default')).toBe('Default');
		expect(effortLabel('')).toBe('');
	});

	it('snaps a pointer to the nearest stop', () => {
		// 5 stops over 0..100 → at 0, 25, 50, 75, 100
		expect(stopAt(0, 0, 100, 5)).toBe(0);
		expect(stopAt(12, 0, 100, 5)).toBe(0);
		expect(stopAt(13, 0, 100, 5)).toBe(1);
		expect(stopAt(60, 0, 100, 5)).toBe(2);
		expect(stopAt(-40, 0, 100, 5)).toBe(0);
		expect(stopAt(400, 0, 100, 5)).toBe(4);
		expect(stopAt(50, 0, 100, 1)).toBe(0);
	});

	it('steps with arrow / Home / End keys, clamped', () => {
		expect(stepStop('ArrowLeft', 0, 4)).toBe(0);
		expect(stepStop('ArrowRight', 1, 4)).toBe(2);
		expect(stepStop('ArrowRight', 3, 4)).toBe(3);
		expect(stepStop('Home', 2, 4)).toBe(0);
		expect(stepStop('End', 0, 4)).toBe(3);
		expect(stepStop('Enter', 1, 4)).toBeNull();
	});
});
