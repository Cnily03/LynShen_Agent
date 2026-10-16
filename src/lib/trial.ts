// The first-use trial plan (gateway contract: notes/trial-plan-client.md).
// After a sign-in the app asks the gateway for the trial, per installation and
// account; the gateway alone decides who gets it. A grant ends the asking. A
// refusal (`not_eligible`, `disabled`) is asked again at later starts and
// sign-ins while the account is in the gateway's 72-hour window, at most once
// per run of the app: the trial may be switched on, or a rule lifted, in the
// meantime. This module is the claim's state machine and the plan's display
// helpers, without Tauri or Svelte; trial.svelte.ts runs it for the app.
import { getLocale, t } from '$lib/i18n';

/** One quota window of the plan, in CNY (1 积分 = ¥1). */
export interface TrialWindow {
	/** "5h", "7d". */
	kind: string;
	quota_cny: string;
	used_cny: string;
	/** RFC 3339, or null when the window has not started. */
	resets_at: string | null;
}

export interface TrialPlan {
	name: string;
	/** The model group's display name. */
	group: string;
	windows: TrialWindow[];
	/** RFC 3339. */
	expires_at: string;
	/** False once the plan ended early or a paid desktop plan replaced it
	 *  (an `already_granted` answer); absent counts as in force. */
	active?: boolean;
	/** From GET /api/desktop/oauth/plan: whether it is the trial (a paid
	 *  desktop plan otherwise). */
	trial?: boolean;
}

/** Who pays every request of this device (its device key), chosen by the
 *  user (notes/plan-balance-separation.md 3.1): the plan only, or the
 *  balance only. On the plan a used-up window (402 `plan_quota_exhausted`),
 *  an ended plan (402 `plan_inactive`) or a model outside the plan (403
 *  `model_not_in_plan`) stops the request; the balance is never used
 *  instead. A device starts on the balance and moves to the plan only by an
 *  explicit act (the trial card, the step after buying a plan, the prompt
 *  for a plan bought elsewhere, Settings → 账户). */
export type PlanFunding = 'plan' | 'balance';

/** GET /api/desktop/oauth/plan: the account's desktop plan in force (trial
 *  or paid; null without one) and this key's funding choice. */
export interface DesktopPlanStatus {
	plan: TrialPlan | null;
	funding: PlanFunding;
}

/** What one claim attempt came to. */
export type ClaimOutcome =
	| { kind: 'granted' | 'already_granted'; plan: TrialPlan | null }
	/** `refused`: any other answer (an unknown status, a 400): final, never retried. */
	| { kind: 'not_eligible' | 'disabled' | 'refused' }
	/** The gateway was not reached (or failed in passing: 408, 429, 5xx): try again later. */
	| { kind: 'network' }
	/** 401 / 403, or no device key: nothing is remembered. */
	| { kind: 'signed_out' };

/** The outcome remembered for one installation and account. */
export interface TrialRecord {
	status: 'granted' | 'already_granted' | 'not_eligible' | 'disabled' | 'refused' | 'network';
	/** When the last attempt ended (ms since the epoch). */
	at: number;
	/** When this installation first asked for this account (ms): where the
	 *  72-hour window starts when the gateway does not say when the account
	 *  was created. Absent in records from before 0.7.1 (`at` stands in). */
	since?: number;
	plan?: TrialPlan | null;
	/** Attempts that failed on the network so far. */
	failures?: number;
	/** The one-time grant card: still to show, or dismissed. */
	card?: 'show' | 'seen';
}

/** localStorage key of the records, by `${installation_id}:${user_id}`. */
export const STORAGE_KEY = 'lynshen-trial-claims';

/** Waits before the timed retries after a network failure, within one run of
 *  the app; after the last one the next sign-in or start tries again. */
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000] as const;

/** How long after an account is created the gateway still grants it the
 *  trial (contract: "created at most 72 hours before the claim"). A refusal is
 *  asked again only within this window. */
export const TRIAL_WINDOW_MS = 72 * 3_600_000;

export const claimKey = (installationId: string, userId: string) => `${installationId}:${userId}`;

const text = (v: unknown): string | null => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);

