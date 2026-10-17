import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { setLocale } from '$lib/i18n';

const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
/** The labels of the notice's buttons. */
const buttons = (html: string) =>
	[...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => text(m[1]).trim()).filter(Boolean);

describe('the error notice', () => {
	it('offers waiting, the balance until it recovers and a plan side by side when the plan is used up', async () => {
		setLocale('zh');
		const { default: ErrorNotice } = await import('./ErrorNotice.svelte');
		const resets = new Date(Date.now() + 2 * 3_600_000);
		const time = `${String(resets.getHours()).padStart(2, '0')}:${String(resets.getMinutes()).padStart(2, '0')}`;
		const body = render(ErrorNotice, {
			props: {
				text: `unexpected status 402 Payment Required: {"error":{"code":"plan_quota_exhausted","details":{"window":"5h","resets_at":"${resets.toISOString()}"}}}`,
				backend: 'codex',
				onAction() {}
			}
		}).body;
		expect(text(body)).toContain('套餐 5 小时额度用完了');
		expect(text(body)).toContain(`${time} 恢复`);
		expect(text(body)).toContain('不会自动改扣余额');
		expect(buttons(body)).toEqual([`等待恢复 · ${time}`, '额度恢复前先用余额', '购买套餐', '原始信息']);
		// No primary among them: the user decides.
		expect(body).not.toMatch(/class="b primary/);
	});

	it('shows the wait and drops the wait button while the turn waits', async () => {
		const { default: ErrorNotice } = await import('./ErrorNotice.svelte');
		const at = Date.now() + 3_600_000;
		const body = render(ErrorNotice, {
			props: {
				text: `API Error: 402 {"error":{"code":"plan_quota_exhausted","details":{"resets_at":"${new Date(at).toISOString()}"}}}`,
				backend: 'claude',
				waitingUntil: at,
				onAction() {},
				onCancelWait() {}
			}
		}).body;
		expect(text(body)).toContain('恢复后自动继续');
		expect(buttons(body)).toEqual(['取消等待', '额度恢复前先用余额', '购买套餐', '原始信息']);
	});

	it('offers renewing or the balance for an ended plan, another model or the balance outside the plan', async () => {
		const { default: ErrorNotice } = await import('./ErrorNotice.svelte');
		const ended = render(ErrorNotice, {
			props: { text: 'API Error: 402 {"error":{"code":"plan_inactive","details":{"plan_name":"Grove"}}}', backend: 'claude', onAction() {} }
		}).body;
		expect(text(ended)).toContain('Grove 已结束');
		expect(buttons(ended)).toEqual(['续费套餐', '改用余额继续', '原始信息']);
		const outside = render(ErrorNotice, {
			props: { text: 'unexpected status 403 Forbidden: {"error":{"code":"model_not_in_plan","details":{"model":"claude-opus-5-5"}}}', backend: 'codex', onAction() {} }
		}).body;
		expect(text(outside)).toContain('claude-opus-5-5 不在套餐内');
		expect(buttons(outside)).toEqual(['换个模型', '改用余额继续', '原始信息']);
	});

	it('offers a top-up when the balance is short, and no second action', async () => {
		const { default: ErrorNotice } = await import('./ErrorNotice.svelte');
		const body = render(ErrorNotice, { props: { text: 'API Error: 402 余额不足', backend: 'claude', onAction() {} } }).body;
		expect(text(body)).toContain('账户余额不足');
		expect(buttons(body)).toEqual(['充值', '原始信息']);
	});
});
