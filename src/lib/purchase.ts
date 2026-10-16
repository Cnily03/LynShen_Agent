// In-app purchase of plans and balance (gateway contract: spec
// desktop-purchase.spec.md, DP-*): reading the gateway's catalog, orders and
// payment answers, the words for prices and quota windows, and the
// checkout's bookkeeping (which request ids a retry reuses after which
// failure). Without Tauri or Svelte; settings/PurchaseSection.svelte and
// settings/CheckoutDialog.svelte run it.
import { t } from '$lib/i18n';

/** One CNY quota rule of a plan, as the store keeps it (SB-P-7). */
export interface QuotaWindow {
	window_kind: string;
	window_seconds: number;
	/** CNY fen; 1 积分 = ¥1. */
	quota_fen_cny: string;
}

export interface StoreBalance {
	recharge_minor: string;
	bonus_minor: string;
	actual_received_minor: string;
}

/** A product the desktop can buy (DP-C2); amounts in CNY fen. */
export interface StoreProduct {
	id: string;
	kind: 'balance' | 'plan';
	name: string;
	description: string;
	price_minor: string;
	duration_seconds: number | null;
	groups: string[];
	windows: QuotaWindow[];
	balance: StoreBalance | null;
}

export type ActionKind = 'qr' | 'redirect';

/** One way to pay (DP-0.4): a Channel and a method (`wxpay`, `alipay`, `card`). */
export interface PaymentOption {
	id: string;
	channel_id: string;
	method: string;
	label: string;
	actions: ActionKind[];
	min_minor: string;
	max_minor: string;
}

export interface StoreCatalog {
	products: StoreProduct[];
	options: PaymentOption[];
	custom: { product_id: string; min_minor: string; max_minor: string } | null;
}

export type OrderState = 'awaiting_payment' | 'expired' | 'paid' | 'completed' | 'closed' | 'refunded';

/** The buyer's view of one order (DP-0.5). */
export interface StoreOrder {
	id: string;
	order_number: string;
	product_id: string;
	kind: 'balance' | 'plan';
	name: string;
	balance: StoreBalance | null;
	amount_minor: string;
	state: OrderState;
	/** RFC 3339. */
	expires_at: string;
	created_at: string;
}

/** What the payment step shows (SB-O-12A): a code to scan or a page to open. */
export type CheckoutAction =
	| { kind: 'qr'; payload: string; expires_at: string | null }
	| { kind: 'redirect'; url: string; expires_at: string | null };

export interface Checkout {
	attemptId: string;
	method: string | null;
	action: CheckoutAction;
}

const MINOR = /^(0|[1-9][0-9]*)$/;
const ORDER_STATES: OrderState[] = ['awaiting_payment', 'expired', 'paid', 'completed', 'closed', 'refunded'];

const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const minor = (v: unknown): string | null => (typeof v === 'string' && MINOR.test(v) ? v : null);

function parseBalance(v: unknown): StoreBalance | null {
	const b = obj(v);
	if (!b) return null;
	const recharge = minor(b.recharge_minor);
	const bonus = minor(b.bonus_minor);
	const received = minor(b.actual_received_minor);
	return recharge && bonus && received ? { recharge_minor: recharge, bonus_minor: bonus, actual_received_minor: received } : null;
}

function parseWindow(v: unknown): QuotaWindow | null {
	const w = obj(v);
	const kind = str(w?.window_kind);
	const seconds = w?.window_seconds;
	const quota = minor(w?.quota_fen_cny);
	if (!kind || typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0 || !quota) return null;
	return { window_kind: kind, window_seconds: seconds, quota_fen_cny: quota };
}

