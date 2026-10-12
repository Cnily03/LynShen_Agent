import { describe, expect, it } from 'vitest';
import { BLOCK_MIN, BlockCutter } from './streamPlain';

/** A long reasoning: lines of a few dozen characters, now and then a blank
 *  line, sometimes a run of them. */
function reasoning(chars: number, seed = 3): string {
	let out = '';
	while (out.length < chars) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		const r = seed % 100;
		out += r < 8 ? '\n' : r < 11 ? '\n\n' : r < 12 ? '\n\n\n' : '推理 step ';
	}
	return out;
}

/** Feeds `text` in pieces of `size`, as a stream would; returns the blocks. */
function cut(text: string, size: number, min = BLOCK_MIN) {
	const cutter = new BlockCutter(min);
	const blocks: string[] = [];
	let start = 0;
	let longestTail = 0;
	for (let at = 0; at < text.length; at += size) {
		for (const c of cutter.feed(text.slice(at, at + size))) {
			blocks.push(text.slice(start, c));
			start = c + 1;
		}
		longestTail = Math.max(longestTail, Math.min(text.length, at + size) - start);
	}
	blocks.push(text.slice(start));
	return { blocks, longestTail, seen: cutter.seen };
}

describe('BlockCutter', () => {
	it('cuts at line breaks, which the block boundaries stand for', () => {
		const text = reasoning(20_000);
		for (const size of [1, 3, 17, 500]) {
			const { blocks } = cut(text, size);
			expect(blocks.join('\n')).toBe(text);
			for (const b of blocks.slice(0, -1)) {
				// Long enough, and no line break of its own at the end (it
				// would not show in a block).
				expect(b.length).toBeGreaterThanOrEqual(BLOCK_MIN);
				expect(b.endsWith('\n')).toBe(false);
			}
		}
	});

	it('cuts the same however the text arrives', () => {
		const text = reasoning(5000);
		expect(cut(text, 1).blocks).toEqual(cut(text, 4096).blocks);
	});

	it('keeps a run of blank lines at the start of the next block', () => {
		expect(cut('abc\n\n\ndef', 1, 2).blocks).toEqual(['abc', '\n\ndef']);
		// A break right after another one never ends a block.
		expect(cut('ab\n\n', 1, 2).blocks).toEqual(['ab', '\n']);
	});

	it('scans each character once and keeps the growing block short', () => {
		// The regression: the whole reasoning was one text node, rewritten and
		// laid out again on every frame. The block still being written must
		// stay about a block long however long the reasoning gets: at most a
		// block and the line that ends it.
		for (const chars of [10_000, 200_000]) {
			const text = reasoning(chars);
			const longestLine = Math.max(...text.split('\n').map((l) => l.length));
			const { seen, longestTail } = cut(text, 4);
			expect(seen).toBe(text.length);
			expect(longestTail).toBeLessThanOrEqual(BLOCK_MIN + longestLine + 4);
			expect(longestTail).toBeLessThan(2000);
		}
	});

	it('leaves a text without line breaks in one block', () => {
		const text = 'x'.repeat(5000);
		expect(cut(text, 7).blocks).toEqual([text]);
	});
});
