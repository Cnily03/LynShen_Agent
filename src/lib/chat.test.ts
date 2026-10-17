import { describe, it, expect, vi } from 'vitest';
import { ChatState, countDiffLines, shownTitle, UNTITLED } from './chat.svelte';
import { setLocale } from './i18n';
import { liveText } from './liveText';
import type { AgentEvent } from './protocol';

const userTexts = (c: ChatState) =>
	c.messages.filter((m) => m.kind === 'user').map((m) => (m.kind === 'user' ? m.text : ''));

describe('countDiffLines', () => {
	it('counts +/- lines, ignoring +++/--- headers', () => {
		expect(countDiffLines('--- a\n+++ b\n@@\n-old\n+new\n ctx')).toEqual({ added: 1, removed: 1 });
	});
	it('handles pure additions', () => {
		expect(countDiffLines('+a\n+b\n+c')).toEqual({ added: 3, removed: 0 });
	});
});

describe('ChatState.handle', () => {
	it('leaves a reasoning block the reader opened open when it ends', () => {
		const c = new ChatState();
		c.handle({ type: 'reasoning_delta', delta: 'think' });
		const block = c.messages.find((m) => m.kind === 'reasoning');
		if (block?.kind === 'reasoning') block.collapsed = false;
		c.handle({ type: 'assistant_delta', delta: 'answer' });
		expect(block?.kind === 'reasoning' && !block.collapsed && !block.live).toBe(true);
	});

	it('records how long the model reasoned once the answer starts', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(10_000);
			const c = new ChatState();
			c.handle({ type: 'reasoning_delta', delta: 'think' });
			vi.setSystemTime(13_400);
			c.handle({ type: 'reasoning_delta', delta: ' more' });
			const block = c.messages.find((m) => m.kind === 'reasoning');
			expect(block && block.kind === 'reasoning' && block.durationMs).toBeUndefined();
			// Folded from the start: one scrolling line until the reader opens it.
			expect(block?.kind === 'reasoning' && block.collapsed && block.live).toBe(true);
			vi.setSystemTime(14_200);
			c.handle({ type: 'assistant_delta', delta: 'answer' });
			const done = c.messages.find((m) => m.kind === 'reasoning');
			expect(done?.kind === 'reasoning' && done.durationMs).toBe(4200);
			expect(done?.kind === 'reasoning' && done.collapsed).toBe(true);
			expect(done?.kind === 'reasoning' && done.live).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it('keeps the deltas of the reasoning and reply streaming now for the view, and only while they stream', () => {
		const c = new ChatState();
		c.handle({ type: 'status', message: 'streaming' });
		let text = '';
		for (let i = 0; i < 20_000; i++) {
			const delta = i % 50 === 49 ? '\n\n' : `想${i} `;
			text += delta;
			c.handle({ type: 'reasoning_delta', delta });
		}
		const block = c.messages.at(-1)!;
		expect(block.kind === 'reasoning' && block.text).toBe(text);
		const live = liveText(block)!;
		expect(live.length).toBe(text.length);
		expect(live.slice(text.length - 240)).toBe(text.slice(-240));
		c.handle({ type: 'assistant_delta', delta: 'The answer' });
		// The reasoning ended: the view reads its text whole again.
		expect(liveText(block)).toBeUndefined();
		const reply = c.messages.at(-1)!;
		expect(liveText(reply)?.slice(0)).toBe('The answer');
		c.handle({ type: 'status', message: 'ready' });
		expect(liveText(reply)).toBeUndefined();
	});

	describe('a response cut off for a steered message', () => {
		/** A turn whose response streams `before`, is steered with `steer` and
		 *  goes on with a new response (the serve protocol's order). */
		function steered(before: AgentEvent[], interrupted = true) {
			const c = new ChatState();
			c.handle({ type: 'user_message', content: 'first' });
			c.handle({ type: 'connecting' });
			c.handle({ type: 'status', message: 'streaming' });
			for (const ev of before) c.handle(ev);
			c.handle({ type: 'pending_messages', messages: ['use staging'] });
			c.handle({ type: 'status', message: 'steering' });
			c.handle({ type: 'pending_messages', messages: [] });
			if (interrupted) c.handle({ type: 'response_interrupted' });
			c.handle({ type: 'user_message', content: 'use staging' });
			c.handle({ type: 'connecting' });
			return c;
		}

		it('finishes the reply in place, marked, and starts a new one after the steered message', () => {
			const c = steered([
				{ type: 'reasoning_delta', delta: 'think' },
				{ type: 'assistant_delta', delta: 'Half an ans' }
			]);
			const cut = c.messages[2]!;
			expect(cut.kind === 'assistant' && cut.interrupted && cut.text).toBe('Half an ans');
			// The reasoning had ended when the answer started: it is whole.
			expect(c.messages[1]!.kind === 'reasoning' && c.messages[1]!.interrupted).toBeFalsy();
			for (const delta of ['A new', ' answer']) c.handle({ type: 'assistant_delta', delta });
			expect(c.messages.map((m) => m.kind)).toEqual(['user', 'reasoning', 'assistant', 'user', 'assistant']);
			// Later deltas never touch it, and nothing of it streams any more.
			expect(cut.kind === 'assistant' && cut.text).toBe('Half an ans');
			expect(liveText(cut)).toBeUndefined();
			expect(c.messages[4]!.kind === 'assistant' && !c.messages[4]!.interrupted && c.messages[4]!.text).toBe('A new answer');
			// The turn's totals go on a reply the conversation keeps.
			c.handle({ type: 'status', message: 'ready' });
			expect(cut.kind === 'assistant' && cut.turn).toBeUndefined();
			expect(c.messages[4]!.kind === 'assistant' && c.messages[4]!.turn).toBeTruthy();
		});

		it('finishes reasoning cut off while it streams, with how long it ran', () => {
			vi.useFakeTimers();
			try {
				vi.setSystemTime(1_000);
				// Steered before any response streamed: nothing to cut yet.
				const c = steered([]);
				expect(c.messages.map((m) => m.kind)).toEqual(['user', 'user']);
				c.handle({ type: 'reasoning_delta', delta: 'thinking about prod' });
				vi.setSystemTime(4_000);
				c.handle({ type: 'response_interrupted' });
				c.handle({ type: 'user_message', content: 'really, staging' });
				c.handle({ type: 'reasoning_delta', delta: 'staging then' });
				const [cut, fresh] = c.messages.filter((m) => m.kind === 'reasoning');
				expect(cut?.kind === 'reasoning' && cut).toMatchObject({ text: 'thinking about prod', interrupted: true, live: false, durationMs: 3000 });
				expect(fresh?.kind === 'reasoning' && fresh).toMatchObject({ text: 'staging then', live: true });
				expect(liveText(cut!)).toBeUndefined();
			} finally {
				vi.useRealTimers();
			}
		});

		it('shows the steered message as on its way until the engine reads it', () => {
			const c = new ChatState();
			c.handle({ type: 'status', message: 'streaming' });
			c.handle({ type: 'tool_start', call_id: 'c1', name: 'bash' });
			c.handle({ type: 'pending_messages', messages: ['use staging', 'then deploy'] });
			c.handle({ type: 'status', message: 'steering' });
			c.handle({ type: 'pending_messages', messages: ['then deploy'] });
			expect(c.steering).toBe('use staging');
			expect(c.phase).toBe('tool');
			c.handle({ type: 'tool_output', call_id: 'c1', name: 'bash', output: 'ok', is_error: false });
			c.handle({ type: 'user_message', content: 'use staging' });
			expect(c.steering).toBeNull();
		});

		it('changes nothing for an engine without the event', () => {
			const c = steered([{ type: 'assistant_delta', delta: 'Half' }], false);
			c.handle({ type: 'assistant_delta', delta: 'New' });
			expect(c.messages.map((m) => (m.kind === 'assistant' ? `${m.text}${m.interrupted ? '!' : ''}` : m.kind))).toEqual([
				'user',
				'Half',
				'user',
				'New'
			]);
		});
	});

	it('keeps a just-sent message that the arriving snapshot does not have yet', () => {
		const c = new ChatState();
		c.optimisticUser('first');
		c.handle({ type: 'transcript', items: [] });
		expect(userTexts(c)).toEqual(['first']);
		// Its echo arrives next and is not shown twice.
		c.handle({ type: 'user_message', content: 'first' });
		expect(userTexts(c)).toEqual(['first']);
	});

	it('takes the snapshot copy of a just-sent message when it already has it', () => {
		const c = new ChatState();
		c.optimisticUser('first');
		c.handle({ type: 'transcript', items: [{ role: 'user', content: 'first' }] });
		expect(userTexts(c)).toEqual(['first']);
		c.handle({ type: 'user_message', content: 'second' });
		expect(userTexts(c)).toEqual(['first', 'second']);
	});

	it('notes deferred and decided actions of a hosted session in the chat', () => {
		setLocale('en');
		const c = new ChatState();
		c.handle({ type: 'action_deferred', id: 'act-1', name: 'bash', summary: 'make deploy' });
		c.handle({ type: 'action_decided', id: 'act-1', decision: 'deny' });
		const texts = c.messages.map((m) => (m.kind === 'system' ? m.text : ''));
		expect(texts[0]).toContain('bash (make deploy)');
		expect(texts[1]).toBe('Pending action act-1 denied');
	});

	it('projects a user message and streamed assistant deltas', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hello' });
		c.handle({ type: 'assistant_delta', delta: 'hi ' });
		c.handle({ type: 'assistant_delta', delta: 'there' });
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
		const a = c.messages[1];
		expect(a.kind === 'assistant' && a.text).toBe('hi there');
	});

	it('leaves the title to the daemon', () => {
		const c = new ChatState();
		c.optimisticUser('do the thing');
		c.handle({ type: 'user_message', content: 'do the thing again' });
		c.handle({ type: 'transcript', items: [{ role: 'user', content: 'earlier' }] });
		expect(c.title).toBe('New session');
	});

	it('shows the placeholder title in the interface language', () => {
		expect(shownTitle(UNTITLED)).not.toBe(UNTITLED);
		expect(shownTitle('')).toBe(shownTitle(UNTITLED));
		expect(shownTitle('Fix the build')).toBe('Fix the build');
	});

	it('de-duplicates the optimistic echo', () => {
		const c = new ChatState();
		c.optimisticUser('refactor foo');
		c.handle({ type: 'user_message', content: 'refactor foo' });
		expect(userTexts(c)).toEqual(['refactor foo']);
	});

	it('still appends a genuinely different message after an optimistic one', () => {
		const c = new ChatState();
		c.optimisticUser('first');
		c.handle({ type: 'user_message', content: 'second' });
		expect(userTexts(c)).toEqual(['first', 'second']);
	});

	it('de-duplicates a replay echo that arrives after the assistant reply (claude)', () => {
		// claude's --replay-user-messages re-emits the user turn only after the
		// assistant has answered, so the optimistic bubble is no longer at the tail.
		const c = new ChatState();
		c.optimisticUser('你好');
		c.handle({ type: 'assistant_start' });
		c.handle({ type: 'assistant_delta', text: '你好！' });
		c.handle({ type: 'user_message', content: '你好' });
		expect(userTexts(c)).toEqual(['你好']);
	});

	it('stamps end-of-turn usage tokens onto the last assistant message (claude)', () => {
		// claude reports usage once at the end of the turn, after the assistant
		// finished — #assistantIdx is already reset, so tokens must fall back to
		// the last assistant message (same bubble the elapsed time lands on).
		const c = new ChatState();
		c.optimisticUser('q');
		c.handle({ type: 'assistant_delta', delta: 'answer' });
		c.handle({ type: 'assistant_start' }); // resets #assistantIdx to -1
		c.handle({ type: 'usage', output_tokens: 42, input_tokens: 10 });
		const last = c.messages[c.messages.length - 1] as { kind: string; tokens?: number };
		expect(last.kind).toBe('assistant');
		expect(last.tokens).toBe(42);
	});

	it('builds a per-turn diff timeline from edit tool outputs', () => {
		const c = new ChatState();
		// Turn 1: edit a.ts (+2/-1)
		c.handle({ type: 'user_message', content: 'edit a' });
		c.handle({ type: 'tool_start', call_id: 't1', name: 'str_replace' });
		c.handle({
			type: 'tool_output',
			call_id: 't1',
			name: 'str_replace',
			output: JSON.stringify({ path: '/proj/a.ts', diff: '-old\n+new1\n+new2' })
		});
		// Turn 2: edit b.ts (+1/-0)
		c.handle({ type: 'user_message', content: 'edit b' });
		c.handle({ type: 'tool_start', call_id: 't2', name: 'write' });
		c.handle({
			type: 'tool_output',
			call_id: 't2',
			name: 'write',
			output: JSON.stringify({ path: '/proj/b.ts', diff: '+only' })
		});
		const tl = c.turnTimeline;
		expect(tl.map((t) => t.index)).toEqual([1, 0]); // newest first
		expect(tl[1]).toMatchObject({ index: 0, text: 'edit a', added: 2, removed: 1 });
		expect(tl[1].files).toEqual([{ path: '/proj/a.ts', added: 2, removed: 1 }]);
		expect(tl[0]).toMatchObject({ index: 1, text: 'edit b', added: 1, removed: 0 });
	});

	it('drops per-turn diffs when truncating to an earlier turn', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'edit a' });
		c.handle({ type: 'tool_start', call_id: 't1', name: 'write' });
		c.handle({ type: 'tool_output', call_id: 't1', name: 'write', output: JSON.stringify({ path: '/a', diff: '+x' }) });
		c.handle({ type: 'user_message', content: 'edit b' });
		c.handle({ type: 'tool_start', call_id: 't2', name: 'write' });
		c.handle({ type: 'tool_output', call_id: 't2', name: 'write', output: JSON.stringify({ path: '/b', diff: '+y' }) });
		c.truncateToUserTurn(1); // drop turn 2 (index 1)
		expect(c.turnTimeline.map((t) => t.index)).toEqual([0]);
	});

	it('summarizes raw frames for the diagnostics trace (incl. unparseable)', () => {
		const c = new ChatState();
		c.captureFrame(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Bash' } } }));
		c.captureFrame(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_9' }] } }));
		c.captureFrame(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use' }] }, parent_tool_use_id: 'toolu_p' }));
		c.captureFrame('{not json');
		expect(c.frameTrace[0]).toBe('stream_event/content_block_start tool_use:Bash');
		expect(c.frameTrace[1]).toBe('user/tool_result toolu_9');
		expect(c.frameTrace[2]).toContain('⤷sub');
		expect(c.frameTrace[3]).toMatch(/^⚠ unparseable/);
	});

	it('caps the frame trace ring buffer at 200', () => {
		const c = new ChatState();
		for (let i = 0; i < 250; i++) c.captureFrame(JSON.stringify({ type: 'system', subtype: `s${i}` }));
		expect(c.frameTrace.length).toBe(200);
		expect(c.frameTrace[c.frameTrace.length - 1]).toBe('system/s249');
	});

	it('aggregates turn timing and message stats for diagnostics', () => {
		const c = new ChatState();
		const a1 = { kind: 'assistant', text: 'x', elapsed: 1000 } as const;
		const a2 = { kind: 'assistant', text: 'y', elapsed: 3000 } as const;
		c.messages.push({ kind: 'user', text: 'q1' }, { ...a1 }, { kind: 'user', text: 'q2' }, { ...a2 });
		expect(c.turnTiming).toEqual({ turns: 2, totalMs: 4000, meanMs: 2000 });
		expect(c.messageStats).toMatchObject({ user: 2, assistant: 2 });
	});

	it('aggregates a tool card by call_id and marks it done', () => {
		const c = new ChatState();
		c.handle({ type: 'tool_start', call_id: '1', name: 'read' });
		c.handle({ type: 'tool_output', call_id: '1', name: 'read', output: '{"kind":"text"}', is_error: false });
		const tool = c.messages.find((m) => m.kind === 'tool');
		expect(tool).toMatchObject({ kind: 'tool', name: 'read', running: false, isError: false });
	});

	it('sweeps a still-running tool card to done when the turn ends (lost tool_output)', () => {
		const c = new ChatState();
		c.handle({ type: 'tool_start', call_id: 'lost', name: 'read' });
		// No tool_output arrives (e.g. a subagent frame whose tool_result never
		// mapped). The turn ending must not leave the card spinning forever.
		c.handle({ type: 'status', message: 'ready' });
		const tool = c.messages.find((m) => m.kind === 'tool');
		expect(tool).toMatchObject({ kind: 'tool', name: 'read', running: false });
	});

	it('resolves a pencil rewind intent from checkpoint_view by position', () => {
		const c = new ChatState();
		c.rewindIntent = { userIndex: 1, text: 'edit me' };
		c.handle({
			type: 'checkpoint_view',
			items: [
				{ id: 't0', label: 'a', detail: '', active: false },
				{ id: 't1', label: 'b', detail: '', active: false }
			]
		});
		expect(c.picker).toBeNull();
		expect(c.pendingRewind).toEqual({ id: 't1', text: 'edit me' });
	});

	it('opens the checkpoint picker when there is no rewind intent', () => {
		const c = new ChatState();
		c.handle({ type: 'checkpoint_view', items: [{ id: 't0', label: 'a', detail: '', active: false }] });
		expect(c.picker?.kind).toBe('checkpoint');
		expect(c.pendingRewind).toBeNull();
	});

	it('stores the latest mcp_servers view on the state', () => {
		const c = new ChatState();
		expect(c.mcpServers).toBeNull();
		c.handle({
			type: 'mcp_servers',
			servers: [
				{
					name: 'files',
					transport: 'stdio',
					state: 'connected',
					tools: [{ name: 'read_file', description: 'Read a file' }]
				},
				{ name: 'web', transport: 'http', state: 'failed', error: 'boom', tools: [] }
			]
		});
		expect(c.mcpServers).toEqual([
			{
				name: 'files',
				transport: 'stdio',
				state: 'connected',
				tools: [{ name: 'read_file', description: 'Read a file' }]
			},
			{ name: 'web', transport: 'http', state: 'failed', error: 'boom', tools: [] }
		]);
		// A later event replaces the list wholesale.
		c.handle({ type: 'mcp_servers', servers: [] });
		expect(c.mcpServers).toEqual([]);
	});

	it('clears booting on the first engine event and caches the model catalog', () => {
		const c = new ChatState();
		expect(c.booting).toBe(true);
		c.handle({ type: 'model_status', state: 'idle' });
		expect(c.booting).toBe(false);
		c.handle({
			type: 'model_view',
			models: [{ model: 'opus', active: true, reasoning_efforts: ['high', 'max'] }],
			active_effort: 'high'
		});
		expect(c.modelCatalog).toEqual([{ model: 'opus', active: true, reasoning_efforts: ['high', 'max'] }]);
		expect(c.modelCatalogEffort).toBe('high');
	});

	it('collects meta notices into statusLog, keeping them out of the bubble stream', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hi' });
		c.handle({ type: 'info', message: 'context reached the compaction threshold; compacting and continuing' });
		c.handle({ type: 'info', message: 'nothing old enough to compact' });
		c.handle({ type: 'error', message: 'boom' });
		// statusLog holds only the system/meta notices…
		expect(c.statusLog.length).toBe(2);
		// …while user + error stay as bubbles in messages.
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'system', 'system', 'error']);
	});

	it('shows a compaction as a card in the conversation, then as a divider with its sizes', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hi' });
		c.handle({ type: 'context_usage', tokens: 755_000, tokenizer: 'x' });
		c.handle({ type: 'info', message: 'context reached the compaction threshold; compacting and continuing' });
		c.handle({ type: 'compaction_start' });
		expect(c.phase).toBe('compacting');
		c.handle({ type: 'info', message: 'a note in between' });
		c.handle({ type: 'compaction_progress', output_tokens: 1_200 });
		const card = c.messages.find((m) => m.kind === 'compaction');
		expect(card).toMatchObject({ state: 'running', before: 755_000, written: 1_200, live: true });
		c.handle({ type: 'compaction_end', summary: '## Kept\n- the plan' });
		c.handle({ type: 'context_usage', tokens: 21_000, tokenizer: 'x' });
		expect(c.messages.filter((m) => m.kind === 'compaction')).toEqual([
			expect.objectContaining({ state: 'done', before: 755_000, after: 21_000, summary: '## Kept\n- the plan' })
		]);
		// A later size is the conversation growing again, not the compaction's.
		c.handle({ type: 'context_usage', tokens: 30_000, tokenizer: 'x' });
		expect(c.messages.find((m) => m.kind === 'compaction')).toMatchObject({ after: 21_000 });
	});

	it('ends a compaction cut short, and shows one that only reports its end', () => {
		const c = new ChatState();
		c.handle({ type: 'status', message: 'compacting' });
		c.handle({ type: 'compaction_start' });
		c.handle({ type: 'status', message: 'ready' });
		expect(c.messages.find((m) => m.kind === 'compaction')).toMatchObject({ state: 'failed' });
		// claude and codex announce only the end.
		const d = new ChatState();
		d.handle({ type: 'compaction_end' });
		expect(d.messages).toEqual([expect.objectContaining({ kind: 'compaction', state: 'done' })]);
		d.handle({ type: 'compaction_failed', error: 'model refused' });
		expect(d.messages.at(-1)).toMatchObject({ kind: 'compaction', state: 'failed', error: 'model refused' });
	});

	it('shows where a reloaded conversation was compacted', () => {
		const c = new ChatState();
		c.handle({
			type: 'transcript',
			items: [
				{ role: 'user', content: 'first' },
				{ role: 'compaction', summary: 'what came before' },
				{ role: 'user', content: 'next' }
			]
		});
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'compaction', 'user']);
		expect(c.messages[1]).toMatchObject({ state: 'done', summary: 'what came before' });
		expect(c.messages[1]).not.toHaveProperty('live');
	});

	it('a panel refused while the conversation runs in its TUI fails nothing', () => {
		const c = new ChatState();
		c.handle({ type: 'surface', surface: 'tui' });
		c.handle({ type: 'error', message: 'the conversation is open in its terminal: exit the TUI to continue here' });
		expect(c.lastError).toBeNull();
		expect(c.messages).toEqual([]);
	});

	it('shows a retry as live state, not a log line, until output flows again', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'hi' });
		c.handle({ type: 'retrying', attempt: 3, max_attempts: 6, reason: 'unexpected status 503: busy', delay_ms: 2000 });
		expect(c.retry).toMatchObject({ attempt: 3, max: 6, reason: 'unexpected status 503: busy', delayMs: 2000 });
		expect(c.messages.map((m) => m.kind)).toEqual(['user']);
		c.handle({ type: 'assistant_delta', delta: 'ok' });
		expect(c.retry).toBeNull();
		c.handle({ type: 'retrying', attempt: 2, max_attempts: 3, reason: 'timeout', delay_ms: 500 });
		c.handle({ type: 'error', message: 'gave up' });
		expect(c.retry).toBeNull();
	});

	it('estimates cost from token usage when the engine reports none', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', model: 'claude-opus-4-8', state: 'idle' });
		c.handle({ type: 'usage', input_tokens: 1_000_000, output_tokens: 1_000_000 });
		// opus: $15/M in + $75/M out = $90 for 1M+1M.
		expect(c.cost).toBeCloseTo(90, 5);
	});

	it('mirrors claude ultracode from model_status; other engines leave it off', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', model: 'claude-opus-5-5', ultracode: true, ultracode_available: true, state: 'idle' });
		expect([c.ultracode, c.ultracodeAvailable]).toEqual([true, true]);
		c.handle({ type: 'model_status', model: 'gpt-5.5', state: 'idle' });
		expect([c.ultracode, c.ultracodeAvailable]).toEqual([false, false]);
	});

	it('defers to the engine cost once it reports one (no double count)', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', model: 'gpt-5.5', state: 'idle' });
		c.handle({ type: 'context_usage', tokens: 100, cost: 0.42 });
		c.handle({ type: 'usage', input_tokens: 1_000_000, output_tokens: 1_000_000 });
		expect(c.cost).toBe(0.42);
	});

	it('truncateToUserTurn drops the target turn and everything after (codex rewind)', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'first' });
		c.handle({ type: 'assistant_delta', delta: 'a1' });
		c.handle({ type: 'user_message', content: 'second' });
		c.handle({ type: 'assistant_delta', delta: 'a2' });
		c.handle({ type: 'user_message', content: 'third' });
		expect(c.userTurns).toBe(3);
		c.truncateToUserTurn(1); // rewind to the 2nd user turn
		expect(userTexts(c)).toEqual(['first']);
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'assistant']);
	});

	it('stamps assistant_uuid and resolves the claude rewind resume-at target', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'q1' });
		c.handle({ type: 'assistant_delta', delta: 'a1' });
		c.handle({ type: 'assistant_uuid', uuid: 'uuid-1' });
		c.handle({ type: 'assistant_start' });
		c.handle({ type: 'user_message', content: 'q2' });
		c.handle({ type: 'assistant_delta', delta: 'a2' });
		c.handle({ type: 'assistant_uuid', uuid: 'uuid-2' });
		// Rewind to turn 1 (2nd user msg) resumes at turn 0's assistant uuid.
		expect(c.claudeRewindTarget(1)).toBe('uuid-1');
		// Rewind to turn 0 has no prior assistant → fresh restart (null).
		expect(c.claudeRewindTarget(0)).toBeNull();
	});

	it('tracks busy state from engine status', () => {
		const c = new ChatState();
		c.handle({ type: 'model_status', state: 'streaming' });
		expect(c.busy).toBe(true);
		c.handle({ type: 'status', message: 'ready' });
		expect(c.busy).toBe(false);
	});

	it('takes a refused context_usage as no categories, not a failure', () => {
		for (const message of ['unknown op: context_usage', 'Claude Code sessions do not support context_usage']) {
			const c = new ChatState();
			c.handle({ type: 'error', message });
			expect(c.contextBreakdown).toEqual({ error: message });
			expect(c.messages).toHaveLength(0);
		}
	});

	it('counts the whole request when context_usage breaks it down', () => {
		const c = new ChatState();
		c.handle({ type: 'context_usage', tokens: 9200 });
		expect(c.requestParts).toBeNull();
		expect(c.contextUsed).toBe(9200);
		c.handle({
			type: 'context_usage',
			tokens: 9200,
			breakdown: { system_prompt: 4100, skills: 2600, system_tools: 11800, mcp_tools: 1300, messages: 9200 }
		});
		expect(c.contextTokens).toBe(9200);
		expect(c.contextUsed).toBe(29_000);
		// An engine that stops sending it falls back to the conversation.
		c.handle({ type: 'context_usage', tokens: 500 });
		expect(c.requestParts).toBeNull();
		expect(c.contextUsed).toBe(500);
	});

	it('averages the prompt-cache hit rate over requests with cache figures', () => {
		const c = new ChatState();
		c.handle({ type: 'usage', input_tokens: 1000, output_tokens: 10 });
		expect(c.cacheHitRate).toBeNull();
		c.handle({ type: 'usage', input_tokens: 1000, cached_input_tokens: 0, output_tokens: 10 });
		c.handle({ type: 'usage', input_tokens: 3000, cached_input_tokens: 2800, output_tokens: 10 });
		expect(c.cacheHitRate).toBeCloseTo(0.7);
	});
});

