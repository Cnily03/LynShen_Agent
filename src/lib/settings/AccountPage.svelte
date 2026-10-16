<script lang="ts">
	// Settings → 账户 for a signed-in LynShen Console account, in the manner
	// of macOS System Settings: who it is (the avatar changes on a click, and
	// the website shows it too), then full-width groups of rows:
	//   套餐与余额  the plan (state, end, its windows), who pays (the plan
	//              only or the balance only, PlanFundingChoice), the balance
	//              with 充值, the currency; 购买套餐 and 充值 open Settings →
	//              套餐与充值 (PurchaseSection), where both are bought in the app;
	//   用量       用量明细, with the last minute's usage as its second line;
	//   more       模型广场, API 密钥, 邀请好友, 授权设备, the console;
	//   sign-in    重新登录 and 退出登录, quiet, at the bottom.
	// The account card in the sidebar shows a short summary and opens this
	// page for the rest.
	import { onMount, untrack } from 'svelte';
	import SquaresFourIcon from 'phosphor-svelte/lib/SquaresFourIcon';
	import KeyIcon from 'phosphor-svelte/lib/KeyIcon';
	import ChartLineIcon from 'phosphor-svelte/lib/ChartLineIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import GiftIcon from 'phosphor-svelte/lib/GiftIcon';
	import DesktopTowerIcon from 'phosphor-svelte/lib/DesktopTowerIcon';
	import CameraIcon from 'phosphor-svelte/lib/CameraIcon';
	import SignInIcon from 'phosphor-svelte/lib/SignInIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { AVATAR_ACCEPT } from '$lib/accountAvatar';
	import { accountAvatar } from '$lib/accountAvatar.svelte';
	import { t } from '$lib/i18n';
	import { prefs } from '$lib/prefs.svelte';
	import { shownBalanceText } from '$lib/money';
	import { openExternal } from '$lib/openExternal';
	import { avatarInitial, cacheHitText, liveCount, roleBadgeKey } from '$lib/account';
	import { fetchMonoizeLiveUsage, readConfig, type LiveUsage, type MonoizeUser } from '$lib/protocol';
	import { planDate, planDevicesText } from '$lib/trial';
	import { trial } from '$lib/trial.svelte';
	import PlanFundingChoice from '$lib/PlanFundingChoice.svelte';
	import PlanUsage from '$lib/PlanUsage.svelte';

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
		onDevices,
		onPurchase
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
		/** Settings → 套餐与充值. */
		onPurchase: () => void;
	} = $props();

	const badge = $derived(roleBadgeKey(user.role));
	// The desktop plan in force (trial or paid, trial.svelte.ts); else the
	// account's subscription plan where the gateway names one.
	const deskPlan = $derived(trial.plan);
	const billingPlan = $derived(user.billing_plan?.name?.trim() || '');
	const money = (amount: string | undefined) =>
		balance && amount != null ? shownBalanceText(amount, balance.currency, prefs.balanceCurrency) : '—';
	const balanceText = $derived(user.balance_unlimited ? t('shell.account.unlimited') : balance ? money(balance.total_balance) : t('common.loading'));

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
	const liveLine = $derived(
		t('settings.accountPage.liveLine', { rpm: liveCount(live?.rpm), tpm: liveCount(live?.tpm), hit: cacheHitText(live?.cache_hit_rate) })
	);

	// The avatar: the picture the app kept, then the one the user this page
	// was given (read as the page opened) names; a click on it picks a file
	// and uploads it.
	$effect(() => {
		const current = user;
		untrack(() => {
			if (!accountAvatar.src) void accountAvatar.restore();
			void accountAvatar.sync(current);
		});
	});
	let picker = $state<HTMLInputElement | null>(null);
	let avatarError = $state('');
	async function pickAvatar(input: HTMLInputElement) {
		const file = input.files?.[0];
		input.value = '';
		if (!file) return;
		avatarError = await accountAvatar.change(file);
		if (!avatarError) toast.success(t('settings.avatar.changed'));
	}

	const LINKS = $derived([
		{ icon: SquaresFourIcon, title: t('settings.monoize.square'), sub: t('settings.accountPage.squareSub'), run: onSquare, external: false },
		{ icon: KeyIcon, title: t('settings.page.apiKey'), sub: t('settings.monoize.managedKey'), run: onApiKey, external: false },
		{ icon: GiftIcon, title: t('settings.accountPage.invite'), sub: t('settings.accountPage.inviteSub'), run: onInvite, external: false },
		{ icon: DesktopTowerIcon, title: t('settings.accountPage.devices'), sub: t('settings.accountPage.devicesSub'), run: onDevices, external: false },
		{ icon: ArrowSquareOutIcon, title: t('settings.accountPage.console'), sub: web.replace(/^https?:\/\//, ''), run: () => openExternal(`${web}/dashboard`), external: true }
	]);
</script>

<!-- Who it is. -->
<section class="acct-profile">
	<button
		class="avatar"
		onclick={() => picker?.click()}
		disabled={accountAvatar.busy}
		aria-label={t('settings.avatar.change')}
		title={t('settings.avatar.change')}
	>
		{#if accountAvatar.src}<img src={accountAvatar.src} alt="" />{:else}<span class="initial">{avatarInitial(user.username) || '·'}</span>{/if}
		<span class="over" aria-hidden="true">
			{#if accountAvatar.busy}<CircleNotchIcon size={18} class="spin" />{:else}<CameraIcon size={18} />{/if}
		</span>
	</button>
	<input bind:this={picker} type="file" accept={AVATAR_ACCEPT} hidden onchange={(e) => pickAvatar(e.currentTarget)} />
	<div class="who">
		<div class="name-row">
			<h2 class="name">{user.username}</h2>
			{#if badge}<span class="badge">{t(badge)}</span>{/if}
		</div>
		<p class="sub">{user.email || 'LynShen Console'}</p>
	</div>
</section>
{#if avatarError}<p role="alert" class="err">{avatarError}</p>{/if}

<SettingsSection title={t('settings.accountPage.planSection')} id="account-plan">
	{#if deskPlan}
		<SettingsRow
			stacked
			title={deskPlan.name.trim() || t('shell.trial.label')}
			tag={t('settings.accountPage.planActive')}
			description={[t('shell.account.expires', { date: planDate(deskPlan.expires_at, true) }), ...(deskPlan.devices ? [planDevicesText(deskPlan.devices)] : [])].join(' · ')}
		>
			<PlanUsage plan={deskPlan} />
		</SettingsRow>
	{:else}
		<SettingsRow id="account-noplan" title={t('shell.account.plan')} description={billingPlan || t('settings.accountPage.noPlan')}>
			{#if !billingPlan}
				<Button size="sm" variant="ghost" onclick={onPurchase}>{t('settings.accountPage.buyPlan')}</Button>
			{/if}
		</SettingsRow>
	{/if}
	<!-- Who pays: with a plan in force, or while the device still pays with one that ended. -->
	<PlanFundingChoice />
	<SettingsRow
		id="account-balance"
		title={t('settings.usage.balance')}
		description={balance && !user.balance_unlimited
			? `${t('settings.accountPage.granted')} ${money(balance.granted_balance)} · ${t('settings.accountPage.toppedUp')} ${money(balance.topped_up_balance)}`
			: undefined}
	>
		<span class="amount">{balanceText}</span>
		<Button size="sm" onclick={onPurchase}>{t('settings.accountPage.topUp')}</Button>
	</SettingsRow>
	<SettingsRow id="account-currency" title={t('settings.accountPage.currency')} description={t('settings.accountPage.currencySub')}>
		<Segmented
			value={prefs.balanceCurrency}
			options={[{ value: 'CNY', label: 'CNY' }, { value: 'USD', label: 'USD' }]}
			onChange={(v) => prefs.setBalanceCurrency(v as 'CNY' | 'USD')}
		/>
	</SettingsRow>
</SettingsSection>

<SettingsSection title={t('settings.accountPage.usageSection')}>
	<button class="lrow" onclick={onUsage}>
		<span class="lico"><ChartLineIcon size={17} /></span>
		<span class="ltxt">
			<span class="ltitle">{t('settings.accountPage.usage')}</span>
			<span class="lsub" title={t('shell.account.liveUsage')}>{liveLine}</span>
		</span>
		<CaretRightIcon size={14} />
	</button>
</SettingsSection>

<SettingsSection title={t('settings.accountPage.moreSection')}>
	{#each LINKS as link (link.title)}
		<button class="lrow" onclick={link.run}>
			<span class="lico"><link.icon size={17} /></span>
			<span class="ltxt">
				<span class="ltitle">{link.title}</span>
				<span class="lsub">{link.sub}</span>
			</span>
			{#if link.external}<ArrowSquareOutIcon size={14} />{:else}<CaretRightIcon size={14} />{/if}
		</button>
	{/each}
</SettingsSection>

<!-- Quiet, at the bottom: the whole row is the button. -->
<SettingsSection title={t('settings.accountPage.signInSection')}>
	<button class="lrow" onclick={onRelogin} aria-labelledby="acct-relogin" aria-describedby="acct-relogin-sub">
		<span class="lico"><SignInIcon size={17} /></span>
		<span class="ltxt">
			<span class="ltitle" id="acct-relogin">{t('settings.account.relogin')}</span>
			<span class="lsub" id="acct-relogin-sub">{t('settings.accountPage.reloginSub')}</span>
		</span>
	</button>
	<button class="lrow danger" onclick={onLogout} aria-labelledby="acct-logout" aria-describedby="acct-logout-sub">
		<span class="lico"><SignOutIcon size={17} /></span>
		<span class="ltxt">
			<span class="ltitle" id="acct-logout">{t('settings.account.logout')}</span>
			<span class="lsub" id="acct-logout-sub">{t('settings.accountPage.logoutSub')}</span>
		</span>
	</button>
</SettingsSection>
{#if logoutError}<p role="alert" class="err">{logoutError}</p>{/if}

<style>
	.acct-profile {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 4px 0 8px;
	}
	/* The avatar is the button that changes it: a camera on hover and focus. */
	.avatar {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 64px;
		height: 64px;
		padding: 0;
		border: none;
		border-radius: var(--r-full);
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--text);
		font: inherit;
		overflow: hidden;
		cursor: pointer;
	}
	.avatar img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.initial {
		font-size: var(--fs-xl);
		font-weight: 600;
	}
	.over {
		position: absolute;
		inset: 0;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: color-mix(in oklab, var(--bg) 55%, transparent);
		color: var(--text);
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.avatar:hover .over,
	.avatar:focus-visible .over,
	.avatar:disabled .over {
		opacity: 1;
	}
	.avatar:disabled {
		cursor: default;
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
		padding: 0 6px;
		border: 1px solid var(--border);
		border-radius: var(--r-xs);
		color: var(--dim);
		font-size: var(--fs-2xs);
		line-height: 18px;
	}
	.sub {
		margin: 2px 0 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.err {
		margin: 8px 0 0;
		color: var(--err);
		font-size: var(--fs-xs);
	}
	.amount {
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-md);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	/* A row that opens a page or the website: the whole row is the button. */
	.lrow {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		min-height: 56px;
		padding: 10px 4px 10px 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out);
	}
	.lrow:hover {
		color: var(--text);
	}
	.lico {
		display: inline-flex;
		color: var(--text);
	}
	.ltxt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.ltitle {
		color: var(--text);
		font-size: var(--fs-sm);
	}
	.lrow.danger .lico,
	.lrow.danger .ltitle {
		color: var(--err);
	}
	.lsub {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
</style>
