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
 *  `top` is the position now, `lastTop` the one before; `byReader` whether
 *  the reader is scrolling by hand (ReaderInput); `resized` whether the
 *  content or the view changed size since the last scroll event or pin.
 *  - Nothing left to scroll: at the end.
 *  - Up, by the reader: stop. So is a move up with no size change: only a
 *    size change lets the layout move the view, so that one is the reader's
 *    too, by a way no input event shows (a scrollbar the page gets no
 *    pointer for, autoscroll, assistive technology).
 *  - Up with a size change, no reader input: the layout moved it. A card
 *    under the list closed (the recap card, an answered approval) or the
 *    content shrank, and the browser brought the position into the new
 *    range. Following goes on as it was. (Its scroll event can come after the
 *    content has grown again, so where the view is then says nothing:
 *    reading it as the reader's stopped following under a reply just sent.)
 *  - Down: follow again near the end, not far from it. */
export function followAfterScroll(
	view: Pick<HTMLElement, 'scrollHeight' | 'clientHeight'>,
	top: number,
	lastTop: number,
	byReader: boolean,
	resized: boolean
): boolean | null {
	const end = view.scrollHeight - view.clientHeight;
	if (end <= 0) return true;
	if (top < lastTop) return byReader || !resized ? false : end - top <= 1 ? true : null;
	return end - top < 60;
}

/** Keys that scroll the list. */
const SCROLL_KEYS = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' ', 'Tab']);
/** How long after a scroll key its scrolling counts as the reader's (a
 *  smooth scroll runs on after the key). */
const KEY_SCROLL_MS = 800;

type Target = { tagName?: string; isContentEditable?: boolean; closest?: (selector: string) => unknown } | null;
const editable = (el: Target) => !!el && (!!el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName ?? ''));
/** Space presses these instead of scrolling. */
const pressable = (el: Target) => !!el?.closest?.('button, a[href], summary, label, [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="tab"]');

/** Whether the reader is scrolling the view by hand now: a pointer held in
 *  it (the primary button: its scrollbar, a selection dragged past its edge,
 *  a finger; the middle button: autoscroll) or a key that scrolls it a moment
 *  ago (in the list or with nothing focused, not typed in a field, not a
 *  space that presses a button). The wheel needs none: a wheel up stops
 *  following as it comes (ChatPane onWheel). */
export class ReaderInput {
	#held = false;
	#keyAt = -Infinity;
	#view: () => { contains(node: unknown): boolean } | null;
	#now: () => number;
	constructor(view: () => { contains(node: unknown): boolean } | null, now: () => number = () => performance.now()) {
		this.#view = view;
		this.#now = now;
	}
	/** The view's pointerdown. */
	down = (e: Pick<PointerEvent, 'button'>) => {
		if (e.button === 0 || e.button === 1) this.#held = true;
	};
	/** The window's pointerup, pointercancel and blur. */
	up = () => {
		this.#held = false;
	};
	/** The window's keydown. */
	key = (e: Pick<KeyboardEvent, 'key' | 'target'>) => {
		const el = e.target as Target;
		const page = !el || /^(BODY|HTML)$/.test(el.tagName ?? '');
		if (!SCROLL_KEYS.has(e.key) || editable(el) || (e.key === ' ' && pressable(el))) return;
		if (page || this.#view()?.contains(el)) this.#keyAt = this.#now();
	};
	get active(): boolean {
		return this.#held || this.#now() - this.#keyAt < KEY_SCROLL_MS;
	}
}
