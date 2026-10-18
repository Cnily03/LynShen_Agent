// An engine error in words a user can act on. The engines pass provider
// errors through raw (`unexpected status 401 Unauthorized: invalid token,
// url: …`); this names what went wrong, what to do, and which button does it.
// Unknown errors return null and show as they came.
import { planStopOf, type PlanStop } from './planStop';

/** `purchase` / `renew` / `topUp`: Settings → 套餐与充值; `useBalance`:
 *  this device pays with the balance from its next request, and the stopped
 *  turn goes on; `balanceUntilReset`: the same until the plan's used-up
 *  window recovers (then the plan again); `waitPlan`: the turn goes on once
 *  the window recovers (planStop.ts). */
export type ErrorAction =
	| 'restart'
	| 'login'
	| 'account'
	| 'compact'
	| 'model'
	| 'providers'
	| 'purchase'
	| 'renew'
	| 'topUp'
	| 'useBalance'
	| 'waitPlan'
	| 'balanceUntilReset'
	| 'devices';

export interface ErrorInfo {
	/** i18n key under `chat.err.<kind>` for the title and the hint. */
	kind: string;
	/** The ways out, as buttons, in this order. */
	actions?: ErrorAction[];
	/** What the plan refused (a device that pays with its plan). */
	plan?: PlanStop;
	/** Named in the hint: the provider, the tool, the model. */
	subject?: string;
	/** The HTTP status and request id, when the raw text carries them. */
	status?: number;
	requestId?: string;
}

// The engines append their own sign-in hint to a 401; ours replaces it.
const ENGINE_HINT = /\s*\((?:Codex|Claude Code) needs to sign in again:[^)]*\)\s*$/;

/** The raw text without the engine's appended sign-in hint. */
export function stripEngineHint(raw: string): string {
	return raw.replace(ENGINE_HINT, '');
}

function statusOf(raw: string): number | undefined {
	const m =
		/\b(?:status(?: code)?|HTTP)\s*:?\s*(\d{3})\b/i.exec(raw) ??
		/\bAPI Error:\s*(\d{3})\b/i.exec(raw) ??
		/"status"\s*:\s*(\d{3})/.exec(raw);
	return m ? Number(m[1]) : undefined;
}

