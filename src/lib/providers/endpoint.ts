// The address the LynShen engine sends a model request to, for a provider's
// base URL and wire format. This mirrors the engine's own code (LynShen CLI
// 0.7.0), so the settings can show the real request URL under the Base URL
// field:
// - agent-core `config.rs` `normalize_base_url` (the stored base URL);
// - llm-provider-kit `lib.rs` `Protocol::resolve` (format names);
// - llm-provider-kit `transport.rs` `endpoint` and the URL builders it calls:
//   `responses.rs` `responses_url` / `codex_responses_url` /
//   `azure_responses_url`, `anthropic.rs` `messages_url` / `is_official_url`,
//   `chat.rs` `completions_url`.
// Keep it in step with those functions (endpoint.test.ts repeats the kit's
// test cases).

/** Wire formats as config.json `protocol` names them. */
export type WireFormat = 'responses' | 'codex' | 'azure' | 'anthropic' | 'chat';

/** Hosts the LynShen gateway no longer answers on; the engine moves them. */
const RETIRED_LYNSHEN_HOSTS = ['https://api.lynshen.cn', 'https://api.lynshen.net'];
/** `AZURE_DEFAULT_API_VERSION` (the engine reads `AZURE_OPENAI_API_VERSION` first). */
const AZURE_API_VERSION = 'v1';

/** The base URL as the engine reads it from config.json: trimmed, without
 *  trailing slashes, a retired LynShen host moved to the live one. */
export function normalizeBaseUrl(value: string): string {
	const url = value.trim().replace(/\/+$/, '');
	for (const host of RETIRED_LYNSHEN_HOSTS) {
		if (url.startsWith(host)) {
			const rest = url.slice(host.length);
			if (rest === '' || rest.startsWith('/')) return `https://api.lynshen.org${rest}`;
		}
	}
	return url;
}

/** `Protocol::resolve`: an explicit format wins; otherwise the model decides
 *  (claude-* → Anthropic, the rest → Responses). */
export function resolveFormat(format: string, model = ''): WireFormat {
	if (format === 'anthropic' || format === 'responses' || format === 'codex' || format === 'azure' || format === 'chat') return format;
	return model.startsWith('claude-') ? 'anthropic' : 'responses';
}

/** True when the URL targets the official Anthropic API host. */
export function isOfficialAnthropic(url: string): boolean {
	const host = 'https://api.anthropic.com';
	if (!url.startsWith(host)) return false;
	const rest = url.slice(host.length);
	return rest === '' || rest.startsWith('/');
}

/** `messages_url`: a base ending in /v1 (any host) or the official host gets
 *  /v1/messages; any other base is taken for a gateway with an
 *  /anthropic/v1 mount. */
export function messagesUrl(baseUrl: string): string {
	const base = baseUrl.replace(/\/+$/, '');
	if (base.endsWith('/v1')) return `${base}/messages`;
	if (base.endsWith('/anthropic') || isOfficialAnthropic(base)) return `${base}/v1/messages`;
	return `${base}/anthropic/v1/messages`;
}

/** The URL of one model request: what `transport::endpoint` builds from the
 *  base URL as config.json stores it. */
export function requestUrl(format: string, baseUrl: string, model = ''): string {
	const base = normalizeBaseUrl(baseUrl).replace(/\/+$/, '');
	switch (resolveFormat(format, model)) {
		case 'codex':
			return `${base}/codex/responses`;
		case 'azure':
			return `${base}/responses?api-version=${AZURE_API_VERSION}`;
		case 'anthropic':
			return messagesUrl(base);
		case 'chat':
			return `${base}/chat/completions`;
		default:
			return `${base}/responses`;
	}
}

/** For the Anthropic format, a base URL that is only a host (not the official
 *  one) makes the engine request {host}/anthropic/v1/messages, which most
 *  relays do not serve. Returns the {host}/v1 base to offer instead, or null
 *  when the URL is not such a host. */
export function anthropicV1Suggestion(format: string, baseUrl: string): string | null {
	if (resolveFormat(format) !== 'anthropic') return null;
	const base = normalizeBaseUrl(baseUrl);
	let parsed: URL;
	try {
		parsed = new URL(base);
	} catch {
		return null;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
	if ((parsed.pathname !== '/' && parsed.pathname !== '') || parsed.search || parsed.hash) return null;
	if (isOfficialAnthropic(base)) return null;
	return `${base}/v1`;
}
