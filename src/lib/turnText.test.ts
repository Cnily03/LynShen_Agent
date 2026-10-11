import { describe, expect, it } from 'vitest';
import type { Msg } from './chat.svelte';
import { lastTurnStart, turnEnds, turnText } from './turnText';

const user = (text: string): Msg => ({ kind: 'user', text });
const reply = (text: string): Msg => ({ kind: 'assistant', text });
const tool = (name: string): Msg => ({ kind: 'tool', callId: name, name, output: 'out', running: false, isError: false });
const reasoning = (text: string): Msg => ({ kind: 'reasoning', text, collapsed: true });

// Two turns: the second one in three segments around tool calls.
const chat: Msg[] = [
	user('first question'),
	reply('First answer.'),
	user('second question'),
	reasoning('thinking about it'),
	reply('Let me look.\n'),
	tool('read'),
	reply(''),
	tool('grep'),
	{ kind: 'system', text: 'note' },
	reply('\n\nFound it:\n\n```ts\nconst a = 1;\n```\n\n'),
	{ kind: 'error', text: 'rate limited' },
	reply('**Done.**')
];

describe('turnText', () => {
	it('joins every reply of the turn with a blank line, as Markdown source', () => {
		const text = 'Let me look.\n\nFound it:\n\n```ts\nconst a = 1;\n```\n\n**Done.**';
		expect(turnText(chat, 11)).toBe(text);
		// Any message of the turn stands for it, tool calls included.
		expect(turnText(chat, 4)).toBe(text);
		expect(turnText(chat, 7)).toBe(text);
	});

	it('stops at the next user message', () => {
		expect(turnText(chat, 1)).toBe('First answer.');
	});

	it('takes a user message as the turn that answers it', () => {
		expect(turnText(chat, 0)).toBe('First answer.');
		expect(turnText(chat, 2)).toBe(turnText(chat, 11));
	});

	it('keeps a first line indent (indented code) and drops blank lead lines', () => {
		expect(turnText([user('q'), reply('\n  \n    code()\n')], 1)).toBe('    code()');
	});

	it('is empty for a turn without reply text', () => {
		expect(turnText([user('q'), tool('read'), reply('  \n')], 1)).toBe('');
		expect(turnText([], 0)).toBe('');
	});

	it('works for replies before any user message', () => {
		expect(turnText([reply('hello'), user('q'), reply('a')], 0)).toBe('hello');
	});
});

describe('turnEnds', () => {
	it('marks the last reply with text of each turn', () => {
		const ends = turnEnds(chat);
		expect([...ends]).toEqual([chat[1], chat[11]]);
	});

	it('skips turns without reply text and empty trailing replies', () => {
		const msgs = [user('a'), tool('read'), user('b'), reply('B'), reply(' '), tool('x')];
		expect([...turnEnds(msgs)]).toEqual([msgs[3]]);
	});
});

describe('lastTurnStart', () => {
	it('is the index after the last user message', () => {
		expect(lastTurnStart(chat)).toBe(3);
		expect(lastTurnStart([reply('a')])).toBe(0);
		expect(lastTurnStart([user('a')])).toBe(1);
	});
});