describe('approval flow (engine-enforced)', () => {
	it('reduces an approval_request with hunks + subagent into state', () => {
		const c = new ChatState();
		c.handle({
			type: 'approval_request',
			call_id: 'call_1',
			name: 'apply_patch',
			summary: 'src/a.rs',
			subagent_id: 'agent-7',
			hunks: [
				{ id: 'f0h1', file: 'src/a.rs', header: '@@ -1,3 +1,3 @@', lines: [' a', '-b', '+c'] },
				{ id: 'f0h2', file: 'src/a.rs', header: '@@ -9,2 +9,3 @@', lines: ['+d'] }
			]
		});
		expect(c.pendingApproval).toEqual({
			callId: 'call_1',
			name: 'apply_patch',
			summary: 'src/a.rs',
			subagentId: 'agent-7',
			hunks: [
				{ id: 'f0h1', file: 'src/a.rs', header: '@@ -1,3 +1,3 @@', lines: [' a', '-b', '+c'] },
				{ id: 'f0h2', file: 'src/a.rs', header: '@@ -9,2 +9,3 @@', lines: ['+d'] }
			],
			questions: null
		});
	});

	it('shows a mode that waits for the turn, and drops an approval decided elsewhere', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_mode_pending', mode: 'full-access' } as never);
		expect(c.approvalPending).toBe('all');
		c.handle({ type: 'approval_mode_pending', mode: null } as never);
		expect(c.approvalPending).toBeNull();
		c.handle({ type: 'approval_request', call_id: 'c1', name: 'bash', summary: 'ls', hunks: null, subagent_id: null } as never);
		expect(c.pendingApproval?.callId).toBe('c1');
		c.handle({ type: 'tool_output', call_id: 'c2', output: '', is_error: false } as never);
		expect(c.pendingApproval?.callId).toBe('c1');
		c.handle({ type: 'tool_output', call_id: 'c1', output: 'ok', is_error: false } as never);
		expect(c.pendingApproval).toBeNull();
	});

	it('reduces a hunk-less approval_request with null hunks/subagent', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_request', call_id: 'c2', name: 'bash', summary: 'rm -rf /tmp/x', subagent_id: null, hunks: null });
		expect(c.pendingApproval).toEqual({
			callId: 'c2',
			name: 'bash',
			summary: 'rm -rf /tmp/x',
			subagentId: null,
			hunks: null,
			questions: null
		});
	});

	it('never auto-approves client-side: requests surface in every mode', () => {
		const c = new ChatState();
		c.approvalMode = 'all'; // engine decides now — 'all' must not swallow the card
		c.handle({ type: 'approval_request', call_id: 'c3', name: 'apply_patch', summary: 'x' });
		expect(c.pendingApproval?.callId).toBe('c3');
	});

	it("pushes the desktop's persisted mode when the startup announcement diverges", () => {
		const c = new ChatState();
		c.approvalMode = 'all'; // persisted preference
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' }); // engine default
		// desktop mode wins at startup: local state untouched, push requested
		expect(c.approvalMode).toBe('all');
		expect(c.pendingModeSync).toBe('full-auto');
		// the ack after the page sends set_approval_mode reconciles to the same value
		c.pendingModeSync = null;
		c.handle({ type: 'approval_mode', mode: 'full-auto' });
		expect(c.approvalMode).toBe('all');
		expect(c.pendingModeSync).toBeNull();
	});

	it("keeps an agent session in the agent's mode and does not persist it", () => {
		const setItem = vi.fn();
		vi.stubGlobal('localStorage', { getItem: () => null, setItem });
		const c = new ChatState();
		c.agent = 'ops';
		c.approvalMode = 'ask'; // the desktop's mode
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'auto' }); // the agent's mode
		expect(c.pendingModeSync).toBeNull();
		expect(c.approvalMode).toBe('auto');
		c.handle({ type: 'approval_mode', mode: 'full-auto' });
		expect(c.approvalMode).toBe('all');
		expect(setItem).not.toHaveBeenCalled();
		vi.unstubAllGlobals();
	});

	it('keeps the engine\'s mode when an older engine refuses one it does not know', () => {
		setLocale('zh');
		const c = new ChatState();
		c.approvalMode = 'auto'; // persisted preference
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' }); // the engine's own (manual)
		expect(c.pendingModeSync).toBe('auto');
		// The page sends set_approval_mode auto; an engine before auto refuses it.
		c.handle({ type: 'error', message: "unknown approval mode 'auto': use manual, auto-edit, full-access, or plan" });
		expect(c.approvalMode).toBe('ask');
		expect(c.pendingModeSync).toBeNull();
		expect(c.unsupportedModes).toEqual(['auto']);
		const last = c.messages.at(-1);
		expect(last?.kind).toBe('system');
		expect(last?.kind === 'system' && last.text).toContain('「自动」');
		expect(c.messages.some((m) => m.kind === 'error')).toBe(false);
		// A mode it knows still switches.
		c.handle({ type: 'approval_mode', mode: 'auto-edit' });
		expect(c.approvalMode).toBe('edits');
		c.handle({ type: 'error', message: "unknown approval mode 'full-access'" });
		expect(c.approvalMode).toBe('edits');
		expect(c.unsupportedModes).toEqual(['auto', 'all']);
	});

	it('requests no push when the startup announcement already matches', () => {
		const c = new ChatState();
		c.approvalMode = 'ask';
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' });
		expect(c.pendingModeSync).toBeNull();
		expect(c.approvalMode).toBe('ask');
	});

	it('reconciles post-startup approval_mode events from the engine (e.g. /approvals)', () => {
		const c = new ChatState();
		c.approvalMode = 'ask';
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' }); // startup announcement, in sync
		c.handle({ type: 'approval_mode', mode: 'auto-edit' }); // user typed /approvals auto-edit
		expect(c.approvalMode).toBe('edits');
		expect(c.pendingModeSync).toBeNull();
		// garbage keeps the current mode
		c.handle({ type: 'approval_mode', mode: 'bogus' });
		expect(c.approvalMode).toBe('edits');
	});

	it('re-arms the startup push after a crash restart', () => {
		const c = new ChatState();
		c.approvalMode = 'edits';
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' });
		expect(c.pendingModeSync).toBe('auto-edit');
		c.pendingModeSync = null;
		c.handle({ type: 'approval_mode', mode: 'auto-edit' }); // ack
		// engine crashes; the restarted engine announces its default again
		c.handle({ type: 'startup', model: 'm', cwd: '/', session_id: 's1' });
		c.handle({ type: 'approval_mode', mode: 'read-only' });
		expect(c.pendingModeSync).toBe('auto-edit');
		expect(c.approvalMode).toBe('edits');
	});
});

