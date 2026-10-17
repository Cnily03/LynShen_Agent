import { describe, expect, it } from 'vitest';
import { ChatState } from '$lib/chat.svelte';
import { countedTitle, overlayText, waitingCount } from './attention.svelte';

const chat = (events: Record<string, unknown>[] = []) => {
	const c = new ChatState();
	for (const ev of events) c.handle(ev as never);
	return c;
};
const approval = { type: 'approval_request', call_id: 'a1', name: 'bash', summary: 'pnpm build', scopes: ['once'] };
const question = { type: 'approval_request', call_id: 'q1', name: 'AskUserQuestion', summary: '', questions: [{ question: '重试还是报错？', options: [{ label: '重试' }], multiSelect: false }] };

describe('waitingCount', () => {
	it('counts the conversations that wait for the reader, as their amber dot does', () => {
		const sessions = [
			{ chat: chat([approval]) },
			{ chat: chat([question]) },
			{ chat: chat([{ type: 'status', message: 'streaming' }]) },
			{ chat: chat([{ type: 'error', message: 'cargo test failed' }]) },
			{ chat: chat() },
			{ chat: chat([approval]), archived: true }
		];
		expect(waitingCount(sessions)).toBe(2);
		expect(waitingCount([])).toBe(0);
	});
});

describe('what shows outside the window', () => {
	it('puts the count before the title, and nothing at 0', () => {
		expect(countedTitle('Aogiri', 2)).toBe('(2) Aogiri');
		expect(countedTitle('Aogiri', 0)).toBe('Aogiri');
	});
	it('keeps the Windows overlay to two characters', () => {
		expect([1, 9, 10, 42].map(overlayText)).toEqual(['1', '9', '9+', '9+']);
	});
});
