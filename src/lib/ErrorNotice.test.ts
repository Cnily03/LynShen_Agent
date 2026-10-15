import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { setLocale } from '$lib/i18n';

const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** The labels of the notice's buttons. */
const buttons = (html: string) =>
	[...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]).trim()).filter(Boolean);

describe('the error notice', () => {
	it('offers a larger plan and the balance when the plan is used up', async () => {
		setLocale('zh');
		const { default: ErrorNotice } = await import('./ErrorNotice.svelte');
		const body = render(ErrorNotice, {
			props: { text: 'unexpected status 402 Payment Required: {"error":{"code":"plan_quota_exhausted"}}', backend: 'codex', onAction() {} }
		}).body;
		expect(text(body)).toContain('套餐额度用完了');
		expect(buttons(body)).toEqual(['购买套餐', '改用余额', '原始信息']);
	});

	it('offers a top-up when the balance is short, and no second action', async () => {
		const { default: ErrorNotice } = await import('./ErrorNotice.svelte');
		const body = render(ErrorNotice, { props: { text: 'API Error: 402 余额不足', backend: 'claude', onAction() {} } }).body;
		expect(text(body)).toContain('账户余额不足');
		expect(buttons(body)).toEqual(['充值', '原始信息']);
	});
});
