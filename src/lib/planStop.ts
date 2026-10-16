// A request the plan refused (gateway contract notes/plan-balance-contract.md
// section 3; design notes/plan-balance-separation.md 3.4). A device that pays
// with its plan never falls back to the balance: a used-up window (402
// `plan_quota_exhausted`, with the window and when it recovers), no plan in
// force (402 `plan_inactive`, with the last plan's name, end and why) or a
// model the plan does not include (403 `model_not_in_plan`) stops the turn,
// and the user picks what happens next: wait for the window, pay with the
// balance and go on, buy or renew a plan, or pick another model. The engines
// pass the gateway's answer through as text; this reads it by its `code`
// (never by its message), with the fields beside it in the error object.

import { getLocale, t } from '$lib/i18n';
import { planDate, sortedWindows, usedShare, windowLabel, type TrialPlan } from '$lib/trial';
import { fmtResetAt } from '$lib/composer/quota';

export type PlanStopCode = 'plan_quota_exhausted' | 'plan_inactive' | 'model_not_in_plan' | 'plan_device_limit';

export interface PlanStop {
	code: PlanStopCode;
	/** The window that refused ("5h", "7d", …). */
	window?: string;
	/** When it recovers (ms since the epoch): the gateway's `retry_at`. */
	resetsAt?: number;
	/** The plan (the last one, for `plan_inactive`). */
	planName?: string;
	/** When it ended, was suspended or revoked (ms). */
	endedAt?: number;
	/** Why there is no plan in force: `none` (never had one), `expired`,
	 *  `suspended`, `revoked`, `not_started`. */
	reason?: string;
	/** The model the plan does not include. */
	model?: string;
	/** `plan_device_limit`: the devices the plan allows at once, and in use. */
	limit?: number;
	inUse?: number;
}

const CODES: [PlanStopCode, RegExp][] = [
	['plan_quota_exhausted', /plan[_ ]quota[_ ]exhausted/i],
	['plan_inactive', /plan[_ ]inactive/i],
	['model_not_in_plan', /model[_ ]not[_ ]in[_ ]plan/i],
	['plan_device_limit', /plan[_ ]device[_ ]limit/i]
];

/** The answer with the quotes of JSON an engine quoted again made plain
 *  (`\"code\":\"…\"` reads as `"code":"…"`). */
