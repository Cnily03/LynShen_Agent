import { describe, expect, it } from 'vitest';
import { wheelMoves, type WheelBox } from './keepWheel';

// A box `max` px taller than its view, scrolled to `top`, in `parent`.
const box = (top: number, max: number, parent: WheelBox | null = null, scrolls = true): WheelBox & { scrolls: boolean } => ({
	scrollTop: top,
	scrollHeight: 100 + max,
	clientHeight: 100,
	parentElement: parent,
	scrolls
});
const scrolls = (b: WheelBox) => (b as WheelBox & { scrolls: boolean }).scrolls;

describe('wheelMoves', () => {
	it('lets a list in the box take the wheel until its end', () => {
		const root = box(0, 0, null, false);
		const list = box(0, 300, root);
		const row = box(0, 0, list, false);
		expect(wheelMoves(row, root, 40, scrolls)).toBe(true);
		expect(wheelMoves(row, root, -40, scrolls)).toBe(false);
		list.scrollTop = 300;
		expect(wheelMoves(row, root, 40, scrolls)).toBe(false);
		expect(wheelMoves(row, root, -40, scrolls)).toBe(true);
	});

	it('takes nothing from outside the box or a box that does not scroll', () => {
		const page = box(50, 500);
		const root = box(0, 0, page, false);
		const clipped = box(0, 20, root, false);
		expect(wheelMoves(clipped, root, 40, scrolls)).toBe(false);
		expect(wheelMoves(clipped, root, -40, scrolls)).toBe(false);
	});

	it('lets the box itself scroll when the list in it is at its end', () => {
		const root = box(10, 200);
		const list = box(300, 300, root);
		expect(wheelMoves(list, root, 40, scrolls)).toBe(true);
		root.scrollTop = 200;
		expect(wheelMoves(list, root, 40, scrolls)).toBe(false);
	});
});
