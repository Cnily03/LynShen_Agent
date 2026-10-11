<script lang="ts">
	import ArrowCircleDownIcon from 'phosphor-svelte/lib/ArrowCircleDownIcon';
	import CoinsIcon from 'phosphor-svelte/lib/CoinsIcon';
	import UserIcon from 'phosphor-svelte/lib/UserIcon';
	import { t } from '$lib/i18n';
	import { fetchMonoizeBalance, monoizeSession, type MonoizeUser } from '$lib/protocol';
	import { shownBalanceText } from '$lib/money';
	import { prefs } from '$lib/prefs.svelte';
	import { avatarInitial } from '$lib/account';
	import AccountCard from './AccountCard.svelte';

	// The bottom of the sidebar, as in the LynShen Console: the account row
	// (avatar, name, balance) opens the account card, which holds settings,
	// the currency and theme switches and logging out. Collapsed, only the
	// avatar shows.
	let {
		loggedIn,
		collapsed = false,
		updateAvailable = false,
		onManageAccount,
		onSettings,
		onUpdate,
		onLoggedOut,
		onCardOpenChange = () => {}
	}: {
		/** Signed in to the LynShen account (not tied to any one chat). */
		loggedIn: boolean;
		/** The sidebar is the narrow icon rail. */
		collapsed?: boolean;
		updateAvailable?: boolean;
		/** Settings → Account: the card's sign-in button. */
		onManageAccount: () => void;
		onSettings: () => void;
		/** Open settings at the update section. */
		onUpdate: () => void;
		/** The card logged the account out: refresh what depends on it. */
		onLoggedOut: () => void;
		/** The account card opened or closed (a peeking rail stays open under it). */
		onCardOpenChange?: (open: boolean) => void;
	} = $props();

	let user = $state<MonoizeUser | null>(null);
	let raw = $state<{ total_balance: string; currency: string } | null>(null);
	let failed = $state(false);
	const balance = $derived(
		user?.balance_unlimited
			? t('shell.account.unlimited')
			: raw
				? shownBalanceText(raw.total_balance, raw.currency, prefs.balanceCurrency)
				: null
	);
	const name = $derived(user?.username ?? (loggedIn ? 'LynShen' : t('shell.notLoggedIn')));

	// Who is signed in and the balance; again on each open of the card, since
	// the balance moves with every call.
	let generation = 0;
	function load() {
		const g = ++generation;
		Promise.all([monoizeSession(), fetchMonoizeBalance().catch(() => null)])
			.then(([s, b]) => {
				if (g !== generation) return;
				user = s.logged_in && s.session ? s.session.user : null;
				raw = b?.balance_infos?.[0] ?? null;
				failed = false;
			})
			.catch(() => {
				if (g === generation) failed = true;
			});
	}
	$effect(() => {
		if (loggedIn) load();
		else {
			generation++;
			user = null;
			raw = null;
			failed = false;
		}
	});

	// The card: a click opens it beside the row (above it, or right of the
	// rail's avatar); a click outside, Escape or a window resize closes it.
	let accountBtn = $state<HTMLButtonElement | null>(null);
	let avatarSlot = $state<HTMLElement | null>(null);
	let card = $state<{ left: number; bottom: number; width: number; side: 'top' | 'right' } | null>(null);
	function openCard() {
		if (!accountBtn || !avatarSlot) return;
		// The row keeps its expanded width under the rail (clipped): place a
		// collapsed card by the avatar, which is what shows.
		const r = accountBtn.getBoundingClientRect();
		const a = avatarSlot.getBoundingClientRect();
		card = collapsed
			? { left: a.right + 18, bottom: window.innerHeight - r.bottom, width: 292, side: 'right' }
			: { left: r.left, bottom: window.innerHeight - r.top + 8, width: Math.min(320, Math.max(272, r.width)), side: 'top' };
		if (loggedIn) load();
	}
	function closeCard() {
		card = null;
	}
	function outsideDown(e: PointerEvent) {
		const el = e.target as Element;
		if (card && !accountBtn?.contains(el) && !el.closest?.('.acct-card')) closeCard();
	}
	$effect(() => onCardOpenChange(!!card));
	// A collapse or expand moves the row away from the card.
	$effect(() => {
		void collapsed;
		closeCard();
	});
