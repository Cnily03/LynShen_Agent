import { describe, expect, it } from 'vitest';
import { LiveText, endLive, hasText, liveRead, liveText, startLive } from './liveText';

/** Deltas the way models send them: a few characters, now and then a break. */
function deltas(n: number, seed = 1): string[] {
	const words = ['我们', '需要', 'check ', 'the cache', '\n', '\n\n', ' ', '**注意**', '。'];
	const out: string[] = [];
	for (let i = 0; i < n; i++) {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		out.push(words[seed % words.length]!);
	}
	return out;
}

describe('LiveText', () => {
	it('reads any part of the text from its deltas', () => {
		const parts = deltas(500);
		const t = new LiveText();
		let text = '';
		for (const d of parts) {
			t.append(d);
			text += d;
		}
		expect(t.length).toBe(text.length);
		expect(t.slice(0)).toBe(text);
		for (const [from, to] of [
			[0, 1],
			[3, 3],
			[5, 77],
			[text.length - 240, text.length],
			[text.length - 1, text.length + 10],
			[-5, 4]
		] as const)
			expect(t.slice(from, to)).toBe(text.slice(Math.max(0, from), to));
	});

	it('knows whether the text so far is blank', () => {
		const t = new LiveText();
		expect(t.blank).toBe(true);
		t.append('  \n');
		expect(t.blank).toBe(true);
		t.append('');
		t.append('a');
		expect(t.blank).toBe(false);
	});
});

describe('liveRead and hasText', () => {
	it('read a streaming message from its deltas and fall back to its text', () => {
		const m = { text: '' };
		const t = startLive(m);
		t.append(' \n');
		m.text += ' \n';
		expect(hasText(m, m.text)).toBe(false);
		t.append('hi');
		m.text += 'hi';
		expect(hasText(m, m.text)).toBe(true);
		expect(liveRead(m, m.text)(1, 4)).toBe('\nhi');
		// The text no longer matches the deltas (it was replaced): the text wins.
		m.text = 'other text';
		expect(liveRead(m, m.text)(0, 5)).toBe('other');
		expect(hasText({ text: '' }, '  ')).toBe(false);
		endLive(m);
		expect(liveText(m)).toBeUndefined();
		expect(hasText(m, m.text)).toBe(true);
	});
});
