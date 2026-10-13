import { describe, expect, it } from 'vitest';
import { scrimClick } from './scrimClick';

const scrim = { id: 'scrim' } as unknown as EventTarget;
const field = { id: 'field' } as unknown as EventTarget;
const on = (target: EventTarget) => ({ target, currentTarget: scrim });

describe('scrimClick', () => {
	it('closes on a press that starts and ends on the scrim', () => {
		let closed = 0;
		const s = scrimClick(() => closed++);
		s.onpointerdown(on(scrim));
		s.onclick(on(scrim));
		expect(closed).toBe(1);
	});

	it('stays open when a text selection starts in a field and ends on the scrim', () => {
		let closed = 0;
		const s = scrimClick(() => closed++);
		s.onpointerdown(on(field));
		// The browser sends the click to the common ancestor: the scrim.
		s.onclick(on(scrim));
		expect(closed).toBe(0);
	});

	it('ignores clicks inside the sheet', () => {
		let closed = 0;
		const s = scrimClick(() => closed++);
		s.onpointerdown(on(scrim));
		s.onclick(on(field));
		expect(closed).toBe(0);
	});

	it('does not reuse an earlier press on the scrim', () => {
		let closed = 0;
		const s = scrimClick(() => closed++);
		s.onpointerdown(on(scrim));
		s.onclick(on(field));
		// A click with no press of its own (e.g. synthetic) does nothing.
		s.onclick(on(scrim));
		expect(closed).toBe(0);
	});
});
