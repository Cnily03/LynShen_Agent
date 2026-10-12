import { describe, expect, it } from 'vitest';
import { ReplyStream, splitIdx, stableBlocks } from './streamBlocks';

const texts = (done: string) => stableBlocks(done).map((b) => b.text);

describe('stableBlocks', () => {
	it('splits two paragraphs into two chunks', () => {
		expect(texts('One.\n\nTwo.\n\n')).toEqual(['One.\n\n', 'Two.\n\n']);
	});

	it('keeps a list with blank lines between items, and its continuations, one chunk', () => {
		const list = '1. a\n\n2. b\n\n   more about b\n\n- c\n\n';
		expect(texts(list)).toEqual([list]);
		expect(texts(`${list}After.\n\n`)).toEqual([list, 'After.\n\n']);
	});

	it('keeps indented code with a blank line one chunk', () => {
		const code = '    a()\n\n    b()\n\n';
		expect(texts(`${code}After.\n\n`)).toEqual([code, 'After.\n\n']);
	});

	it('never splits inside a fence', () => {
		const fence = '```\na\n\nb\n```\n\n';
		expect(texts(`${fence}Next.\n\n`)).toEqual([fence, 'Next.\n\n']);
	});

	it('keeps the trailing blank in the last chunk and its key once the next block comes', () => {
		const [first] = stableBlocks('One.\n\n');
		expect(stableBlocks('One.\n\nTwo.\n\n')[0]).toEqual(first);
	});
});

/** A reply as models stream it: paragraphs, lists, fenced and indented code,
 *  and now and then a break of another kind. */
function reply(tokens: number, seed: number): string {
	const parts = ['word ', '答案', ' ', '\n', '\n\n', '\n\n\n', '```js\n', '```\n', '~~~\n', '    code()\n', '- item\n', '1. one\n', '1.5 apples', '  - nested\n', '   \n', '\t', '> quote\n', '\r\n', ' ', '``` \n', '**bold**'];
	let out = '';
	for (let i = 0; i < tokens; i++) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		out += parts[seed % parts.length];
	}
	return out;
}

describe('ReplyStream', () => {
	it('splits a reply as it streams the way splitIdx and stableBlocks split it whole', () => {
		for (let seed = 1; seed <= 100; seed++) {
			const text = reply(300, seed);
			const r = new ReplyStream();
			let size = seed;
			for (let at = 0; at < text.length; ) {
				// Mostly a few characters, now and then a lot at once.
				size = (size * 7 + 3) % 97;
				at = Math.min(text.length, at + (size > 90 ? size * 5 : (size % 23) + 1));
				const got = r.update(at, (from, to) => text.slice(from, to));
				const shown = text.slice(0, at);
				const split = splitIdx(shown);
				expect(got.split).toBe(split);
				expect(got.blocks).toEqual(stableBlocks(shown.slice(0, split)));
				expect(got.tail).toBe(shown.slice(split));
			}
		}
	}, 20_000);

	it('keeps the same blocks while the split stays, and a finished block as it was', () => {
		const text = 'One.\n\nTwo.\n\nThree is long';
		const r = new ReplyStream();
		const read = (from: number, to: number) => text.slice(from, to);
		const a = r.update(14, read);
		const b = r.update(20, read);
		expect(b.blocks).toBe(a.blocks);
		const c = r.update(text.length, read);
		expect(c.blocks[0]).toBe(a.blocks[0]);
	});

	it('starts over when the text it was given gets shorter', () => {
		const r = new ReplyStream();
		r.update(12, (from, to) => 'Old one.\n\nTail'.slice(from, to));
		const text = 'New.\n\nx';
		expect(r.update(text.length, (from, to) => text.slice(from, to))).toEqual({
			split: 6,
			blocks: stableBlocks('New.\n\n'),
			tail: 'x'
		});
	});

	it('reads about what each update adds, not the reply so far', () => {
		// The regression: the split and the chunks were worked out from the
		// whole reply on every frame. Twice the reply must read about twice
		// as much, not four times.
		const readFor = (tokens: number) => {
			const text = reply(tokens, 7).replace(/[`~]/g, '');
			const r = new ReplyStream();
			let read = 0;
			for (let at = 0; at < text.length; ) {
				at = Math.min(text.length, at + 4);
				r.update(at, (from, to) => {
					read += to - from;
					return text.slice(from, to);
				});
			}
			return read / text.length;
		};
		const short = readFor(20_000);
		const long = readFor(40_000);
		expect(long / short).toBeLessThan(1.3);
	});
});
