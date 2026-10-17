// Where a conversation's scroller goes as its content grows while it follows
// the end (ChatPane, RemoteSession).

/** Space kept above the latest message once a reply has filled the view. */
const REPLY_TOP_GAP = 16;

/** The scroll position to follow to. Idle (a conversation loading): the end.
 *  While a reply streams: the end only until the latest user message reaches
 *  the top, so the text being read never moves; never back up. */
export function followTop(scroller: HTMLElement, content: HTMLElement, streaming: boolean): number {
	const end = scroller.scrollHeight - scroller.clientHeight;
	if (!streaming) return end;
	const rows = content.querySelectorAll<HTMLElement>('.row.user');
	const last = rows[rows.length - 1];
	if (!last) return scroller.scrollTop;
	const top = scroller.scrollTop + last.getBoundingClientRect().top - scroller.getBoundingClientRect().top - REPLY_TOP_GAP;
	return Math.max(scroller.scrollTop, Math.min(end, top));
}

/** Whether `top` is short of the end, so following stops there. */
export function shortOfEnd(scroller: HTMLElement, top: number): boolean {
	return top < scroller.scrollHeight - scroller.clientHeight - 1;
}

/** What a scroll event the app did not make (its own pins are not asked)
 *  says about following the end: follow, stop, or null to keep it as it is.
 *  `top` is the position now, `lastTop` the one before, `byReader` whether
 *  the reader is scrolling by hand (ReaderInput).
 *  - Nothing left to scroll: at the end.
 *  - Up, by the reader: stop.
 *  - Up, not by the reader: the layout moved it. A card under the list closed
 *    (the recap card, an answered approval) or the content shrank, and the
 *    browser brought the position into the new range. Following goes on as it
 *    was. (Its scroll event can come after the content has grown again, so
 *    where the view is then says nothing: reading it as the reader's stopped
 *    following under a reply that was just sent.)
 *  - Down: follow again near the end, not far from it. */
export function followAfterScroll(
	view: Pick<HTMLElement, 'scrollHeight' | 'clientHeight'>,
	top: number,
	lastTop: number,
	byReader: boolean
): boolean | null {
	const end = view.scrollHeight - view.clientHeight;
	if (end <= 0) return true;
	if (top < lastTop) return byReader ? false : end - top <= 1 ? true : null;
	return end - top < 60;
}

/** Keys that scroll the list when no text field has the focus. */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ', 'Tab']);
/** How long after a scroll key its scrolling counts as the reader's (a
 *  smooth scroll runs on after the key). */
const KEY_SCROLL_MS = 800;

const editable = (target: EventTarget | null) => {
	const el = target as HTMLElement | null;
	return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
};

/** Whether the reader is scrolling the view by hand now: a pointer held in
 *  it (its scrollbar, a selection dragged past its edge, a finger) or a
 *  scroll key a moment ago. The wheel needs none: a wheel up stops following
 *  as it comes (ChatPane onWheel). */
export class ReaderInput {
	#held = false;
	#keyAt = -Infinity;
	#now: () => number;
	constructor(now: () => number = () => performance.now()) {
		this.#now = now;
	}
	/** The view's pointerdown. */
	down = (e: Pick<PointerEvent, 'button'>) => {
		if (e.button === 0) this.#held = true;
	};
	/** The window's pointerup, pointercancel and blur. */
	up = () => {
		this.#held = false;
	};
	/** The window's keydown. */
	key = (e: Pick<KeyboardEvent, 'key' | 'target'>) => {
		if (SCROLL_KEYS.has(e.key) && !editable(e.target)) this.#keyAt = this.#now();
	};
	get active(): boolean {
		return this.#held || this.#now() - this.#keyAt < KEY_SCROLL_MS;
	}
}
