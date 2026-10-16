<script lang="ts">
	// Settings → 套餐与充值 (gateway desktop-purchase.spec.md): the plan in
	// force, who pays this device's requests, and the balance, the plans on sale, the balance packs and a
	// custom amount, then the recent orders. Buying opens CheckoutDialog;
	// a completed order reads the plan and the balance again here, in the
	// sidebar (purchase.svelte.ts) and in Settings → 账户.
	import { onMount } from 'svelte';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';
	import { prefs } from '$lib/prefs.svelte';
	import { shownBalanceText } from '$lib/money';
	import { openExternal } from '$lib/openExternal';
	import { account } from '$lib/accountSession.svelte';
	import { GatewayError, fetchMonoizeBalance, fetchStoreCatalog, fetchStoreOrders, readConfig } from '$lib/protocol';
	import { planDate } from '$lib/trial';
	import { trial } from '$lib/trial.svelte';
	import { purchases } from '$lib/purchase.svelte';
	import {
		durationText,
		optionsFor,
		parseCatalog,
		parseOrders,
		parseYuanInput,
		resumable,
		windowRule,
		withinMinor,
		yuan,
		type StoreCatalog,
		type StoreOrder,
		type StoreProduct
	} from '$lib/purchase';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import GatewayNotice from './GatewayNotice.svelte';
	import CheckoutDialog from './CheckoutDialog.svelte';
	import PlanFundingChoice from '$lib/PlanFundingChoice.svelte';

	let { onSignIn }: { onSignIn: () => void } = $props();

	let catalog = $state<StoreCatalog | null>(null);
	let loadError = $state<unknown>(null);
	let loading = $state(true);
	let orders = $state<StoreOrder[]>([]);
	let balance = $state<{ total_balance: string; currency: string } | null>(null);
	let web = $state('https://www.lynshen.org');

	async function load() {
		loading = true;
		loadError = null;
		try {
			const read = parseCatalog(await fetchStoreCatalog());
			if (!read) throw new Error(t('settings.purchase.loadFailed'));
			catalog = read;
		} catch (error) {
			loadError = error;
		} finally {
			loading = false;
		}
		void loadOrders();
	}
	async function loadOrders() {
		try {
			orders = parseOrders(await fetchStoreOrders(5));
		} catch {
			/* the list stays as it was */
		}
	}
	function loadBalance() {
		fetchMonoizeBalance()
			.then((b) => (balance = b?.balance_infos?.[0] ?? null))
			.catch(() => {});
	}
	onMount(() => {
		void load();
		loadBalance();
		void trial.refreshStatus();
		readConfig()
			.then((cfg) => (web = String(cfg.lynshen_web_url || web).replace(/\/+$/, '')))
			.catch(() => {});
	});

	// A gateway without these endpoints answers 404 with no code.
	const unsupported = $derived(loadError instanceof GatewayError && loadError.status === 404 && !loadError.code);
	const plan = $derived(trial.plan);
	const plans = $derived(catalog?.products.filter((p) => p.kind === 'plan') ?? []);
	const packs = $derived(catalog?.products.filter((p) => p.kind === 'balance') ?? []);
	const balanceText = $derived(
		account.user?.balance_unlimited
			? t('shell.account.unlimited')
			: balance
				? shownBalanceText(balance.total_balance, balance.currency, prefs.balanceCurrency)
				: '—'
	);
	const storeUrl = $derived(`${web}/dashboard/store`);

	// A custom top-up: typed in yuan, within the gateway's range.
	let customText = $state('');
	const customFen = $derived(parseYuanInput(customText));
	const customOk = $derived(catalog?.custom != null && customFen != null && withinMinor(customFen, catalog.custom.min_minor, catalog.custom.max_minor));
	const customWrong = $derived(customText.trim() !== '' && !customOk);

	// The dialog: what is bought, and the order to show again when resuming.
	let buying = $state<{ product: StoreProduct; customMinor: string | null; resume: string | null } | null>(null);
	const optionsOf = (fen: string) => optionsFor(catalog?.options ?? [], fen);
	function buy(product: StoreProduct, customMinor: string | null = null) {
		buying = { product, customMinor, resume: null };
	}
	function buyCustom() {
		const product = catalog?.products.find((p) => p.id === catalog?.custom?.product_id);
		if (product && customOk && customFen) buy(product, customFen);
	}
	function resume(order: StoreOrder) {
		const kept = resumable(localStorage, order, Date.now());
		const product = kept ? catalog?.products.find((p) => p.id === kept.productId) : null;
		if (kept && product) buying = { product, customMinor: kept.customMinor, resume: order.id };
	}
	const canResume = (order: StoreOrder) => resumable(localStorage, order, Date.now()) != null;
	function completed() {
		purchases.done();
		void trial.refreshStatus();
		loadBalance();
		void loadOrders();
	}
	function closeDialog() {
		buying = null;
		void loadOrders();
	}

	const orderTitle = (o: StoreOrder) => (o.kind === 'plan' ? `${o.name} · ${yuan(o.amount_minor)}` : t('settings.purchase.topUpTitle', { amount: yuan(o.amount_minor) }));
	const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	// The state and time; a top-up with a bonus also what it credits.
	const orderLine = (o: StoreOrder) =>
		[
			t(`settings.purchase.orderState.${o.state}`),
			...(o.balance && o.balance.actual_received_minor !== o.amount_minor ? [t('settings.purchase.receive', { amount: yuan(o.balance.actual_received_minor) })] : []),
			when(o.created_at)
		].join(' · ');
	const isCurrent = (p: StoreProduct) => plan != null && plan.trial !== true && plan.name.trim() === p.name.trim();
