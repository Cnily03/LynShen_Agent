<script lang="ts">
	import { onMount } from 'svelte';
	import { popOut } from '$lib/ui/motion';
	import ArrowCircleDownIcon from 'phosphor-svelte/lib/ArrowCircleDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CoinsIcon from 'phosphor-svelte/lib/CoinsIcon';
	import GearIcon from 'phosphor-svelte/lib/GearIcon';
	import SignInIcon from 'phosphor-svelte/lib/SignInIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import UserIcon from 'phosphor-svelte/lib/UserIcon';
	import Button from '$lib/ui/Button.svelte';
	import { accountAvatar } from '$lib/accountAvatar.svelte';
	import { account } from '$lib/accountSession.svelte';
	import { t } from '$lib/i18n';
	import { monoizeLogout, type MonoizeUser } from '$lib/protocol';
	import { shortcutLabel } from '$lib/shortcuts';
	import { avatarInitial, roleBadgeKey } from '$lib/account';
	import { credits, planDate, tightestWindow, windowLabel } from '$lib/trial';
	import { trial } from '$lib/trial.svelte';

	// The account card, a short menu as in Claude, Codex or Linear: who is
	// signed in, one line for the plan (its tightest window and its end) and
	// one for the balance, both opening Settings → 账户, then settings and
	// logging out. The rest (the plan's windows, who pays, the last minute's
	// usage, the currency) lives in Settings → 账户, the theme in Settings →
	// 外观. Fixed to the window (the sidebar would clip it); the footer owns
	// opening and closing.
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
		onAccount,
		onSettings,
		onUpdate,
		onLoggedOut
	}: {
		/** Signed in (or, before the sign-in is read, the account kept from the
		 *  last run): never the logged-out card while that is not known. */
		loggedIn: boolean;
		/** The account; null while it is read. */
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
		/** Settings → Account (signed out: to sign in). */
		onSignIn: () => void;
		/** Settings → Account: the plan and balance lines. */
		onAccount?: () => void;
		onSettings: () => void;
		onUpdate: () => void;
		onLoggedOut: () => void;
	} = $props();

	const badge = $derived(roleBadgeKey(user?.role));
	const billingPlan = $derived(user?.billing_plan?.name?.trim() || '');
	// The desktop plan in force (trial.svelte.ts): its name, the window with
	// the least left, and its end.
	const plan = $derived(loggedIn ? trial.plan : null);
	const tight = $derived(plan ? tightestWindow(plan) : null);
	// The plan's windows as they stand now.
	onMount(() => {
		if (loggedIn) void trial.refreshStatus();
	});

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
		account.signedOut();
		onLoggedOut();
	}
	const openAccount = () => (onAccount ?? onSignIn)();
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
			<span class="sub">{loggedIn ? (user ? user.email || 'LynShen Console' : t('settings.account.loading')) : t('shell.account.signInHint')}</span>
		</div>
	</div>

	{#if loggedIn}
		<div class="sec lines">
			{#if plan}
				<button class="line plan" onclick={openAccount} title={t('shell.account.planDetails')}>
					<span class="line-top">
						<span class="lname">{plan.name.trim() || t('shell.trial.label')}</span>
						<span class="lval">{t('shell.account.expires', { date: planDate(plan.expires_at) })}</span>
						<CaretRightIcon size={12} />
					</span>
					{#if tight}
						<span class="meter" aria-hidden="true"><span class:full={tight.share >= 1} style:width="{tight.share * 100}%"></span></span>
						<span class="lsub">{t('shell.account.windowLeft', { window: windowLabel(tight.window.kind), n: credits(tight.left, true) })}</span>
					{/if}
				</button>
			{:else if billingPlan}
				<button class="line" onclick={openAccount}>
					<span class="line-top">
						<span class="lkey">{t('shell.account.plan')}</span>
						<span class="lval strong">{billingPlan}</span>
						<CaretRightIcon size={12} />
					</span>
				</button>
			{/if}
			<button class="line" onclick={openAccount}>
				<span class="line-top">
					<span class="lkey">{t('shell.account.balance')}</span>
					<span class="lval strong amount"><CoinsIcon size={13} /><span class="num">{balance ?? (balanceFailed ? '—' : t('common.loading'))}</span></span>
					<CaretRightIcon size={12} />
				</span>
			</button>
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
	.sec.lines {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 4px 0;
	}
	/* The plan and balance lines: one row each, a fill on hover, opening
	   Settings → 账户. */
	.line {
		display: flex;
		flex-direction: column;
		gap: 5px;
		width: 100%;
		padding: 8px 10px 8px 12px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.line:hover {
		background: var(--surface2);
	}
	.line-top {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.line-top > :global(svg) {
		flex-shrink: 0;
		color: var(--dim2);
	}
	.lname {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.lkey {
		flex: 1;
		white-space: nowrap;
	}
	.lval {
		flex-shrink: 0;
		white-space: nowrap;
	}
	.strong {
		color: var(--text);
		font-weight: 500;
	}
	.amount {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.amount > :global(svg) {
		color: var(--warn);
	}
	.num {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.meter {
		display: block;
		height: 3px;
		overflow: hidden;
		border-radius: var(--r-full);
		background: var(--surface2);
	}
	.line:hover .meter {
		background: color-mix(in oklab, var(--text) 10%, transparent);
	}
	.meter > span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
	}
	.meter > span.full {
		background: var(--warn);
	}
	.lsub {
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
	.err {
		margin: 2px 12px 6px;
		color: var(--err);
		font-size: var(--fs-xs);
	}
</style>
