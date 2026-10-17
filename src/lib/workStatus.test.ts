import { describe, expect, it } from 'vitest';
import type { Msg } from '$lib/chat.svelte';
import { ChatState } from '$lib/chat.svelte';
import { workElapsed, workStep } from './workStatus';

const tool = (name: string, extra: Partial<Extract<Msg, { kind: 'tool' }>> = {}): Msg => ({
	kind: 'tool',
	callId: 'c1',
	name,
	output: '',
	running: true,
	isError: false,
	...extra
});

describe('workStep', () => {
	it('names nothing while nothing runs', () => {
		expect(workStep(null, null, [])).toBeNull();
		expect(workStep('steering', null, [])).toBeNull();
	});

	it('words the request stages: connecting, thinking, writing', () => {
		const since = 1000;
		expect(workStep('connecting', { phase: 'connect', since }, [])).toMatchObject({ verb: 'connecting', object: '', since, exact: false, call: null });
		expect(workStep('waiting', { phase: 'connect', since }, [])?.verb).toBe('connecting');
		expect(workStep('waiting', { phase: 'ttft', since }, [])?.verb).toBe('thinking');
		expect(workStep('waiting', null, [])).toMatchObject({ verb: 'thinking', since: null });
		expect(workStep('generating', { phase: 'output', since }, [{ kind: 'reasoning', text: 'x', collapsed: true }])?.verb).toBe('thinking');
		expect(workStep('generating', { phase: 'output', since }, [{ kind: 'assistant', text: 'x' }])?.verb).toBe('writing');
		expect(workStep('compacting', null, [])?.verb).toBe('compacting');
	});

	it('keeps one step while thinking moves from waiting to streaming, and a new one for the reply', () => {
		const a = workStep('waiting', { phase: 'ttft', since: 1 }, []);
		const b = workStep('generating', { phase: 'output', since: 2 }, [{ kind: 'reasoning', text: 'x', collapsed: true }]);
		const c = workStep('generating', { phase: 'output', since: 2 }, [{ kind: 'assistant', text: 'y' }]);
		expect(a?.key).toBe(b?.key);
		expect(c?.key).not.toBe(b?.key);
	});

	it('names a running call by its verb and object, from its start', () => {
		const read = tool('read', { output: JSON.stringify({ path: '/Users/me/code/app/src/lib/cache.ts' }), startedAt: 500 });
		expect(workStep('tool', null, [read])).toMatchObject({ verb: 'reading', object: 'cache.ts', since: 500, exact: true, call: read, key: 'tool:c1' });
		expect(workStep('tool', null, [tool('str_replace', { output: JSON.stringify({ path: '/a/b/session.svelte.ts' }) })])).toMatchObject({ verb: 'editing', object: 'session.svelte.ts' });
		expect(workStep('tool', null, [tool('apply_patch')])?.verb).toBe('editing');
		expect(workStep('tool', null, [tool('ripgrep', { output: JSON.stringify({ pattern: 'SessionCache' }) })])).toMatchObject({ verb: 'searching', object: 'SessionCache' });
		expect(workStep('tool', null, [tool('web_search', { output: JSON.stringify({ query: 'svelte flip' }) })])).toMatchObject({ verb: 'searchingWeb', object: 'svelte flip' });
		expect(workStep('tool', null, [tool('wait_agent')])?.verb).toBe('waitingAgents');
		expect(workStep('tool', null, [tool('browser_click')])?.verb).toBe('browser');
		expect(workStep('tool', null, [tool('mcp__linear__create_issue')])).toMatchObject({ verb: 'tool', object: 'create_issue' });
		expect(workStep('tool', null, [tool('frobnicate')])).toMatchObject({ verb: 'tool', object: 'frobnicate' });
	});

	it('keeps the command lynshen named as it started, under the output so far', () => {
		const bash = tool('bash', { output: 'running 3.0s\nstdout:\nok', target: 'pnpm vitest run' });
		expect(workStep('tool', null, [bash])).toMatchObject({ verb: 'running', object: 'pnpm vitest run' });
		// Claude's card names the command itself.
		expect(workStep('tool', null, [tool('bash', { output: JSON.stringify({ command: 'ls -la' }) })])?.object).toBe('ls -la');
	});
});

describe('the chat records what a running call acts on', () => {
	it('stamps the start and keeps the first command named', () => {
		const chat = new ChatState();
		const before = Date.now();
		chat.handle({ type: 'tool_start', call_id: 'b1', name: 'bash' } as never);
		chat.handle({ type: 'tool_update', call_id: 'b1', name: 'bash', output: 'started: pnpm vitest run src/lib' } as never);
		chat.handle({ type: 'tool_update', call_id: 'b1', name: 'bash', output: 'running 1.0s\nstdout:\n.' } as never);
		const m = chat.messages.at(-1) as Extract<Msg, { kind: 'tool' }>;
		expect(m.target).toBe('pnpm vitest run src/lib');
		expect(m.startedAt).toBeGreaterThanOrEqual(before);
		expect(m.output).toBe('running 1.0s\nstdout:\n.');
	});
});

describe('workElapsed', () => {
	it('shows whole seconds, then minutes', () => {
		expect(workElapsed(0)).toBe('0s');
		expect(workElapsed(24_900)).toBe('24s');
		expect(workElapsed(59_999)).toBe('59s');
		expect(workElapsed(65_000)).toBe('1m05s');
		expect(workElapsed(-5)).toBe('0s');
	});
});
