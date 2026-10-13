import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The app's trial runner (trial.svelte.ts) against a stand-in gateway: when it
// asks, how often, and what it then shows.
const gateway = vi.hoisted(() => ({
	replies: [] as (unknown | { fail: { status: number | null; code: string | null } })[],
	user: { id: 'user-1', username: 'Ann', role: 'user' } as { id: string; username: string; role: string } | null,
	/** GET /api/desktop/oauth/plan: the body, or a failure (default: a gateway without it). */
	plan: { fail: { status: 404, code: null } } as unknown,
	funding: [] as string[]
}));
const answer = (v: unknown) => {
	if (v && typeof v === 'object' && 'fail' in v) throw Object.assign(new Error('refused'), (v as { fail: object }).fail);
	return v;
};

vi.mock('$lib/protocol', () => ({
	desktopInstallationId: vi.fn(async () => 'inst-1'),
	monoizeSession: vi.fn(async () => (gateway.user ? { logged_in: true, session: { user: gateway.user } } : { logged_in: false })),
	claimTrial: vi.fn(async () => {
		const next = gateway.replies.shift();
		if (next && typeof next === 'object' && 'fail' in next) throw Object.assign(new Error('refused'), next.fail);
		if (next === undefined) throw Object.assign(new Error('unreachable'), { status: null, code: null });
		return next;
	}),
	fetchDesktopPlan: vi.fn(async () => answer(gateway.plan)),
	setPlanFunding: vi.fn(async (funding: string) => {
		gateway.funding.push(funding);
		const body = answer(gateway.plan) as { plan: unknown };
		return { ...body, plan_funding: funding };
	})
}));

const PLAN = {
	name: '7 天体验套餐',
	group: '国内模型分组',
	windows: [
		{ kind: '5h', quota_cny: '4.00', used_cny: '0.00', resets_at: null },
		{ kind: '7d', quota_cny: '10.00', used_cny: '0.00', resets_at: null }
	],
	expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString()
};
const network = { fail: { status: null, code: null } };

async function fresh() {
	vi.resetModules();
	const protocol = await import('$lib/protocol');
	const { trial } = await import('./trial.svelte');
	return { trial, claimTrial: vi.mocked(protocol.claimTrial) };
}

