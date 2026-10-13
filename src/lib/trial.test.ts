import { describe, expect, it, vi } from 'vitest';
import { setLocale } from '$lib/i18n';
import {
	RETRY_DELAYS_MS,
	STORAGE_KEY,
	TRIAL_WINDOW_MS,
	TrialClaims,
	accountCreatedAt,
	activePlan,
	claimKey,
	needsClaim,
	credits,
	grantText,
	grantToAnnounce,
	outcomeOfFailure,
	outcomeOfReply,
	parseDesktopPlan,
	parsePlan,
	sortedWindows,
	tightestWindow,
	usedShare,
	windowLabel,
	type ClaimOutcome,
	type ClaimStorage
} from './trial';

const NOW = Date.parse('2026-10-13T08:40:00Z');
const DAY = 86_400_000;
// The contract's reply shape (notes/trial-plan-client.md).
const PLAN = {
	name: '7 天体验套餐',
	group: '国内模型分组',
	windows: [
		{ kind: '7d', quota_cny: '10.00', used_cny: '0.00', resets_at: null },
		{ kind: '5h', quota_cny: '4.00', used_cny: '0.00', resets_at: null }
	],
	expires_at: new Date(NOW + 7 * DAY).toISOString()
};
const KEY = claimKey('inst-1', 'user-1');

function memory(): ClaimStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

/** A claimer whose gateway answers `replies` in turn (an Error: a network failure). */
function claimer(replies: (ClaimOutcome | Error)[], storage = memory()) {
	const claim = vi.fn(async (): Promise<ClaimOutcome> => {
		const next = replies.shift();
		if (!next) throw new Error('no more replies');
		if (next instanceof Error) throw next;
		return next;
	});
	return { claims: new TrialClaims(storage, claim, () => NOW), claim, storage };
}

describe('reading the gateway answer', () => {
	it('reads each status of a 200 answer', () => {
		expect(outcomeOfReply({ status: 'granted', plan: PLAN })).toEqual({ kind: 'granted', plan: PLAN });
		expect(outcomeOfReply({ status: 'already_granted', plan: PLAN })).toEqual({ kind: 'already_granted', plan: PLAN });
		expect(outcomeOfReply({ status: 'not_eligible' })).toEqual({ kind: 'not_eligible' });
		expect(outcomeOfReply({ status: 'disabled' })).toEqual({ kind: 'disabled' });
		expect(outcomeOfReply({ status: 'maybe' })).toEqual({ kind: 'refused' });
		expect(outcomeOfReply(null)).toEqual({ kind: 'refused' });
		// A grant without a readable plan is still a grant (nothing to show).
		expect(outcomeOfReply({ status: 'granted', plan: { name: 'x' } })).toEqual({ kind: 'granted', plan: null });
	});

	it('reads failures: 404 is an older gateway, 401/403 signed out, no status the network', () => {
		expect(outcomeOfFailure({ status: 404, code: null })).toEqual({ kind: 'disabled' });
		expect(outcomeOfFailure({ status: 401, code: 'invalid_token' })).toEqual({ kind: 'signed_out' });
		expect(outcomeOfFailure({ status: 403, code: null })).toEqual({ kind: 'signed_out' });
		expect(outcomeOfFailure({ status: null, code: 'not_signed_in' })).toEqual({ kind: 'signed_out' });
		expect(outcomeOfFailure({ status: null, code: null })).toEqual({ kind: 'network' });
		expect(outcomeOfFailure(new Error('boom'))).toEqual({ kind: 'network' });
		for (const status of [408, 429, 500, 502, 503]) expect(outcomeOfFailure({ status, code: null })).toEqual({ kind: 'network' });
		expect(outcomeOfFailure({ status: 400, code: 'invalid_request' })).toEqual({ kind: 'refused' });
	});

	it('keeps only readable windows of a plan', () => {
		const plan = parsePlan({ ...PLAN, windows: [...PLAN.windows, { kind: '1d' }, null, { kind: 'x', quota_cny: 3, used_cny: 'n/a', resets_at: 'soon' }] });
		expect(plan?.windows).toEqual([...PLAN.windows, { kind: 'x', quota_cny: '3', used_cny: '0', resets_at: null }]);
		expect(parsePlan({ ...PLAN, expires_at: 'never' })).toBeNull();
	});

	it('reads the deployed reply: extra fields, a null group, and active', () => {
		// The gateway's shape (2026-10-13 changes: groups, starts_at, active, in_flight_cny, remaining_cny, plan_funding).
		const deployed = {
			status: 'already_granted',
			plan: {
				...PLAN,
				group: null,
				groups: [],
				starts_at: new Date(NOW).toISOString(),
				active: false,
				windows: PLAN.windows.map((w) => ({ ...w, in_flight_cny: '0.00', remaining_cny: w.quota_cny }))
			},
			plan_funding: 'balance'
		};
		const outcome = outcomeOfReply(deployed);
		expect(outcome).toMatchObject({ kind: 'already_granted', plan: { group: '', active: false } });
		// Ended early, or a paid desktop plan replaced it: not in force.
		const record = { status: 'already_granted' as const, at: NOW, plan: (outcome as { plan: ReturnType<typeof parsePlan> }).plan };
		expect(activePlan(record, NOW)).toBeNull();
		expect(activePlan({ ...record, plan: { ...record.plan!, active: true } }, NOW)).not.toBeNull();
	});

	it('reads the plan status and the funding choice', () => {
		expect(parseDesktopPlan({ plan: { ...PLAN, trial: true, active: true }, plan_funding: 'plan' })).toEqual({
			plan: { ...PLAN, trial: true, active: true },
			funding: 'plan'
		});
		expect(parseDesktopPlan({ plan: null, plan_funding: 'balance' })).toEqual({ plan: null, funding: 'balance' });
		expect(parseDesktopPlan({ plan: null })).toBeNull();
		expect(parseDesktopPlan({ plan: null, plan_funding: 'both' })).toBeNull();
		expect(parseDesktopPlan(null)).toBeNull();
	});
});

