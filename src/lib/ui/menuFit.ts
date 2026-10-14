// Where a popover menu (ui/PopMenu.svelte) opens and how tall it may be.
// The menu hangs from its anchor, so it is inside whatever scrolls or clips
// the anchor (the conversation's scroller, a tile). Too tall for the room
// it has there, it made that scroller longer: the wheel scrolled the page
// behind it and carried it up under the title bar. Now it keeps inside the
// part of the window it can be seen in and scrolls its own rows.

export type Side = 'up' | 'down';
/** A vertical extent in window coordinates. */
export type Band = { top: number; bottom: number };

/** Space kept between a menu and the edge of the area it can be seen in. */
export const MENU_EDGE = 8;
/** The least height a menu gets, even where there is less room (two rows and
 *  the padding): smaller, it would show nothing to choose. */
export const MENU_MIN_HEIGHT = 96;

/**
 * The side a menu opens on and the most it may be tall. It takes the side
 * its placement asks for, unless the list does not fit there and the other
 * side has more room (with `flip`).
 *
 * - anchor: the anchor's top and bottom
 * - band: the part of the window the menu can be seen in (`visibleBand`)
 * - natural: the menu's full height
 * - gap: the distance between the anchor and the menu below / above it
 */
export function fitMenu(o: {
	anchor: Band;
	band: Band;
	natural: number;
	preferred: Side;
	flip?: boolean;
	gap?: { down: number; up: number };
	edge?: number;
}): { side: Side; maxHeight: number } {
	const edge = o.edge ?? MENU_EDGE;
	const gap = o.gap ?? { down: 6, up: 8 };
	const room: Record<Side, number> = {
		down: o.band.bottom - edge - (o.anchor.bottom + gap.down),
		up: o.anchor.top - gap.up - (o.band.top + edge)
	};
	const other: Side = o.preferred === 'up' ? 'down' : 'up';
	const side = o.flip !== false && o.natural > room[o.preferred] && room[other] > room[o.preferred] ? other : o.preferred;
	return { side, maxHeight: Math.max(MENU_MIN_HEIGHT, Math.floor(room[side])) };
}

/** A clipping ancestor: the window coordinates of its client box, and how
 *  much of each edge a mask fades out. */
export type Clip = Band & { fade: number };

/** The part of the window between `top` and `bottom` that every clipping
 *  ancestor leaves visible (innermost first), less the toasts above it. */
export function bandWithin(viewport: Band, clips: Clip[], toastBottom = 0): Band {
	let { top, bottom } = viewport;
	for (const c of clips) {
		top = Math.max(top, c.top + c.fade);
		bottom = Math.min(bottom, c.bottom - c.fade);
	}
	return { top: Math.max(top, toastBottom), bottom };
}

/**
 * The part of the window a menu under `anchor` can be seen in: the window,
 * cut by each ancestor that scrolls or clips (to its client box, less a
 * masked edge: the transcript fades its top and bottom under glass), and
 * below the toasts over the menu's columns. A fixed ancestor ends the walk:
 * nothing above it clips it.
 */
export function visibleBand(anchor: Element, menu?: Element): Band {
	const clips: Clip[] = [];
	for (let el: Element | null = anchor; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
		const cs = getComputedStyle(el);
		if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
			const r = el.getBoundingClientRect();
			const top = r.top + el.clientTop;
			const masked = (cs.maskImage || cs.getPropertyValue('-webkit-mask-image') || 'none') !== 'none';
			const fade = masked ? parseFloat(cs.getPropertyValue('--edge-fade')) || 0 : 0;
			clips.push({ top, bottom: top + el.clientHeight, fade });
		}
		if (cs.position === 'fixed') break;
	}
	return bandWithin({ top: 0, bottom: window.innerHeight }, clips, toastsOver(menu ?? anchor));
}

/** The bottom of the toasts (ui/Toaster.svelte, under the title bar) that
 *  share columns with `el`; 0 with none. */
function toastsOver(el: Element): number {
	const r = el.getBoundingClientRect();
	let bottom = 0;
	for (const t of document.querySelectorAll('.toaster .toast')) {
		const b = t.getBoundingClientRect();
		if (b.right > r.left && b.left < r.right) bottom = Math.max(bottom, b.bottom);
	}
	return bottom;
}

/** Whether a wheel turn of `deltaY` moves a list at `scrollTop` (of `max`).
 *  When it would not, the list keeps it anyway: the page behind it must not
 *  scroll instead. */
export function wheelScrolls(scrollTop: number, max: number, deltaY: number): boolean {
	if (max <= 0 || deltaY === 0) return false;
	return deltaY < 0 ? scrollTop > 0 : scrollTop < max - 0.5;
}

/** The scroll offset that shows a row whole in a list `viewHeight` tall,
 *  moving as little as possible; `rowTop` is from the top of the list's
 *  content. */
export function scrollToShow(scrollTop: number, viewHeight: number, rowTop: number, rowHeight: number, pad = 0): number {
	if (rowTop - pad < scrollTop) return Math.max(0, rowTop - pad);
	if (rowTop + rowHeight + pad > scrollTop + viewHeight) return rowTop + rowHeight + pad - viewHeight;
	return scrollTop;
}

/** The row a key moves to among `count` rows from `current` (-1: none yet);
 *  null for any other key. Up and down go round. */
export function nextRow(key: string, current: number, count: number): number | null {
	if (count <= 0) return null;
	switch (key) {
		case 'ArrowDown':
			return current < 0 ? 0 : (current + 1) % count;
		case 'ArrowUp':
			return current < 0 ? count - 1 : (current - 1 + count) % count;
		case 'Home':
			return 0;
		case 'End':
			return count - 1;
		default:
			return null;
	}
}