/** The plan of a `granted` / `already_granted` answer; null when it is not one. */
export function parsePlan(v: unknown): TrialPlan | null {
	if (!v || typeof v !== 'object') return null;
	const p = v as Record<string, unknown>;
	const expires = text(p.expires_at);
	if (!expires || Number.isNaN(Date.parse(expires))) return null;
	const windows = (Array.isArray(p.windows) ? p.windows : []).flatMap((w): TrialWindow[] => {
		if (!w || typeof w !== 'object') return [];
		const r = w as Record<string, unknown>;
		const kind = text(r.kind);
		const quota = text(r.quota_cny);
		if (!kind || quota == null || !Number.isFinite(Number(quota))) return [];
		const used = text(r.used_cny);
		const resets = text(r.resets_at);
		return [{ kind, quota_cny: quota, used_cny: used != null && Number.isFinite(Number(used)) ? used : '0', resets_at: resets && !Number.isNaN(Date.parse(resets)) ? resets : null }];
	});
	return {
		name: text(p.name) ?? '',
		group: text(p.group) ?? '',
		windows,
		expires_at: expires,
		...(typeof p.active === 'boolean' ? { active: p.active } : {}),
		...(typeof p.trial === 'boolean' ? { trial: p.trial } : {})
	};
}

/** The body of GET / PUT /api/desktop/oauth/plan; null when it is not one. */
export function parseDesktopPlan(body: unknown): DesktopPlanStatus | null {
	if (!body || typeof body !== 'object') return null;
	const b = body as Record<string, unknown>;
	if (b.plan_funding !== 'plan' && b.plan_funding !== 'balance') return null;
	return { plan: b.plan == null ? null : parsePlan(b.plan), funding: b.plan_funding };
}

/** Tells one plan (one purchase, one trial) from the next: the prompts that
 *  ask once per plan remember this. */
export const planKey = (plan: TrialPlan): string => `${plan.name.trim()}|${new Date(plan.expires_at).toISOString()}`;

/** The outcome of a claim the gateway answered with HTTP 200. */
export function outcomeOfReply(body: unknown): ClaimOutcome {
	const status = body && typeof body === 'object' ? (body as Record<string, unknown>).status : null;
	if (status === 'granted' || status === 'already_granted') return { kind: status, plan: parsePlan((body as Record<string, unknown>).plan) };
	if (status === 'not_eligible' || status === 'disabled') return { kind: status };
	return { kind: 'refused' };
}

/** The outcome of a failed claim: `{ status, code }` of protocol's GatewayError
 *  (status null: the gateway was not reached). */
export function outcomeOfFailure(error: unknown): ClaimOutcome {
	const e = (error && typeof error === 'object' ? error : {}) as { status?: unknown; code?: unknown };
	const status = typeof e.status === 'number' ? e.status : null;
	if (e.code === 'not_signed_in' || status === 401 || status === 403) return { kind: 'signed_out' };
	// A gateway without the endpoint: as if the trial were switched off.
	if (status === 404) return { kind: 'disabled' };
	if (status == null || status === 408 || status === 429 || status >= 500) return { kind: 'network' };
	return { kind: 'refused' };
}

/** What decides whether a remembered refusal is asked again. */
export interface ClaimContext {
	/** This run of the app already asked for this account. */
	askedThisRun?: boolean;
	/** When the account was created (ms), where the gateway says so. */
	accountSince?: number | null;
}

/** A claim is due:
 *  - the last attempt failed on the network (timed retries, trial.svelte.ts);
 *  - otherwise at most once per run of the app: nothing remembered yet, or a
 *    refusal (`not_eligible`, `disabled`) while the account is younger than
 *    TRIAL_WINDOW_MS (from its creation, else from this installation's first
 *    claim for it).
 *  A grant (`granted`, `already_granted`) and any other answer (`refused`)
 *  end the asking. */
export function needsClaim(record: TrialRecord | undefined, now: number, context: ClaimContext = {}): boolean {
	if (record?.status === 'network') return true;
	if (context.askedThisRun) return false;
	if (!record) return true;
	if (record.status !== 'not_eligible' && record.status !== 'disabled') return false;
	const since = context.accountSince ?? record.since ?? record.at;
	return now - since < TRIAL_WINDOW_MS;
}

/** When the account was created, from the gateway's user (`created_at`: RFC
 *  3339, or Unix seconds or milliseconds); null when it does not say. */
export function accountCreatedAt(user: { created_at?: unknown } | null | undefined): number | null {
	const v = user?.created_at;
	if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
	if (typeof v === 'string' && v.trim()) {
		const ms = Date.parse(v);
		return Number.isNaN(ms) ? null : ms;
	}
	return null;
}

