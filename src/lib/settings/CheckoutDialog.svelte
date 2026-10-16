<script lang="ts">
	// Buying one product in the app (purchase.ts, gateway DP-*): confirm what
	// is bought and how it is paid, then the payment itself, a QR code to
	// scan in the dialog or a payment page in the browser, and the outcome,
	// asked of the gateway every few seconds. Request ids are kept
	// (localStorage) so a retry, a reopened dialog or a restart cannot order
	// or pay twice; closing the dialog only stops waiting. A plan bought
	// ends with who pays this device now: the plan, with its end, and the
	// balance one tap away.
	import { trial } from '$lib/trial.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { onDestroy, untrack } from 'svelte';
	import { renderSVG } from 'uqr';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { t } from '$lib/i18n';
	import { openExternal } from '$lib/openExternal';
	import { GatewayError, createStoreOrder, payStoreOrder, queryStoreOrder } from '$lib/protocol';
	import { planDate, type TrialPlan } from '$lib/trial';
	import {
		POLL_INTERVAL_MS,
		clearPending,
		clock,
		durationText,
		failureText,
		loadPending,
		methodName,
		parseCheckout,
		parseOrder,
		pendingAfterFailure,
		phaseOf,
		preparePending,
		savePending,
		secondsUntil,
		windowRule,
		yuan,
		type Checkout,
		type PaymentOption,
		type PendingCheckout,
		type StoreOrder,
		type StoreProduct
	} from '$lib/purchase';

	let {
		product,
		customMinor = null,
		options,
		currentPlan = null,
		userId,
		resumeOrderId = null,
		onClose,
		onCompleted
	}: {
		product: StoreProduct;
		/** A custom top-up in CNY fen, carried by `product` (DP-C4). */
		customMinor?: string | null;
		/** The ways to pay that take this amount. */
		options: PaymentOption[];
		/** The desktop plan in force: a plan bought now replaces it (DP-P1). */
		currentPlan?: TrialPlan | null;
		userId: string;
		/** An unpaid order of the kept checkout: show its payment again. */
		resumeOrderId?: string | null;
		onClose: () => void;
		/** The order is paid and the plan or credit is in place. */
		onCompleted: (order: StoreOrder) => void;
	} = $props();

	const METHOD_KEY = 'lynshen-store-method';
	const storage = typeof localStorage === 'undefined' ? null : localStorage;
	const newId = () => crypto.randomUUID();

	const amount = $derived(customMinor ?? product.price_minor);
	const balance = $derived(
		customMinor ? { recharge_minor: customMinor, bonus_minor: '0', actual_received_minor: customMinor } : product.balance
	);
	const title = $derived(
		product.kind === 'plan' ? t('settings.purchase.buyTitle', { name: product.name }) : t('settings.purchase.topUpTitle', { amount: yuan(amount) })
	);

	// The kept checkout's method when resuming, else the one picked last
	// time, else the first offered.
	let optionId = $state(
		untrack(() => {
			const kept = resumeOrderId && storage ? loadPending(storage) : null;
			if (kept?.orderId === resumeOrderId && options.some((o) => o.id === kept.optionId)) return kept.optionId;
			const last = storage?.getItem(METHOD_KEY);
			return options.find((o) => o.method === last)?.id ?? options[0]?.id ?? '';
		})
	);
	const option = $derived(options.find((o) => o.id === optionId) ?? null);

	type Step = 'confirm' | 'working' | 'pay' | 'paid' | 'done' | 'slow' | 'expired' | 'closed' | 'error';
	let step = $state<Step>('confirm');
	let order = $state<StoreOrder | null>(null);
	let checkout = $state<Checkout | null>(null);
	let failure = $state('');
	let pending: PendingCheckout | null = null;
	let paidSince: number | null = null;
	let startedAt = $state(Date.now());
	let now = $state(Date.now());
	let alive = true;

	// After a plan is paid, this device pays with it: the default after a
	// purchase (owner, 2026-10-17; the gateway moves the account's devices to
	// the plan at fulfilment). The dialog confirms it, with the plan's end,
	// and offers 改用余额 at once (also later in Settings → 账户). A gateway
	// that left this device on the balance gets the plan here. Meanwhile the
	// one-time notice elsewhere waits; this plan is not announced again.
	let payer = $state<'checking' | 'plan' | 'balance' | 'saving' | null>(null);
	let payerError = $state('');
	$effect(() => {
		if (step !== 'done' || order?.kind !== 'plan' || payer) return;
		untrack(() => {
			payer = 'checking';
			trial.offerHeld = true;
			void settlePayer();
		});
	});
	async function settlePayer() {
		await trial.refreshStatus();
		if (!alive) return;
		if (trial.funding === 'balance') {
			const error = await trial.setFunding('plan');
			if (!alive) return;
			if (error) payerError = t('shell.trial.fundingFailed', { error });
		}
		payer = trial.funding === 'balance' ? 'balance' : 'plan';
	}
	async function switchPayer(to: 'plan' | 'balance') {
		payer = 'saving';
		payerError = '';
		const error = await trial.setFunding(to);
		if (!alive) return;
		if (error) payerError = t('shell.trial.fundingFailed', { error });
		else toast.success(t(to === 'plan' ? 'shell.funding.toPlan' : 'shell.trial.fundingToBalance'));
		payer = trial.funding === 'balance' ? 'balance' : 'plan';
	}
	onDestroy(() => {
		if (!payer) return;
		trial.offerHeld = false;
		const now = trial.plan;
		if (now && now.name.trim() === planName.trim()) trial.markOffered(now);
	});
	const planName = $derived(order?.name || product.name);
	// The plan's end, counted from the purchase: the gateway's, else the
	// product's length from now.
	const planEnds = $derived.by(() => {
		const now = trial.plan;
		if (now && now.name.trim() === planName.trim()) return now.expires_at;
		return product.duration_seconds ? new Date(Date.now() + product.duration_seconds * 1000).toISOString() : null;
	});
	const endsAround = $derived(product.duration_seconds ? new Date(Date.now() + product.duration_seconds * 1000).toISOString() : null);

	const replacing = $derived(product.kind === 'plan' && currentPlan != null);
	const sameProduct = $derived(replacing && currentPlan?.name.trim() === product.name.trim());
	const qr = $derived(checkout?.action.kind === 'qr' ? renderSVG(checkout.action.payload, { border: 4 }) : '');
	// The code and the order run out together (30 minutes); the earlier wins.
	const left = $derived.by(() => {
		const times = [checkout?.action.expires_at ?? null, order?.expires_at ?? null]
			.map((iso) => secondsUntil(iso, now))
			.filter((s): s is number => s != null);
		return times.length ? Math.min(...times) : null;
	});
	const waited = $derived(Math.max(0, Math.round((now - startedAt) / 1000)));
	const working = $derived(step === 'working');
	const polling = $derived(step === 'pay' || step === 'paid');

	function fail(error: unknown) {
		const e = error instanceof GatewayError ? error : null;
		if (pending && storage) {
			const next = pendingAfterFailure(pending, e?.code ?? null, newId);
			if (next) savePending(storage, next);
			else clearPending(storage);
			pending = next;
		}
		failure = failureText(e?.code ?? null, e?.status ?? null, error instanceof Error ? error.message : String(error));
		step = 'error';
	}

	/** Orders (or finds the kept order) and starts paying it. */
	async function start() {
		if (!option || !storage) return;
		step = 'working';
		failure = '';
		storage.setItem(METHOD_KEY, option.method);
		try {
			pending = preparePending(
				storage,
				{ userId, productId: product.id, optionId: option.id, method: option.method, customMinor },
				Date.now(),
				newId
			);
			let current: StoreOrder | null = null;
			if (pending.orderId) {
				current = parseOrder(await queryStoreOrder(pending.orderId));
				if (!alive) return;
				// Paid meanwhile, or no longer payable: show that instead.
				if (current && current.state !== 'awaiting_payment') return follow(current);
			}
			if (!current) {
				current = parseOrder(await createStoreOrder(product.id, option.channel_id, customMinor, pending.orderRequestId));
				if (!current) throw new Error(t('settings.purchase.errors.unknown'));
				pending = { ...pending, orderId: current.id };
				savePending(storage, pending);
			}
			if (!alive) return;
			order = current;
			await pay(current.id, option.method);
		} catch (error) {
			if (alive) fail(error);
		}
	}

	async function pay(orderId: string, method: string | null) {
		if (!pending) return;
		const answer = parseCheckout(await payStoreOrder(orderId, method, pending.attemptRequestId));
		if (!alive) return;
		// A form post (no Channel the app lists answers one) cannot be shown here.
		if (!answer) throw new Error(t('settings.purchase.errors.unknown'));
		checkout = answer;
		if (answer.action.kind === 'redirect') openExternal(answer.action.url);
		startedAt = Date.now();
		now = startedAt;
		step = 'pay';
	}

	/** Moves the dialog on by the order's state. */
	function follow(next: StoreOrder) {
		order = next;
		const at = Date.now();
		if (next.state === 'paid' && paidSince == null) paidSince = at;
		const phase = phaseOf(next, at, paidSince);
		if (phase === 'waiting') {
			step = 'pay';
			return;
		}
		step = phase;
		if (phase === 'done' || phase === 'expired' || phase === 'closed') {
			if (storage) clearPending(storage, next.id);
			pending = null;
		}
		if (phase === 'done') onCompleted(next);
	}

	// The checks, every few seconds while the payment is open or being credited.
	async function check() {
		const id = order?.id;
		if (!id || !polling) return;
		try {
			const next = parseOrder(await queryStoreOrder(id));
			if (alive && next && order?.id === id && polling) follow(next);
		} catch (error) {
			// A limit, the network: the next check tries again. A lost sign-in stops.
			if (alive && error instanceof GatewayError && (error.status === 401 || error.code === 'not_signed_in')) fail(error);
		}
	}
	$effect(() => {
		if (!polling) return;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;
		const loop = () => {
			timer = setTimeout(async () => {
				await check();
				if (!stopped) loop();
			}, POLL_INTERVAL_MS);
		};
		loop();
		return () => {
			stopped = true;
			clearTimeout(timer);
		};
	});
	// The waited seconds and the countdown.
	$effect(() => {
		if (!polling) return;
		const tick = setInterval(() => (now = Date.now()), 1000);
		return () => clearInterval(tick);
	});
	onDestroy(() => (alive = false));

	// A kept unpaid order: its payment again, with the kept ids.
	$effect(() => {
		const id = resumeOrderId;
		if (id) untrack(() => void resume(id));
	});
	async function resume(orderId: string) {
		const kept = storage ? loadPending(storage) : null;
		if (!kept || kept.orderId !== orderId) return;
		pending = kept;
		step = 'working';
		try {
			const current = parseOrder(await queryStoreOrder(orderId));
			if (!alive || !current) return;
			order = current;
			if (current.state !== 'awaiting_payment') return follow(current);
			await pay(orderId, kept.method);
		} catch (error) {
			if (alive) fail(error);
		}
	}

	function reopen() {
		const action = checkout?.action;
		if (action?.kind === 'redirect') openExternal(action.url);
	}

	function again() {
		if (storage) clearPending(storage);
		pending = null;
		order = null;
		checkout = null;
		paidSince = null;
		step = 'confirm';
	}
