// The text of a message still streaming, kept as the deltas that made it.
//
// `m.text += delta` is cheap: V8 and JavaScriptCore join the two strings
// lazily (a rope). Reading any character of the result copies the whole text
// into one new string first, so a view that reads the text on every delta
// (its end for the folded reasoning line, the part not shown yet) copies the
// whole text each time: quadratic in its length over a long reply, and a
// stream of large dead strings for the collector. A LiveText answers those
// reads from the deltas, touching only the part asked for; the message's own
// `text` is read whole once, when the finished message renders.
//
// ChatState records the deltas of the message it streams into (`liveText`
// finds them by the message object); views fall back to `m.text` for every
// other message, and whenever the two disagree (`liveRead`).

export class LiveText {
	#parts: string[] = [];
	/** End offset of each part in the whole text. */
	#ends: number[] = [];
	length = 0;
	/** No character so far other than white space. */
	blank = true;

	append(delta: string) {
		if (!delta) return;
		this.#parts.push(delta);
		this.length += delta.length;
		this.#ends.push(this.length);
		if (this.blank && /\S/.test(delta)) this.blank = false;
	}

	/** The text from `from` to `to`, read from the parts that hold it. */
	slice(from: number, to = this.length): string {
		from = Math.max(0, from);
		to = Math.min(this.length, to);
		if (from >= to) return '';
		// The first part ending after `from`.
		let lo = 0;
		let hi = this.#ends.length - 1;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (this.#ends[mid]! > from) hi = mid;
			else lo = mid + 1;
		}
		let out = '';
		for (let i = lo; i < this.#parts.length; i++) {
			const start = this.#ends[i]! - this.#parts[i]!.length;
			if (start >= to) break;
			out += this.#parts[i]!.slice(Math.max(0, from - start), to - start);
		}
		return out;
	}
}

const live = new WeakMap<object, LiveText>();

/** Starts recording the deltas of a message that streams from now on (its
 *  text is empty). */
export function startLive(m: object): LiveText {
	const t = new LiveText();
	live.set(m, t);
	return t;
}

/** The message has stopped streaming: its text is read whole from now on. */
export function endLive(m: object) {
	live.delete(m);
}

export function liveText(m: object): LiveText | undefined {
	return live.get(m);
}

/** A reader for part of a message's text: from its deltas while they match
 *  the text (same length), else from the text itself. Reading `text.length`
 *  keeps a reactive caller subscribed to the text without copying it. */
export function liveRead(m: object, text: string): (from: number, to: number) => string {
	const t = live.get(m);
	return t && t.length === text.length ? (from, to) => t.slice(from, to) : (from, to) => text.slice(from, to);
}

/** Whether a message's text has a character other than white space, without
 *  reading the whole text while it streams. */
export function hasText(m: object, text: string): boolean {
	const t = live.get(m);
	if (t && t.length === text.length) return !t.blank;
	return /\S/.test(text);
}