/** The record after an attempt; undefined when nothing is to be remembered. */
export function recordAfter(prev: TrialRecord | undefined, outcome: ClaimOutcome, now: number): TrialRecord | undefined {
	const since = prev?.since ?? prev?.at ?? now;
	switch (outcome.kind) {
		case 'signed_out':
			return prev;
		case 'network':
			return { status: 'network', at: now, since, failures: (prev?.failures ?? 0) + 1 };
		case 'granted':
		case 'already_granted':
			return {
				status: outcome.kind,
				at: now,
				since,
				plan: outcome.plan,
				// A repeat after a network failure or a refusal may be the grant
				// whose answer was lost on the way, or one made since: it is
				// announced as well.
				card: outcome.kind === 'granted' || (prev != null && prev.status !== 'granted' && prev.status !== 'already_granted') ? 'show' : undefined
			};
		default:
			return { status: outcome.kind, at: now, since };
	}
}

/** A plan in force at `now`: not ended early, not expired. */
export const planInForce = (plan: TrialPlan | null | undefined, now: number): TrialPlan | null =>
	plan && plan.active !== false && Date.parse(plan.expires_at) > now ? plan : null;

/** The trial plan in force: granted, and not expired. */
export function activePlan(record: TrialRecord | null | undefined, now: number): TrialPlan | null {
	if (!record || (record.status !== 'granted' && record.status !== 'already_granted')) return null;
	return planInForce(record.plan, now);
}

/** The plan to announce on the one-time grant card, or null. */
export function grantToAnnounce(record: TrialRecord | null | undefined, now: number): TrialPlan | null {
	return record?.card === 'show' ? activePlan(record, now) : null;
}

/** Where the records live (localStorage in the app). */
export interface ClaimStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

/**
 * Claims the trial per installation and account (`needsClaim` says when). An
 * outcome is remembered (except "signed out"); a run of the app asks at most
 * once per account, apart from retries after a network failure. Concurrent
 * runs for one key share one request.
 */
export class TrialClaims {
	#inflight = new Map<string, Promise<TrialRecord | undefined>>();
	/** Accounts asked for in this run of the app. */
	#asked = new Set<string>();

	constructor(
		private readonly storage: ClaimStorage,
		private readonly claim: () => Promise<ClaimOutcome>,
		private readonly now: () => number = Date.now
	) {}

