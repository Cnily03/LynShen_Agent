// A box over or beside a scroller that keeps the wheel (the plan and
// subagents cards over the transcript): the wheel scrolls a list in it, and
// at either end, or with nothing to scroll, it goes nowhere. It never moves
// what is behind or around the box.

import { wheelScrolls } from './menuFit';

/** What a wheel turn reads of a box on its way up from the target. */
export interface WheelBox {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
	parentElement: WheelBox | null;
}

/** Whether a wheel turn of `deltaY` on `target` scrolls a box from it up to
 *  `root` (both included): one that `scrolls` (its overflow lets it) and is
 *  not at its end in that direction yet. */
export function wheelMoves(target: WheelBox | null, root: WheelBox, deltaY: number, scrolls: (box: WheelBox) => boolean): boolean {
	for (let box = target; box; box = box === root ? null : box.parentElement)
		if (scrolls(box) && wheelScrolls(box.scrollTop, box.scrollHeight - box.clientHeight, deltaY)) return true;
	return false;
}

const overflows = (box: WheelBox) => /^(auto|scroll)$/.test(getComputedStyle(box as unknown as Element).overflowY);

/** The action: the wheel over `node` is its own. Not passive (Svelte makes
 *  `onwheel` passive), so it can hold the page still. A pinch (ctrl +
 *  wheel) is left to the window's zoom, a sideways turn to the page. */
export function keepWheel(node: HTMLElement) {
	const onWheel = (e: WheelEvent) => {
		if (e.ctrlKey || !e.deltaY) return;
		if (!wheelMoves(e.target as unknown as WheelBox | null, node, e.deltaY, overflows)) e.preventDefault();
	};
	node.addEventListener('wheel', onWheel, { passive: false });
	return { destroy: () => node.removeEventListener('wheel', onWheel) };
}