</script>

<div class="sb-foot" class:collapsed>
	<button
		bind:this={accountBtn}
		class="account"
		class:on={!!card}
		aria-label={t('shell.account.title')}
		aria-haspopup="dialog"
		aria-expanded={!!card}
		data-tip={collapsed && !card ? (balance ? `${name} · ${balance}` : name) : undefined}
		data-tip-side="right"
		onclick={() => (card ? closeCard() : openCard())}
	>
		<span class="ico" bind:this={avatarSlot}>
			<span class="avatar" class:anon={!loggedIn}>
				{#if loggedIn && user}{avatarInitial(user.username)}{:else}<UserIcon size={15} />{/if}
			</span>
			{#if updateAvailable}<span class="dot" aria-hidden="true"></span>{/if}
		</span>
		<span class="who">
			<span class="name">{name}</span>
			{#if loggedIn}
				<span class="bal">
					<CoinsIcon size={12} />
					<span class="num">{balance ?? (failed ? '—' : '…')}</span>
				</span>
			{:else}
				<span class="bal">{t('shell.account.signIn')}</span>
			{/if}
		</span>
	</button>
	{#if updateAvailable}
		<button class="upd" inert={collapsed} title={t('shell.updateAvailable')} aria-label={t('shell.updateAvailable')} onclick={onUpdate}>
			<ArrowCircleDownIcon size={18} />
		</button>
	{/if}
</div>

<svelte:window onpointerdown={outsideDown} onkeydown={(e) => e.key === 'Escape' && card && closeCard()} onresize={() => card && closeCard()} />

{#if card}
	<AccountCard
		{loggedIn}
		{user}
		{balance}
		balanceFailed={failed}
		{updateAvailable}
		left={card.left}
		bottom={card.bottom}
		width={card.width}
		side={card.side}
		onSignIn={() => {
			closeCard();
			onManageAccount();
		}}
		onSettings={() => {
			closeCard();
			onSettings();
		}}
		onUpdate={() => {
			closeCard();
			onUpdate();
		}}
		onLoggedOut={() => {
			closeCard();
			onLoggedOut();
		}}
	/>
{/if}

<style>
	.sb-foot {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 8px 10px 12px;
		border-top: 1px solid var(--hairline);
		flex-shrink: 0;
	}
	/* The row keeps its width while the sidebar collapses (the sidebar clips
	   it); its fill shrinks to the avatar, in step with the sidebar. */
	.account {
		position: relative;
		isolation: isolate;
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		min-height: 48px;
		padding: 0 10px 0 0;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.account::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: var(--r-md);
		transition:
			background var(--t-fast) var(--ease-out),
			right var(--t-base) var(--ease-base);
	}
	.account:hover::before,
	.account.on::before {
		background: var(--surface2);
	}
	.account:focus-visible {
		outline: none;
	}
	.account:focus-visible::before {
		outline: 2px solid var(--brand-bright);
		outline-offset: -2px;
	}
	.collapsed .account::before {
		right: calc(100% - 42px);
	}
	.ico {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 42px;
		height: 48px;
		flex-shrink: 0;
	}
	.avatar {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: var(--r-full);
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--hairline);
		color: var(--text);
		font-size: var(--fs-xs);
		font-weight: 600;
		line-height: 1;
	}
	.avatar.anon {
		color: var(--dim);
	}
	/* An update waits: a dot on the avatar while the rail hides the button. */
	.dot {
		position: absolute;
		top: 10px;
		right: 7px;
		width: 8px;
		height: 8px;
		border-radius: var(--r-full);
		background: var(--accent);
		box-shadow: 0 0 0 2px var(--sidebar);
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.collapsed .dot {
		opacity: 1;
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
		transition: opacity var(--t-base) var(--ease-base) 60ms;
	}
	.collapsed .who {
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-base);
	}
	.name {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.bal {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
		white-space: nowrap;
	}
	.bal > :global(svg) {
		flex-shrink: 0;
		color: var(--warn);
	}
	.num {
		overflow: hidden;
		text-overflow: ellipsis;
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.upd {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		flex-shrink: 0;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.upd:hover {
		background: var(--surface2);
		color: var(--text);
	}
</style>