function parseProduct(v: unknown): StoreProduct | null {
	const p = obj(v);
	if (!p) return null;
	const id = str(p.id);
	const kind = p.kind === 'balance' || p.kind === 'plan' ? p.kind : null;
	const price = minor(p.price_minor);
	if (!id || !kind || !price || price === '0') return null;
	const balance = parseBalance(p.balance);
	if (kind === 'balance' && !balance) return null;
	const duration = typeof p.duration_seconds === 'number' && p.duration_seconds > 0 ? p.duration_seconds : null;
	if (kind === 'plan' && duration == null) return null;
	return {
		id,
		kind,
		name: str(p.name) ?? '',
		description: str(p.description) ?? '',
		price_minor: price,
		duration_seconds: duration,
		groups: Array.isArray(p.groups) ? p.groups.filter((g): g is string => typeof g === 'string') : [],
		windows: Array.isArray(p.windows) ? p.windows.flatMap((w) => parseWindow(w) ?? []) : [],
		balance: kind === 'balance' ? balance : null
	};
}

function parseOption(v: unknown): PaymentOption | null {
	const o = obj(v);
	const id = str(o?.id);
	const channel = str(o?.channel_id);
	const method = str(o?.method);
	const min = minor(o?.min_minor);
	const max = minor(o?.max_minor);
	const raw = o?.actions;
	const actions = Array.isArray(raw) ? raw.filter((a): a is ActionKind => a === 'qr' || a === 'redirect') : [];
	if (!o || !id || !channel || !method || !min || !max || actions.length === 0) return null;
	return { id, channel_id: channel, method, label: str(o.label) ?? method, actions, min_minor: min, max_minor: max };
}

/** The body of GET /api/desktop/oauth/store/catalog; null when it is not one. */
export function parseCatalog(body: unknown): StoreCatalog | null {
	const b = obj(body);
	if (!b || !Array.isArray(b.products) || !Array.isArray(b.payment_options)) return null;
	const c = obj(b.custom_recharge);
	const customProduct = str(c?.product_id);
	const customMin = minor(c?.min_minor);
	const customMax = minor(c?.max_minor);
	return {
		products: b.products.flatMap((p) => parseProduct(p) ?? []),
		options: b.payment_options.flatMap((o) => parseOption(o) ?? []),
		custom: customProduct && customMin && customMax ? { product_id: customProduct, min_minor: customMin, max_minor: customMax } : null
	};
}

/** One `DesktopOrder`; null when it is not one. */
export function parseOrder(v: unknown): StoreOrder | null {
	const o = obj(v);
	const id = str(o?.id);
	const state = ORDER_STATES.find((s) => s === o?.state);
	const amount = minor(o?.amount_minor);
	const expires = str(o?.expires_at);
	if (!o || !id || !state || !amount || !expires || Number.isNaN(Date.parse(expires))) return null;
	return {
		id,
		order_number: str(o.order_number) ?? '',
		product_id: str(o.product_id) ?? '',
		kind: o.kind === 'plan' ? 'plan' : 'balance',
		name: str(o.name) ?? '',
		balance: parseBalance(o.balance),
		amount_minor: amount,
		state,
		expires_at: expires,
		created_at: str(o.created_at) ?? expires
	};
}

/** The body of GET /api/desktop/oauth/store/orders. */
export function parseOrders(body: unknown): StoreOrder[] {
	const orders = obj(body)?.orders;
	return Array.isArray(orders) ? orders.flatMap((o) => parseOrder(o) ?? []) : [];
}

/** The answer of POST …/attempts; null for an action the desktop cannot
 *  complete (a form post) or a malformed body. */