	#all(): Record<string, TrialRecord> {
		try {
			const v = JSON.parse(this.storage.getItem(STORAGE_KEY) ?? '{}');
			return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
		} catch {
			return {};
		}
	}

	get(key: string): TrialRecord | undefined {
		return this.#all()[key];
	}

	#put(key: string, record: TrialRecord) {
		try {
			this.storage.setItem(STORAGE_KEY, JSON.stringify({ ...this.#all(), [key]: record }));
		} catch {
			/* storage full or unavailable: the claim is asked again next time */
		}
	}

	/** Claims for `key` when due; answers the record as it stands after.
	 *  `accountSince`: when the account was created, where known. */
	run(key: string, accountSince: number | null = null): Promise<TrialRecord | undefined> {
		const pending = this.#inflight.get(key);
		if (pending) return pending;
		const prev = this.get(key);
		if (!needsClaim(prev, this.now(), { askedThisRun: this.#asked.has(key), accountSince })) return Promise.resolve(prev);
		this.#asked.add(key);
		const attempt = this.claim()
			.catch((): ClaimOutcome => ({ kind: 'network' }))
			.then((outcome) => {
				// Not signed in after all: the next sign-in of this run asks.
				if (outcome.kind === 'signed_out') this.#asked.delete(key);
				const before = this.get(key);
				const next = recordAfter(before, outcome, this.now());
				if (next && next !== before) this.#put(key, next);
				return next;
			})
			.finally(() => this.#inflight.delete(key));
		this.#inflight.set(key, attempt);
		return attempt;
	}

	/** The grant card was dismissed: it does not show again. */
	acknowledge(key: string): TrialRecord | undefined {
		const record = this.get(key);
		if (record?.card !== 'show') return record;
		const next = { ...record, card: 'seen' as const };
		this.#put(key, next);
		return next;
	}
}

// ---------- display ----------

/** An amount of 积分 (CNY): "10", "2.5" (`exact`: always two decimals, "0.00"). */
export function credits(v: string, exact = false): string {
	const n = Number(v);
	if (!Number.isFinite(n)) return v;
	return exact ? n.toFixed(2) : String(Math.round(n * 100) / 100);
}

/** A window's name: "5 小时", "7 天", "每天" / "每周" / "每月" (a paid
 *  plan's calendar windows); another kind as sent. A rolling window of whole
 *  days reads in days ("336h", as the gateway names a 14-day rule, is
 *  "14 天"): the exact length, in the largest whole unit. */
export function windowLabel(kind: string): string {
	const calendar = { day: 'shell.trial.day', week: 'shell.trial.week', month: 'shell.trial.month' } as const;
	const named = calendar[kind.trim().toLowerCase() as keyof typeof calendar];
	if (named) return t(named);
	const m = /^(\d+)\s*([hd])$/i.exec(kind.trim());
	if (!m) return kind;
	const n = Number(m[1]);
	if (m[2].toLowerCase() === 'h' && n >= 24 && n % 24 === 0) return t('chat.quota.days', { n: n / 24 });
	return t(m[2].toLowerCase() === 'h' ? 'chat.quota.hours' : 'chat.quota.days', { n });
}

/** Length of a window in hours, to order them (unknown kinds last). */
function windowHours(kind: string): number {
	const calendar: Record<string, number> = { day: 24, week: 168, month: 720 };
	const named = calendar[kind.trim().toLowerCase()];
	if (named) return named;
	const m = /^(\d+)\s*([hd])$/i.exec(kind.trim());
	return m ? Number(m[1]) * (m[2].toLowerCase() === 'd' ? 24 : 1) : Number.POSITIVE_INFINITY;
}

/** The windows, shortest first. */
export const sortedWindows = (plan: TrialPlan): TrialWindow[] => [...plan.windows].sort((a, b) => windowHours(a.kind) - windowHours(b.kind));

/** Share of a window used, 0–1. */
export function usedShare(w: TrialWindow): number {
	const quota = Number(w.quota_cny);
	const used = Number(w.used_cny);
	if (!(quota > 0) || !Number.isFinite(used)) return 0;
	return Math.min(1, Math.max(0, used / quota));
}

/** The window with the least left, as a share of its quota (the shorter one
 *  on a tie), and what is left of it: the one line the account card shows.
 *  Null for a plan without windows. */
export function tightestWindow(plan: TrialPlan): { window: TrialWindow; left: string; share: number } | null {
	let best: { window: TrialWindow; left: string; share: number } | null = null;
	for (const w of sortedWindows(plan)) {
		const quota = Number(w.quota_cny);
		const used = Number(w.used_cny);
		const left = Math.max(0, (Number.isFinite(quota) ? quota : 0) - (Number.isFinite(used) ? used : 0));
		const share = usedShare(w);
		if (!best || share > best.share) best = { window: w, left: left.toFixed(2), share };
	}
	return best;
}

/** A date for the plan: "10月20日" / "Oct 20", with the time when asked. */
export function planDate(iso: string, withTime = false): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) return '—';
	const zh = getLocale() === 'zh';
	const date = zh ? `${d.getMonth() + 1}月${d.getDate()}日` : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	if (!withTime) return date;
	return `${date} ${d.toLocaleTimeString(zh ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
}

/** The grant card's text: "已赠送 7 天体验套餐" and "国内模型 · 共 10 积分 ·
 *  每 5 小时最多 4 积分 · 到期 10月20日" (also as its parts, which the card
 *  keeps whole on a line). `grantedAt` dates the plan's length. */
export function grantText(plan: TrialPlan, grantedAt: number): { title: string; body: string; parts: string[] } {
	const days = Math.max(1, Math.round((Date.parse(plan.expires_at) - grantedAt) / 86_400_000));
	const windows = sortedWindows(plan);
	const longest = windows.at(-1);
	const parts = [plan.group.trim() || t('shell.trial.domestic')];
	if (longest) parts.push(t('shell.trial.total', { n: credits(longest.quota_cny) }));
	for (const w of windows.slice(0, -1)) parts.push(t('shell.trial.perWindow', { window: windowLabel(w.kind), n: credits(w.quota_cny) }));
	parts.push(t('shell.trial.until', { date: planDate(plan.expires_at) }));
	return { title: t('shell.trial.grantTitle', { days }), body: parts.join(' · '), parts };
}
