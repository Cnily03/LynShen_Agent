// 等你处理 on the phone, one item at a time: which way a horizontal swipe
// goes, and whether a touch started too close to the screen edge (that is
// the system's back gesture, not ours).

/** How far a finger moves sideways before the deck turns a card (px). */
export const SWIPE_TURN = 44;
/** A touch starting this close to a screen edge belongs to the system (px). */
export const EDGE_GUARD = 24;

/** What a finished horizontal drag does: the next card, the previous one,
 *  nothing (too short, or mostly vertical: the page scrolled). */
export function swipeStep(dx: number, dy: number): 1 | -1 | 0 {
	if (Math.abs(dx) < SWIPE_TURN || Math.abs(dx) < Math.abs(dy) * 1.2) return 0;
	return dx < 0 ? 1 : -1;
}

/** A touch at `x` on a screen `width` wide is the system's edge gesture. */
export function fromEdge(x: number, width: number): boolean {
	return x < EDGE_GUARD || x > width - EDGE_GUARD;
}

/** The card shown after a step: within the deck; `hit` when the deck
 *  ended there (to say 已经是第一件 / 最后一件). */
export function turn(at: number, step: 1 | -1, count: number): { at: number; hit: 'first' | 'last' | null } {
	const next = at + step;
	if (next < 0) return { at: 0, hit: 'first' };
	if (next >= count) return { at: Math.max(0, count - 1), hit: 'last' };
	return { at: next, hit: null };
}
