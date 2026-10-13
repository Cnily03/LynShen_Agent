<script lang="ts">
	// Settings → 账户 for a signed-in LynShen Console account: who it is, the
	// money (balance, what was granted and topped up, the plan), the last
	// minute's usage, and the places the account is managed.
	import { onMount } from 'svelte';
	import WalletIcon from 'phosphor-svelte/lib/WalletIcon';
	import SquaresFourIcon from 'phosphor-svelte/lib/SquaresFourIcon';
	import KeyIcon from 'phosphor-svelte/lib/KeyIcon';
	import ChartLineIcon from 'phosphor-svelte/lib/ChartLineIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import SignInIcon from 'phosphor-svelte/lib/SignInIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import GiftIcon from 'phosphor-svelte/lib/GiftIcon';
	import DesktopTowerIcon from 'phosphor-svelte/lib/DesktopTowerIcon';
	import Button from '$lib/ui/Button.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { t } from '$lib/i18n';
	import { prefs } from '$lib/prefs.svelte';
	import { shownBalanceText } from '$lib/money';
	import { openExternal } from '$lib/openExternal';
	import { avatarInitial, cacheHitText, liveCount, roleBadgeKey } from '$lib/account';
	import { fetchMonoizeLiveUsage, readConfig, type LiveUsage, type MonoizeUser } from '$lib/protocol';
	import { trial } from '$lib/trial.svelte';
	import PlanFundingChoice from '$lib/PlanFundingChoice.svelte';

	let {
		user,
		balance,
		logoutError = '',
		onRelogin,
		onLogout,
		onSquare,
		onApiKey,
		onUsage,
		onInvite,
		onDevices
	}: {
		user: MonoizeUser;
		/** The first `balance_infos` entry of /user/balance; null while loading. */
		balance: { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string } | null;
		logoutError?: string;
		onRelogin: () => void;
		onLogout: () => void;
		onSquare: () => void;
		onApiKey: () => void;
		onUsage: () => void;
		/** Settings → 邀请好友. */
		onInvite: () => void;
		/** Settings → 授权设备. */
		onDevices: () => void;
	} = $props();

	const badge = $derived(roleBadgeKey(user.role));
	// The first-use trial plan in force names the plan as well (trial.svelte.ts).
	const trialPlan = $derived(trial.plan);
	const plan = $derived(trialPlan ? trialPlan.name.trim() || t('shell.trial.label') : user.billing_plan?.name?.trim() || '');
	const money = (amount: string | undefined) =>
		balance && amount != null ? shownBalanceText(amount, balance.currency, prefs.balanceCurrency) : '—';

	// The console's web address (the update prompt reads it the same way).
	let web = $state('https://www.lynshen.org');
	// The last minute's usage, every 10 s while the page is open.
	let live = $state<LiveUsage | null>(null);
	onMount(() => {
		void trial.refreshStatus();
		readConfig()
			.then((cfg) => (web = String(cfg.lynshen_web_url || web).replace(/\/+$/, '')))
			.catch(() => {});
		let alive = true;
		const poll = () =>
			fetchMonoizeLiveUsage()
				.then((v) => alive && (live = v))
				.catch(() => alive && (live = null));
		poll();
		const timer = setInterval(poll, 10_000);
		return () => {
			alive = false;
			clearInterval(timer);
		};
	});

	const LINKS = $derived([
		{ icon: WalletIcon, title: t('settings.accountPage.topUp'), sub: t('settings.accountPage.topUpSub'), run: () => openExternal(`${web}/dashboard/wallet`), external: true },
		{ icon: SquaresFourIcon, title: t('settings.monoize.square'), sub: t('settings.accountPage.squareSub'), run: onSquare, external: false },
		{ icon: KeyIcon, title: t('settings.page.apiKey'), sub: t('settings.monoize.managedKey'), run: onApiKey, external: false },
		{ icon: ChartLineIcon, title: t('settings.accountPage.usage'), sub: t('settings.accountPage.usageSub'), run: onUsage, external: false },
		{ icon: GiftIcon, title: t('settings.accountPage.invite'), sub: t('settings.accountPage.inviteSub'), run: onInvite, external: false },
		{ icon: DesktopTowerIcon, title: t('settings.accountPage.devices'), sub: t('settings.accountPage.devicesSub'), run: onDevices, external: false },
		{ icon: ArrowSquareOutIcon, title: t('settings.accountPage.console'), sub: web.replace(/^https?:\/\//, ''), run: () => openExternal(`${web}/dashboard`), external: true }
	]);
</script>

<section class="hero">
	<span class="avatar" aria-hidden="true">{avatarInitial(user.username) || '·'}</span>
	<div class="who">
		<div class="name-row">
			<h2 class="name">{user.username}</h2>
			{#if badge}<span class="badge">{t(badge)}</span>{/if}
		</div>
		<p class="sub">{user.email || 'LynShen Console'}</p>
	</div>
	<div class="acts">
		<Button size="sm" onclick={onRelogin}><SignInIcon size={14} /> {t('settings.account.relogin')}</Button>
		<Button variant="danger" size="sm" onclick={onLogout}><SignOutIcon size={14} /> {t('settings.account.logout')}</Button>
	</div>
</section>
{#if logoutError}<p role="alert" class="err">{logoutError}</p>{/if}

<section class="stats">
	<div class="tile wide">
		<div class="tile-head">
			<span class="tile-label">{t('settings.usage.balance')}</span>
			<Segmented
				value={prefs.balanceCurrency}
				options={[{ value: 'CNY', label: 'CNY' }, { value: 'USD', label: 'USD' }]}
				onChange={(v) => prefs.setBalanceCurrency(v as 'CNY' | 'USD')}
			/>
		</div>
		<span class="big">{user.balance_unlimited ? t('shell.account.unlimited') : money(balance?.total_balance)}</span>
		{#if balance && !user.balance_unlimited}
			<span class="split">
				{t('settings.accountPage.granted')} {money(balance.granted_balance)} · {t('settings.accountPage.toppedUp')} {money(balance.topped_up_balance)}
			</span>
		{/if}
	</div>
	<!-- With a desktop plan in force, the tile also holds its funding choice. -->
	<div class="tile" class:wide={!!trial.funding}>
		<span class="tile-label">{t('shell.account.plan')}</span>
		<span class="mid">{plan || t('settings.accountPage.payAsYouGo')}</span>
		<PlanFundingChoice />
	</div>
	<div class="tile live">
		<span class="tile-label">{t('shell.account.liveUsage')}</span>
		<div class="trio">
			<span><b>{liveCount(live?.rpm)}</b><small>{t('shell.account.rpm')}</small></span>
			<span><b>{liveCount(live?.tpm)}</b><small>{t('shell.account.tpm')}</small></span>
			<span><b>{cacheHitText(live?.cache_hit_rate)}</b><small>{t('shell.account.cacheHit')}</small></span>
		</div>
	</div>
</section>

<section class="links">
	{#each LINKS as link (link.title)}
		<button class="link" onclick={link.run}>
			<span class="link-ico"><link.icon size={17} /></span>
			<span class="link-txt">
				<span class="link-title">{link.title}</span>
				<span class="link-sub">{link.sub}</span>
			</span>
			{#if link.external}<ArrowSquareOutIcon size={14} />{:else}<CaretRightIcon size={14} />{/if}
		</button>
	{/each}
</section>

<style>
	.hero {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 20px;
		border-radius: var(--r-xl);
		background:
			radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, var(--accent) 16%, transparent), transparent 60%),
			var(--panel);
		box-shadow: var(--shadow-float);
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 56px;
		height: 56px;
		border-radius: 50%;
		background: linear-gradient(135deg, var(--accent), var(--accent-deep));
		color: var(--on-accent);
		font-size: 24px;
		font-weight: 600;
	}
	.who {
		flex: 1;
		min-width: 0;
	}
	.name-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.name {
		margin: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-lg);
		font-weight: 600;
	}
	.badge {
		flex-shrink: 0;
		padding: 1px 8px;
		border-radius: var(--r-full);
		background: color-mix(in oklab, var(--accent) 14%, transparent);
		color: var(--accent);
		font-size: var(--fs-2xs);
	}
	.sub {
		margin: 4px 0 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.acts {
		display: flex;
		gap: 8px;
		flex-shrink: 0;
	}
	.err {
		margin: 8px 4px 0;
		color: var(--err);
		font-size: var(--fs-xs);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		margin-top: 14px;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		padding: 14px 16px;
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.tile.wide {
		grid-column: 1 / -1;
	}
	.tile-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.tile-label {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.big {
		font-size: 28px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
		letter-spacing: -0.01em;
	}
	.split {
		color: var(--dim);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.mid {
		font-size: var(--fs-md, 15px);
		font-weight: 600;
	}
	.trio {
		display: flex;
		gap: 16px;
	}
	.trio span {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.trio b {
		font-size: var(--fs-md, 15px);
		font-variant-numeric: tabular-nums;
	}
	.trio small {
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	.links {
		display: flex;
		flex-direction: column;
		margin-top: 14px;
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: inset 0 0 0 1px var(--hairline);
		overflow: hidden;
	}
	.link {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 12px 16px;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.link + .link {
		box-shadow: inset 0 1px 0 var(--hairline);
	}
	.link:hover {
		background: color-mix(in oklab, var(--text) 4%, transparent);
	}
	.link-ico {
		display: inline-flex;
		color: var(--text);
	}
	.link-txt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.link-title {
		color: var(--text);
		font-size: var(--fs-sm);
	}
	.link-sub {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
	}
</style>