describe('the claim state machine', () => {
	it('claims once: a granted answer is remembered and announced', async () => {
		const { claims, claim } = claimer([{ kind: 'granted', plan: PLAN }]);
		const record = await claims.run(KEY);
		expect(record).toMatchObject({ status: 'granted', plan: PLAN, card: 'show', at: NOW });
		expect(await claims.run(KEY)).toEqual(record);
		expect(claim).toHaveBeenCalledTimes(1);
	});

	it.each([
		['not_eligible', { kind: 'not_eligible' }],
		['disabled', { kind: 'disabled' }],
		['an older gateway (404)', outcomeOfFailure({ status: 404, code: null })],
		['an unknown answer', { kind: 'refused' }],
		['already_granted', { kind: 'already_granted', plan: PLAN }]
	] as [string, ClaimOutcome][])('does not ask again after %s', async (_, outcome) => {
		const { claims, claim } = claimer([outcome]);
		await claims.run(KEY);
		await claims.run(KEY);
		await claims.run(KEY);
		expect(claim).toHaveBeenCalledTimes(1);
	});

	it('does not announce a repeat grant (already_granted)', async () => {
		const { claims } = claimer([{ kind: 'already_granted', plan: PLAN }]);
		const record = await claims.run(KEY);
		expect(activePlan(record, NOW)).toEqual(PLAN);
		expect(grantToAnnounce(record, NOW)).toBeNull();
	});

	it('shows nothing for not_eligible, disabled and 404', async () => {
		for (const outcome of [{ kind: 'not_eligible' }, { kind: 'disabled' }, outcomeOfFailure({ status: 404 })] as ClaimOutcome[]) {
			const { claims } = claimer([outcome]);
			const record = await claims.run(KEY);
			expect(activePlan(record, NOW)).toBeNull();
			expect(grantToAnnounce(record, NOW)).toBeNull();
		}
	});

	it('asks again about a refusal at each later start within 72 hours, then stops at a grant', async () => {
		const HOUR = 3_600_000;
		for (const outcome of [{ kind: 'not_eligible' }, { kind: 'disabled' }, outcomeOfFailure({ status: 404 })] as ClaimOutcome[]) {
			const storage = memory();
			await claimer([outcome], storage).claims.run(KEY);
			// The next start, an hour later: asked once, quietly, and refused again.
			let now = NOW + HOUR;
			const replies: ClaimOutcome[] = [outcome, { kind: 'granted', plan: PLAN }];
			const claim = vi.fn(async () => replies.shift()!);
			const second = new TrialClaims(storage, claim, () => now);
			expect(await second.run(KEY)).toMatchObject({ status: outcome.kind, since: NOW, at: now });
			// Sign-ins later in that run do not ask again.
			await second.run(KEY);
			await second.run(KEY);
			expect(claim).toHaveBeenCalledTimes(1);
			// The start after: granted (the admin switched the trial on).
			now = NOW + 30 * HOUR;
			expect(await new TrialClaims(storage, claim, () => now).run(KEY)).toMatchObject({ status: 'granted', card: 'show', since: NOW });
			expect(claim).toHaveBeenCalledTimes(2);
			// After a grant nothing is asked, on any later start.
			now = NOW + 40 * HOUR;
			await new TrialClaims(storage, claim, () => now).run(KEY);
			expect(claim).toHaveBeenCalledTimes(2);
		}
	});

	it('stops asking 72 hours after the first claim, or after the account was created', async () => {
		const storage = memory();
		await claimer([{ kind: 'not_eligible' }], storage).claims.run(KEY);
		const claim = vi.fn(async (): Promise<ClaimOutcome> => ({ kind: 'not_eligible' }));
		await new TrialClaims(storage, claim, () => NOW + TRIAL_WINDOW_MS).run(KEY);
		expect(claim).not.toHaveBeenCalled();
		await new TrialClaims(storage, claim, () => NOW + TRIAL_WINDOW_MS - 1).run(KEY);
		expect(claim).toHaveBeenCalledTimes(1);
		// Where the gateway says when the account was created, that counts.
		const created = NOW - TRIAL_WINDOW_MS + 60_000;
		await new TrialClaims(storage, claim, () => NOW + 120_000).run(KEY, created);
		expect(claim).toHaveBeenCalledTimes(1);
		await new TrialClaims(storage, claim, () => NOW + 30_000).run(KEY, created);
		expect(claim).toHaveBeenCalledTimes(2);
	});

	it('reads a record from 0.7.0 (no since) by its last attempt', () => {
		const old = { status: 'not_eligible' as const, at: NOW };
		expect(needsClaim(old, NOW + TRIAL_WINDOW_MS - 1)).toBe(true);
		expect(needsClaim(old, NOW + TRIAL_WINDOW_MS)).toBe(false);
		expect(needsClaim(old, NOW + 1, { askedThisRun: true })).toBe(false);
		// Grants and other answers are final; a network failure is always due.
		for (const status of ['granted', 'already_granted', 'refused'] as const) expect(needsClaim({ status, at: NOW }, NOW + 1)).toBe(false);
		expect(needsClaim({ status: 'network', at: NOW }, NOW + 1, { askedThisRun: true })).toBe(true);
		expect(needsClaim(undefined, NOW)).toBe(true);
		expect(needsClaim(undefined, NOW, { askedThisRun: true })).toBe(false);
	});

	it('announces a grant that follows a refusal, also a repeat (granted by hand meanwhile)', async () => {
		const storage = memory();
		await claimer([{ kind: 'not_eligible' }], storage).claims.run(KEY);
		const record = await new TrialClaims(storage, async () => ({ kind: 'already_granted', plan: PLAN }), () => NOW + 1).run(KEY);
		expect(grantToAnnounce(record, NOW + 1)).toEqual(PLAN);
	});

	it('reads when the account was created', () => {
		expect(accountCreatedAt({ created_at: '2026-10-13T21:09:06Z' })).toBe(Date.parse('2026-10-13T21:09:06Z'));
		expect(accountCreatedAt({ created_at: 1_791_000_000 })).toBe(1_791_000_000_000);
		expect(accountCreatedAt({ created_at: 1_791_000_000_000 })).toBe(1_791_000_000_000);
		for (const v of [undefined, null, '', 'soon', 0, -1]) expect(accountCreatedAt({ created_at: v })).toBeNull();
		expect(accountCreatedAt(null)).toBeNull();
	});

	it('never asks again after an unknown answer (refused), on any start', async () => {
		const storage = memory();
		await claimer([{ kind: 'refused' }], storage).claims.run(KEY);
		const claim = vi.fn();
		await new TrialClaims(storage, claim, () => NOW + 1).run(KEY);
		expect(claim).not.toHaveBeenCalled();
	});

	it('asks again after a network failure, then stops at the answer', async () => {
		const { claims, claim } = claimer([new Error('offline'), { kind: 'network' }, { kind: 'granted', plan: PLAN }]);
		expect(await claims.run(KEY)).toMatchObject({ status: 'network', failures: 1 });
		expect(await claims.run(KEY)).toMatchObject({ status: 'network', failures: 2 });
		expect(await claims.run(KEY)).toMatchObject({ status: 'granted', card: 'show' });
		await claims.run(KEY);
		expect(claim).toHaveBeenCalledTimes(3);
	});

	it('announces a repeat grant that follows a network failure (the first answer may be lost)', async () => {
		const { claims } = claimer([{ kind: 'network' }, { kind: 'already_granted', plan: PLAN }]);
		await claims.run(KEY);
		const record = await claims.run(KEY);
		expect(grantToAnnounce(record, NOW)).toEqual(PLAN);
	});

	it('shares one request between concurrent runs', async () => {
		const { claims, claim } = claimer([{ kind: 'granted', plan: PLAN }]);
		const [a, b] = await Promise.all([claims.run(KEY), claims.run(KEY)]);
		expect(a).toEqual(b);
		expect(claim).toHaveBeenCalledTimes(1);
	});

	it('remembers nothing when signed out (401/403), so the next sign-in asks again, in the same run too', async () => {
		const { claims, claim, storage } = claimer([{ kind: 'signed_out' }, { kind: 'not_eligible' }]);
		expect(await claims.run(KEY)).toBeUndefined();
		expect(storage.data.size).toBe(0);
		expect(await claims.run(KEY)).toMatchObject({ status: 'not_eligible' });
		expect(claim).toHaveBeenCalledTimes(2);
	});

	it('keys the outcome by installation and account', async () => {
		const { claims, claim } = claimer([{ kind: 'granted', plan: PLAN }, { kind: 'not_eligible' }, { kind: 'not_eligible' }]);
		await claims.run(claimKey('inst-1', 'user-1'));
		await claims.run(claimKey('inst-1', 'user-2'));
		await claims.run(claimKey('inst-2', 'user-1'));
		await claims.run(claimKey('inst-1', 'user-1'));
		await claims.run(claimKey('inst-1', 'user-2'));
		expect(claim).toHaveBeenCalledTimes(3);
		expect(claims.get(claimKey('inst-1', 'user-1'))?.status).toBe('granted');
		expect(claims.get(claimKey('inst-1', 'user-2'))?.status).toBe('not_eligible');
	});

	it('keeps the outcome across restarts (the same storage)', async () => {
		const first = claimer([{ kind: 'granted', plan: PLAN }]);
		await first.claims.run(KEY);
		const again = claimer([], first.storage);
		expect(await again.claims.run(KEY)).toMatchObject({ status: 'granted' });
		expect(again.claim).not.toHaveBeenCalled();
	});

	it('reads unreadable storage as empty', async () => {
		const storage = memory();
		storage.setItem(STORAGE_KEY, '{oops');
		const { claims, claim } = claimer([{ kind: 'disabled' }], storage);
		expect(await claims.run(KEY)).toMatchObject({ status: 'disabled' });
		expect(claim).toHaveBeenCalledTimes(1);
	});
});