function requestIdOf(raw: string): string | undefined {
	return /request[ _-]?id["']?\s*[:=]\s*["']?([\w-]{8,})/i.exec(raw)?.[1];
}

/** The providers whose credential is a LynShen sign-in: a 401 there is an
 *  expired session, not a wrong key. */
const LYNSHEN_PROVIDERS = new Set(['lynshen', 'monoize']);

/** `backend` is the session's engine (`lynshen`, `claude`, `codex`, `acp`);
 *  `provider` the LynShen engine's provider (`monoize`, `deepseek`, …). */
export function describeError(raw: string, backend = '', provider = ''): ErrorInfo | null {
	const text = stripEngineHint(raw);
	const low = text.toLowerCase();
	const status = statusOf(text);
	const requestId = requestIdOf(text);
	const info = (kind: string, action?: ErrorAction | ErrorAction[], subject?: string): ErrorInfo => ({
		kind,
		...(action ? { actions: Array.isArray(action) ? action : [action] } : {}),
		...(subject ? { subject } : {}),
		...(status ? { status } : {}),
		...(requestId ? { requestId } : {})
	});
	const tool = backend === 'claude' ? 'Claude Code' : backend === 'codex' ? 'Codex' : '';

	// History written by another account: its signed / encrypted parts do not
	// verify here (before the generic 400 below).
	if (/invalid[ `'"]*signature|signature.*thinking|encrypted content.*(verif|decrypt)|could not be verified/i.test(text))
		return info('foreignHistory');
	if (/model provider `?([^`\s]+)`? not found/i.test(text))
		return info('providerMissing', undefined, /model provider `?([^`\s]+)`?/i.exec(text)?.[1]);

	if (/not logged in to lynshen|lynshen session expired|run \/login/i.test(text)) return info('lynshenLogin', 'login');
	// The gateway's hardware binding (gateway AD-H6, AD-L1): the device key
	// belongs to another computer, the engine is too old to name this one, or
	// the account has no free computer seat. The gateway's own text says it in
	// Chinese; the card says what to do.
	if (/device_hwid_mismatch/.test(text)) return info('deviceMismatch', ['login', 'devices']);
	if (/device_client_outdated/.test(text)) return info('deviceOutdated', 'restart');
	if (/device_limit_reached/.test(text)) return info('deviceLimit', 'devices');
	if (status === 401 || /\bunauthori[sz]ed\b|invalid[_ ](api[_ ])?(key|token)|token (is )?expired|authentication_error/i.test(low)) {
		// Through the LynShen gateway: the credential the session started with
		// ran out (it is handed over once, at start); a restart takes a new one.
		// A key of the user's own (DeepSeek, OpenRouter, …) was refused: it is
		// wrong or revoked, and only Settings fixes it.
		if (backend === 'lynshen' && provider && !LYNSHEN_PROVIDERS.has(provider))
			return info('providerKey', 'providers', provider);
		if (/lynshen/i.test(text) || backend === 'lynshen') return info('lynshenAuth', 'restart');
		return info('toolAuth', undefined, tool || undefined);
	}
	// The device pays with its plan, which never falls back to the balance:
	// a used-up window, an ended plan, a model outside the plan or a plan
	// already in use on as many devices as it allows stops the turn (not a
	// balance or rate problem), and the user picks the way on.
	const stop = planStopOf(text);
	if (stop) {
		const ACTIONS: Record<typeof stop.code, ErrorAction[]> = {
			// The balance only until the window recovers (owner, 2026-10-17).
			plan_quota_exhausted: ['waitPlan', 'balanceUntilReset', 'purchase'],
			plan_inactive: [stop.reason === 'none' ? 'purchase' : 'renew', 'useBalance'],
			model_not_in_plan: ['model', 'useBalance'],
			plan_device_limit: ['useBalance', 'devices']
		};
		const KINDS = { plan_quota_exhausted: 'planQuota', plan_inactive: 'planInactive', model_not_in_plan: 'notInPlan', plan_device_limit: 'planDevices' };
		const actions = ACTIONS[stop.code];
		const kind = KINDS[stop.code];
		return { ...info(kind, actions, stop.model), plan: stop };
	}
	// Through the LynShen gateway the balance is topped up in the app; a key
	// of the user's own (DeepSeek, …) is topped up at its provider.
	if (status === 402 || /insufficient[_ ](balance|quota|funds)|余额不足|quota exceeded|billing/i.test(text))
		return info('balance', backend === 'lynshen' && provider && !LYNSHEN_PROVIDERS.has(provider) ? 'account' : 'topUp');
	if (/context[_ ]length|context window|prompt is too long|maximum context|too many tokens|input.*exceeds|上下文/i.test(text))
		return info('context', 'compact');
	if (status === 429 || /rate[ _-]?limit|too many requests|限流|请求过于频繁/i.test(text)) return info('rateLimit');
	if (status === 404 || /model[_ ]not[_ ]found|model .* (does not exist|not found|is not available)|no such model|unknown model/i.test(text))
		return info('model', 'model');
	if (
		(status !== undefined && status >= 500) ||
		/overloaded|bad gateway|service unavailable|gateway timeout|upstream|internal server error/i.test(low)
	)
		return info('upstream');
	if (
		/stream disconnected|stream closed before|response body closed|connection (reset|refused|closed|abort|error|failed)|econn|etimedout|enotfound|timed? ?out|network|dns|error sending request|broken pipe|unexpected eof|io error:|decoding chunk|exceeded retry limit/i.test(
			low
		)
	)
		return info('network');
	if (status === 403 || /forbidden|permission denied|not allowed/i.test(low)) return info('forbidden');
	if (status === 400 || /invalid_request|请求参数有误|bad request/i.test(text)) return info('badRequest');
	return null;
}
