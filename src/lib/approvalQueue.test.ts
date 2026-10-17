import { describe, expect, it } from 'vitest';
import { ChatState } from '$lib/chat.svelte';

const ask = (id: string, extra: Record<string, unknown> = {}) => ({ type: 'approval_request', call_id: id, name: 'bash', summary: `cmd ${id}`, scopes: ['once'], ...extra });
const chat = (...events: Record<string, unknown>[]) => {
	const c = new ChatState();
	for (const ev of events) c.handle(ev as never);
	return c;
};
const ids = (c: ChatState) => c.pendingApprovals.map((a) => a.callId);

describe('several requests at once', () => {
	it('wait in the order they came; the first is the one shown', () => {
		const c = chat(ask('a'), ask('b'), ask('c'));
		expect(ids(c)).toEqual(['a', 'b', 'c']);
		expect(c.pendingApproval?.callId).toBe('a');
		expect(c.approvalPlace).toEqual({ n: 1, of: 3 });
	});

	it('count the answered ones in the run: 第 2/3 个, then 第 3/3 个, then nothing', () => {
		const c = chat(ask('a'), ask('b'), ask('c'));
		c.approvalAnswered();
		expect(c.pendingApproval?.callId).toBe('b');
		expect(c.approvalPlace).toEqual({ n: 2, of: 3 });
		c.approvalAnswered();
		expect(c.approvalPlace).toEqual({ n: 3, of: 3 });
		c.approvalAnswered();
		expect(c.pendingApproval).toBeNull();
		expect(c.approvalPlace).toBeNull();
		// A new run starts again at 1.
		c.handle(ask('d') as never);
		expect(c.approvalPlace).toBeNull();
		c.handle(ask('e') as never);
		expect(c.approvalPlace).toEqual({ n: 1, of: 2 });
	});

	it('shows no place for a single request', () => {
		expect(chat(ask('a')).approvalPlace).toBeNull();
	});

	it('drops a request whose call ran, wherever it is in the queue', () => {
		const c = chat(ask('a'), ask('b'), ask('c'));
		c.handle({ type: 'tool_output', call_id: 'b', name: 'bash', output: 'ok' } as never);
		expect(ids(c)).toEqual(['a', 'c']);
		expect(c.approvalPlace).toEqual({ n: 2, of: 3 });
	});

	it('keeps the place of a request asked again', () => {
		const c = chat(ask('a'), ask('b'), ask('a', { summary: 'again' }));
		expect(ids(c)).toEqual(['a', 'b']);
		expect(c.pendingApproval?.summary).toBe('again');
	});

	it('clears them all when the turn ends or fails', () => {
		const c = chat({ type: 'status', message: 'streaming' }, ask('a'), ask('b'));
		c.handle({ type: 'status', message: 'ready' } as never);
		expect(c.pendingApprovals).toEqual([]);
		expect(c.approvalPlace).toBeNull();
		const d = chat(ask('a'), ask('b'));
		d.handle({ type: 'error', message: 'boom' } as never);
		expect(d.pendingApprovals).toEqual([]);
	});

	it('keeps the one-request setter working for callers that set it', () => {
		const c = new ChatState();
		c.pendingApproval = { callId: 'x', name: 'bash', summary: '', subagentId: null, hunks: null };
		c.pendingApproval = { ...c.pendingApproval, summary: 'changed' };
		expect(ids(c)).toEqual(['x']);
		expect(c.pendingApproval.summary).toBe('changed');
		c.pendingApproval = null;
		expect(c.pendingApproval).toBeNull();
	});
});
