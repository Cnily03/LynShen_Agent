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
	/** Where the part shown starts: the text before it shows elsewhere (as
	 *  Markdown, once a reasoning has finished). */
	from?: number;
}

/** `use:streamPlain={source}` on an empty pre-wrap element: writes the text
 *  as it grows, reading only what was added since the last update, and
 *  drops its front as `from` moves on: the blocks before it go, and the one
 *  it falls in is cut, so the blocks after it keep the layout they had. */
export const streamPlain: Action<HTMLElement, PlainSource> = (node, source) => {
	let cutter: BlockCutter;
	let tail: Text;
	let shown = 0;
	/** The blocks still there, and where each starts in the whole text. */
	let blocks: { el: HTMLElement; start: number }[];
	/** Characters cut from the front of the first block. */
	let cut: number;
	let from: number;
	const block = (start: number) => {
		const div = document.createElement('div');
		tail = document.createTextNode('');
		div.append(tail);
		node.append(div);
		blocks.push({ el: div, start });
	};
	const reset = () => {
		node.replaceChildren();
		cutter = new BlockCutter();
		shown = 0;
		blocks = [];
		cut = 0;
		from = 0;
		block(0);
	};
	const write = (src: PlainSource) => {
		if (src.length === shown) return;
		const added = src.read(shown, src.length);
		const base = shown;
		let pos = 0;
		for (const at of cutter.feed(added)) {
			tail.appendData(added.slice(pos, at - base));
			pos = at - base + 1;
			block(at + 1);
		}
		tail.appendData(added.slice(pos));
		shown = src.length;
	};
	const trim = (to: number) => {
		let gone = 0;
		while (gone < blocks.length - 1 && blocks[gone + 1]!.start <= to) blocks[gone++]!.el.remove();
		if (gone) {
			blocks.splice(0, gone);
			cut = 0;
		}
		const b = blocks[0]!;
		const drop = to - b.start - cut;
		if (drop > 0) {
			(b.el.firstChild as Text).deleteData(0, drop);
			cut += drop;
		}
		from = to;
	};
	const update = (src: PlainSource) => {
		// Shorter than shown, or starting further back: not the text it was
		// (never while it streams).
		if (src.length < shown || (src.from ?? 0) < from) reset();
		write(src);
		if ((src.from ?? 0) > from) trim(src.from!);
	};
	reset();
	update(source);
	return { update };
};
