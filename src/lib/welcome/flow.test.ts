import { describe, expect, it } from 'vitest';
import { STEPS, accountProvider, agentNeeds, firstRunStart } from './flow';
import type { DepReport } from '$lib/protocol';
const dep = (id: string, present: boolean): DepReport => ({ id, present, detail: '', plan: { kind: 'run', program: '', args: [] } });

describe('first-run flow', () => {
	it('starts a new install at the sign-in, and never shows it again to a finished or signed-in one', () => {
		expect(firstRunStart(false, false)).toBe('login');
		// Signed in before (also stopped in the 0.7.0 walkthrough): ready, nothing shown.
		expect(firstRunStart(false, true)).toBe('done');
		// Finished before, signed in or not.
		expect(firstRunStart(true, false)).toBe('none');
		expect(firstRunStart(true, true)).toBe('none');
	});

	it('has no dependency step, and the account step first', () => {
		expect(STEPS).toEqual(['account', 'agent', 'model', 'appearance', 'basics']);
	});

	it('asks for tools only for the agent that needs them', () => {
		const newMac = [dep('node', false), dep('git', true), dep('lynshen', true), dep('claude', false), dep('codex', false)];
		// LynShen's engine ships with the app: nothing, not even Git.
		expect(agentNeeds('lynshen', newMac)).toEqual([]);
		expect(agentNeeds('lynshen', [dep('git', false), dep('node', false)])).toEqual([]);
		// Claude Code and Codex install with npm: Node first.
		expect(agentNeeds('claude', newMac)).toEqual(['node', 'claude']);
		expect(agentNeeds('codex', [dep('node', true), dep('codex', false)])).toEqual(['codex']);
		expect(agentNeeds('claude', [dep('node', false), dep('claude', true)])).toEqual([]);
		// Not known yet (the probe still runs): nothing to ask.
		expect(agentNeeds('claude', [])).toEqual([]);
		expect(agentNeeds('acp', newMac)).toEqual([]);
	});

	it('points the engine at the account only where its provider cannot run', () => {
		// A new computer: config.json names nothing, or the engine's default
		// LynShen provider without its own login.
		expect(accountProvider({}, ['monoize'])).toBe('monoize');
		expect(accountProvider({ provider: 'lynshen' }, ['monoize'])).toBe('monoize');
		expect(accountProvider({ provider: 'openai' }, ['monoize'])).toBe('monoize');
		// Already the account, or a provider with its own key or login.
		expect(accountProvider({ provider: 'monoize' }, ['monoize'])).toBeNull();
		expect(accountProvider({ provider: 'deepseek' }, ['monoize', 'deepseek'])).toBeNull();
		expect(accountProvider({ provider: 'lynshen' }, ['monoize', 'lynshen'])).toBeNull();
	});
});

describe('the greeting after the first run', () => {
	it('plays once, right after the first run ends in this start', async () => {
		const { greetingDue } = await import('./flow');
		expect(greetingDue(true, false)).toBe(true);
		expect(greetingDue(true, true)).toBe(false);
		// An install that finished the first run before (or a later start): never.
		expect(greetingDue(false, false)).toBe(false);
	});

	it('runs its phases in order, faster with reduced motion, and skips to the opening', async () => {
		const { GREETING_PHASES, GREETING_AT, GREETING_REDUCED_AT, greetingNext, greetingReached } = await import('./flow');
		for (const at of [GREETING_AT, GREETING_REDUCED_AT]) {
			const t = GREETING_PHASES.map((p) => at[p]);
			t.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(t[i]));
		}
		expect(GREETING_AT.done).toBeLessThanOrEqual(6000);
		expect(GREETING_REDUCED_AT.done).toBeLessThan(GREETING_AT.done);
		let p: (typeof GREETING_PHASES)[number] = 'light';
		const seen: (typeof GREETING_PHASES)[number][] = [p];
		while (p !== 'done') seen.push((p = greetingNext(p, 'tick')));
		expect(seen).toEqual([...GREETING_PHASES]);
		for (const q of GREETING_PHASES) expect(greetingNext(q, 'skip')).toBe(greetingReached(q, 'open') ? q : 'open');
	});
});
