import type { DepReport } from '$lib/protocol';
import type { BackendId } from '$lib/backends';

// The first run (the welcome page, Welcome.svelte):
//   1. Sign-in first: the LynShen account by device authorization. Signed
//      in, the app is ready: the LynShen engine on the account's models and
//      plan. Nothing else is asked.
//   2. 跳过，稍后登录: one optional page to pick another agent (Claude Code,
//      Codex) or an API key; 开始使用 always goes on.
//   Node, Git and the agents' own tools are asked for only where a feature
//   needs them (an agent that is not installed, the Git panel).
// The walkthrough (设置向导, from the command palette) is optional too: every
// step can be opened and skipped, and it closes at any time.

/** localStorage: the first run is over (signed in, or 开始使用 / 稍后设置). */
export const SETUP_DONE_KEY = 'lynshen-setup-done';

/** What a start shows: nothing (`none`), the sign-in (`login`), or nothing
 *  and the first run is recorded as over (`done`): an account signed in
 *  before this version never sees the welcome page again, also when it
 *  stopped in the walkthrough of 0.7.0. */
export function firstRunStart(setupDone: boolean, signedIn: boolean): 'none' | 'login' | 'done' {
	if (setupDone) return 'none';
	return signedIn ? 'done' : 'login';
}

export const STEPS = ['account', 'agent', 'model', 'appearance', 'basics'] as const;
export type StepKey = (typeof STEPS)[number];

/** The tools an agent needs that are missing, in install order: Claude Code
 *  and Codex install with npm (Node first); LynShen's engine ships with the
 *  app. Empty when the agent is there (or the tools are not known yet). */
export function agentNeeds(backend: BackendId, list: DepReport[]): string[] {
	if (backend !== 'claude' && backend !== 'codex') return [];
	const present = (id: string) => list.some((d) => d.id === id && d.present);
	const known = (id: string) => list.some((d) => d.id === id);
	if (!known(backend) || present(backend)) return [];
	return [...(known('node') && !present('node') ? ['node'] : []), backend];
}

/** The engine's provider after a first sign-in: the account's gateway
 *  (`monoize`) when the provider in config.json cannot run (none set, or one
 *  without a key or login on this computer); null to leave it. */
export function accountProvider(cfg: Record<string, unknown>, signedInProviders: string[]): 'monoize' | null {
	const current = typeof cfg.provider === 'string' ? cfg.provider : '';
	if (current === 'monoize') return null;
	if (current && signedInProviders.includes(current)) return null;
	return 'monoize';
}
