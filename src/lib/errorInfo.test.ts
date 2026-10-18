import { describe, it, expect } from 'vitest';
import { describeError, stripEngineHint } from './errorInfo';

describe('describeError', () => {
	it('reads a gateway 401 as the session credential running out, not a codex login', () => {
		const raw =
			"unexpected status 401 Unauthorized: invalid token, url: https://api.lynshen.org/v1/responses, request id: 2e5d62a1-6dfa-4d1b-8ce2-ef42f25ee84a (Codex needs to sign in again: run `codex login` in a terminal.)";
		expect(describeError(raw, 'codex')).toEqual({
			kind: 'lynshenAuth',
			actions: ['restart'],
			status: 401,
			requestId: '2e5d62a1-6dfa-4d1b-8ce2-ef42f25ee84a'
		});
		expect(stripEngineHint(raw)).not.toContain('codex login');
	});

	it('reads a 401 on a provider key of the user as a key to fix, a gateway 401 as an expired login', () => {
		const raw = 'LLM API returned HTTP 401: {"error":{"message":"Authentication Fails, Your api key: ****test is invalid","type":"authentication_error"}}';
		expect(describeError(raw, 'lynshen', 'deepseek')).toMatchObject({ kind: 'providerKey', actions: ['providers'], subject: 'deepseek', status: 401 });
		expect(describeError(raw, 'lynshen', 'monoize')).toMatchObject({ kind: 'lynshenAuth', actions: ['restart'] });
		expect(describeError(raw, 'lynshen')).toMatchObject({ kind: 'lynshenAuth' });
	});

	it('names the tool for a 401 from its own account', () => {
		expect(describeError('unexpected status 401 Unauthorized: invalid api key, url: https://api.openai.com/v1/responses', 'codex'))
			.toMatchObject({ kind: 'toolAuth', subject: 'Codex' });
	});

	it.each([
		['API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"messages.1.content.0: Invalid `signature` in `thinking` block"}}', 'foreignHistory'],
		['failed to load configuration: Model provider `recodex` not found', 'providerMissing'],
		['LynShen session expired. Run /login to sign in again.', 'lynshenLogin'],
		['unexpected status 402 Payment Required: 余额不足', 'balance'],
		['unexpected status 402 Payment Required: {"error":{"code":"plan_quota_exhausted","message":"plan quota exhausted"}}', 'planQuota'],
		['API Error: 402 plan quota exhausted', 'planQuota'],
		['unexpected status 402 Payment Required: {"error":{"code":"plan_inactive"}}', 'planInactive'],
		['unexpected status 403 Forbidden: {"error":{"code":"model_not_in_plan"}}', 'notInPlan'],
		["This model's maximum context length is 258400 tokens. context_length_exceeded", 'context'],
		['prompt is too long: 212345 tokens > 200000 maximum', 'context'],
		['unexpected status 429 Too Many Requests: rate limit reached', 'rateLimit'],
		['API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}', 'upstream'],
		['unexpected status 502 Bad Gateway', 'upstream'],
		['stream disconnected before completion: error sending request', 'network'],
		['model_not_found: The model `gpt-9` does not exist', 'model'],
		['API Error: 400 请求参数有误，请检查后重试', 'badRequest']
	])('%s → %s', (raw, kind) => {
		expect(describeError(raw)?.kind).toBe(kind);
	});

	it('offers a top-up when the balance is short', () => {
		expect(describeError('API Error: 402 余额不足', 'claude')).toMatchObject({ kind: 'balance', actions: ['topUp'] });
		expect(describeError('LLM API returned HTTP 402: insufficient balance', 'lynshen', 'monoize')).toMatchObject({ actions: ['topUp'] });
		// A key of the user's own is topped up at its provider, not here.
		expect(describeError('LLM API returned HTTP 402: insufficient balance', 'lynshen', 'deepseek')).toMatchObject({ actions: ['account'] });
		expect(describeError('API Error: 402 余额不足')?.plan).toBeUndefined();
	});

	it('reads what the plan refused, with the ways on side by side (never the balance by itself)', () => {
		const quota =
			'unexpected status 402 Payment Required: {"error":{"code":"plan_quota_exhausted","message":"plan quota exhausted","details":{"window":"5h","resets_at":"2026-10-17T13:20:00Z"}}}';
		expect(describeError(quota, 'codex')).toMatchObject({
			kind: 'planQuota',
			actions: ['waitPlan', 'balanceUntilReset', 'purchase'],
			status: 402,
			plan: { code: 'plan_quota_exhausted', window: '5h', resetsAt: Date.parse('2026-10-17T13:20:00Z') }
		});
		// The Anthropic envelope of /v1/messages, quoted once more by an engine.
		const quoted = 'Error: "{\\"type\\":\\"error\\",\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"code\\":\\"plan_quota_exhausted\\",\\"window\\":\\"7d\\",\\"retry_at\\":1792236000}}"';
		expect(describeError(quoted, 'claude')?.plan).toEqual({ code: 'plan_quota_exhausted', window: '7d', resetsAt: 1792236000_000 });
		expect(
			describeError('LLM API returned HTTP 402: {"error":{"code":"plan_inactive","details":{"plan_name":"Grove","ended_at":"2026-10-16T08:00:00Z"}}}', 'lynshen', 'monoize')
		).toMatchObject({ kind: 'planInactive', actions: ['renew', 'useBalance'], plan: { code: 'plan_inactive', planName: 'Grove', endedAt: Date.parse('2026-10-16T08:00:00Z') } });
		expect(describeError('unexpected status 403 Forbidden: {"error":{"code":"model_not_in_plan","message":"model claude-opus-5-5 is not in the plan","details":{"model":"claude-opus-5-5"}}}', 'codex')).toMatchObject({
			kind: 'notInPlan',
			actions: ['model', 'useBalance'],
			subject: 'claude-opus-5-5',
			status: 403
		});
		// No plan in force at all: buy one (nothing to renew).
		expect(describeError('API Error: 402 {"error":{"code":"plan_inactive","plan_name":null,"ended_at":null,"reason":"none"}}', 'claude')).toMatchObject({
			kind: 'planInactive',
			actions: ['purchase', 'useBalance']
		});
		// A fourth device: not a rate limit, and never retried by itself.
		expect(describeError('unexpected status 429 Too Many Requests: {"error":{"code":"plan_device_limit","limit":3,"in_use":3}}', 'codex')).toMatchObject({
			kind: 'planDevices',
			actions: ['useBalance', 'devices']
		});
		// Without details: still the plan's, not a balance or permission problem.
		expect(describeError('API Error: 402 plan quota exhausted')).toMatchObject({ kind: 'planQuota', plan: { code: 'plan_quota_exhausted' } });
		expect(describeError('API Error: 403 model_not_in_plan')?.kind).toBe('notInPlan');
	});

	it('leaves errors it does not know alone', () => {
		expect(describeError('the tool crashed in an odd way')).toBeNull();
	});

	it('maps the gateway hardware binding refusals (AD-H6, AD-L1) to cards with a way on', () => {
		const body = (code: string, message: string) => `HTTP 403: {"error":{"code":"${code}","message":"${message}"}}`;
		expect(describeError(body('device_hwid_mismatch', '这个设备密钥是在另一台电脑上授权的'), 'lynshen', 'monoize')).toMatchObject({
			kind: 'deviceMismatch',
			actions: ['login', 'devices'],
			status: 403
		});
		expect(describeError(body('device_client_outdated', '请把 Aogiri / LynShen CLI 更新到最新版本'), 'lynshen', 'monoize')).toMatchObject({
			kind: 'deviceOutdated',
			actions: ['restart']
		});
		expect(describeError(body('device_limit_reached', '这个账户已授权 5 台电脑'), 'lynshen', 'monoize')).toMatchObject({
			kind: 'deviceLimit',
			actions: ['devices']
		});
	});
});
