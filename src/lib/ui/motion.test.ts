import { describe, expect, it } from 'vitest';
import { bezier, childIn, childOut, EASE_BASE, EASE_ENTER, EASE_EXIT, listIn, listOut, motionMs, moveRow } from './motion';

describe('motion easings', () => {
	it('start at 0 and end at 1', () => {
		for (const ease of [EASE_BASE, EASE_ENTER, EASE_EXIT]) {
			expect(ease(0)).toBe(0);
			expect(ease(1)).toBe(1);
		}
	});

	it('follow the curve: linear stays linear, enter leads, exit lags', () => {
		const linear = bezier(0, 0, 1, 1);
		expect(linear(0.3)).toBeCloseTo(0.3, 4);
		expect(EASE_ENTER(0.5)).toBeGreaterThan(0.5);
		expect(EASE_EXIT(0.5)).toBeLessThan(0.5);
	});

	it('never go backwards', () => {
		let last = 0;
		for (let i = 1; i <= 50; i++) {
			const v = EASE_BASE(i / 50);
			expect(v).toBeGreaterThanOrEqual(last);
			last = v;
		}
	});

	it('keep durations outside a browser', () => {
		expect(motionMs(240)).toBe(240);
	});
});

describe('the navigator list', () => {
	const node = {} as Element;
	it('fades a sub-agent in from 4px up after its delay, and out in opacity only', () => {
		const inn = childIn(node, { delay: 200 });
		expect([inn.delay, inn.duration, inn.css?.(0, 1), inn.css?.(1, 0)]).toEqual([200, 240, 'opacity: 0; transform: translateY(-4px)', 'opacity: 1; transform: translateY(0px)']);
		expect(childIn(node, { delay: -1 })).toEqual({ duration: 0 });
		const out = childOut(node);
		expect([out.duration, out.css?.(0.5, 0.5)]).toEqual([140, 'opacity: 0.5']);
	});

	it('routes items: a sub-agent fades, a row or a heading leaves at once', () => {
		expect((listIn(node, { child: true, delay: 80 }) as { delay: number }).delay).toBe(80);
		expect(listOut(node)).toEqual({ duration: 0 });
		expect(listOut(node, { child: true }).duration).toBe(140);
	});

	it('lifts a row that changes group on the list fill, 1px around, and keeps nothing', () => {
		const at = (top: number) => ({ top }) as DOMRect;
		expect(moveRow(node, { from: at(10), to: at(10) })).toEqual({ duration: 0 });
		const move = moveRow(node, { from: at(100), to: at(40) }, { over: true, fill: 'red' });
		expect(move.css?.(0, 1)).toBe('transform: translateY(60px); z-index: 2; background-color: red; box-shadow: 0 0 0 1px red');
		expect(moveRow(node, { from: at(100), to: at(40) }).css?.(0.5, 0.5)).toBe('transform: translateY(30px)');
	});
});
