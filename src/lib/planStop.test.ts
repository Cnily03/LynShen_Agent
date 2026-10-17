import { describe, expect, it } from 'vitest';
import { setLocale } from '$lib/i18n';
import { planStopOf, planStopText, resetFromPlan } from './planStop';

const NOW = Date.parse('2026-10-17T10:00:00Z');
const PLAN = {
	name: 'Grove',
	group: '套餐专用',
	windows: [
		{ kind: '5h', quota_cny: '8.00', used_cny: '8.00', resets_at: '2026-10-17T12:30:00Z' },
		{ kind: '7d', quota_cny: '23.00', used_cny: '9.00', resets_at: '2026-10-20T08:00:00Z' }
	],
	expires_at: '2026-11-16T00:00:00Z'
};

describe('planStopOf', () => {
	it('reads the code and its details, also from a body quoted again', () => {
		expect(planStopOf('{"error":{"code":"plan_quota_exhausted","details":{"window":"7d","resets_at":"2026-10-20T08:00:00Z"}}}')).toEqual({
			code: 'plan_quota_exhausted',
			window: '7d',
			resetsAt: Date.parse('2026-10-20T08:00:00Z')
		});
		expect(planStopOf('"{\\"code\\":\\"plan_inactive\\",\\"details\\":{\\"plan_name\\":\\"Grove \\u5957\\u9910\\",\\"ended_at\\":1792224000}}"')).toEqual({
			code: 'plan_inactive',
			planName: 'Grove 套餐',
			endedAt: 1792224000_000
		});
		expect(planStopOf('model_not_in_plan')).toEqual({ code: 'model_not_in_plan' });
		expect(planStopOf('insufficient balance')).toBeNull();
	});
});

describe('planStopOf, the gateway contract v1 (notes/plan-balance-contract.md 3)', () => {
	const W = (kind: string, resets: string | null) => ({ kind, quota_cny: '8.00', used_cny: '8.00', in_flight_cny: '0.00', remaining_cny: '0.00', resets_at: resets });
	it('reads plan_quota_exhausted with retry_at, else the refusing window of `windows`', () => {
		const body = {
			error: { code: 'plan_quota_exhausted', type: 'invalid_request_error', param: null, message: '套餐额度已用完', plan_name: 'Grove', window: '7d', retry_at: '2026-10-20T08:00:00Z', windows: [W('5h', '2026-10-17T12:30:00Z'), W('7d', '2026-10-20T08:00:00Z')] }
		};
		expect(planStopOf(`unexpected status 402 Payment Required: ${JSON.stringify(body)}, url: https://api.lynshen.org/v1/responses`)).toEqual({
			code: 'plan_quota_exhausted',
			window: '7d',
			planName: 'Grove',
			resetsAt: Date.parse('2026-10-20T08:00:00Z')
		});
		const noRetry = { error: { ...body.error, retry_at: null } };
		expect(planStopOf(`API Error: 402 ${JSON.stringify(noRetry)}`)?.resetsAt).toBe(Date.parse('2026-10-20T08:00:00Z'));
	});
	it('reads the Anthropic envelope of /v1/messages', () => {
		const body = { type: 'error', error: { type: 'invalid_request_error', message: '…', code: 'model_not_in_plan', model: 'claude-opus-5-5', plan_name: 'Grove' }, request_id: 'req_1' };
		expect(planStopOf(`API Error: 403 ${JSON.stringify(body)}`)).toEqual({ code: 'model_not_in_plan', model: 'claude-opus-5-5', planName: 'Grove' });
	});
	it('reads plan_inactive with its reason', () => {
		const ended = { error: { code: 'plan_inactive', type: 'invalid_request_error', param: null, message: '…', plan_name: 'Grove', ended_at: '2026-10-16T08:00:00Z', reason: 'expired' } };
		expect(planStopOf(JSON.stringify(ended))).toEqual({ code: 'plan_inactive', planName: 'Grove', endedAt: Date.parse('2026-10-16T08:00:00Z'), reason: 'expired' });
		const none = { error: { code: 'plan_inactive', plan_name: null, ended_at: null, reason: 'none' } };
		expect(planStopOf(JSON.stringify(none))).toEqual({ code: 'plan_inactive', reason: 'none' });
		setLocale('zh');
		expect(planStopText({ code: 'plan_inactive', reason: 'none' }, undefined, NOW).title).toBe('现在没有生效的套餐');
		expect(planStopText({ code: 'plan_inactive', reason: 'revoked', planName: 'Grove' }, undefined, NOW).title).toBe('Grove 已停用');
	});
});

describe('planStopOf, a fourth device (proposed v1.2)', () => {
	it('reads plan_device_limit with the limit that was hit', () => {
		const body = { error: { code: 'plan_device_limit', type: 'rate_limit_error', param: null, message: '…', limit: 3, in_use: 3, plan_name: 'Grove' } };
		expect(planStopOf(`unexpected status 429 Too Many Requests: ${JSON.stringify(body)}`)).toEqual({ code: 'plan_device_limit', limit: 3, inUse: 3, planName: 'Grove' });
		setLocale('zh');
		expect(planStopText({ code: 'plan_device_limit', limit: 3 }, undefined, NOW).title).toBe('套餐已在 3 台设备上使用，已达上限');
	});
});

describe('resetFromPlan', () => {
	it('takes the window the error names, else the fullest one, and only a time ahead', () => {
		expect(resetFromPlan(PLAN, '7d', NOW)).toBe(Date.parse('2026-10-20T08:00:00Z'));
		expect(resetFromPlan(PLAN, undefined, NOW)).toBe(Date.parse('2026-10-17T12:30:00Z'));
		expect(resetFromPlan(PLAN, undefined, Date.parse('2026-10-18T00:00:00Z'))).toBeUndefined();
		expect(resetFromPlan(null)).toBeUndefined();
	});
});

describe('planStopText', () => {
	it('names the window and when it recovers, and never offers the balance by itself', () => {
		setLocale('zh');
		const words = planStopText({ code: 'plan_quota_exhausted', window: '5h' }, NOW + 2 * 3_600_000, NOW);
		expect(words.title).toBe('套餐 5 小时额度用完了');
		expect(words.hint).toMatch(/^\d\d:\d\d 恢复。/);
		expect(words.hint).toContain('不会自动改扣余额');
		expect(planStopText({ code: 'plan_quota_exhausted' }, undefined, NOW).title).toBe('套餐额度用完了');
		expect(planStopText({ code: 'plan_inactive', planName: 'Grove' }, undefined, NOW).title).toBe('Grove 已结束');
		expect(planStopText({ code: 'model_not_in_plan', model: 'gpt-6.1-sol' }, undefined, NOW).title).toBe('gpt-6.1-sol 不在套餐内');
		setLocale('en');
		expect(planStopText({ code: 'plan_quota_exhausted', window: '7d' }, undefined, NOW).title).toBe("The plan's 7 days quota is used up");
		setLocale('zh');
	});
});