describe('send state and turn stats', () => {
	const user = (c: ChatState) => c.messages.find((m) => m.kind === 'user') as { state?: string };

	it('walks a sent message through connecting and waiting until the reply streams', () => {
		const c = new ChatState();
		c.optimisticUser('hi');
		expect(user(c).state).toBe('sending');
		c.handle({ type: 'connecting' });
		expect(user(c).state).toBe('connecting');
		c.handle({ type: 'thinking_start' });
		expect(user(c).state).toBe('waiting');
		c.handle({ type: 'assistant_delta', delta: 'hello' });
		expect(user(c).state).toBeUndefined();
	});

	it('marks a message whose turn fails before any output', () => {
		const c = new ChatState();
		c.optimisticUser('hi');
		c.handle({ type: 'connecting' });
		c.handle({ type: 'error', message: 'HTTP 400' });
		expect(user(c).state).toBe('failed');
	});

	it('flags a cache miss during a running turn only', () => {
		const c = new ChatState();
		c.handle({ type: 'usage', input_tokens: 10_000, cached_input_tokens: 0, output_tokens: 10 });
		c.handle({ type: 'usage', input_tokens: 12_000, cached_input_tokens: 0, output_tokens: 10 });
		expect(c.cacheMiss).toBeNull();
		c.handle({ type: 'connecting' });
		c.handle({ type: 'usage', input_tokens: 14_000, cached_input_tokens: 11_990, output_tokens: 10 });
		expect(c.cacheMiss).toBeNull();
		c.handle({ type: 'usage', input_tokens: 16_000, cached_input_tokens: 100, output_tokens: 10 });
		expect(c.cacheMiss).toEqual({ input: 16_000, cached: 100 });
		c.cacheMiss = null;
		c.handle({ type: 'compaction_end' });
		c.handle({ type: 'usage', input_tokens: 5_000, cached_input_tokens: 0, output_tokens: 10 });
		c.handle({ type: 'usage', input_tokens: 6_000, output_tokens: 10 });
		expect(c.cacheMiss).toBeNull();
	});

	it('stamps the turn totals on the last reply, including late usage', () => {
		const c = new ChatState();
		c.optimisticUser('fix it');
		c.handle({ type: 'connecting' });
		c.handle({ type: 'assistant_delta', delta: 'looking' });
		c.handle({ type: 'tool_start', call_id: 'c1', name: 'read_file' });
		c.handle({ type: 'tool_output', call_id: 'c1', name: 'read_file', output: 'x' });
		c.handle({ type: 'usage', input_tokens: 100, output_tokens: 20 });
		c.handle({ type: 'assistant_delta', delta: 'done' });
		c.handle({ type: 'status', message: 'ready' });
		// claude: usage for the turn arrives after it ended
		c.handle({ type: 'usage', input_tokens: 50, output_tokens: 5 });
		const last = [...c.messages].reverse().find((m) => m.kind === 'assistant') as { turn?: Record<string, number> };
		expect(last.turn).toMatchObject({ inTokens: 150, outTokens: 25, tools: 1, files: 0 });
		expect(last.turn!.ttft).toBeGreaterThanOrEqual(0);
	});
});