describe('the grant card', () => {
	it('shows once: dismissed, it does not come back, also after a restart', async () => {
		const { claims, storage } = claimer([{ kind: 'granted', plan: PLAN }]);
		expect(grantToAnnounce(await claims.run(KEY), NOW)).toEqual(PLAN);
		// Not dismissed yet: it shows again at the next start.
		expect(grantToAnnounce(new TrialClaims(storage, vi.fn(), () => NOW).get(KEY), NOW)).toEqual(PLAN);
		expect(grantToAnnounce(claims.acknowledge(KEY), NOW)).toBeNull();
		const restarted = new TrialClaims(storage, vi.fn(), () => NOW);
		expect(grantToAnnounce(await restarted.run(KEY), NOW)).toBeNull();
		// The plan itself stays in the account card.
		expect(activePlan(restarted.get(KEY), NOW)).toEqual(PLAN);
	});

	it('neither the card nor the plan show once the plan has expired', async () => {
		const { claims } = claimer([{ kind: 'granted', plan: PLAN }]);
		const record = await claims.run(KEY);
		const later = Date.parse(PLAN.expires_at) + 1;
		expect(activePlan(record, later)).toBeNull();
		expect(grantToAnnounce(record, later)).toBeNull();
	});

	it('says what was given and until when', () => {
		setLocale('zh');
		const expires = new Date(2026, 9, 20, 16, 40);
		const plan = { ...PLAN, expires_at: expires.toISOString() };
		expect(grantText(plan, expires.getTime() - 7 * DAY)).toEqual({
			title: '已赠送 7 天体验套餐',
			body: '国内模型分组 · 共 10 积分 · 每 5 小时最多 4 积分 · 到期 10月20日',
			parts: ['国内模型分组', '共 10 积分', '每 5 小时最多 4 积分', '到期 10月20日']
		});
		expect(grantText({ ...plan, group: '' }, expires.getTime() - 7 * DAY).body.startsWith('国内模型 · ')).toBe(true);
		setLocale('en');
		expect(grantText(plan, expires.getTime() - 7 * DAY)).toMatchObject({
			title: '7-day trial plan added',
			body: '国内模型分组 · 10 credits in all · at most 4 per 5 hours · ends Oct 20'
		});
		setLocale('zh');
	});
});