</script>

{#if loading && !catalog}
	<div class="skeleton" aria-busy="true">
		<div class="sk"></div>
		<div class="sk"></div>
		<div class="sk tall"></div>
	</div>
{:else if unsupported}
	<Notice tone="info">
		<span class="line">
			{t('settings.purchase.unsupported')}
			<Button size="sm" onclick={() => openExternal(storeUrl)}>{t('settings.purchase.openWeb')} <ArrowSquareOutIcon size={13} /></Button>
		</span>
	</Notice>
{:else if loadError && !catalog}
	<GatewayNotice error={loadError} fallback={t('settings.purchase.loadFailed')} onRetry={load} {onSignIn} />
{:else if catalog}
	<SettingsSection title={t('settings.purchase.current')}>
		<SettingsRow
			id="purchase-plan"
			title={plan ? plan.name.trim() || t('shell.trial.label') : t('settings.purchase.noPlan')}
			tag={plan ? t('settings.purchase.inUse') : undefined}
			description={plan ? t('settings.purchase.planUntil', { date: planDate(plan.expires_at, true) }) : undefined}
		/>
		<PlanFundingChoice id="purchase-funding" />
		<SettingsRow id="purchase-balance" title={t('settings.purchase.balance')}>
			<span class="amount">{balanceText}</span>
		</SettingsRow>
	</SettingsSection>

	{#if catalog.options.length === 0}
		<Notice tone="info">
			<span class="line">
				{t('settings.purchase.noOptions')}
				<Button size="sm" onclick={() => openExternal(storeUrl)}>{t('settings.purchase.openWeb')} <ArrowSquareOutIcon size={13} /></Button>
			</span>
		</Notice>
	{/if}

	<SettingsSection title={t('settings.purchase.plansSection')} description={t('settings.purchase.plansHint')} id="purchase-plans">
		{#each plans as p (p.id)}
			<SettingsRow
				title={p.name}
				tag={isCurrent(p) ? t('settings.purchase.inUse') : undefined}
				description={[t('settings.purchase.price', { price: yuan(p.price_minor), duration: durationText(p.duration_seconds) }), ...p.windows.map(windowRule)].join(' · ')}
			>
				{#snippet detail()}
					{#if p.description.trim()}<span class="about" title={p.description}>{p.description}</span>{/if}
				{/snippet}
				<Button size="sm" onclick={() => buy(p)} disabled={optionsOf(p.price_minor).length === 0}>{t('settings.purchase.buy')}</Button>
			</SettingsRow>
		{:else}
			<p class="empty">{t('settings.purchase.noPlans')}</p>
		{/each}
	</SettingsSection>

	{#if packs.length}
		<SettingsSection title={t('settings.purchase.topUpSection')} description={t('settings.purchase.topUpHint')} id="purchase-topup">
			{#each packs as p (p.id)}
				<SettingsRow
					title={yuan(p.price_minor)}
					description={p.balance && p.balance.bonus_minor !== '0'
						? t('settings.purchase.receiveBonus', { amount: yuan(p.balance.actual_received_minor), bonus: yuan(p.balance.bonus_minor) })
						: undefined}
				>
					<Button size="sm" onclick={() => buy(p)} disabled={optionsOf(p.price_minor).length === 0}>{t('settings.purchase.topUp')}</Button>
				</SettingsRow>
			{/each}
			{#if catalog.custom}
				<SettingsRow
					id="purchase-custom"
					title={t('settings.purchase.customAmount')}
					description={customWrong
						? t('settings.purchase.customInvalid', { min: yuan(catalog.custom.min_minor), max: yuan(catalog.custom.max_minor) })
						: t('settings.purchase.customHint', { min: yuan(catalog.custom.min_minor), max: yuan(catalog.custom.max_minor) })}
				>
					<input
						class="custom"
						class:bad={customWrong}
						inputmode="decimal"
						placeholder={t('settings.purchase.customPlaceholder')}
						aria-label={t('settings.purchase.customLabel')}
						aria-invalid={customWrong}
						bind:value={customText}
						onkeydown={(e) => e.key === 'Enter' && buyCustom()}
					/>
					<Button size="sm" onclick={buyCustom} disabled={!customOk || (customFen != null && optionsOf(customFen).length === 0)}>{t('settings.purchase.topUp')}</Button>
				</SettingsRow>
			{/if}
		</SettingsSection>
	{/if}

	{#if orders.length}
		<SettingsSection title={t('settings.purchase.ordersSection')} id="purchase-orders">
			{#each orders as o (o.id)}
				<SettingsRow title={orderTitle(o)} description={orderLine(o)}>
					{#if canResume(o)}
						<Button size="sm" onclick={() => resume(o)}>{t('settings.purchase.resume')}</Button>
					{/if}
				</SettingsRow>
			{/each}
		</SettingsSection>
	{/if}
{/if}

<!-- Keyed: a dialog opened while the last one still fades out is a new one
     (an {#if} that turns true again during its outro keeps the old instance). -->
{#if buying && catalog}
	{#key buying}
		<CheckoutDialog
			product={buying.product}
			customMinor={buying.customMinor}
			options={optionsOf(buying.customMinor ?? buying.product.price_minor)}
			currentPlan={plan}
			userId={account.user?.id ?? ''}
			resumeOrderId={buying.resume}
			onClose={closeDialog}
			onCompleted={completed}
		/>
	{/key}
{/if}

<style>
	.amount {
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-md);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.about {
		display: block;
		max-width: 52ch;
		overflow: hidden;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 16px;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.line {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
	.empty {
		margin: 0;
		padding: 14px 0;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	/* TextField's look at the row buttons' height; a plain input for its
	   label, input mode and Enter. */
	.custom {
		width: 104px;
		min-height: 28px;
		padding: 4px 8px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		line-height: 18px;
		text-align: right;
		outline: none;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.custom::placeholder {
		color: var(--dim2);
	}
	.custom:focus {
		border-color: var(--border-strong);
	}
	.custom.bad {
		border-color: var(--err);
	}
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.sk {
		height: 48px;
		border-radius: var(--r-sm);
		background: color-mix(in oklab, var(--text) 5%, transparent);
		animation: pulse 1.4s ease-in-out infinite;
	}
	.sk.tall {
		height: 180px;
	}
	@media (prefers-reduced-motion: reduce) {
		.sk {
			animation: none;
		}
	}
</style>
