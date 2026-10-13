// The first-use trial plan (gateway contract: notes/trial-plan-client.md).
// After a sign-in the app asks the gateway once per installation and account
// for the trial; the gateway alone decides who gets it. This module is the
// claim's state machine and the plan's display helpers, without Tauri or
// Svelte; trial.svelte.ts runs it for the app.
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
	return { name: text(p.name) ?? '', group: text(p.group) ?? '', windows, expires_at: expires };
}

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

/** A claim is due: nothing remembered, or the last attempt failed on the network. */
export const needsClaim = (record: TrialRecord | undefined): boolean => !record || record.status === 'network';

/** The record after an attempt; undefined when nothing is to be remembered. */
export function recordAfter(prev: TrialRecord | undefined, outcome: ClaimOutcome, now: number): TrialRecord | undefined {
	switch (outcome.kind) {
		case 'signed_out':
			return prev;
		case 'network':
			return { status: 'network', at: now, failures: (prev?.failures ?? 0) + 1 };
		case 'granted':
		case 'already_granted':
			return {
				status: outcome.kind,
				at: now,
				plan: outcome.plan,
				// A repeat after a network failure may be the grant whose answer was
				// lost on the way: it is announced as well.
				card: outcome.kind === 'granted' || prev?.status === 'network' ? 'show' : undefined
			};
		default:
			return { status: outcome.kind, at: now };
	}
}

/** The trial plan in force: granted, and not expired. */
export function activePlan(record: TrialRecord | null | undefined, now: number): TrialPlan | null {
	if (!record || (record.status !== 'granted' && record.status !== 'already_granted') || !record.plan) return null;
	return Date.parse(record.plan.expires_at) > now ? record.plan : null;
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
 * Claims the trial at most once per installation and account. An outcome is
 * remembered (except "signed out"), so a later run does not ask again; only a
 * network failure leaves the claim due. Concurrent runs for one key share one
 * request.
 */
export class TrialClaims {
	#inflight = new Map<string, Promise<TrialRecord | undefined>>();

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

	/** Claims for `key` when due; answers the record as it stands after. */
	run(key: string): Promise<TrialRecord | undefined> {
		const pending = this.#inflight.get(key);
		if (pending) return pending;
		const prev = this.get(key);
		if (!needsClaim(prev)) return Promise.resolve(prev);
		const attempt = this.claim()
			.catch((): ClaimOutcome => ({ kind: 'network' }))
			.then((outcome) => {
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

/** A window's name: "5 小时", "7 天"; another kind as sent. */
export function windowLabel(kind: string): string {
	const m = /^(\d+)\s*([hd])$/i.exec(kind.trim());
	if (!m) return kind;
	return t(m[2].toLowerCase() === 'h' ? 'chat.quota.hours' : 'chat.quota.days', { n: Number(m[1]) });
}

/** Length of a window in hours, to order them (unknown kinds last). */
function windowHours(kind: string): number {
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
 *  每 5 小时最多 4 积分 · 到期 10月20日". `grantedAt` dates the plan's length. */
export function grantText(plan: TrialPlan, grantedAt: number): { title: string; body: string } {
	const days = Math.max(1, Math.round((Date.parse(plan.expires_at) - grantedAt) / 86_400_000));
	const windows = sortedWindows(plan);
	const longest = windows.at(-1);
	const parts = [plan.group.trim() || t('shell.trial.domestic')];
	if (longest) parts.push(t('shell.trial.total', { n: credits(longest.quota_cny) }));
	for (const w of windows.slice(0, -1)) parts.push(t('shell.trial.perWindow', { window: windowLabel(w.kind), n: credits(w.quota_cny) }));
	parts.push(t('shell.trial.until', { date: planDate(plan.expires_at) }));
	return { title: t('shell.trial.grantTitle', { days }), body: parts.join(' · ') };
}
