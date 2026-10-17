import { describe, expect, it } from 'vitest';
import type { Msg, TurnStats } from './chat.svelte';
import { isPickKey, keysFree, lastParagraph, markStopped, pickKeyLabel, recapOf, type RecapContext } from './recap';

const stats = (files = 0, added = 0, removed = 0): TurnStats => ({ elapsed: 1000, inTokens: 0, outTokens: 0, files, added, removed, tools: 0, cost: 0, model: 'm', segments: 1 });
const user = (text = 'go'): Msg => ({ kind: 'user', text }) as Msg;
const reply = (text: string, turn?: TurnStats, extra: object = {}): Msg => ({ kind: 'assistant', text, ...(turn ? { turn } : {}), ...extra }) as Msg;
const tool = (): Msg => ({ kind: 'tool', id: 't', name: 'edit', input: '', output: '' }) as unknown as Msg;
const ctx = (c: Partial<RecapContext> = {}): RecapContext => ({ busy: false, failed: false, suggestion: '', review: true, ...c });

describe('recapOf', () => {
	it('offers the suggestion as the next step, with the turn totals and the last paragraph', () => {
		const msgs = [user(), tool(), reply('Looked at it.\n\nDone: **3 tests** pass.', stats(2, 10, 3))];
		const r = recapOf(msgs, ctx({ suggestion: '  Commit\n and push ' }));
		expect(r).toMatchObject({ suggestion: 'Commit and push', summary: 'Done: 3 tests pass.', review: true, turn: { files: 2, added: 10, removed: 3 } });
		expect(r?.reply).toBe(msgs[2]);
	});

	it('offers the changes when there is no suggestion, and nothing without either', () => {
		expect(recapOf([user(), reply('ok', stats(1, 1, 0))], ctx())).toMatchObject({ suggestion: '', review: true });
		expect(recapOf([user(), reply('ok', stats(0))], ctx())).toBeNull();
		// The Changes panel cannot be opened from here: the changes are not an action.
		expect(recapOf([user(), reply('ok', stats(1, 1, 0))], ctx({ review: false }))).toBeNull();
		expect(recapOf([user(), reply('ok', stats(0))], ctx({ suggestion: 'next', review: false }))).toMatchObject({ suggestion: 'next', review: false });
	});

	it('shows nothing while busy, after a failure, an error or an interrupted reply, or before the turn ended', () => {
		const msgs = [user(), reply('ok', stats(1, 1, 0))];
		expect(recapOf(msgs, ctx({ busy: true }))).toBeNull();
		expect(recapOf(msgs, ctx({ failed: true }))).toBeNull();
		expect(recapOf([...msgs, { kind: 'error', text: 'x' } as Msg], ctx())).toBeNull();
		expect(recapOf([user(), reply('ok', stats(1, 1, 0), { interrupted: true })], ctx())).toBeNull();
		// No totals stamped yet (the turn has not ended), or a reloaded transcript.
		expect(recapOf([user(), reply('ok')], ctx({ suggestion: 'next' }))).toBeNull();
		expect(recapOf([], ctx({ suggestion: 'next' }))).toBeNull();
	});

	it('takes only the latest turn: an older turn with totals does not count', () => {
		expect(recapOf([user('a'), reply('first', stats(3, 3, 0)), user('b'), reply('second')], ctx({ suggestion: 'next' }))).toBeNull();
	});

	it('stays away once the reader chose', () => {
		expect(recapOf([user(), reply('ok', stats(1, 1, 0), { recap: { choice: 'closed', what: '', at: 0 } })], ctx({ suggestion: 'x' }))).toBeNull();
	});

	it('gives a turn the user stopped no card', () => {
		const msgs = [user(), reply('partial')];
		markStopped(msgs);
		msgs[1] = reply('partial', stats(1, 1, 0));
		expect(recapOf(msgs, ctx({ suggestion: 'next' }))).toBeNull();
		// The next turn has its own.
		expect(recapOf([...msgs, user('again'), reply('ok', stats(1, 1, 0))], ctx())).not.toBeNull();
	});
});

