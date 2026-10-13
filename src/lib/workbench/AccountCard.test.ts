import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { setLocale } from '$lib/i18n';

// The account card with a trial plan in force (trial.svelte.ts stands in).
vi.mock('$lib/trial.svelte', () => ({
	trial: {
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
	it('shows the trial plan: both windows, shortest first, and its end', async () => {
		setLocale('zh');
		const { default: AccountCard } = await import('./AccountCard.svelte');
		const shown = text(render(AccountCard, { props: props(true) }).body);
		expect(shown).toContain('套餐 7 天体验套餐');
		expect(shown).toMatch(/5 小时 1\.00 \/ 4\.00 积分 .*7 天 2\.50 \/ 10\.00 积分/);
		expect(shown).toMatch(/10月13日 \d\d:00 恢复/);
		expect(shown).toMatch(/10月20日 \d\d:40 到期/);
		expect(shown).not.toContain('未分配订阅套餐');
	});

	it('shows no plan while signed out', async () => {
		const { default: AccountCard } = await import('./AccountCard.svelte');
		const shown = text(render(AccountCard, { props: props(false) }).body);
		expect(shown).not.toContain('体验套餐');
		expect(shown).not.toContain('积分');
	});
});
