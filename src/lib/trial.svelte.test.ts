import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The app's trial runner (trial.svelte.ts) against a stand-in gateway: when it
// asks, how often, and what it then shows.
const gateway = vi.hoisted(() => ({
	replies: [] as (unknown | { fail: { status: number | null; code: string | null } })[],
	user: { id: 'user-1', username: 'Ann', role: 'user' } as { id: string; username: string; role: string } | null,
	/** GET /api/desktop/oauth/plan: the body, or a failure (default: a gateway without it). */
	plan: { fail: { status: 404, code: null } } as unknown,
	funding: [] as string[],
	/** Held answers (`hold`): PUTs and GETs wait until the test lets them go. */
	hold: false,
	held: [] as { kind: 'put' | 'get'; release: () => void }[],
	/** The choice the gateway has stored (PUTs change it, GETs read it). */
	stored: 'plan' as string,
	/** The PUTs' modes; the end of a move until the window recovers (a GET
	 *  answers it while the stored choice is the balance). */
	modes: [] as (string | null)[],
	untils: [] as (string | null)[],
	until: null as string | null,
	/** A gateway before contract v1.2: a PUT with a mode is refused (400). */
	noMode: false
}));
const wait = (kind: 'put' | 'get') =>
	gateway.hold ? new Promise<void>((release) => gateway.held.push({ kind, release })) : Promise.resolve();
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
	fetchDesktopPlan: vi.fn(async () => {
		// The gateway reads its stored choice when the request arrives.
		const body = answer(gateway.plan) as { plan: unknown; plan_funding: string };
		const stored = gateway.hold ? gateway.stored : body.plan_funding;
		await wait('get');
		// A move to the balance until the window recovers (contract v1.2 2.1):
		// the stored choice stays the plan, the next request's bucket is the balance.
		return gateway.until ? { ...body, plan_funding: 'plan', bucket: 'balance', balance_until: gateway.until } : { ...body, plan_funding: stored };
	}),
	setPlanFunding: vi.fn(async (funding: string, mode: string | null = null, until: string | null = null) => {
		gateway.funding.push(funding);
		gateway.modes.push(mode);
		gateway.untils.push(until);
		if (mode && gateway.noMode) throw Object.assign(new Error('unknown field mode'), { status: 400, code: 'invalid_request' });
		const temporary = funding === 'balance' && mode === 'until_reset' && gateway.until;
		gateway.stored = temporary ? 'plan' : funding;
		if (!temporary) gateway.until = null;
		const body = answer(gateway.plan) as { plan: unknown };
		await wait('put');
		return temporary ? { ...body, plan_funding: 'plan', bucket: 'balance', balance_until: gateway.until } : { ...body, plan_funding: funding };
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
	gateway.hold = false;
	gateway.held = [];
	gateway.stored = 'plan';
	gateway.modes = [];
	gateway.untils = [];
	gateway.until = null;
	gateway.noMode = false;
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

	it('a refusal (switched off, 404, not eligible) shows nothing; each later start asks again, once', async () => {
		const { trial, claimTrial } = await fresh();
		gateway.replies = [{ fail: { status: 404, code: null } }, { status: 'not_eligible' }, { status: 'granted', plan: PLAN }];
		await trial.signedIn();
		expect(trial.grant).toBeNull();
		expect(trial.plan).toBeNull();
		// No timer asks again, nor do later sign-ins in this run.
		await vi.advanceTimersByTimeAsync(24 * 3_600_000);
		trial.signedOut();
		await trial.signedIn();
		expect(claimTrial).toHaveBeenCalledTimes(1);
		// The next start does (still refused), once.
		const second = await fresh();
		await second.trial.signedIn();
		await second.trial.signedIn();
		// (One more reply used: the restarted module may share the mock.)
		expect(gateway.replies).toHaveLength(1);
		expect(second.trial.grant).toBeNull();
		// The start after: granted, and announced.
		const third = await fresh();
		await third.trial.signedIn();
		expect(third.trial.grant).toEqual(PLAN);
	});

	it('claims right after a fresh sign-in on the first run', async () => {
		const { trial, claimTrial } = await fresh();
		// The first start: nobody signed in yet.
		gateway.user = null;
		trial.signedOut();
		expect(claimTrial).not.toHaveBeenCalled();
		// The welcome page's sign-in.
		gateway.user = { id: 'user-1', username: 'Ann', role: 'user' };
		gateway.replies = [{ status: 'granted', plan: PLAN }];
		await trial.signedIn();
		expect(claimTrial).toHaveBeenCalledTimes(1);
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
		// The gateway says the plan ended: no plan, whatever the claim said;
		// a device on the balance has nothing to choose.
		gateway.plan = { plan: null, plan_funding: 'balance' };
		await trial.refreshStatus();
		expect(trial.plan).toBeNull();
		expect(trial.funding).toBe('balance');
		expect(trial.choiceShown).toBe(false);
		// A device still on an ended plan sees the choice (its requests stop).
		gateway.plan = { plan: null, plan_funding: 'plan' };
		await trial.refreshStatus();
		expect(trial.funding).toBe('plan');
		expect(trial.choiceShown).toBe(true);
		trial.signedOut();
		expect(trial.status).toBeNull();
		expect(trial.funding).toBeNull();
	});

	describe('a plan the device does not pay with', () => {
		const paid = { ...PLAN, name: 'Grove', group: '套餐专用', active: true, trial: false };
		async function signedIn(funding: 'plan' | 'balance') {
			const { trial } = await fresh();
			gateway.plan = { plan: paid, plan_funding: funding };
			gateway.replies = [{ status: 'not_eligible' }];
			await trial.signedIn();
			await vi.advanceTimersByTimeAsync(0);
			return trial;
		}

		it('is offered once, and the answer is the user\'s', async () => {
			let trial = await signedIn('balance');
			expect(trial.offer).toEqual(paid);
			expect(await trial.answerOffer(false)).toBe('');
			expect(gateway.funding).toEqual([]);
			expect(trial.offer).toBeNull();
			// Not again at the next start.
			trial = await signedIn('balance');
			expect(trial.offer).toBeNull();
			expect(trial.funding).toBe('balance');
		});

		it('moves to the plan only when the user says so', async () => {
			const trial = await signedIn('balance');
			expect(await trial.answerOffer(true)).toBe('');
			expect(gateway.funding).toEqual(['plan']);
			expect(trial.funding).toBe('plan');
			expect(trial.offer).toBeNull();
		});

		it('is shown once on the plan too (the default after a purchase), with the balance one answer away', async () => {
			let trial = await signedIn('plan');
			expect(trial.offer).toEqual(paid);
			// 知道了: nothing is sent.
			trial.markOffered(trial.offer);
			expect(trial.offer).toBeNull();
			expect(gateway.funding).toEqual([]);
			localStorage.setItem('lynshen-funding-offered', '{}');
			trial = await signedIn('plan');
			expect(await trial.answerOffer(true)).toBe('');
			expect(gateway.funding).toEqual([]);
			localStorage.setItem('lynshen-funding-offered', '{}');
			trial = await signedIn('plan');
			expect(await trial.answerOffer(false)).toBe('');
			expect(gateway.funding).toEqual(['balance']);
			expect(trial.offer).toBeNull();
		});

		it('is not shown while held, or after a choice made in Settings', async () => {
			const trial = await signedIn('balance');
			trial.offerHeld = true;
			expect(trial.offer).toBeNull();
			trial.offerHeld = false;
			expect(await trial.setFunding('balance')).toBe('');
			expect(trial.offer).toBeNull();
		});

	});

	describe('the balance until a used-up window recovers', () => {
		const paid = { ...PLAN, name: 'Grove', group: '套餐专用', active: true, trial: false };
		const resets = () => new Date(Date.now() + 3_600_000).toISOString();
		/** 已恢复使用套餐, in whichever language the test runs. */
		const BACK = /已恢复使用套餐|Back on the plan/;
		async function onPlan() {
			const { trial } = await fresh();
			gateway.plan = { plan: paid, plan_funding: 'plan' };
			gateway.replies = [{ status: 'not_eligible' }];
			await trial.signedIn();
			await vi.advanceTimersByTimeAsync(0);
			// The toasts of this copy of the modules (fresh() reloads them).
			const { toast } = await import('$lib/ui/toast.svelte');
			return { trial, toast };
		}

		it('is sent as until_reset, shows until when, and says so once the gateway is back on the plan', async () => {
			const { trial, toast } = await onPlan();
			const until = resets();
			gateway.until = until;
			expect(await trial.setFunding('balance', 'until_reset', Date.parse(until))).toBe('');
			expect(gateway.modes).toEqual(['until_reset']);
			// The 402's retry_at goes along (contract v1.2 2.2).
			expect(gateway.untils).toEqual([new Date(Date.parse(until)).toISOString()]);
			expect(trial.funding).toBe('balance');
			expect(trial.balanceUntil).toBe(Date.parse(until));
			// The window recovers; the gateway returns the device to the plan.
			gateway.plan = { plan: paid, plan_funding: 'plan' };
			gateway.until = null;
			await vi.advanceTimersByTimeAsync(3_600_000 + 6_000);
			expect(trial.funding).toBe('plan');
			expect(trial.balanceUntil).toBeNull();
			expect(toast.items.some((x) => BACK.test(x.message))).toBe(true);
		});

		it('is said after a restart too, and not when the user chose the plan or the balance themselves', async () => {
			let { trial, toast } = await onPlan();
			gateway.until = resets();
			await trial.setFunding('balance', 'until_reset');
			// The app restarts after the window recovered.
			gateway.plan = { plan: paid, plan_funding: 'plan' };
			gateway.until = null;
			({ trial, toast } = await onPlan());
			expect(toast.items.some((x) => BACK.test(x.message))).toBe(true);
			// The user goes back to the plan by hand: nothing to say.
			({ trial, toast } = await onPlan());
			gateway.until = resets();
			await trial.setFunding('balance', 'until_reset');
			expect(await trial.setFunding('plan')).toBe('');
			expect(toast.items.some((x) => BACK.test(x.message))).toBe(false);
		});

		it('becomes for good when the user picks the balance in Settings meanwhile', async () => {
			const { trial } = await onPlan();
			gateway.until = resets();
			await trial.setFunding('balance', 'until_reset');
			expect(trial.balanceUntil).not.toBeNull();
			expect(await trial.setFunding('balance')).toBe('');
			expect(gateway.modes).toEqual(['until_reset', null]);
			expect(trial.balanceUntil).toBeNull();
			expect(trial.funding).toBe('balance');
			// A gateway without the mode answers for good: sent once, not again.
			gateway.modes = [];
			await trial.setFunding('plan');
			expect(await trial.setFunding('balance', 'until_reset')).toBe('');
			expect(gateway.modes).toEqual([null, 'until_reset']);
		});

		it('falls back to the balance for good where the gateway refuses the mode', async () => {
			const { trial } = await onPlan();
			gateway.noMode = true;
			expect(await trial.setFunding('balance', 'until_reset', Date.now() + 3_600_000)).toBe('');
			expect(gateway.modes).toEqual(['until_reset', null]);
			expect(trial.funding).toBe('balance');
			expect(trial.balanceUntil).toBeNull();
		});
	});

	describe('the funding choice under a slow gateway', () => {
		const live = { ...PLAN, active: true, trial: true };
		async function ready() {
			const { trial } = await fresh();
			gateway.plan = { plan: live, plan_funding: 'balance' };
			gateway.replies = [{ status: 'granted', plan: PLAN }];
			await trial.signedIn();
			await vi.advanceTimersByTimeAsync(0);
			expect(trial.funding).toBe('balance');
			gateway.stored = 'balance';
			gateway.hold = true;
			return trial;
		}
		const releaseNext = async (kind?: 'put' | 'get') => {
			const i = gateway.held.findIndex((h) => !kind || h.kind === kind);
			gateway.held.splice(i, 1)[0].release();
			await vi.advanceTimersByTimeAsync(0);
		};

		it('shows each click at once, drops none, and ends on the last one', async () => {
			const trial = await ready();
			const done = trial.setFunding('plan');
			expect(trial.funding).toBe('plan');
			expect(trial.saving).toBe(true);
			void trial.setFunding('balance');
			expect(trial.funding).toBe('balance');
			void trial.setFunding('plan');
			void trial.setFunding('balance');
			expect(trial.funding).toBe('balance');
			// One change in flight; the first answer brings the latest pick.
			expect(gateway.funding).toEqual(['plan']);
			await releaseNext('put');
			expect(trial.funding).toBe('balance');
			expect(gateway.funding).toEqual(['plan', 'balance']);
			await releaseNext('put');
			expect(await done).toBe('');
			expect(trial.funding).toBe('balance');
			expect(trial.saving).toBe(false);
			expect(gateway.funding.at(-1)).toBe('balance');
			expect(gateway.stored).toBe('balance');
		});

		it('sends nothing more when the clicks come back to the stored choice', async () => {
			const trial = await ready();
			void trial.setFunding('plan');
			void trial.setFunding('balance');
			await releaseNext('put');
			// The gateway now has plan; the last click said balance.
			expect(gateway.funding).toEqual(['plan', 'balance']);
			await releaseNext('put');
			expect(trial.funding).toBe('balance');
		});

		it('keeps the pick over a read that lands in the middle, and drops a read older than the answer', async () => {
			const trial = await ready();
			// A read the gateway answers (balance) while the change is in flight.
			const middle = trial.refreshStatus();
			void trial.setFunding('plan');
			await releaseNext('get');
			await middle;
			expect(trial.status?.funding).toBe('balance');
			expect(trial.funding).toBe('plan');
			await releaseNext('put');
			expect(trial.funding).toBe('plan');
			// A read the gateway served before the next change, answering after it.
			void trial.setFunding('balance');
			gateway.stored = 'plan';
			const late = trial.refreshStatus();
			await releaseNext('put');
			expect(trial.funding).toBe('balance');
			await releaseNext('get');
			await late;
			expect(trial.funding).toBe('balance');
			expect(trial.status?.funding).toBe('balance');
		});

		it('falls back to the gateway\'s choice and says why when a change fails', async () => {
			const trial = await ready();
			gateway.hold = false;
			gateway.plan = { fail: { status: 503, code: null } };
			expect(await trial.setFunding('plan')).toBe('refused');
			expect(trial.funding).toBe('balance');
			expect(trial.fundingError).toBe('refused');
			gateway.plan = { plan: live, plan_funding: 'balance' };
			expect(await trial.setFunding('plan')).toBe('');
			expect(trial.fundingError).toBe('');
			expect(trial.funding).toBe('plan');
		});
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
