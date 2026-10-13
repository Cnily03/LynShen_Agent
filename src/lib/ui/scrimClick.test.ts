import { describe, expect, it } from 'vitest';
import { scrimClick } from './scrimClick';

const scrim = { id: 'scrim' } as unknown as EventTarget;
const field = { id: 'field' } as unknown as EventTarget;
const on = (target: EventTarget) => ({ target, currentTarget: scrim });

/** A press from `down` to `up`; the browser sends the click to their common
 *  ancestor, which is the scrim unless both are in the sheet. */
function press(s: ReturnType<typeof scrimClick>, down: EventTarget, up: EventTarget) {
	s.onpointerdown(on(down));
	s.onpointerup(on(up));
	s.onclick(on(down === field && up === field ? field : scrim));
}

describe('scrimClick', () => {
	it('closes on a press that starts and ends on the scrim', () => {
		let closed = 0;
		const s = scrimClick(() => closed++);
		press(s, scrim, scrim);
		expect(closed).toBe(1);
	});

	it('stays open when a text selection starts in a field and ends on the scrim', () => {
		let closed = 0;
		const s = scrimClick(() => closed++);
		press(s, field, scrim);
		expect(closed).toBe(0);
	});

	it('stays open when a press starts on the scrim and ends in the sheet', () => {
		let closed = 0;
		const s = scrimClick(() => closed++);
		press(s, scrim, field);
		expect(closed).toBe(0);
		// The next real click on the scrim still closes.
		press(s, scrim, scrim);
		expect(closed).toBe(1);
	});

	it('ignores clicks inside the sheet', () => {
		let closed = 0;
		const s = scrimClick(() => closed++);
		press(s, field, field);
		expect(closed).toBe(0);
	});

	it('does not reuse an earlier press on the scrim', () => {
		let closed = 0;
		const s = scrimClick(() => closed++);
		s.onpointerdown(on(scrim));
		s.onpointerup(on(scrim));
		s.onclick(on(field));
		// A click with no press of its own (e.g. synthetic) does nothing.
		s.onclick(on(scrim));
		expect(closed).toBe(0);
	});
});
