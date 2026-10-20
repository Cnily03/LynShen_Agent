import { describe, expect, it } from 'vitest';
import { costText, pendingCost, sumCosts } from './sessionCost';
import { turnParts } from './turnStats';
import { setLocale } from './i18n';
import type { TurnStats } from './chat.svelte';

describe('session cost display', () => {
	it('keeps billed points separate from estimated dollars and labels incomplete charges', () => {
		setLocale('zh');
		const settled = { ...pendingCost(), gateway_cost: 0.05, pending_requests: 0 };
		const mixed = sumCosts([settled, { ...pendingCost(), gateway_requests: 0, pending_requests: 0, estimated_cost_usd: 0.12, unpriced_requests: 1 }]);
		expect(costText(99, mixed)).toBe('0.0500 积分 · 估算 $0.1200 · 部分费用未知');
		expect(costText(99, pendingCost())).toBe('待结算');
		expect(costText(99, { ...settled, gateway_cost: 0 })).toBe('0.0000 积分');
		expect(costText(0.05)).toBe('估算 $0.0500');
		expect(costText(0)).toBe('—');
		const turn = { cost: 99, billing: settled } as TurnStats;
		expect(turnParts(turn, ['cost'])).toEqual([{ text: '0.0500 积分', title: '实际扣费，已包含分组倍率', mono: true }]);
	});
});

describe('turn figures', () => {
	it('name the model in the duration’s tooltip when the model is not shown', () => {
		setLocale('zh');
		const turn = { elapsed: 49200, model: 'claude-haiku-5-5', inTokens: 0, outTokens: 0, files: 0, added: 0, removed: 0, tools: 0, cost: 0, segments: 0 } as TurnStats;
		expect(turnParts(turn, ['elapsed'])[0]).toEqual({ text: '49.2s', title: '本轮总耗时 · claude-haiku-5-5', mono: true });
		expect(turnParts(turn, ['elapsed', 'model'])[0]!.title).toBe('本轮总耗时');
	});
});
