// What the engine's next request holds, from its `context_usage` events:
// `tokens` counts the conversation only; the LynShen engine also sends
// `breakdown`, the whole request by part. Pure helpers for ChatState and the
// composer's context ring.

/** Request parts, in the order the context card lists them. */
export const BREAKDOWN_KEYS = ['system_tools', 'skills', 'system_prompt', 'messages', 'mcp_tools'] as const;
export type BreakdownKey = (typeof BREAKDOWN_KEYS)[number];
/** Token count per request part; a part the engine left out is absent. */
export type RequestParts = Partial<Record<BreakdownKey, number>>;

/** `context_usage.breakdown` → known parts with a token count; null when
 *  the event has none (older engines, Claude Code, Codex). */
export function parseBreakdown(v: unknown): RequestParts | null {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
	const src = v as Record<string, unknown>;
	const out: RequestParts = {};
	let any = false;
	for (const k of BREAKDOWN_KEYS) {
		const n = src[k];
		if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
			out[k] = n;
			any = true;
		}
	}
	return any ? out : null;
}

/** The whole request: the sum of its parts. */
export function breakdownTotal(b: RequestParts): number {
	return BREAKDOWN_KEYS.reduce((sum, k) => sum + (b[k] ?? 0), 0);
}

// One decimal below 100 ("2.9", "25.8"), whole numbers above ("258").
const short = (x: number) => (x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));

/** Token count for the context card: 万 in Chinese ("2.9万", "100万"),
 *  k / M in English ("29k", "1M"). */
export function fmtCtxTokens(n: number, locale: 'zh' | 'en'): string {
	const v = Math.max(0, n);
	if (locale === 'zh') return v < 10_000 ? String(Math.round(v)) : `${short(v / 10_000)}万`;
	if (v < 1000) return String(Math.round(v));
	return v < 1_000_000 && Math.round(v / 1000) < 1000 ? `${short(v / 1000)}k` : `${short(v / 1_000_000)}M`;
}

/** A percentage (0–100): one decimal below 10 ("2.9%"), whole above ("46%"). */
export function fmtPct(p: number): string {
	const v = Math.max(0, p);
	return `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)}%`;
}
