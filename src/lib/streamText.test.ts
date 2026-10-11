import { describe, expect, it } from 'vitest';
import { tailEdit } from './streamText';

describe('tailEdit', () => {
	it('appends what the tail gained', () => {
		expect(tailEdit({ text: 'Hel' }, { text: 'Hello' })).toEqual({ cut: 0, append: 'lo' });
		expect(tailEdit({ text: 'same' }, { text: 'same' })).toEqual({ cut: 0, append: '' });
	});

	it('cuts the part that moved into a finished block', () => {
		// "One.\n\n" became a Markdown block; the tail now starts at 6.
		expect(tailEdit({ text: 'One.\n\nTw', from: 0 }, { text: 'Two', from: 6 })).toEqual({ cut: 6, append: 'o' });
		expect(tailEdit({ text: 'One.\n\n', from: 4 }, { text: '', from: 10 })).toEqual({ cut: 6, append: '' });
	});

	it('gives up when the tail does not continue', () => {
		// The split moved back (a fence closed).
		expect(tailEdit({ text: '```\ncode', from: 6 }, { text: 'intro\n```\ncode\n```', from: 0 })).toBeNull();
		// The text changed under it.
		expect(tailEdit({ text: 'abc' }, { text: 'abd' })).toBeNull();
		// The split moved past the old tail.
		expect(tailEdit({ text: 'ab', from: 0 }, { text: 'x', from: 5 })).toBeNull();
	});
});