const plain = (raw: string) => raw.replace(/\\+"/g, '"').replace(/\\\\u([0-9a-fA-F]{4})/g, '\\u$1');

/** The JSON objects in a text (an engine's prefix and suffix around the
 *  gateway's body), outermost first. */
function jsonObjects(text: string): unknown[] {
	const found: unknown[] = [];
	for (let start = text.indexOf('{'); start >= 0; start = text.indexOf('{', start + 1)) {
		let depth = 0;
		let quoted = false;
		for (let i = start; i < text.length; i++) {
			const c = text[i];
			if (quoted) {
				if (c === '\\') i++;
				else if (c === '"') quoted = false;
			} else if (c === '"') quoted = true;
			else if (c === '{') depth++;
			else if (c === '}' && --depth === 0) {
				try {
					found.push(JSON.parse(text.slice(start, i + 1)));
					start = i;
				} catch {
					/* not JSON: the next brace */
				}
				break;
			}
		}
	}
	return found;
}

/** The error object that carries `code` (OpenAI and Anthropic envelopes). */
function errorObject(v: unknown, code: string, depth = 0): Record<string, unknown> | null {
	if (!v || typeof v !== 'object' || depth > 6) return null;
	const o = v as Record<string, unknown>;
	if (o.code === code || (o.type === code && !Array.isArray(v))) return o;
	for (const child of Object.values(o)) {
		const hit = errorObject(child, code, depth + 1);
		if (hit) return hit;
	}
	return null;
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
/** An instant: RFC 3339, or Unix seconds or milliseconds. */
function instant(v: unknown): number | undefined {
	if (typeof v === 'number' && Number.isFinite(v) && v > 0) return v < 1e12 ? v * 1000 : v;
	const s = str(v);
	const ms = s ? Date.parse(s) : NaN;
	return Number.isNaN(ms) ? undefined : ms;
}

/** A field of a body that did not parse as JSON. */
function field(raw: string, name: string): unknown {
	const m = new RegExp(`"${name}"\\s*:\\s*(?:"((?:[^"\\\\]|\\\\.)*)"|(\\d{9,13})\\b)`).exec(plain(raw));
	if (!m) return undefined;
	if (m[2]) return Number(m[2]);
	try {
		return JSON.parse(`"${m[1]}"`);
	} catch {
		return m[1];
	}
}

/** What the plan refused, read from an error's text; null for any other error. */
export function planStopOf(raw: string): PlanStop | null {
	const code = CODES.find(([, re]) => re.test(raw))?.[0];
	if (!code) return null;
	const body = [...jsonObjects(raw), ...jsonObjects(plain(raw))].map((v) => errorObject(v, code)).find(Boolean) ?? null;
	// The fields beside the code; a body that does not parse is searched as text.
	const get = (name: string): unknown => (body ? (body[name] ?? (body.details as Record<string, unknown> | undefined)?.[name]) : field(raw, name));
	const stop: PlanStop = { code };
	const window = str(get('window'));
	// When the window that refused recovers: `retry_at`, else that window's
	// own `resets_at` in the plan's windows sent along.
	const windows = Array.isArray(get('windows')) ? (get('windows') as Record<string, unknown>[]) : [];
	const resetsAt = instant(get('retry_at')) ?? instant(get('resets_at')) ?? instant(windows.find((w) => w?.kind === window)?.resets_at);
	const planName = str(get('plan_name'));
	const endedAt = instant(get('ended_at'));
	const reason = str(get('reason'));
	const model = str(get('model'));
	if (window) stop.window = window;
	if (resetsAt !== undefined) stop.resetsAt = resetsAt;
	if (planName) stop.planName = planName;
	if (endedAt !== undefined) stop.endedAt = endedAt;
	if (reason) stop.reason = reason;
	if (model) stop.model = model;
	const limit = Number(get('limit'));
	const inUse = Number(get('in_use'));
	if (Number.isInteger(limit) && limit > 0) stop.limit = limit;
	if (Number.isInteger(inUse) && inUse >= 0 && get('in_use') != null) stop.inUse = inUse;
	return stop;
}

/** When a used-up window recovers, from the plan as last read, where the
 *  error does not say: the window it names, else the fullest one. */
export function resetFromPlan(plan: TrialPlan | null | undefined, window?: string, now = Date.now()): number | undefined {
	if (!plan) return undefined;
	const windows = sortedWindows(plan);
	const named = window ? windows.find((w) => w.kind === window) : undefined;
	const fullest = named ?? [...windows].sort((a, b) => usedShare(b) - usedShare(a))[0];
	const at = fullest?.resets_at ? Date.parse(fullest.resets_at) : NaN;
	return Number.isFinite(at) && at > now ? at : undefined;
}

/** "21:20" within a day, else "10月21日 21:20". */
export function resetText(at: number, now = Date.now()): string {
	const locale = getLocale() === 'zh' ? 'zh' : 'en';
	const time = fmtResetAt(at, locale, now);
	return at - now < 24 * 3_600_000 ? time : planDate(new Date(at).toISOString(), true);
}

/** The card's title and hint. `resetsAt`: when the window recovers, where
 *  known (the error's, else the plan's). */
export function planStopText(stop: PlanStop, resetsAt: number | undefined, now = Date.now()): { title: string; hint: string } {
	switch (stop.code) {
		case 'plan_quota_exhausted': {
			const title = stop.window ? t('chat.planStop.quotaWindowTitle', { window: windowLabel(stop.window) }) : t('chat.planStop.quotaTitle');
			const hint = resetsAt ? t('chat.planStop.quotaHintAt', { time: resetText(resetsAt, now) }) : t('chat.planStop.quotaHint');
			return { title, hint };
		}
		case 'plan_inactive': {
			if (stop.reason === 'none' || (!stop.planName && !stop.endedAt && !stop.reason))
				return { title: t('chat.planStop.noneTitle'), hint: t('chat.planStop.noneHint') };
			const named = { suspended: 'chat.planStop.suspendedTitle', revoked: 'chat.planStop.revokedTitle', not_started: 'chat.planStop.notStartedTitle' }[
				stop.reason ?? ''
			] as 'chat.planStop.suspendedTitle' | undefined;
			const title = stop.planName ? t(named ?? 'chat.planStop.inactiveNamedTitle', { name: stop.planName }) : t('chat.planStop.inactiveTitle');
			const hint = stop.endedAt && stop.reason !== 'not_started'
				? t('chat.planStop.inactiveHintAt', { date: planDate(new Date(stop.endedAt).toISOString(), true) })
				: t('chat.planStop.inactiveHint');
			return { title, hint };
		}
		case 'plan_device_limit':
			return {
				title: stop.limit ? t('chat.planStop.devicesTitle', { n: stop.limit }) : t('chat.planStop.devicesTitleBare'),
				hint: t('chat.planStop.devicesHint')
			};
		case 'model_not_in_plan':
			return {
				title: stop.model ? t('chat.planStop.notInPlanNamedTitle', { model: stop.model }) : t('chat.planStop.notInPlanTitle'),
				hint: t('chat.planStop.notInPlanHint')
			};
	}
}
