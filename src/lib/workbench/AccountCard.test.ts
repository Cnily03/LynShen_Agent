import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { setLocale } from '$lib/i18n';

// The account card with a trial plan in force (trial.svelte.ts stands in).
vi.mock('$lib/trial.svelte', () => ({
	trial: {
		refreshStatus: async () => {},
		plan: {
			name: '7 天体验套餐',
			group: '国内模型分组',
			windows: [
				{ kind: '7d', quota_cny: '10.00', used_cny: '2.50', resets_at: null },
				{ kind: '5h', quota_cny: '4.00', used_cny: '1.00', resets_at: '2026-10-13T12:00:00Z' }
			],
			expires_at: '2026-10-20T08:40:00Z'
		}
	}
}));

const props = (loggedIn: boolean) => ({
	loggedIn,
	user: loggedIn ? { id: 'u1', username: 'Ann', role: 'user' } : null,
	balance: '12.30 CNY',
	left: 0,
	bottom: 0,
	width: 300,
	side: 'top' as const,
	onSignIn() {},
	onSettings() {},
	onUpdate() {},
	onLoggedOut() {}
});
const text = (html: string) => html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the account card', () => {
	it('shows the plan on one line: its name, the tightest window and its end, then the balance', async () => {
		setLocale('zh');
		const { default: AccountCard } = await import('./AccountCard.svelte');
		const shown = text(render(AccountCard, { props: props(true) }).body);
		expect(shown).toContain('7 天体验套餐 10月20日 到期');
		// 7 天: 25% used; 5 小时: 25% used: the shorter one on a tie.
		expect(shown).toContain('5 小时额度剩 3.00 积分');
		expect(shown).toContain('余额 12.30 CNY');
		expect(shown).toContain('设置');
		expect(shown).toContain('退出登录');
		// The rest is in Settings → 账户 / 外观.
		for (const gone of ['最近 60 秒', '计费方式', '显示货币', '主题', '7 天 2.50']) expect(shown).not.toContain(gone);
	});

	it('offers buying a plan or balance when the app can, and only when signed in', async () => {
		const { default: AccountCard } = await import('./AccountCard.svelte');
		expect(text(render(AccountCard, { props: { ...props(true), onPurchase() {} } }).body)).toContain('购买套餐或充值');
		expect(text(render(AccountCard, { props: props(true) }).body)).not.toContain('购买套餐或充值');
		expect(text(render(AccountCard, { props: { ...props(false), onPurchase() {} } }).body)).not.toContain('购买套餐或充值');
	});

	it('reads as loading, not logged out, while the account is read', async () => {
		const { default: AccountCard } = await import('./AccountCard.svelte');
		const shown = text(render(AccountCard, { props: { ...props(true), user: null, balance: null } }).body);
		expect(shown).toContain('正在读取账户…');
		expect(shown).not.toContain('未登录');
		expect(shown).not.toContain('登录 LynShen 账号');
	});

	it('shows no plan while signed out', async () => {
		const { default: AccountCard } = await import('./AccountCard.svelte');
		const shown = text(render(AccountCard, { props: props(false) }).body);
		expect(shown).not.toContain('体验套餐');
		expect(shown).not.toContain('积分');
		expect(shown).toContain('登录 LynShen 账号');
	});
});
