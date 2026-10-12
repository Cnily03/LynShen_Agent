// Streaming plain text (the open reasoning of a reply still thinking) written
// into the DOM as blocks: each finished block is written once and never
// touched again, and only the last one grows. One text node holding the
// whole text made every frame re-lay out, and re-copy, all of it: the frame
// time and the web view's memory grew with the reasoning's length.
//
// The blocks read as the one pre-wrap text they replace: a block ends at a
// line break, which the block boundary stands for (the break itself is not
// written), and a block never ends with a line break of its own (a trailing
// break would not show).
import type { Action } from 'svelte/action';

/** Characters a block holds at least before it may end. */
export const BLOCK_MIN = 400;

/** Cuts a growing text into blocks, scanning each part of it once. */
export class BlockCutter {
	/** Where the block being written starts in the whole text. */
	start = 0;
	/** Characters scanned so far. */
	seen = 0;
	#last = '';

	constructor(private min = BLOCK_MIN) {}

	/** Scans `added`, the text that follows what was scanned, and returns the
	 *  offsets (in the whole text) of the line breaks that end a block. */
	feed(added: string): number[] {
		const cuts: number[] = [];
		for (let i = added.indexOf('\n'); i >= 0; i = added.indexOf('\n', i + 1)) {
			const at = this.seen + i;
			const before = i > 0 ? added[i - 1] : this.#last;
			if (at - this.start >= this.min && before !== '\n') {
				cuts.push(at);
				this.start = at + 1;
			}
		}
		if (added) this.#last = added[added.length - 1]!;
		this.seen += added.length;
		return cuts;
	}
}

/** The text to show: its length, and a reader for part of it (see liveRead). */
export interface PlainSource {
	length: number;
	read: (from: number, to: number) => string;
}

/** `use:streamPlain={source}` on an empty pre-wrap element: writes the text
 *  as it grows, reading only what was added since the last update. */
export const streamPlain: Action<HTMLElement, PlainSource> = (node, source) => {
	let cutter: BlockCutter;
	let tail: Text;
	let shown = 0;
	const block = () => {
		const div = document.createElement('div');
		tail = document.createTextNode('');
		div.append(tail);
		node.append(div);
	};
	const reset = () => {
		node.replaceChildren();
		cutter = new BlockCutter();
		shown = 0;
		block();
	};
	const write = (src: PlainSource) => {
		// Shorter than shown: not the text it was (never while it streams).
		if (src.length < shown) reset();
		if (src.length === shown) return;
		const added = src.read(shown, src.length);
		const base = shown;
		let pos = 0;
		for (const at of cutter.feed(added)) {
			tail.appendData(added.slice(pos, at - base));
			pos = at - base + 1;
			block();
		}
		tail.appendData(added.slice(pos));
		shown = src.length;
	};
	reset();
	write(source);
	return { update: write };
};