describe('reply timing', () => {
	it('splits a reply at its tool call, times each segment and the request stages', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(0);
			const c = new ChatState();
			const at = (ms: number, ev: Record<string, unknown>) => {
				vi.setSystemTime(ms);
				c.handle(ev as never);
			};
			at(0, { type: 'user_message', content: 'q' });
			at(0, { type: 'assistant_start' });
			at(0, { type: 'connecting' });
			expect(c.call).toEqual({ phase: 'connect', since: 0 });
			at(300, { type: 'thinking_start' });
			expect(c.call).toEqual({ phase: 'ttft', since: 300 });
			at(1000, { type: 'assistant_delta', delta: 'A' });
			expect(c.call).toEqual({ phase: 'output', since: 1000 });
			at(2000, { type: 'tool_start', call_id: 't', name: 'read' });
			expect(c.call).toBeNull();
			at(2500, { type: 'tool_output', call_id: 't', name: 'read', output: 'x' });
			at(2600, { type: 'connecting' });
			at(3000, { type: 'assistant_delta', delta: 'B' });
			at(4000, { type: 'status', message: 'ready' });

			const kinds = c.messages.map((m) => [m.kind, 'text' in m ? m.text : '']);
			// Text after the tool is its own message, below the tool card.
			expect(kinds).toEqual([['user', 'q'], ['assistant', 'A'], ['tool', ''], ['assistant', 'B']]);
			const [a, b] = c.messages.filter((m) => m.kind === 'assistant') as { segMs?: number; turn?: { segments: number; elapsed: number } }[];
			expect(a.segMs).toBe(2000);
			expect(b.segMs).toBe(1400);
			expect(b.turn).toMatchObject({ segments: 2, elapsed: 4000 });
			expect(c.call).toBeNull();
			expect(c.runMs).toBe(4000);
		} finally {
			vi.useRealTimers();
		}
	});

	it('times the wait to the first token from the request on engines without a connect event', () => {
		vi.useFakeTimers();
		try {
			vi.setSystemTime(100);
			const c = new ChatState();
			c.backendId = 'claude';
			c.handle({ type: 'connecting' } as never);
			expect(c.call).toEqual({ phase: 'ttft', since: 100 });
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('claude session extras', () => {
	it('lists background tasks with their progress and announces finished ones', () => {
		setLocale('zh');
		const c = new ChatState();
		c.handle({ type: 'background_tasks', tasks: [{ id: 'w1', kind: 'local_workflow', description: 'Review' }] });
		c.handle({ type: 'task_progress', task_id: 'w1', message: 'Find: bugs-0' });
		expect(c.bgTasks).toEqual([{ id: 'w1', kind: 'local_workflow', description: 'Review', message: 'Find: bugs-0' }]);
		// A new listing keeps a task's latest progress line.
		c.handle({ type: 'background_tasks', tasks: [{ id: 'w1', kind: 'local_workflow', description: 'Review' }] });
		expect(c.bgTasks[0].message).toBe('Find: bugs-0');
		c.handle({ type: 'background_tasks', tasks: [] });
		c.handle({ type: 'task_done', task_id: 'w1', kind: 'local_workflow', status: 'completed', summary: 'Review done' });
		expect(c.bgTasks).toEqual([]);
		expect(c.messages.at(-1)).toEqual({ kind: 'system', text: '多智能体编排已完成：Review done' });
		c.handle({ type: 'task_output', task_id: 'b1', output: 'ok', truncated: true });
		expect(c.taskOutputs.b1).toEqual({ output: 'ok', truncated: true, error: '' });
	});

	it('fills a pending /btw answer in place', () => {
		const c = new ChatState();
		c.sideAnswers.push({ question: 'why?', answer: '', error: '', pending: true });
		c.handle({ type: 'side_answer', question: 'why?', answer: 'Because.' });
		expect(c.sideAnswers).toEqual([{ question: 'why?', answer: 'Because.', error: '', pending: false }]);
		// The conversation is untouched.
		expect(c.messages).toEqual([]);
	});

	it('keeps a suggestion until the next turn starts', () => {
		const c = new ChatState();
		c.handle({ type: 'prompt_suggestion', text: 'run the tests' });
		expect(c.suggestion).toBe('run the tests');
		c.handle({ type: 'connecting' });
		expect(c.suggestion).toBe('');
	});

	it('names fallbacks, subagents and session switches', () => {
		setLocale('zh');
		const c = new ChatState();
		c.handle({ type: 'model_fallback', from: 'Opus 5.5', to: 'Sonnet 5.5', reason: 'overloaded' });
		expect(c.messages.at(-1)).toEqual({ kind: 'system', text: '模型已从 Opus 5.5 切换到 Sonnet 5.5（原模型过载）' });
		c.handle({ type: 'subagent_lifecycle', path: 'a1', label: 'Scan auth', status: 'running', message: 'Reading' });
		expect(c.subagents.a1).toMatchObject({ status: 'running', message: 'Reading', label: 'Scan auth' });
		c.handle({ type: 'tool_start', call_id: 't2', name: 'read', subagent: 'Scan auth' });
		expect(c.messages.at(-1)).toMatchObject({ kind: 'tool', subagent: 'Scan auth' });
		expect(c.subagentLastTool['Scan auth']).toMatchObject({ callId: 't2', name: 'read' });
		// A finished subagent stays (the subagents card shows it) until the next turn.
		c.handle({ type: 'subagent_lifecycle', path: 'a1', label: 'Scan auth', status: 'completed', message: '' });
		expect(c.subagents.a1).toMatchObject({ status: 'completed', label: 'Scan auth' });
		expect(c.subagents.a1.endedAt).toBeGreaterThan(0);
		c.handle({ type: 'connecting' });
		expect(c.subagents.a1).toBeUndefined();
		c.handle({ type: 'model_status', model: 'claude-opus-5-5', fast: true, fast_available: true, thinking_summaries: false, state: 'idle' });
		expect([c.fast, c.fastAvailable, c.thinkingSummaries]).toEqual([true, true, false]);
		c.handle({ type: 'model_status', model: 'gpt-5.5', state: 'idle' });
		expect([c.fast, c.fastAvailable, c.thinkingSummaries]).toEqual([false, false, null]);
	});

	it('reads the agent trace and a subagent conversation', () => {
		const c = new ChatState();
		c.handle({
			type: 'agent_runs',
			workflows: [
				{
					id: 'w1',
					tool_use_id: 't0',
					name: 'review',
					status: 'running',
					started_at: 100,
					tokens: 900,
					phases: [{ index: 1, title: 'Find' }],
					agents: [{ id: 'a1', label: 'bugs-0', phase: 1, state: 'running', started_at: 120, tokens: 900, tool_calls: 2 }]
				}
			],
			agents: [{ id: 'a9', label: 'Read a.txt', status: 'completed', tool_use_id: 't1', tokens: 30420, duration_ms: 4529 }]
		});
		expect(c.agentRuns.workflows[0].agents[0]).toMatchObject({ id: 'a1', phase: 1, state: 'running', toolCalls: 2 });
		expect(c.agentRuns.agents[0]).toMatchObject({ id: 'a9', state: 'completed', toolUseId: 't1', durationMs: 4529 });
		c.handle({
			type: 'subagent_transcript',
			agent_id: 'a1',
			items: [
				{ role: 'user', content: 'Find bugs' },
				{ role: 'reasoning', content: 'Look.' },
				{ role: 'tool', call_id: 't2', name: 'read', output: '{"path":"/a"}', running: false, is_error: false },
				{ role: 'assistant', content: 'None.' }
			]
		});
		const tr = c.subagentTranscripts.a1;
		expect(tr.task).toBe('Find bugs');
		expect(tr.messages.map((m) => m.kind)).toEqual(['reasoning', 'tool', 'assistant']);
		// The session's own conversation is untouched.
		expect(c.messages).toEqual([]);
	});

	it('keeps a subagent call’s arguments once its result replaces them', () => {
		const c = new ChatState();
		c.handle({ type: 'tool_start', call_id: 't1', name: 'Task' });
		c.handle({ type: 'tool_update', call_id: 't1', output: '{"description":"Scan auth","prompt":"Find it"}' });
		c.handle({ type: 'tool_output', call_id: 't1', name: 'Task', output: 'Found it in auth.ts', is_error: false });
		expect(c.messages.at(-1)).toMatchObject({ output: 'Found it in auth.ts', args: '{"description":"Scan auth","prompt":"Find it"}' });
	});

	it('reads a LynShen subagent from its spawn call and its lifecycle', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		c.handle({ type: 'tool_start', call_id: 'call_1', name: 'spawn_agent' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'pending', message: 'reserved' });
		c.handle({ type: 'tool_output', call_id: 'call_1', name: 'spawn_agent', output: '{"task_name":"scan","path":"/root/scan","status":"running"}', is_error: false });
		expect(c.subagents['/root/scan']).toMatchObject({ status: 'pending', label: 'scan', toolUseId: 'call_1' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'running', message: 'started', model: 'gpt-5.5' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'message', message: 'queued message' });
		expect(c.subagents['/root/scan']).toMatchObject({ status: 'running', model: 'gpt-5.5', toolUseId: 'call_1' });
		c.handle({ type: 'subagent_lifecycle', path: '/root/scan', status: 'errored', message: 'timeout' });
		expect(c.subagents['/root/scan'].endedAt).toBeGreaterThan(0);
	});

	it('reads the native agent trace’s activity and effort, and tool inputs in a transcript', () => {
		const c = new ChatState();
		c.handle({ type: 'agent_runs', workflows: [], agents: [{ id: '/root/x', label: 'x', state: 'running', activity: 'Ran cargo test', effort: 'low', tool_use_id: 'c9' }] });
		expect(c.agentRunsSeen).toBe(true);
		expect(c.agentRuns.agents[0]).toMatchObject({ state: 'running', activity: 'Ran cargo test', effort: 'low', toolUseId: 'c9' });
		c.handle({ type: 'subagent_transcript', agent_id: '/root/x', items: [{ role: 'user', content: 'go' }, { role: 'tool', call_id: 't', name: 'bash', input: { command: 'ls' }, running: true }] });
		expect(c.subagentTranscripts['/root/x'].messages[0]).toMatchObject({ kind: 'tool', output: '{"command":"ls"}', running: true });
	});

	it('takes an older engine’s refusal of the trace ops quietly', () => {
		setLocale('zh');
		const c = new ChatState();
		c.agentFocus = '/root/x';
		c.handle({ type: 'error', message: 'unknown op: agent_runs' });
		c.handle({ type: 'error', message: 'unknown op: subagent_transcript' });
		expect(c.messages).toEqual([]);
		expect(c.lastError).toBeNull();
		expect(c.subagentTranscripts['/root/x'].error).toBeTruthy();
	});

	it('shows a proposed plan and follows its status', () => {
		const c = new ChatState();
		c.handle({ type: 'proposed_plan', id: 'p1', title: 'Fix auth', markdown: '## Steps\n1. a', status: 'pending' });
		expect(c.messages.at(-1)).toEqual({ kind: 'plan', id: 'p1', title: 'Fix auth', text: '## Steps\n1. a', status: 'pending' });
		c.planRevising = 'p1';
		c.handle({ type: 'proposed_plan', id: 'p1', title: 'Fix auth', markdown: '## Steps\n1. a', status: 'revising' });
		expect(c.messages).toHaveLength(1);
		expect(c.messages[0]).toMatchObject({ status: 'revising' });
		expect(c.planRevising).toBeNull();
		c.handle({ type: 'proposed_plan', id: 'p2', title: 'Fix auth v2', markdown: 'x', status: 'odd' });
		expect(c.messages.at(-1)).toMatchObject({ id: 'p2', status: 'pending' });
		c.handle({ type: 'transcript', items: [{ role: 'plan', id: 'p2', title: 'T', content: 'body', status: 'approved' }] });
		expect(c.messages).toEqual([{ kind: 'plan', id: 'p2', title: 'T', text: 'body', status: 'approved' }]);
	});

	it('grows one plan while the model writes it, and completes it in place', () => {
		const c = new ChatState();
		c.handle({ type: 'plan_draft', id: 'p1', title: 'Sna', append: '' });
		c.handle({ type: 'plan_draft', id: 'p1', title: 'Snake', append: '## Go' });
		c.handle({ type: 'plan_draft', id: 'p1', title: 'Snake', append: 'al' });
		expect(c.messages).toEqual([{ kind: 'plan', id: 'p1', title: 'Snake', text: '## Goal', status: 'drafting' }]);
		const draft = c.messages[0];
		c.handle({ type: 'proposed_plan', id: 'p1', title: 'Snake', markdown: '## Goal\n1. a', status: 'pending' });
		expect(c.messages).toHaveLength(1);
		expect(c.messages[0]).toBe(draft);
		expect(c.messages[0]).toMatchObject({ text: '## Goal\n1. a', status: 'pending' });
	});

	it('drops a plan still being drafted when the request is retried', () => {
		const c = new ChatState();
		c.handle({ type: 'proposed_plan', id: 'p0', title: 'Old', markdown: 'x', status: 'pending' });
		c.handle({ type: 'plan_draft', id: 'p1', title: 'Snake', append: '## Go' });
		c.handle({ type: 'assistant_delta', delta: 'and' });
		c.handle({ type: 'retrying', attempt: 1, max_attempts: 3, reason: 'timeout', delay_ms: 500 });
		expect(c.messages).toEqual([{ kind: 'plan', id: 'p0', title: 'Old', text: 'x', status: 'pending' }]);
		c.handle({ type: 'plan_draft', id: 'p1', title: 'Snake', append: '## Goal' });
		expect(c.messages.at(-1)).toMatchObject({ id: 'p1', text: '## Goal', status: 'drafting' });
		expect(c.messages).toHaveLength(2);
	});

	it('remembers the mode before plan mode and when the plan changed', () => {
		const c = new ChatState();
		c.setApprovalMode('edits');
		c.setApprovalMode('plan');
		c.setApprovalMode('plan');
		expect(c.modeBeforePlan).toBe('edits');
		c.handle({ type: 'plan', plan: [{ step: 'a', status: 'pending' }] });
		const at = c.planAt;
		expect(at).toBeGreaterThan(0);
		c.handle({ type: 'connecting' });
		expect(c.turnStartedAt).toBeGreaterThan(0);
		c.handle({ type: 'status', message: 'ready' });
		expect(c.turnEndedAt).toBeGreaterThanOrEqual(c.turnStartedAt);
	});

	it('shows the images a message was sent with, live and in a transcript', () => {
		const c = new ChatState();
		c.handle({ type: 'user_message', content: 'look', images: ['/u/a.png'] });
		expect(c.messages.at(-1)).toEqual({ kind: 'user', text: 'look', images: ['/u/a.png'] });
		c.handle({ type: 'transcript', items: [{ role: 'user', content: 'look', images: ['/u/a.png'] }, { role: 'user', content: 'plain' }] });
		expect(c.messages).toEqual([
			{ kind: 'user', text: 'look', images: ['/u/a.png'] },
			{ kind: 'user', text: 'plain' }
		]);
	});

	it('keeps an elicitation page with its approval', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_request', call_id: 'a', name: 'mcp_elicitation', summary: 'jira: sign in', url: 'https://x.test/auth', hunks: null });
		expect(c.pendingApproval?.url).toBe('https://x.test/auth');
	});
});


describe('gateway session costs', () => {
	it('uses settled per-turn charges, including group changes, without repricing history', () => {
		const c = new ChatState();
		for (const id of ['t-first', 't-second']) {
			c.handle({ type: 'user_message', content: id });
			c.handle({ type: 'connecting' });
			c.handle({ type: 'assistant_delta', delta: 'answer' });
			c.handle({ type: 'usage', input_tokens: 1000, output_tokens: 500, billing_turn: id, billing_gateway: true });
			c.handle({ type: 'context_usage', tokens: 1500, cost: 9 });
			c.handle({ type: 'status', message: 'ready' });
		}
		const charge = (gateway_cost: number) => ({ gateway_cost, estimated_cost_usd: null, gateway_requests: 1, pending_requests: 0, unpriced_requests: 0 });
		const snapshot = { type: 'session_usage', totals: { ...charge(0.08), gateway_requests: 2 }, turns: [
			{ ...charge(0.05), turn_id: 't-first' }, { ...charge(0.03), turn_id: 't-second' }
		] };
		c.handle(snapshot);
		c.handle(snapshot); // refresh replaces, never adds or multiplies again
		expect(c.billing?.gateway_cost).toBe(0.08);
		const costs = c.messages.flatMap(m => m.kind === 'assistant' && m.turn ? [m.turn.billing?.gateway_cost] : []);
		expect(costs).toEqual([0.05, 0.03]);
		c.handle({ type: 'session_usage', billing_error: 'offline' });
		expect(c.billing?.gateway_cost).toBe(0.08);
		expect(c.billingError).toBe('offline');
	});

	it('marks gateway usage pending before settlement and accepts a zero charge', () => {
		const c = new ChatState();
		c.handle({ type: 'connecting' });
		c.handle({ type: 'assistant_delta', delta: 'answer' });
		c.handle({ type: 'status', message: 'ready' });
		// A late usage frame still belongs to the turn which just ended.
		c.handle({ type: 'usage', input_tokens: 10, output_tokens: 2, billing_turn: 't-free', billing_gateway: true });
		expect(c.billing?.pending_requests).toBeGreaterThan(0);
		const free = { gateway_cost: 0, estimated_cost_usd: null, gateway_requests: 1, pending_requests: 0, unpriced_requests: 0 };
		c.handle({ type: 'session_usage', totals: free, turns: [{ ...free, turn_id: 't-free' }] });
		expect(c.billing?.gateway_cost).toBe(0);
		const last = c.messages.at(-1);
		expect(last?.kind === 'assistant' && last.turn?.billing?.gateway_cost).toBe(0);
	});
});

import { boundedOutput } from './chat.svelte';
describe('boundedOutput', () => {
	it('keeps a short output, cuts a long one to its head and tail', () => {
		expect(boundedOutput('ok')).toBe('ok');
		const long = 'a'.repeat(50_000) + 'MIDDLE' + 'z'.repeat(50_000);
		const out = boundedOutput(long);
		expect(out.length).toBeLessThan(70_000);
		expect(out.startsWith('aaa')).toBe(true);
		expect(out.endsWith('zzz')).toBe(true);
		expect(out).toContain('characters not shown');
	});
	it('keeps JSON parseable and an image whole', () => {
		const json = JSON.stringify({ stdout: 'x'.repeat(200_000), exit_code: 0 });
		const out = JSON.parse(boundedOutput(json));
		expect(out.exit_code).toBe(0);
		expect(out.stdout.length).toBeLessThan(40_000);
		const image = JSON.stringify({ kind: 'image', base64: 'A'.repeat(300_000) });
		expect(JSON.parse(boundedOutput(image)).base64.length).toBe(300_000);
	});
});

import { merged, refilled, replayShows } from './chat.svelte';
describe('letting go of tool outputs while hidden', () => {
	/** A conversation run live here: a turn with a reasoning block, a tool
	 *  call and its stats, then the engine idle. */
	const live = () => {
		const c = new ChatState();
		c.optimisticUser('fix it');
		c.handle({ type: 'user_message', content: 'fix it' });
		c.handle({ type: 'connecting' });
		c.handle({ type: 'reasoning_delta', delta: 'think' });
		c.handle({ type: 'assistant_delta', delta: 'looking' });
		c.handle({ type: 'tool_start', call_id: 'c1', name: 'read_file' });
		c.handle({ type: 'tool_output', call_id: 'c1', name: 'read_file', output: 'file body' });
		c.handle({ type: 'assistant_delta', delta: 'done' });
		c.handle({ type: 'status', message: 'ready' });
		c.handle({ type: 'model_status', state: 'ready', model: 'm', provider: 'p' });
		return c;
	};
	const replay = (output = 'file body') => ({
		type: 'transcript',
		items: [
			{ role: 'user', content: 'fix it' },
			{ role: 'assistant', content: 'looking' },
			{ role: 'tool', name: 'read_file', output },
			{ role: 'assistant', content: 'done' }
		] as Record<string, unknown>[]
	});
	/** Released, then shown again: the snapshot of its session follows. */
	const reshow = (c: ChatState, snapshot: { type: string; items: Record<string, unknown>[] }) => {
		c.armRefill();
		c.handle(snapshot);
	};
	type Tool = { output: string; name: string; callId: string; isError: boolean; cut?: boolean; released?: string };
	const tools = (c: ChatState) => c.messages.filter((m) => m.kind === 'tool') as Tool[];
	const tool = (c: ChatState) => tools(c)[0]!;
	const stats = (c: ChatState) => c.messages.findLast((m) => m.kind === 'assistant' && !!m.turn);
	const reasoning = (c: ChatState) => c.messages.some((m) => m.kind === 'reasoning');
	/** One more live turn. */
	const turn = (c: ChatState, text: string, events: Record<string, unknown>[]) => {
		c.handle({ type: 'user_message', content: text });
		c.handle({ type: 'connecting' });
		for (const ev of events) c.handle(ev as never);
		c.handle({ type: 'status', message: 'ready' });
		c.handle({ type: 'model_status', state: 'ready' });
	};

	it('is settled only when nothing is under way', () => {
		const c = live();
		expect(c.settled).toBe(true);
		c.handle({ type: 'connecting' });
		expect(c.settled).toBe(false);
		c.handle({ type: 'status', message: 'ready' });
		c.handle({ type: 'model_status', state: 'ready' });
		expect(c.settled).toBe(true);
		c.optimisticUser('next');
		expect(c.settled).toBe(false);
	});

	it('is not settled while the conversation is open in a TUI', () => {
		const c = live();
		c.handle({ type: 'surface', surface: 'tui' });
		expect(c.settled).toBe(false);
		c.handle({ type: 'surface', surface: 'gui' });
		expect(c.settled).toBe(true);
	});

	it('empties the tool outputs and fills them back in from the same conversation', () => {
		const c = live();
		tool(c).isError = true;
		const turnStats = stats(c);
		expect(turnStats).toBeTruthy();
		c.releaseOutputs();
		expect(tool(c).output).toBe('');
		expect(reasoning(c)).toBe(true);
		reshow(c, replay());
		expect(tool(c).output).toBe('file body');
		expect(tool(c).released).toBeUndefined();
		// What only this chat knew stays: the reasoning, the turn's stats, the
		// call's id (a subagent card's link) and its error.
		expect(reasoning(c)).toBe(true);
		expect(stats(c)).toBe(turnStats);
		expect(tool(c)).toMatchObject({ callId: 'c1', isError: true });
	});

	it('keeps the turns it shares with a conversation that moved on, and shows the new ones', () => {
		const c = live();
		const before = stats(c);
		const kept = before?.kind === 'assistant' ? before.turn : undefined;
		c.releaseOutputs();
		// Closed by the daemon while hidden, then continued on another client.
		const moved = replay();
		moved.items.push({ role: 'user', content: 'more' }, { role: 'tool', name: 'bash', output: 'ok' }, { role: 'assistant', content: 'fine' });
		reshow(c, moved);
		expect(c.messages.map((m) => m.kind)).toEqual(['user', 'reasoning', 'assistant', 'tool', 'assistant', 'user', 'tool', 'assistant']);
		expect(tools(c).map((m) => m.output)).toEqual(['file body', 'ok']);
		expect(tool(c).callId).toBe('c1');
		const first = c.messages[4];
		expect(first?.kind === 'assistant' && first.turn).toEqual(kept);
		const last = c.messages[7];
		expect(last?.kind === 'assistant' && last.turn).toBeFalsy();
	});

	it('shows the replay from where a conversation rewound elsewhere differs, never another output in a card', () => {
		const c = live();
		c.releaseOutputs();
		const rewound = replay('other body');
		rewound.items[0] = { role: 'user', content: 'fix it differently' };
		reshow(c, rewound);
		expect(reasoning(c)).toBe(false);
		expect(tool(c).output).toBe('other body');
		expect(userTexts(c)).toEqual(['fix it differently']);
		// The same message and call, another output: not this card's.
		const other = live();
		other.releaseOutputs();
		reshow(other, replay('other body'));
		expect(tool(other).output).toBe('other body');
		expect(reasoning(other)).toBe(false);
		const changed = live();
		changed.releaseOutputs();
		const reply = replay();
		reply.items[1] = { role: 'assistant', content: 'looking elsewhere' };
		reshow(changed, reply);
		expect(reasoning(changed)).toBe(false);
	});

	it('keeps the turns before the one that differs', () => {
		const c = live();
		turn(c, 'second', [
			{ type: 'reasoning_delta', delta: 'hmm' },
			{ type: 'tool_start', call_id: 'c2', name: 'bash' },
			{ type: 'tool_output', call_id: 'c2', name: 'bash', output: 'v1' },
			{ type: 'assistant_delta', delta: 'ran it' }
		]);
		c.releaseOutputs();
		const rewound = replay();
		rewound.items.push({ role: 'user', content: 'second, again' }, { role: 'assistant', content: 'sure' });
		reshow(c, rewound);
		expect(userTexts(c)).toEqual(['fix it', 'second, again']);
		expect(c.messages.filter((m) => m.kind === 'reasoning').map((m) => m.text)).toEqual(['think']);
		expect(tools(c).map((m) => [m.callId, m.output])).toEqual([['c1', 'file body']]);
	});

	it('fills in a conversation whose message was sent while a turn ran', () => {
		const c = live();
		// Sent mid-turn: the bubble shows before the reply it waited behind.
		c.messages.splice(1, 0, { kind: 'user', text: 'and then this' });
		c.messages.push({ kind: 'assistant', text: 'user said: and then this' });
		c.releaseOutputs();
		const queued = replay();
		queued.items.push({ role: 'user', content: 'and then this' }, { role: 'assistant', content: 'user said: and then this' });
		reshow(c, queued);
		expect(tool(c).output).toBe('file body');
		expect(reasoning(c)).toBe(true);
	});

	it('fills in a reply and a call the engine never kept, a blank segment, a command and an image', () => {
		const c = live();
		// A command shows as typed; the engine keeps its expanded text.
		turn(c, '/review src', [
			{ type: 'assistant_delta', delta: '  \n' },
			{ type: 'tool_start', call_id: 'c2', name: 'grep' },
			{ type: 'tool_output', call_id: 'c2', name: 'grep', output: 'match' },
			{ type: 'assistant_delta', delta: 'reviewed' }
		]);
		// Stopped while a call ran and a reply streamed: the engine keeps neither.
		c.handle({ type: 'user_message', content: 'look again' });
		c.handle({ type: 'connecting' });
		c.handle({ type: 'tool_start', call_id: 'c3', name: 'bash' });
		c.handle({ type: 'tool_update', call_id: 'c3', name: 'bash', output: 'partial' });
		c.handle({ type: 'assistant_delta', delta: 'half a rep' });
		c.handle({ type: 'info', message: 'request interrupted' });
		c.handle({ type: 'status', message: 'interrupted' });
		c.handle({ type: 'model_status', state: 'ready' });
		// A message of images only: the engine keeps their names.
		c.messages.push({ kind: 'user', text: '', images: ['/tmp/shot.png'] }, { kind: 'assistant', text: 'a cat' });
		expect(c.settled).toBe(true);
		const cut = tools(c)[2]!;
		expect(cut).toMatchObject({ callId: 'c3', cut: true, output: 'partial' });
		c.releaseOutputs();
		// The call cut short is not let go of: the replay has nothing for it.
		expect(tools(c).map((m) => m.output)).toEqual(['', '', 'partial']);
		const snapshot = replay();
		snapshot.items.push(
			{ role: 'user', content: 'Review the code in src for bugs.' },
			{ role: 'tool', name: 'grep', output: 'match' },
			{ role: 'assistant', content: 'reviewed' },
			{ role: 'user', content: 'look again' },
			{ role: 'user', content: '[image: shot.png]' },
			{ role: 'assistant', content: 'a cat' }
		);
		const kinds = c.messages.map((m) => m.kind);
		reshow(c, snapshot);
		expect(c.messages.map((m) => m.kind)).toEqual(kinds);
		expect(tools(c).map((m) => [m.callId, m.output])).toEqual([
			['c1', 'file body'],
			['c2', 'match'],
			['c3', 'partial']
		]);
		expect(c.messages.some((m) => m.kind === 'system' && m.text === 'request interrupted')).toBe(true);
	});

	it('keeps an output the replay would cut, and fills in the rest', () => {
		const log = JSON.stringify({ command: 'make', stdout: 'line\n'.repeat(5_000), exit_code: 0 });
		const c = live();
		turn(c, 'build', [
			{ type: 'tool_start', call_id: 'c2', name: 'bash' },
			{ type: 'tool_output', call_id: 'c2', name: 'bash', output: log }
		]);
		c.releaseOutputs();
		expect(tools(c).map((m) => m.output)).toEqual(['', log]);
		const snapshot = replay();
		// The engine kept what the model saw: an excerpt and where the rest is.
		const excerpt = JSON.stringify({ command: 'make', stdout: 'line\n…', model_output_truncated: true, full_output_path: '/tmp/out' });
		snapshot.items.push({ role: 'user', content: 'build' }, { role: 'tool', name: 'bash', output: excerpt });
		reshow(c, snapshot);
		expect(tools(c).map((m) => m.output)).toEqual(['file body', log]);
		expect(reasoning(c)).toBe(true);
	});

	it('lets a read go, whose card shows only the file it read', () => {
		const read = JSON.stringify({ path: '/w/src/main.rs', content: 'fn main() {}\n'.repeat(400), hashlines: '1#ab|fn main() {}\n'.repeat(400) });
		const c = live();
		turn(c, 'read it', [
			{ type: 'tool_start', call_id: 'c2', name: 'read' },
			{ type: 'tool_output', call_id: 'c2', name: 'read', output: read }
		]);
		c.releaseOutputs();
		expect(tools(c)[1]!.output).toBe('');
		const snapshot = replay();
		const kept = JSON.stringify({ path: '/w/src/main.rs', hashlines: '1#ab|fn main() {}\n…', model_output_truncated: true });
		snapshot.items.push({ role: 'user', content: 'read it' }, { role: 'tool', name: 'read', output: kept });
		reshow(c, snapshot);
		expect(tools(c)[1]!.output).toBe(kept);
		expect(reasoning(c)).toBe(true);
	});

	it('tells which outputs the replay shows the same', () => {
		expect(replayShows('bash', JSON.stringify({ stdout: 'ok', exit_code: 0 }))).toBe(true);
		// Over 16 KB, as the engine counts it (UTF-8).
		expect(replayShows('bash', 'x'.repeat(16 * 1024))).toBe(true);
		expect(replayShows('bash', 'x'.repeat(16 * 1024 + 1))).toBe(false);
		expect(replayShows('bash', '日'.repeat(6_000))).toBe(false);
		// A diff over 8 KB.
		expect(replayShows('edit', JSON.stringify({ path: 'a', diff: '+x\n'.repeat(3_000) }))).toBe(false);
		expect(replayShows('edit', JSON.stringify({ path: 'a', diff: '+x\n'.repeat(100) }))).toBe(true);
		// A read keeps its file, its text goes; an image keeps its file.
		expect(replayShows('read', JSON.stringify({ path: 'a', content: 'x'.repeat(40_000), hashlines: 'y'.repeat(40_000) }))).toBe(true);
		expect(replayShows('read', JSON.stringify({ path: 'a.png', kind: 'image', base64: 'A'.repeat(100_000) }))).toBe(true);
		expect(replayShows('read', JSON.stringify({ path: 'a', entries: Array(4_000).fill('file.txt') }))).toBe(false);
	});

	it('fills in a turn that started while hidden, as it runs', () => {
		const started = () => {
			const c = live();
			c.releaseOutputs();
			// Another session's message starts a turn: its events still arrive.
			c.handle({ type: 'user_message', content: 'from elsewhere' });
			c.handle({ type: 'connecting' });
			c.handle({ type: 'tool_start', call_id: 'c2', name: 'grep' });
			c.handle({ type: 'tool_output', call_id: 'c2', name: 'grep', output: 'hit' });
			expect(c.settled).toBe(false);
			return c;
		};
		const snapshot = replay();
		snapshot.items.push({ role: 'user', content: 'from elsewhere' }, { role: 'tool', name: 'grep', output: 'hit' });
		// A call still running: the engine has no output for it yet.
		const running = started();
		running.handle({ type: 'tool_start', call_id: 'c3', name: 'bash' });
		reshow(running, snapshot);
		expect(tool(running).output).toBe('file body');
		running.handle({ type: 'tool_output', call_id: 'c3', name: 'bash', output: 'built' });
		expect(tools(running).map((m) => m.output)).toEqual(['file body', 'hit', 'built']);
		// A reply streaming: it goes on in the same message.
		const streaming = started();
		streaming.handle({ type: 'assistant_delta', delta: 'work' });
		reshow(streaming, snapshot);
		streaming.handle({ type: 'assistant_delta', delta: 'ing' });
		expect(streaming.messages.at(-1)).toMatchObject({ kind: 'assistant', text: 'working' });
		expect(reasoning(streaming)).toBe(true);
	});

	it('fills in only from the snapshot of a chat shown again, not a transcript sent while hidden', () => {
		const c = live();
		c.releaseOutputs();
		// The TUI on another client exits while this chat is hidden: every
		// chat replaces its messages with the replay.
		c.handle(replay());
		expect(reasoning(c)).toBe(false);
		expect(tool(c).output).toBe('file body');
		c.handle({ type: 'info', message: 'later note' });
		reshow(c, replay());
		expect(c.messages.some((m) => m.kind === 'system' && m.text === 'later note')).toBe(true);
		// Only the next transcript: the one after it replays as usual.
		c.handle(replay());
		expect(c.messages.some((m) => m.kind === 'system')).toBe(false);
	});

	it('replays as before when nothing was let go', () => {
		const c = live();
		c.armRefill();
		c.handle(replay());
		expect(reasoning(c)).toBe(false);
	});

	it('pairs the turns of the shown and the replayed conversation', () => {
		const shown = [
			{ kind: 'user', text: '/plan x' },
			{ kind: 'tool', callId: 'a', name: 'ls', output: '', running: false, isError: false, released: '3:0' }
		] as const;
		// A replayed call with another output does not fill the card.
		expect(refilled([...shown], [{ kind: 'user', text: 'expanded' }, { kind: 'tool', callId: '', name: 'ls', output: 'abc', running: false, isError: false }])).toBeNull();
		expect(merged([...shown], [{ kind: 'user', text: 'other' }])).toEqual([{ kind: 'user', text: 'other' }]);
	});

	it('keeps a long output of a replay to its head and tail, as a live one', () => {
		const c = new ChatState();
		c.handle(replay('x'.repeat(200_000)));
		expect(tool(c).output.length).toBeLessThan(70_000);
	});

	it('keeps a few subagent transcripts besides the one shown', () => {
		const c = new ChatState();
		c.agentFocus = 'a0';
		for (let i = 0; i < 8; i++)
			c.handle({ type: 'subagent_transcript', agent_id: `a${i}`, items: [{ role: 'user', content: 'task' }, { role: 'assistant', content: 'ok' }] });
		const ids = Object.keys(c.subagentTranscripts);
		expect(ids).toContain('a0');
		expect(ids).toContain('a7');
		expect(ids.length).toBeLessThanOrEqual(4);
	});
});

describe('ChatState: the LynShen sandbox', () => {
	it('starts a new LynShen session in 自动 and a claude one as before', () => {
		vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
		expect(new ChatState().approvalMode).toBe('auto');
		expect(new ChatState('lynshen').approvalMode).toBe('auto');
		expect(new ChatState('claude').approvalMode).toBe('ask');
		expect(new ChatState('claude').backendId).toBe('claude');
		vi.unstubAllGlobals();
	});

	it('keeps an approval request from an older engine as it was', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_request', call_id: 'c1', name: 'bash', summary: 'ls', subagent_id: null, hunks: null });
		expect(c.pendingApproval).toEqual({ callId: 'c1', name: 'bash', summary: 'ls', subagentId: null, hunks: null, questions: null });
		// codex's always-allow scopes stay codex's (the second request waits
		// behind the first)
		c.handle({ type: 'approval_request', call_id: 'c2', name: 'exec_command', summary: 'ls', scopes: ['session', 'rule'] });
		expect(c.pendingApprovals.at(-1)?.scopes).toEqual(['session', 'rule']);
		expect(c.pendingApprovals.at(-1)?.sandbox).toBeUndefined();
	});

	it('reads the sandbox fields of a request, not as codex scopes', () => {
		const c = new ChatState();
		c.handle({
			type: 'approval_request',
			call_id: 'c3',
			name: 'bash',
			summary: 'npm install -g pnpm',
			kind: 'escalation',
			must_ask: false,
			justification: 'install pnpm',
			cwd: '/w',
			command: 'npm install -g pnpm',
			paths: [],
			dir_suggestion: null,
			prefix: 'npm install',
			scopes: ['once', 'session', 'project'],
			elevation: null
		});
		expect(c.pendingApproval?.scopes).toBeUndefined();
		expect(c.pendingApproval?.sandbox).toMatchObject({ kind: 'escalation', prefix: 'npm install', scopes: ['once', 'session', 'project'] });
	});

	it('keeps the sandbox state and records crossings in the conversation', () => {
		const c = new ChatState();
		expect(c.sandbox).toBeNull();
		c.handle({ type: 'sandbox', mode: 'workspace-write', network: true, enforced: false, unavailable: null, directories: [] });
		expect(c.sandbox).toMatchObject({ mode: 'workspace-write', enforced: false });
		c.handle({ type: 'escalated', call_id: 'c4', kind: 'escalation', command: 'brew install jq', justification: 'needs jq', cwd: '/w', paths: [], by: 'mode' });
		const last = c.messages.at(-1);
		expect(last?.kind).toBe('escalation');
		if (last?.kind === 'escalation') expect(last.record).toMatchObject({ command: 'brew install jq', by: 'mode' });
	});

	it('keeps the reply style the engine says the conversation uses', () => {
		const c = new ChatState();
		expect(c.replyStyle).toBeNull();
		c.handle({ type: 'reply_style', style: 'concise', name: '简洁', source: 'builtin', chosen: true, missing: false });
		expect(c.replyStyle).toEqual({ style: 'concise', name: '简洁', source: 'builtin', chosen: true, missing: false });
		c.handle({ type: 'reply_style', style: 'terse', name: 'terse', source: 'missing', chosen: false, missing: true });
		expect(c.replyStyle).toMatchObject({ style: 'terse', source: 'missing', missing: true, chosen: false });
	});

	it('shows a crossing the transcript keeps', () => {
		const c = new ChatState();
		c.handle({ type: 'transcript', items: [{ role: 'user', content: '装 jq' }, { role: 'escalated', kind: 'escalation', command: 'brew install jq', by: 'classifier' }] });
		const last = c.messages.at(-1);
		expect(last?.kind === 'escalation' && last.record).toMatchObject({ command: 'brew install jq', by: 'classifier' });
	});

	it('says why a deferred action was asked', () => {
		setLocale('zh');
		const c = new ChatState();
		c.handle({ type: 'action_deferred', name: 'bash', summary: 'brew install jq', kind: 'escalation', justification: '需要 jq' });
		const last = c.messages.at(-1);
		expect(last?.kind === 'system' && last.text).toContain('原因：需要 jq');
	});

	it('brings a sandbox card back when the engine does not take the answer', () => {
		const c = new ChatState();
		const ask = {
			type: 'approval_request',
			call_id: 'w1',
			name: 'write',
			summary: '/Users/me/New/a.txt',
			kind: 'outside_write',
			command: null,
			paths: ['/Users/me/New/a.txt'],
			dir_suggestion: '/Users/me/New',
			scopes: ['once']
		};
		c.handle(ask);
		c.approvalAnswered();
		expect(c.pendingApproval).toBeNull();
		// add_dir named a directory that does not exist yet: the request waits
		c.handle({ type: 'error', message: 'not an existing absolute directory: /Users/me/New' });
		expect(c.pendingApproval?.callId).toBe('w1');
		expect(c.pendingApproval?.sandbox?.dirSuggestion).toBe('/Users/me/New');
		expect(c.lastError).toBeNull();
		expect(c.messages.at(-1)?.kind).toBe('system');
		// answered again and taken: the call runs; a later error is a failure as before
		c.approvalAnswered();
		c.handle({ type: 'tool_output', call_id: 'w1', output: 'ok' });
		c.handle({ type: 'error', message: 'not an existing absolute directory: /x' });
		expect(c.pendingApproval).toBeNull();
		expect(c.lastError).toBe('not an existing absolute directory: /x');
	});

	it('brings a sandbox card back when the engine will not make the directory writable', () => {
		const c = new ChatState();
		c.handle({
			type: 'approval_request',
			call_id: 'w2',
			name: 'write',
			summary: '/Users/me/a.txt',
			kind: 'outside_write',
			command: null,
			paths: ['/Users/me/x/a.txt'],
			dir_suggestion: '/Users/me/x',
			scopes: ['once']
		});
		c.approvalAnswered();
		c.handle({
			type: 'error',
			message:
				"/Users/me cannot be made writable: it is the root, the home directory or holds credentials or LynShen's settings"
		});
		expect(c.pendingApproval?.callId).toBe('w2');
		expect(c.lastError).toBeNull();
	});

	it('does not bring back an older engine card or one answered long ago', () => {
		const c = new ChatState();
		c.handle({ type: 'approval_request', call_id: 'o1', name: 'bash', summary: 'ls', subagent_id: null, hunks: null });
		c.approvalAnswered();
		c.handle({ type: 'error', message: 'call o1 can be allowed only once' });
		expect(c.pendingApproval).toBeNull();
		vi.useFakeTimers();
		try {
			c.handle({ type: 'approval_request', call_id: 's1', name: 'bash', kind: 'command', command: 'ls', scopes: ['once'] });
			c.approvalAnswered();
			vi.advanceTimersByTime(60_000);
			c.handle({ type: 'error', message: 'call s1 can be allowed only once' });
			expect(c.pendingApproval).toBeNull();
		} finally {
			vi.useRealTimers();
		}
	});

	it('takes an older engine refusing a sandbox op quietly', () => {
		const c = new ChatState();
		const before = c.messages.length;
		c.handle({ type: 'error', message: 'unknown op: set_sandbox' });
		c.handle({ type: 'error', message: 'unknown op: add_directory' });
		expect(c.messages.length).toBe(before);
		expect(c.lastError).toBeNull();
	});
});