beforeEach(() => {
	const data = new Map<string, string>();
	vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) });
	vi.useFakeTimers();
	gateway.replies = [];
	gateway.user = { id: 'user-1', username: 'Ann', role: 'user' };
	gateway.plan = { fail: { status: 404, code: null } };
	gateway.funding = [];
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('the trial runner', () => {
	it('claims after the sign-in, shows the card once and keeps the plan', async () => {
		const { trial, claimTrial } = await fresh();
		gateway.replies = [{ status: 'granted', plan: PLAN }];
		await trial.signedIn();
		expect(trial.grant).toEqual(PLAN);
		expect(trial.plan).toEqual(PLAN);
		trial.acknowledge();
		expect(trial.grant).toBeNull();
		expect(trial.plan).toEqual(PLAN);
		// Later starts and sign-ins do not ask again.
		await trial.signedIn();
		const again = await fresh();
		await again.trial.signedIn();
		expect(again.trial.grant).toBeNull();
		expect(again.trial.plan).toEqual(PLAN);
		// One request in all (the restarted module may get the same mock).
		const all = new Set([...claimTrial.mock.invocationCallOrder, ...again.claimTrial.mock.invocationCallOrder]);
		expect(all.size).toBe(1);
	});

	it('a switched-off trial or an older gateway (404) shows nothing; only a sign-in hours later asks again', async () => {
		const { trial, claimTrial } = await fresh();
		gateway.replies = [{ fail: { status: 404, code: null } }, { status: 'disabled' }, { status: 'granted', plan: PLAN }];
		await trial.signedIn();
		expect(trial.grant).toBeNull();
		expect(trial.plan).toBeNull();
		// No timer asks again.
		await vi.advanceTimersByTimeAsync(24 * 3_600_000);
		expect(claimTrial).toHaveBeenCalledTimes(1);
		// A later sign-in (or start) does: still switched off, then on.
		await trial.signedIn();
		expect(claimTrial).toHaveBeenCalledTimes(2);
		await trial.signedIn();
		expect(claimTrial).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(6 * 3_600_000);
		await trial.signedIn();
		expect(claimTrial).toHaveBeenCalledTimes(3);
		expect(trial.grant).toEqual(PLAN);
	});

	it('shows the plan as the gateway has it now, with the funding choice', async () => {
		const { trial } = await fresh();
		const live = { ...PLAN, windows: [{ ...PLAN.windows[0], used_cny: '1.50' }, PLAN.windows[1]], active: true, trial: true };
		gateway.plan = { plan: live, plan_funding: 'plan' };
		gateway.replies = [{ status: 'granted', plan: PLAN }];
		await trial.signedIn();
		await vi.advanceTimersByTimeAsync(0);
		expect(trial.plan).toEqual(live);
		expect(trial.funding).toBe('plan');
		// A payer switches to the balance.
		expect(await trial.setFunding('balance')).toBe('');
		expect(gateway.funding).toEqual(['balance']);
		expect(trial.funding).toBe('balance');
		// A refused change keeps the choice in force and says why.
		gateway.plan = { fail: { status: 503, code: null } };
		expect(await trial.setFunding('plan')).toBe('refused');
		expect(trial.funding).toBe('balance');
		// The gateway says the plan ended: nothing shows, whatever the claim said.
		gateway.plan = { plan: null, plan_funding: 'balance' };
		await trial.refreshStatus();
		expect(trial.plan).toBeNull();
		expect(trial.funding).toBeNull();
		trial.signedOut();
		expect(trial.status).toBeNull();
	});

	it('keeps the claim plan when the gateway has no plan endpoint, and no choice', async () => {
		const { trial } = await fresh();
		gateway.replies = [{ status: 'granted', plan: PLAN }];
		await trial.signedIn();
		await vi.advanceTimersByTimeAsync(0);
		expect(trial.plan).toEqual(PLAN);
		expect(trial.funding).toBeNull();
	});

	it('retries after a network failure, a bounded number of times', async () => {
		const { trial, claimTrial } = await fresh();
		gateway.replies = [network, network, { status: 'granted', plan: PLAN }];
		await trial.signedIn();
		expect(claimTrial).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(30_000);
		expect(claimTrial).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(120_000);
		expect(claimTrial).toHaveBeenCalledTimes(3);
		expect(trial.grant).toEqual(PLAN);
		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(claimTrial).toHaveBeenCalledTimes(3);
	});

	it('stops retrying after the last delay; the next sign-in asks again', async () => {
		const { trial, claimTrial } = await fresh();
		gateway.replies = [network, network, network, network, { status: 'not_eligible' }];
		await trial.signedIn();
		await vi.advanceTimersByTimeAsync(24 * 3_600_000);
		expect(claimTrial).toHaveBeenCalledTimes(4);
		await trial.signedIn();
		expect(claimTrial).toHaveBeenCalledTimes(5);
		await trial.signedIn();
		expect(claimTrial).toHaveBeenCalledTimes(5);
	});

	it('signing out cancels a pending retry and clears the plan', async () => {
		const { trial, claimTrial } = await fresh();
		gateway.replies = [network, { status: 'granted', plan: PLAN }];
		await trial.signedIn();
		trial.signedOut();
		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(claimTrial).toHaveBeenCalledTimes(1);
		expect(trial.plan).toBeNull();
	});

	it('does nothing on 401 / 403 until the next sign-in', async () => {
		const { trial, claimTrial } = await fresh();
		gateway.replies = [{ fail: { status: 401, code: 'invalid_token' } }, { status: 'disabled' }];
		await trial.signedIn();
		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(claimTrial).toHaveBeenCalledTimes(1);
		await trial.signedIn();
		expect(claimTrial).toHaveBeenCalledTimes(2);
	});

	it('claims for each account on this installation', async () => {
		const { trial, claimTrial } = await fresh();
		gateway.replies = [{ status: 'granted', plan: PLAN }, { status: 'not_eligible' }];
		await trial.signedIn();
		trial.signedOut();
		gateway.user = { id: 'user-2', username: 'Bo', role: 'user' };
		await trial.signedIn();
		expect(trial.plan).toBeNull();
		gateway.user = { id: 'user-1', username: 'Ann', role: 'user' };
		await trial.signedIn();
		expect(trial.plan).toEqual(PLAN);
		expect(claimTrial).toHaveBeenCalledTimes(2);
	});
});