</script>

<Modal {title} width={420} dismissible={!working} {onClose}>
	{#if step === 'confirm' || step === 'working' || step === 'error'}
		<dl class="facts">
			<div>
				<dt>{t('settings.purchase.item')}</dt>
				<dd>
					{product.kind === 'plan' ? product.name : t('settings.purchase.topUp')}
					{#if product.kind === 'plan' && product.windows.length}
						<span class="sub">{product.windows.map(windowRule).join(' · ')}</span>
					{/if}
				</dd>
			</div>
			<div><dt>{t('settings.purchase.amount')}</dt><dd class="num">{yuan(amount)}</dd></div>
			{#if product.kind === 'plan'}
				<div><dt>{t('settings.purchase.validity')}</dt><dd>{durationText(product.duration_seconds)}</dd></div>
			{:else if balance}
				<div>
					<dt>{t('settings.purchase.receives')}</dt>
					<dd>
						{balance.bonus_minor !== '0'
							? t('settings.purchase.receiveBonus', { amount: yuan(balance.actual_received_minor), bonus: yuan(balance.bonus_minor) })
							: yuan(balance.actual_received_minor)}
					</dd>
				</div>
			{/if}
			<div>
				<dt>{t('settings.purchase.method')}</dt>
				<dd>
					{#if options.length > 1}
						<Segmented value={optionId} options={options.map((o) => ({ value: o.id, label: methodName(o.method, o.label) }))} onChange={(v) => (optionId = v)} />
					{:else if option}
						{methodName(option.method, option.label)}
					{/if}
				</dd>
			</div>
		</dl>
		{#if product.kind === 'plan'}
			{#if replacing && currentPlan}
				<Notice tone="warn">
					{sameProduct
						? t('settings.purchase.sameNotice', { current: currentPlan.name.trim(), duration: durationText(product.duration_seconds) })
						: t('settings.purchase.replaceNotice', { current: currentPlan.name.trim() || t('shell.trial.label') })}
				</Notice>
			{:else}
				<p class="note">
					{endsAround
						? t('settings.purchase.startNoticeAt', { duration: durationText(product.duration_seconds), date: planDate(endsAround) })
						: t('settings.purchase.startNotice', { duration: durationText(product.duration_seconds) })}
				</p>
			{/if}
			<p class="note">{t('settings.purchase.planDefault')} {t('settings.purchase.planScope')}</p>
		{/if}
		{#if step === 'error'}
			<p class="err" role="alert">{failure}</p>
		{/if}
	{:else if step === 'pay' && checkout?.action.kind === 'qr'}
		<div class="pay">
			<!-- SVG drawn here from the payment provider's code; no markup comes from outside. -->
			<div class="qr" role="img" aria-label={t('settings.purchase.scanGeneric', { amount: yuan(amount) })}>{@html qr}</div>
			<p class="lead">
				{checkout.method
					? t('settings.purchase.scanWith', { method: methodName(checkout.method, option?.label ?? ''), amount: yuan(amount) })
					: t('settings.purchase.scanGeneric', { amount: yuan(amount) })}
			</p>
			<p class="small num">
				{t('settings.purchase.waited', { s: waited })}{#if left != null}{' · '}{t('settings.purchase.expiresIn', { time: clock(left) })}{/if}
			</p>
		</div>
		<p class="note">{t('settings.purchase.leaveNote')}</p>
	{:else if step === 'pay' && checkout?.action.kind === 'redirect'}
		<div class="pay">
			<p class="lead">{t('settings.purchase.inBrowser')}</p>
			<p class="small num">{t('settings.purchase.waited', { s: waited })}</p>
		</div>
		<p class="note">{t('settings.purchase.leaveNote')}</p>
	{:else if step === 'paid'}
		<div class="pay" role="status">
			<CircleNotchIcon size={20} class="spin" />
			<p class="lead">{t('settings.purchase.paidWaiting')}</p>
		</div>
	{:else if step === 'done' && order}
		<div class="pay" role="status">
			<span class="ok"><CheckCircleIcon size={28} weight="fill" /></span>
			<p class="lead">
				{order.kind === 'plan'
					? t('settings.purchase.donePlan', { name: order.name || product.name })
					: t('settings.purchase.doneBalance', { amount: yuan(order.balance?.actual_received_minor ?? amount) })}
			</p>
		</div>
		{#if payer}
			<!-- Who pays now: the plan (the default after a purchase), with its end; the balance one tap away. -->
			<div class="payer" role="status" aria-busy={payer === 'checking' || payer === 'saving'}>
				{#if payer === 'checking'}
					<p class="small"><CircleNotchIcon size={12} class="spin" /> {t('settings.purchase.checkingPayer')}</p>
				{:else}
					<p class="lead">
						{payer === 'balance' ? t('settings.purchase.stillBalance') : t('settings.purchase.nowPlan', { name: planName })}
					</p>
					<p class="small">
						{planEnds
							? t('settings.purchase.planEnds', { date: planDate(planEnds, true), duration: durationText(product.duration_seconds) })
							: ''}{payer === 'balance' ? t('settings.purchase.stillBalanceHint') : t('settings.purchase.nowPlanHint')}
					</p>
				{/if}
				{#if payerError}<p class="err" role="alert">{payerError}</p>{/if}
			</div>
		{/if}
	{:else if step === 'slow'}
		<p class="lead">{t('settings.purchase.slow')}</p>
	{:else if step === 'expired'}
		<p class="lead">{t('settings.purchase.expired')}</p>
	{:else if step === 'closed'}
		<p class="lead">{t('settings.purchase.closedState')}</p>
	{/if}

	{#snippet footer()}
		{#if step === 'confirm' || step === 'working'}
			<Button onclick={onClose} disabled={working}>{t('settings.purchase.cancel')}</Button>
			<Button variant="primary" onclick={start} disabled={working || !option}>
				{#if working}<CircleNotchIcon size={13} class="spin" />{/if}
				{t('settings.purchase.pay')}
			</Button>
		{:else if step === 'error'}
			<Button onclick={onClose}>{t('settings.purchase.close')}</Button>
			<Button variant="primary" onclick={start} disabled={!option}>{t('settings.purchase.retry')}</Button>
		{:else if step === 'pay' && checkout?.action.kind === 'redirect'}
			<Button onclick={reopen}>{t('settings.purchase.reopen')}</Button>
			<Button onclick={onClose}>{t('settings.purchase.close')}</Button>
		{:else if step === 'done' && payer}
			<Button onclick={() => switchPayer(payer === 'balance' ? 'plan' : 'balance')} disabled={payer === 'checking' || payer === 'saving'}>
				{#if payer === 'saving'}<CircleNotchIcon size={13} class="spin" />{/if}
				{t(payer === 'balance' ? 'settings.purchase.toPlan' : 'settings.purchase.toBalance')}
			</Button>
			<Button variant="primary" onclick={onClose}>{t('settings.purchase.done')}</Button>
		{:else if step === 'done'}
			<Button variant="primary" onclick={onClose}>{t('settings.purchase.done')}</Button>
		{:else if step === 'expired'}
			<Button onclick={onClose}>{t('settings.purchase.close')}</Button>
			<Button variant="primary" onclick={again}>{t('settings.purchase.again')}</Button>
		{:else}
			<Button onclick={onClose}>{t('settings.purchase.close')}</Button>
		{/if}
	{/snippet}
</Modal>

<style>
	.facts {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin: 0 0 12px;
	}
	.facts > div {
		display: flex;
		align-items: baseline;
		gap: 12px;
	}
	dt {
		flex: 0 0 72px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	dd {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex: 1;
		min-width: 0;
		margin: 0;
		color: var(--text);
		font-size: var(--fs-sm);
	}
	.sub {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.num {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.note {
		margin: 12px 0 0;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.5;
	}
	.err {
		margin: 12px 0 0;
		color: var(--err);
		font-size: var(--fs-xs);
		line-height: 1.5;
	}
	.pay {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		padding: 4px 0;
		text-align: center;
	}
	.qr {
		width: 196px;
		height: 196px;
		border-radius: var(--r-md);
		overflow: hidden;
	}
	.qr :global(svg) {
		display: block;
		width: 100%;
		height: 100%;
	}
	.lead {
		margin: 0;
		color: var(--text);
		font-size: var(--fs-sm);
		line-height: 1.5;
	}
	.small {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.ok {
		display: inline-flex;
		color: var(--ok);
	}
	.payer {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 14px;
		padding: 10px 12px;
		border-radius: var(--r-md);
		background: var(--surface);
		text-align: left;
	}
	.payer .lead {
		font-weight: 500;
	}
	.payer .small {
		display: flex;
		align-items: center;
		gap: 6px;
		line-height: 1.5;
	}
</style>