describe('lastParagraph', () => {
	it('is the last block of prose, as plain text', () => {
		expect(lastParagraph('First.\n\nThe **cache** is now [per session](x.md), see `cache.ts`.')).toBe('The cache is now per session, see cache.ts.');
		expect(lastParagraph('# Title\n\n- one\n- two *items*')).toBe('one two items');
		expect(lastParagraph('> quoted\n> lines')).toBe('quoted lines');
		expect(lastParagraph('Plain snake_case_name and 2 * 3 * 4 stay.')).toBe('Plain snake_case_name and 2 * 3 * 4 stay.');
	});

	it('skips code blocks, tables and rules', () => {
		expect(lastParagraph('Changed it.\n\n```ts\nconst a = 1;\n```')).toBe('Changed it.');
		expect(lastParagraph('Results:\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n---')).toBe('Results:');
		expect(lastParagraph('Before.\n\n    indented code')).toBe('Before.');
		// An unclosed fence still hides its code.
		expect(lastParagraph('Note.\n\n```\nnever closed')).toBe('Note.');
	});

	it('is cut with an ellipsis when long, and empty without prose', () => {
		const long = 'x'.repeat(400);
		expect(lastParagraph(long)).toHaveLength(280);
		expect(lastParagraph(long).endsWith('…')).toBe(true);
		expect(lastParagraph('```\ncode\n```')).toBe('');
		expect(lastParagraph('')).toBe('');
	});
});

describe('the pick key', () => {
	const key = (k: Partial<KeyboardEvent>) => ({ key: 'Enter', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...k });
	it('is ⌘↵ on macOS and Ctrl+↵ elsewhere, nothing else', () => {
		expect(isPickKey(key({ metaKey: true }), true)).toBe(true);
		expect(isPickKey(key({ ctrlKey: true }), true)).toBe(false);
		expect(isPickKey(key({ ctrlKey: true }), false)).toBe(true);
		expect(isPickKey(key({ metaKey: true }), false)).toBe(false);
		expect(isPickKey(key({}), true)).toBe(false);
		expect(isPickKey(key({ metaKey: true, shiftKey: true }), true)).toBe(false);
		expect(isPickKey(key({ key: 'a', metaKey: true }), true)).toBe(false);
		expect([pickKeyLabel(true), pickKeyLabel(false)]).toEqual(['⌘↵', 'Ctrl+Enter']);
	});
});

describe('keysFree', () => {
	type Fake = { tagName: string; isContentEditable?: boolean; attrs?: Record<string, string>; inside?: Fake[] };
	const el = (f: Fake) => ({ ...f, getAttribute: (n: string) => f.attrs?.[n] ?? null, contains: (o: unknown) => o === el || (f.inside ?? []).includes(o as Fake) }) as unknown as Element;
	const body = el({ tagName: 'BODY' });
	const doc = (open = false) => ({ body: body as HTMLElement, querySelector: () => (open ? body : null) }) as unknown as Pick<Document, 'querySelector' | 'body'>;

	it('is free with focus nowhere or on a button, not in another field', () => {
		expect(keysFree(null, null, doc())).toBe(true);
		expect(keysFree(body, null, doc())).toBe(true);
		expect(keysFree(el({ tagName: 'BUTTON' }), null, doc())).toBe(true);
		expect(keysFree(el({ tagName: 'INPUT' }), null, doc())).toBe(false);
		expect(keysFree(el({ tagName: 'TEXTAREA' }), null, doc())).toBe(false);
		expect(keysFree(el({ tagName: 'DIV', isContentEditable: true }), null, doc())).toBe(false);
	});

	it('takes keys typed in the composer while its menu is closed', () => {
		const editor = { tagName: 'DIV', isContentEditable: true, attrs: { 'aria-expanded': 'false' } } as Fake;
		const composer = el({ tagName: 'DIV', inside: [] });
		const focused = el(editor);
		(composer as unknown as { contains: (o: unknown) => boolean }).contains = (o) => o === focused;
		expect(keysFree(focused, composer, doc())).toBe(true);
		const open = el({ ...editor, attrs: { 'aria-expanded': 'true' } });
		(composer as unknown as { contains: (o: unknown) => boolean }).contains = (o) => o === open;
		expect(keysFree(open, composer, doc())).toBe(false);
	});

	it('leaves the keys to an open menu, list or dialog', () => {
		expect(keysFree(null, null, doc(true))).toBe(false);
	});
});