describe('display helpers', () => {
	it('picks the window with the least left for the account card', () => {
		const plan = {
			...PLAN,
			windows: [
				{ kind: '7d', quota_cny: '10.00', used_cny: '3.58', resets_at: null },
				{ kind: '5h', quota_cny: '4.00', used_cny: '1.36', resets_at: null }
			]
		};
		// 5h: 34% used, 7d: 35.8% used.
		expect(tightestWindow(plan)).toMatchObject({ window: { kind: '7d' }, left: '6.42' });
		expect(tightestWindow({ ...plan, windows: [{ ...plan.windows[0], used_cny: '0' }, plan.windows[1]] })).toMatchObject({ window: { kind: '5h' }, left: '2.64' });
		// A tie: the shorter window.
		expect(tightestWindow(PLAN)?.window.kind).toBe('5h');
		expect(tightestWindow({ ...PLAN, windows: [{ kind: '5h', quota_cny: '4.00', used_cny: '9.00', resets_at: null }] })?.left).toBe('0.00');
		expect(tightestWindow({ ...PLAN, windows: [] })).toBeNull();
	});

	it('formats credits, window names and order, and the share used', () => {
		expect(credits('10.00')).toBe('10');
		expect(credits('2.50')).toBe('2.5');
		expect(credits('0', true)).toBe('0.00');
		expect(credits('3.456', true)).toBe('3.46');
		setLocale('zh');
		expect(windowLabel('5h')).toBe('5 小时');
		expect(windowLabel('7d')).toBe('7 天');
		expect(windowLabel('month')).toBe('每月');
		expect(windowLabel('day')).toBe('每天');
		expect(windowLabel('12h')).toBe('12 小时');
		expect(windowLabel('odd')).toBe('odd');
		expect(sortedWindows(PLAN).map((w) => w.kind)).toEqual(['5h', '7d']);
		expect(usedShare({ kind: '5h', quota_cny: '4.00', used_cny: '1.00', resets_at: null })).toBe(0.25);
		expect(usedShare({ kind: '5h', quota_cny: '4.00', used_cny: '9.00', resets_at: null })).toBe(1);
		expect(usedShare({ kind: '5h', quota_cny: '0', used_cny: '1', resets_at: null })).toBe(0);
	});

	it('retries a few times after a network failure, then waits for the next sign-in', () => {
		expect(RETRY_DELAYS_MS.length).toBe(3);
		expect([...RETRY_DELAYS_MS].every((ms, i, all) => ms > 0 && (i === 0 || ms > all[i - 1]))).toBe(true);
	});
});