export function parseCheckout(body: unknown): Checkout | null {
	const b = obj(body);
	const attempt = obj(b?.attempt);
	const action = obj(b?.action);
	const id = str(attempt?.id);
	if (!id || !action) return null;
	const expires = str(action.expires_at);
	const method = str(attempt?.method);
	if (action.kind === 'qr' && str(action.payload)) return { attemptId: id, method, action: { kind: 'qr', payload: action.payload as string, expires_at: expires } };
	const url = str(action.url);
	if (action.kind === 'redirect' && url && /^https:\/\//i.test(url)) return { attemptId: id, method, action: { kind: 'redirect', url, expires_at: expires } };
	return null;
}

// ---------- words and numbers ----------

function groupThousands(digits: string): string {
	return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** CNY fen as yuan without a trailing ".00": "¥49", "¥23.45", "¥1,000". */
export function yuan(fen: string): string {
	if (!MINOR.test(fen)) return '—';
	const value = BigInt(fen);
	const cents = value % 100n;
	const whole = groupThousands((value / 100n).toString());
	return cents === 0n ? `¥${whole}` : `¥${whole}.${cents.toString().padStart(2, '0')}`;
}

/** CNY fen as 积分, as the website names a quota (PR #18 quotaCoinAmount):
 *  "8", "23.50". */
export function creditAmount(fen: string): string {
	if (!MINOR.test(fen)) return fen;
	const value = BigInt(fen);
	const cents = value % 100n;
	return cents === 0n ? (value / 100n).toString() : `${value / 100n}.${cents.toString().padStart(2, '0')}`;
}

/** A quota window in words, by its exact rolling length: whole days, else
 *  whole hours, else minutes; the calendar windows by their reset. */
export function windowText(kind: string, seconds: number): string {
	switch (kind) {
		case 'day':
			return t('settings.purchase.window.day');
		case 'week':
			return t('settings.purchase.window.week');
		case 'month':
			return t('settings.purchase.window.month');
	}
	if (seconds > 0 && seconds % 86_400 === 0) {
		const n = seconds / 86_400;
		return n === 1 ? t('settings.purchase.window.oneDay') : t('settings.purchase.window.days', { n });
	}
	if (seconds > 0 && seconds % 3_600 === 0) {
		const n = seconds / 3_600;
		return n === 1 ? t('settings.purchase.window.oneHour') : t('settings.purchase.window.hours', { n });
	}
	return t('settings.purchase.window.minutes', { n: Math.max(1, Math.round(seconds / 60)) });
}

/** "每 5 小时 8 积分" / "Every 5 hours: 8 credits". */
export function windowRule(w: QuotaWindow): string {
	return t('settings.purchase.window.rule', { window: windowText(w.window_kind, w.window_seconds), n: creditAmount(w.quota_fen_cny) });
}

/** A plan's length: "30 天", or hours when it is not whole days. */
export function durationText(seconds: number | null): string {
	if (seconds == null || seconds <= 0) return '—';
	if (seconds % 86_400 === 0) return t('settings.purchase.days', { n: seconds / 86_400 });
	return t('settings.purchase.hours', { n: Math.round(seconds / 3_600) });
}

/** A typed amount in yuan ("23", "23.5", "23.45") as fen; null when it is not
 *  one (a sign, a third decimal, letters). */
export function parseYuanInput(text: string): string | null {
	const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(text);
	if (!m) return null;
	const fen = BigInt(m[1]) * 100n + BigInt((m[2] ?? '').padEnd(2, '0'));
	return fen > 0n ? fen.toString() : null;
}

/** Whether `fen` lies within [min, max] (all CNY fen). */
export const withinMinor = (fen: string, min: string, max: string): boolean =>
	MINOR.test(fen) && BigInt(fen) >= BigInt(min) && BigInt(fen) <= BigInt(max);

/** The payment options that take this amount. */
export const optionsFor = (options: PaymentOption[], fen: string): PaymentOption[] => options.filter((o) => withinMinor(fen, o.min_minor, o.max_minor));

/** The wallet a method's QR code is scanned with, for the dialog's line. */
export function methodName(method: string | null, label: string): string {
	if (method === 'wxpay') return t('settings.purchase.methods.wxpay');
	if (method === 'alipay') return t('settings.purchase.methods.alipay');
	return label;
}

// ---------- checkout bookkeeping ----------

/** localStorage: the checkout in progress, so a retry, a reopened dialog or a
 *  restart reuses its request ids instead of ordering twice. */
export const CHECKOUT_KEY = 'lynshen-store-checkout';

/** How long an order can be paid (SB-P-15: 30 minutes). */
export const ORDER_LIFETIME_MS = 30 * 60_000;

export interface PendingCheckout {
	/** What was bought, how, and by whom: a different choice is a new order. */
	fingerprint: string;
	/** The choice itself, to show the payment again later. */
	productId: string;
	optionId: string;
	method: string | null;
	customMinor: string | null;
	orderRequestId: string;
	attemptRequestId: string;
	orderId: string | null;
	/** When the ids were made (ms): after an order's lifetime they are dropped. */
	createdAt: number;
}

export interface CheckoutStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

/** The identity of one purchase choice. The method is part of it: one EPay
 *  Channel offers both wallets, and an order whose code was shown for one
 *  cannot take another attempt while that code is valid (SB-O-4). */
export function checkoutFingerprint(userId: string, productId: string, optionId: string, customMinor: string | null): string {
	return JSON.stringify([userId, productId, optionId, customMinor]);
}

export function loadPending(storage: CheckoutStorage): PendingCheckout | null {
	try {
		const v = obj(JSON.parse(storage.getItem(CHECKOUT_KEY) ?? 'null'));
		if (
			!v ||
			typeof v.fingerprint !== 'string' ||
			typeof v.productId !== 'string' ||
			typeof v.optionId !== 'string' ||
			!(typeof v.method === 'string' || v.method === null) ||
			!(typeof v.customMinor === 'string' || v.customMinor === null) ||
			typeof v.orderRequestId !== 'string' ||
			typeof v.attemptRequestId !== 'string' ||
			typeof v.createdAt !== 'number' ||
			!(typeof v.orderId === 'string' || v.orderId === null)
		)
			return null;
		return v as unknown as PendingCheckout;
	} catch {
		return null;
	}
}

export function savePending(storage: CheckoutStorage, pending: PendingCheckout): void {
	try {
		storage.setItem(CHECKOUT_KEY, JSON.stringify(pending));
	} catch {
		/* no storage: a retry orders again, which the gateway allows */
	}
}

/** One purchase choice: what, how, and by whom. */
export interface CheckoutChoice {
	userId: string;
	productId: string;
	optionId: string;
	method: string | null;
	customMinor: string | null;
}

/** The checkout for this choice: the kept one while it can still be paid,
 *  else new ids. */
export function preparePending(storage: CheckoutStorage, choice: CheckoutChoice, now: number, newId: () => string): PendingCheckout {
	const fingerprint = checkoutFingerprint(choice.userId, choice.productId, choice.optionId, choice.customMinor);
	const kept = loadPending(storage);
	if (kept && kept.fingerprint === fingerprint && now - kept.createdAt < ORDER_LIFETIME_MS) return kept;
	const pending: PendingCheckout = {
		fingerprint,
		productId: choice.productId,
		optionId: choice.optionId,
		method: choice.method,
		customMinor: choice.customMinor,
		orderRequestId: newId(),
		attemptRequestId: newId(),
		orderId: null,
		createdAt: now
	};
	savePending(storage, pending);
	return pending;
}

/** The kept checkout of an order that can still be paid, to show its
 *  payment again (the same ids return the same code or page). */
export function resumable(storage: CheckoutStorage, order: StoreOrder, now: number): PendingCheckout | null {
	const kept = loadPending(storage);
	return kept && kept.orderId === order.id && order.state === 'awaiting_payment' && Date.parse(order.expires_at) > now ? kept : null;
}

/** Forgets the kept checkout (for `orderId`, or any). */
export function clearPending(storage: CheckoutStorage, orderId?: string): void {
	const kept = loadPending(storage);
	if (!orderId || kept?.orderId === orderId) {
		try {
			storage.removeItem(CHECKOUT_KEY);
		} catch {
			/* nothing kept */
		}
	}
}

/** What a retry after this failure reuses:
 *  - `rotate`: the order stays, the payment attempt gets a new id (the
 *    Provider refused it for certain, SB-UI-9A);
 *  - `restart`: a new order (this one can no longer be paid);
 *  - `keep`: both ids again (the outcome is unknown: a network failure, an
 *    ambiguous answer, a limit), so a retry cannot pay twice. */
export function afterFailure(code: string | null): 'rotate' | 'restart' | 'keep' {
	if (code === 'payment_configuration_unavailable' || code === 'payment_provider_rejected') return 'rotate';
	if (
		code === 'order_not_payable' ||
		code === 'active_payment_attempt' ||
		code === 'idempotency_conflict' ||
		code === 'order_not_found' ||
		code === 'product_not_available' ||
		code === 'invalid_amount' ||
		code === 'payment_channel_unavailable'
	)
		return 'restart';
	return 'keep';
}

/** After a failure: the kept checkout with the ids a retry should use. */
export function pendingAfterFailure(pending: PendingCheckout, code: string | null, newId: () => string): PendingCheckout | null {
	switch (afterFailure(code)) {
		case 'rotate':
			return pending.orderId ? { ...pending, attemptRequestId: newId() } : pending;
		case 'restart':
			return null;
		default:
			return pending;
	}
}

/** How long the dialog keeps asking after the payment went through but the
 *  plan or credit is not there yet (fulfillment retries on its own, SB-RC-1a). */
export const PAID_PATIENCE_MS = 120_000;

/** Between two status checks. The gateway allows 30 a minute per account,
 *  website included (SB-O-8). */
export const POLL_INTERVAL_MS = 3_000;

export type CheckoutPhase = 'waiting' | 'paid' | 'done' | 'expired' | 'closed' | 'slow';

/** Where the dialog stands after a status check. `paidSince`: when the
 *  order was first seen paid (ms), or null. */
export function phaseOf(order: StoreOrder, now: number, paidSince: number | null): CheckoutPhase {
	switch (order.state) {
		case 'completed':
			return 'done';
		case 'paid':
			return paidSince != null && now - paidSince >= PAID_PATIENCE_MS ? 'slow' : 'paid';
		case 'expired':
			return 'expired';
		case 'closed':
		case 'refunded':
			return 'closed';
		default:
			return Date.parse(order.expires_at) <= now ? 'expired' : 'waiting';
	}
}

/** The checks continue in these phases. */
export const keepsPolling = (phase: CheckoutPhase): boolean => phase === 'waiting' || phase === 'paid';

/** Whole seconds until `iso` (0 once past); null without a time. */
export function secondsUntil(iso: string | null, now: number): number | null {
	if (!iso) return null;
	const at = Date.parse(iso);
	return Number.isNaN(at) ? null : Math.max(0, Math.ceil((at - now) / 1000));
}

/** "9:41" for a countdown. */
export function clock(seconds: number): string {
	const m = Math.floor(seconds / 60);
	return `${m}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A purchase failure in words: what failed, then what to do. */
export function failureText(code: string | null, status: number | null, message: string): string {
	const known = [
		'payment_channel_unavailable',
		'product_not_available',
		'order_rate_limited',
		'open_order_limit',
		'payment_hold',
		'payment_provider_rejected',
		'payment_configuration_unavailable',
		'payment_provider_ambiguous',
		'provider_query_required',
		'invalid_amount',
		'order_poll_rate_limited',
		'order_not_payable',
		'active_payment_attempt'
	];
	if (code && known.includes(code)) return t(`settings.purchase.errors.${code}`);
	if (code === 'store_retention_paused' || code === 'store_primary_unavailable' || code === 'store_write_rejected' || code === 'exchange_rate_unavailable')
		return t('settings.purchase.errors.unavailable');
	if (code === 'email_unverified' && message) return message;
	if (status === 404) return t('settings.purchase.unsupported');
	if (status == null) return t('settings.purchase.errors.network');
	return message || t('settings.purchase.errors.unknown');
}
