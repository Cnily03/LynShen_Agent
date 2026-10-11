// The tail of a reply that is still streaming, written into one text node by
// edits: the part that moved into a finished Markdown block is cut from the
// front and the new text appended. Replacing the node's whole text each frame
// (what `{text}` in a template does) would collapse a selection the user is
// making in it.
import type { Action } from 'svelte/action';

/** The tail's text and where it starts in the whole message. */
export type StreamTail = { text: string; from?: number };

/** How to turn the tail `prev` into `next` by cutting a prefix and appending;
 *  null when `next` does not continue `prev` (the split moved back, or the
 *  text changed). */
export function tailEdit(prev: StreamTail, next: StreamTail): { cut: number; append: string } | null {
	const cut = (next.from ?? 0) - (prev.from ?? 0);
	if (cut < 0 || cut > prev.text.length) return null;
	const kept = prev.text.slice(cut);
	if (!next.text.startsWith(kept)) return null;
	return { cut, append: next.text.slice(kept.length) };
}

/** `use:streamText={{ text, from }}` on an empty element. */
export const streamText: Action<HTMLElement, StreamTail> = (node, tail) => {
	const text = document.createTextNode(tail.text);
	node.append(text);
	let shown = tail;
	return {
		update(next) {
			const edit = tailEdit(shown, next);
			if (!edit) text.data = next.text;
			else {
				if (edit.cut) text.deleteData(0, edit.cut);
				if (edit.append) text.appendData(edit.append);
			}
			shown = next;
		}
	};
};
