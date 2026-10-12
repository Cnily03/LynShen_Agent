// A streaming reply split into its finished part, as stable Markdown chunks,
// and the tail still being written (MessageList).

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/gm;
const LIST_ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])(\s|$)/;

export type Block = { key: string; text: string };

/** Where a streaming reply splits into its finished part (rendered as
 *  Markdown) and the tail still being written (plain text): after the last
 *  blank line. The split never lands inside an open code fence: the whole
 *  open block stays in the tail, so it isn't parsed as a finished (broken)
 *  code block; the split is then at the start of the last fence line.
 *
 *  Fences are matched anchored to line starts per CommonMark (optional ≤3
 *  spaces, then 3+ backticks or tildes). Counting every "```" occurrence
 *  miscounts inline code spans and 4-backtick fences. */
export function splitIdx(text: string): number {
	const fences = text.match(FENCE_RE);
	if (fences && fences.length % 2 === 1) {
		let idx = 0;
		const re = new RegExp(FENCE_RE.source, 'gm');
		for (let m = re.exec(text); m; m = re.exec(text)) idx = m.index;
		return idx;
	}
	const i = text.lastIndexOf('\n\n');
	return i < 0 ? 0 : i + 2;
}

/** The chunks `stableBlocks` cuts from `done` and where the last chunk, the
 *  one that may still grow, starts; keys count from `offset`. */
function cutBlocks(done: string, offset = 0): { blocks: Block[]; rest: number } {
	const out: Block[] = [];
	let start = 0;
	let open = false;
	let list = false;
	const lines = done.split('\n');
	let pos = 0;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (FENCE.test(line)) open = !open;
		else if (!open && LIST_ITEM.test(line)) list = true;
		pos += line.length + 1;
		if (open || line.trim() !== '' || pos - start <= 1) continue;
		let j = i + 1;
		while (j < lines.length && lines[j]!.trim() === '') j++;
		const next = lines[j];
		if (next === undefined) continue;
		// A list item's continuation may be indented less than code's 4 spaces.
		if (list ? /^\s/.test(next) || LIST_ITEM.test(next) : /^( {4}|\t)/.test(next)) continue;
		const text = done.slice(start, pos);
		if (text.trim()) out.push({ key: `${offset + start}:${text.length}`, text });
		start = pos;
		list = false;
	}
	return { blocks: out, rest: start };
}

/** The finished part of a streaming reply as stable chunks: each top-level
 *  block (paragraph, list, fenced or indented code) is one chunk whose text
 *  never changes once complete, so a keyed {#each} renders it once. Rendering
 *  the whole finished prefix as one Markdown re-parsed, re-highlighted and
 *  re-sanitized everything before it whenever a paragraph completed:
 *  quadratic in the reply's length.
 *
 *  A blank line outside a fence ends a chunk only when the next line starts a
 *  new top-level block: an indented line continues a list item or indented
 *  code, and in a list the next item continues the list. With no next line yet
 *  the blank stays in the last chunk. */
export function stableBlocks(done: string): Block[] {
	const { blocks, rest } = cutBlocks(done);
	const text = done.slice(rest);
	if (text.trim()) blocks.push({ key: `${rest}:${text.length}`, text });
	return blocks;
}

/** A line break, as the `m` flag of FENCE_RE sees one. */
const isBreak = (c: string) => c === '\n' || c === '\r' || c === '\u2028' || c === '\u2029';

/** The split, finished chunks and tail of a reply as it streams in
 *  (MessageList), worked out from what was added since the last update:
 *  `splitIdx` and `stableBlocks` scanned the whole reply on every frame, so
 *  a frame cost the reply's length. Gives what
 *  `stableBlocks(text.slice(0, splitIdx(text)))` gives, with the same block
 *  objects (the same array while the split stays). */
export class ReplyStream {
	/** Characters taken in. */
	#length = 0;
	#prev = '';
	/** The line not finished yet: where it starts, and its first characters
	 *  (enough to tell a fence line). */
	#lineStart = 0;
	#head = '';
	/** Finished lines that open or close a fence, and where the last starts. */
	#fences = 0;
	#lastFence = -1;
	/** The last blank line: where its "\n\n" starts. */
	#blank = -1;
	/** Chunks that no longer change, and where they end. */
	#settled: Block[] = [];
	#settledEnd = 0;
	#split = -1;
	#blocks: Block[] = [];

	/** Takes in the text up to `length`; `read(from, to)` reads part of it. */
	update(length: number, read: (from: number, to: number) => string): { split: number; blocks: Block[]; tail: string } {
		if (length < this.#length) this.#reset();
		if (length > this.#length) this.#scan(read(this.#length, length));
		const lineFence = this.#lineStart < length && FENCE.test(this.#head);
		const fences = this.#fences + (lineFence ? 1 : 0);
		const split = fences % 2 ? (lineFence ? this.#lineStart : this.#lastFence) : this.#blank >= 0 ? this.#blank + 2 : 0;
		if (split !== this.#split) this.#cut(split, read);
		return { split, blocks: this.#blocks, tail: read(split, length) };
	}

	#reset() {
		this.#length = 0;
		this.#prev = '';
		this.#lineStart = 0;
		this.#head = '';
		this.#fences = 0;
		this.#lastFence = -1;
		this.#blank = -1;
		this.#settled = [];
		this.#settledEnd = 0;
		this.#split = -1;
		this.#blocks = [];
	}

	#scan(added: string) {
		for (let i = 0; i < added.length; i++) {
			const c = added[i]!;
			const at = this.#length + i;
			if (isBreak(c)) {
				if (FENCE.test(this.#head)) {
					this.#fences++;
					this.#lastFence = this.#lineStart;
				}
				this.#lineStart = at + 1;
				this.#head = '';
				if (c === '\n' && this.#prev === '\n') this.#blank = at - 1;
			} else if (this.#head.length < 6) this.#head += c;
			this.#prev = c;
		}
		this.#length += added.length;
	}

	/** The finished part now ends at `split`: cut what was added to it. */
	#cut(split: number, read: (from: number, to: number) => string) {
		// It moved back (a fence closed): a chunk cut before may have been cut
		// for a line now past the split. Start over.
		if (split < this.#split) {
			this.#settled = [];
			this.#settledEnd = 0;
		}
		this.#split = split;
		const done = read(this.#settledEnd, split);
		const { blocks, rest } = cutBlocks(done, this.#settledEnd);
		const open = done.slice(rest);
		const openBlock = open.trim() ? [{ key: `${this.#settledEnd + rest}:${open.length}`, text: open }] : [];
		// A chunk is final once the line after it is whole: the finished part
		// ends at a line break, as it does unless a fence line follows another
		// kind of break.
		if (done.endsWith('\n') || !done) {
			this.#settled.push(...blocks);
			this.#settledEnd += rest;
			this.#blocks = [...this.#settled, ...openBlock];
		} else this.#blocks = [...this.#settled, ...blocks, ...openBlock];
	}
}
