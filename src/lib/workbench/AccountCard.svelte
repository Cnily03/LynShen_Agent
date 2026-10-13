<script lang="ts">
	import { popOut } from '$lib/ui/motion';
	import { onMount } from 'svelte';
	import ArrowCircleDownIcon from 'phosphor-svelte/lib/ArrowCircleDownIcon';
	import CoinsIcon from 'phosphor-svelte/lib/CoinsIcon';
	import GearIcon from 'phosphor-svelte/lib/GearIcon';
	import MonitorIcon from 'phosphor-svelte/lib/MonitorIcon';
	import MoonIcon from 'phosphor-svelte/lib/MoonIcon';
	import PulseIcon from 'phosphor-svelte/lib/PulseIcon';
	import SignInIcon from 'phosphor-svelte/lib/SignInIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import SunIcon from 'phosphor-svelte/lib/SunIcon';
	import UserIcon from 'phosphor-svelte/lib/UserIcon';
	import Button from '$lib/ui/Button.svelte';
	import { accountAvatar } from '$lib/accountAvatar.svelte';
	import { t } from '$lib/i18n';
	import { fetchMonoizeLiveUsage, monoizeLogout, type LiveUsage, type MonoizeUser } from '$lib/protocol';
	import { prefs } from '$lib/prefs.svelte';
	import { setTheme, themeState, type ThemePref } from '$lib/theme.svelte';
	import { shortcutLabel } from '$lib/shortcuts';
	import { avatarInitial, cacheHitText, liveCount, roleBadgeKey } from '$lib/account';

	// The account card, as the LynShen Console's account menu: who is signed
	// in, balance and plan, the last minute's usage, then settings, the
	// currency and theme switches and logging out. Fixed to the window (the
	// sidebar would clip it); the footer owns opening and closing.
	let {
		loggedIn,
		user,
		balance,
		balanceFailed = false,
		updateAvailable = false,
		left,
		bottom,
		width,
		side,
		onSignIn,
		onSettings,
		onUpdate,
		onLoggedOut
	}: {
		loggedIn: boolean;
		user: MonoizeUser | null;
		/** The balance as shown (in the chosen currency); null while loading. */
		balance: string | null;
		balanceFailed?: boolean;
		updateAvailable?: boolean;
		left: number;
		bottom: number;
		width: number;
		/** Above the account row, or right of the collapsed rail's avatar. */
		side: 'top' | 'right';
		/** Settings → Account. */
		onSignIn: () => void;
		onSettings: () => void;
		onUpdate: () => void;
		onLoggedOut: () => void;
	} = $props();

	const badge = $derived(roleBadgeKey(user?.role));
	const plan = $derived(user?.billing_plan?.name?.trim() || '');

	// The last minute's usage, every 10 s while the card is open (as the
	// console polls it).
	let live = $state<LiveUsage | null>(null);
	onMount(() => {
		if (!loggedIn) return;
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

	const THEMES: { value: ThemePref; icon: typeof SunIcon; key: string }[] = [
		{ value: 'light', icon: SunIcon, key: 'settings.themeLight' },
		{ value: 'dark', icon: MoonIcon, key: 'settings.themeDark' },
		{ value: 'system', icon: MonitorIcon, key: 'settings.themeSystem' }
	];
	const CURRENCIES = [
		{ value: 'CNY', label: '¥ CNY' },
		{ value: 'USD', label: '$ USD' }
	] as const;

	// The sidebar contains its layout and paint, which would make it the box
	// a fixed element is placed in: the card lives under <body>. The wrapper
	// stays in the tree so Svelte removes its own node; the action takes the
	// moved one (as ui/Modal does).
	function portal(node: HTMLElement) {
		document.body.appendChild(node);
		return { destroy: () => node.remove() };
	}

	// Logging out revokes the device key at the gateway (as Settings → Account
	// does); on failure the credentials stay and the card says so.
	let busy = $state(false);
	let logoutError = $state('');
	async function logout() {
		busy = true;
		try {
			await monoizeLogout();
		} catch {
			logoutError = t('settings.monoize.revokeFailed');
			return;
		} finally {
			busy = false;
		}
		logoutError = '';
		onLoggedOut();
	}
</script>

<div class="acct-root">
<div
	use:portal
	class="pop acct-card {side}"
	out:popOut|global
	role="dialog"
	aria-label={t('shell.account.title')}
	tabindex="-1"
	style:left="{left}px"
	style:bottom="{bottom}px"
	style:width="{width}px"
	style:max-height="calc(100vh - {bottom + 12}px)"
>
	<div class="head">
		<span class="avatar" class:anon={!loggedIn}>
			{#if loggedIn && accountAvatar.src}<img src={accountAvatar.src} alt="" />{:else if loggedIn && user}{avatarInitial(user.username)}{:else}<UserIcon size={18} />{/if}
		</span>
		<div class="id">
			<div class="name-line">
				<span class="name">{loggedIn ? (user?.username ?? 'LynShen') : t('shell.notLoggedIn')}</span>
				{#if loggedIn && badge}<span class="badge">{t(badge)}</span>{/if}
			</div>
			<span class="sub">{loggedIn ? (user?.email || 'LynShen Console') : t('shell.account.signInHint')}</span>
		</div>
	</div>

	{#if loggedIn}
		<div class="sec facts">
			<div class="kv">
				<span>{t('shell.account.balance')}</span>
				<span class="amount">
					<CoinsIcon size={14} />
					<span class="num">{balance ?? (balanceFailed ? '—' : t('common.loading'))}</span>
				</span>
			</div>
			<div class="kv">
				<span>{t('shell.account.plan')}</span>
				{#if plan}<span class="plan">{plan}</span>{:else}<span class="none">{t('shell.account.noPlan')}</span>{/if}
			</div>
		</div>

		<div class="sec live">
			<div class="live-head"><PulseIcon size={12} /><span>{t('shell.account.liveUsage')}</span></div>
			<div class="tiles">
				<div class="tile"><span class="v">{liveCount(live?.rpm)}</span><span class="k">{t('shell.account.rpm')}</span></div>
				<div class="tile"><span class="v">{liveCount(live?.tpm)}</span><span class="k">{t('shell.account.tpm')}</span></div>
				<div class="tile"><span class="v">{cacheHitText(live?.cache_hit_rate)}</span><span class="k">{t('shell.account.cacheHit')}</span></div>
			</div>
		</div>
	{:else}
		<div class="sec">
			<Button variant="primary" size="sm" full onclick={onSignIn}><SignInIcon size={14} /> {t('shell.account.signIn')}</Button>
		</div>
	{/if}

	<div class="sec rows">
		<button class="pop-row" onclick={onSettings}>
			<span class="pop-ico"><GearIcon size={18} /></span>
			<span class="pop-label grow">{t('shell.settings')}</span>
			<span class="pop-hint">{shortcutLabel('settings')}</span>
		</button>
		{#if updateAvailable}
			<button class="pop-row" onclick={onUpdate}>
				<span class="pop-ico"><ArrowCircleDownIcon size={18} /></span>
				<span class="pop-label grow">{t('shell.updateAvailable')}</span>
			</button>
		{/if}
	</div>

	<div class="sec rows">
		{#if loggedIn}
			<div class="ctl">
				<span>{t('shell.account.currency')}</span>
				<div class="seg" role="group" aria-label={t('shell.account.currency')}>
					{#each CURRENCIES as c (c.value)}
						<button class="opt" class:on={prefs.balanceCurrency === c.value} aria-pressed={prefs.balanceCurrency === c.value} onclick={() => prefs.setBalanceCurrency(c.value)}>{c.label}</button>
					{/each}
				</div>
			</div>
		{/if}
		<div class="ctl">
			<span>{t('shell.account.theme')}</span>
			<div class="seg" role="group" aria-label={t('shell.account.theme')}>
				{#each THEMES as th (th.value)}
					<button class="opt icon" class:on={themeState.pref === th.value} aria-pressed={themeState.pref === th.value} title={t(th.key)} aria-label={t(th.key)} onclick={() => setTheme(th.value)}>
						<th.icon size={14} />
					</button>
				{/each}
			</div>
		</div>
	</div>

	{#if loggedIn}
		<div class="sec rows">
			<button class="pop-row danger" disabled={busy} onclick={logout}>
				<span class="pop-ico"><SignOutIcon size={18} /></span>
				<span class="pop-label">{t('shell.account.logout')}</span>
			</button>
			{#if logoutError}<p class="err" role="alert">{logoutError}</p>{/if}
		</div>
	{/if}
</div>
</div>

<style>
	.acct-root {
		display: contents;
	}
	.acct-card {
		position: fixed;
		z-index: 90;
		gap: 0;
		padding: 6px;
		overflow-y: auto;
		overscroll-behavior: contain;
		user-select: text;
		transform-origin: bottom left;
		animation: pop-in var(--t-pop) var(--ease-enter);
	}
	/* Beside the rail's avatar: grows out of it, from the left. */
	.acct-card.right {
		transform-origin: bottom left;
		animation-name: card-in-side;
	}
	@keyframes card-in-side {
		from {
			opacity: 0;
			transform: translateX(-8px) scale(0.95);
			filter: blur(4px);
		}
	}
	.head {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 8px 10px;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border-radius: var(--r-full);
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 600;
		line-height: 1;
		overflow: hidden;
	}
	.avatar img {
		display: block;
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.avatar.anon {
		color: var(--dim);
	}
	.id {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.name-line {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-size: var(--fs-sm);
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
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.sec {
		padding: 8px;
		border-top: 1px solid var(--hairline);
	}
	.sec.rows {
		padding: 4px 0;
	}
	.facts {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.kv {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 22px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.amount {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		min-width: 0;
		color: var(--text);
		font-weight: 500;
	}
	.amount > :global(svg) {
		flex-shrink: 0;
		color: var(--warn);
	}
	.num {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.plan {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-weight: 500;
	}
	.none {
		color: var(--dim);
	}
	.live-head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding-bottom: 6px;
		color: var(--dim);
		font-size: var(--fs-2xs);
		font-weight: 500;
	}
	.live-head > :global(svg) {
		color: var(--ok);
	}
	.tiles {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 4px;
	}
	.tile {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: 6px 4px;
		border-radius: var(--r-sm);
		background: var(--surface2);
	}
	.tile .v {
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-weight: 500;
		font-variant-numeric: tabular-nums;
	}
	.tile .k {
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	.rows .pop-row {
		min-height: 36px;
	}
	.grow {
		flex: 1;
	}
	.danger,
	.danger .pop-ico,
	.danger .pop-label {
		color: var(--err);
	}
	.ctl {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 40px;
		padding: 0 6px 0 12px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	/* A compact pill switch, as the console's (Segmented is sized for settings rows). */
	.seg {
		display: inline-flex;
		gap: 2px;
		padding: 3px;
		border-radius: var(--r-full);
		background: var(--surface2);
	}
	.opt {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 60px;
		height: 24px;
		padding: 0 8px;
		border: none;
		border-radius: var(--r-full);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-2xs);
		font-weight: 500;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			box-shadow var(--t-fast) var(--ease-out);
	}
	.opt.icon {
		min-width: 32px;
		padding: 0;
	}
	.opt:hover {
		color: var(--text);
	}
	.opt.on {
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-sm);
	}
	.err {
		margin: 2px 12px 6px;
		color: var(--err);
		font-size: var(--fs-xs);
	}
	.kv span:first-child {
		flex-shrink: 0;
		white-space: nowrap;
	}
</style>
