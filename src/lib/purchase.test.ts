import { describe, expect, it } from 'vitest';
import { setLocale } from '$lib/i18n';
import {
	CHECKOUT_KEY,
	ORDER_LIFETIME_MS,
	PAID_PATIENCE_MS,
	afterFailure,
	clearPending,
	clock,
	creditAmount,
	durationText,
	failureText,
	keepsPolling,
	loadPending,
	optionsFor,
	parseCatalog,
	parseCheckout,
	parseOrder,
	parseOrders,
	parseYuanInput,
	pendingAfterFailure,
	priceNow,
	phaseOf,
	preparePending,
	resumable,
	savePending,
	secondsUntil,
	windowRule,
	windowText,
	withinMinor,
	yuan,
	type CheckoutStorage,
	type StoreOrder
} from './purchase';

const NOW = Date.parse('2026-10-16T03:00:00Z');
const MIN = 60_000;

// The gateway's answer (desktop-purchase.spec.md DP-C1), with the owner's
// products and the production Channel (EPay, both wallets).
const CATALOG = {
	currency: 'CNY',
	products: [
		{ id: 'b10', kind: 'balance', name: '10', description: '', price_minor: '1000', duration_seconds: null, groups: [], windows: [],
			balance: { recharge_minor: '1000', bonus_minor: '0', actual_received_minor: '1000' } },
		{ id: 'b50', kind: 'balance', name: '50', description: '', price_minor: '5000', duration_seconds: null, groups: [], windows: [],
			balance: { recharge_minor: '5000', bonus_minor: '500', actual_received_minor: '5500' } },
		{ id: 'sprout', kind: 'plan', name: 'Sprout', description: '可用模型：Claude、GPT、Gemini', price_minor: '4900', duration_seconds: 2_592_000,
			groups: ['套餐专用'], balance: null,
			windows: [
				{ window_kind: '5h', window_seconds: 18000, quota_fen_cny: '800' },
				{ window_kind: 'custom', window_seconds: 604800, quota_fen_cny: '2300' }
			] },
		// Dropped: no price, an unknown kind, a balance product without its amounts.
		{ id: 'x1', kind: 'plan', name: 'Broken', price_minor: '', duration_seconds: 10 },
		{ id: 'x2', kind: 'gift', name: 'Odd', price_minor: '100' },
		{ id: 'x3', kind: 'balance', name: 'No amounts', price_minor: '100', balance: null }
	],
	payment_options: [
		{ id: 'store-channel-epay:alipay', channel_id: 'store-channel-epay', method: 'alipay', label: 'Alipay', actions: ['qr', 'redirect'], min_minor: '1', max_minor: '100000000' },
		{ id: 'store-channel-epay:wxpay', channel_id: 'store-channel-epay', method: 'wxpay', label: 'WeChat Pay', actions: ['qr', 'redirect'], min_minor: '1', max_minor: '100000' },
		// Dropped: no action the app can complete.
		{ id: 'c:form', channel_id: 'c', method: 'alipay', label: 'Form', actions: ['form'], min_minor: '1', max_minor: '2' }
	],
	custom_recharge: { product_id: 'b10', min_minor: '100', max_minor: '100000000' }
};

const order = (over: Partial<Record<string, unknown>> = {}) =>
	parseOrder({
		id: 'o1',
		order_number: 'LS-1',
		product_id: 'sprout',
		kind: 'plan',
		name: 'Sprout',
		balance: null,
		amount_minor: '4900',
		currency: 'CNY',
		payment_state: 'unpaid',
		fulfillment_state: 'pending',
		state: 'awaiting_payment',
		expires_at: new Date(NOW + 30 * MIN).toISOString(),
		created_at: new Date(NOW).toISOString(),
		...over
	}) as StoreOrder;

function memory(): CheckoutStorage & { data: Map<string, string> } {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k) => data.get(k) ?? null,
		setItem: (k, v) => void data.set(k, v),
		removeItem: (k) => void data.delete(k)
	};
}

let counter = 0;
const newId = () => `id-${++counter}`;

describe('the catalog and orders', () => {
	it('reads the products, the ways to pay and the custom range, and drops what it cannot use', () => {
		const catalog = parseCatalog(CATALOG)!;
		expect(catalog.products.map((p) => p.id)).toEqual(['b10', 'b50', 'sprout']);
		expect(catalog.products[2].windows).toHaveLength(2);
		expect(catalog.products[1].balance?.actual_received_minor).toBe('5500');
		expect(catalog.options.map((o) => o.id)).toEqual(['store-channel-epay:alipay', 'store-channel-epay:wxpay']);
		expect(catalog.custom).toEqual({ product_id: 'b10', min_minor: '100', max_minor: '100000000' });
		expect(parseCatalog({ products: [] })).toBeNull();
		expect(parseCatalog(null)).toBeNull();
	});

	it('reads the gateway\'s upgrade quote and a lower plan, and prices an upgrade by the quote', () => {
		const sprout = CATALOG.products.find((p: { id: string }) => p.id === 'sprout')!;
		const catalog = parseCatalog({
			...CATALOG,
			products: [
				{ ...sprout, id: 'branch', name: 'Branch', price_minor: '9900', upgrade: { price_minor: '5000', expires_at: '2026-11-16T00:00:00Z', from: 'sprout' } },
				{ ...sprout, id: 'seed', name: 'Seed', price_minor: '1900', downgrade: true },
				{ ...sprout, id: 'odd', upgrade: { price_minor: '0' } }
			]
		})!;
		const [branch, seed, odd] = catalog.products;
		expect(branch.upgrade).toEqual({ price_minor: '5000', expires_at: '2026-11-16T00:00:00Z', from: 'sprout' });
		expect(priceNow(branch)).toBe('5000');
		expect(seed.downgrade).toBe(true);
		expect(priceNow(seed)).toBe('1900');
		expect(odd.upgrade).toBeUndefined();
	});

	it('offers only the ways to pay that take the amount', () => {
		const { options } = parseCatalog(CATALOG)!;
		expect(optionsFor(options, '4900').map((o) => o.method)).toEqual(['alipay', 'wxpay']);
		expect(optionsFor(options, '200000').map((o) => o.method)).toEqual(['alipay']);
		expect(withinMinor('100', '100', '200')).toBe(true);
		expect(withinMinor('99', '100', '200')).toBe(false);
		expect(withinMinor('1.5', '1', '200')).toBe(false);
	});

	it('reads an order and its state, and the list', () => {
		expect(order().state).toBe('awaiting_payment');
		expect(order({ state: 'completed' }).state).toBe('completed');
		expect(parseOrder({ id: 'o', state: 'lost', amount_minor: '1', expires_at: '2026-10-16T03:00:00Z' })).toBeNull();
		expect(parseOrders({ orders: [{ id: 'bad' }, { ...order(), id: 'o2' }] }).map((o) => o.id)).toEqual(['o2']);
		expect(parseOrders(null)).toEqual([]);
	});

	it('shows a QR code or an HTTPS page, and nothing it cannot complete', () => {
		expect(parseCheckout({ attempt: { id: 'a1', method: 'wxpay' }, action: { kind: 'qr', payload: 'weixin://wxpay/bizpayurl?pr=1', expires_at: null } })).toEqual({
			attemptId: 'a1',
			method: 'wxpay',
			action: { kind: 'qr', payload: 'weixin://wxpay/bizpayurl?pr=1', expires_at: null }
		});
		expect(parseCheckout({ attempt: { id: 'a2', method: 'alipay' }, action: { kind: 'redirect', url: 'https://pay.example.com/x', expires_at: '2026-10-16T03:30:00Z' } })?.action.kind).toBe('redirect');
		expect(parseCheckout({ attempt: { id: 'a3' }, action: { kind: 'redirect', url: 'http://pay.example.com/x' } })).toBeNull();
		expect(parseCheckout({ attempt: { id: 'a4' }, action: { kind: 'form', action: 'https://x', fields: [] } })).toBeNull();
		expect(parseCheckout({ action: { kind: 'qr', payload: 'x' } })).toBeNull();
	});
});

describe('words and numbers', () => {
	it('writes yuan without a trailing .00 and 积分 as the website does', () => {
		expect(yuan('4900')).toBe('¥49');
		expect(yuan('2345')).toBe('¥23.45');
		expect(yuan('2350')).toBe('¥23.50');
		expect(yuan('100000000')).toBe('¥1,000,000');
		expect(yuan('x')).toBe('—');
		expect(creditAmount('800')).toBe('8');
		expect(creditAmount('2350')).toBe('23.50');
	});

	it('names each window by its exact length', () => {
		setLocale('zh');
		expect(windowText('5h', 18000)).toBe('每 5 小时');
		expect(windowText('12h', 43200)).toBe('每 12 小时');
		expect(windowText('custom', 604800)).toBe('每 7 天');
		expect(windowText('custom', 1_209_600)).toBe('每 14 天');
		expect(windowText('custom', 86400)).toBe('每天');
		expect(windowText('custom', 3600)).toBe('每小时');
		expect(windowText('custom', 129_600)).toBe('每 36 小时');
		expect(windowText('custom', 5400)).toBe('每 90 分钟');
		expect(windowText('day', 86400)).toBe('每天');
		expect(windowText('week', 604800)).toBe('每周（周一恢复）');
		expect(windowText('month', 2_592_000)).toBe('每月（每月 1 日恢复）');
		expect(windowRule({ window_kind: '5h', window_seconds: 18000, quota_fen_cny: '800' })).toBe('每 5 小时 8 积分');
		expect(windowRule({ window_kind: 'custom', window_seconds: 604800, quota_fen_cny: '2350' })).toBe('每 7 天 23.50 积分');
		expect(durationText(2_592_000)).toBe('30 天');
		expect(durationText(7200)).toBe('2 小时');
		setLocale('en');
		expect(windowRule({ window_kind: '5h', window_seconds: 18000, quota_fen_cny: '800' })).toBe('Every 5 hours: 8 credits');
		expect(windowText('custom', 86400)).toBe('Every day');
		expect(windowText('week', 604800)).toBe('Weekly (resets Monday)');
		setLocale('zh');
	});

	it('reads a typed amount in yuan', () => {
		expect(parseYuanInput('23')).toBe('2300');
		expect(parseYuanInput(' 23.5 ')).toBe('2350');
		expect(parseYuanInput('23.45')).toBe('2345');
		for (const bad of ['', '0', '23.456', '-5', '1e3', 'abc', '2,000']) expect(parseYuanInput(bad)).toBeNull();
	});

	it('counts down in minutes and seconds', () => {
		expect(secondsUntil(new Date(NOW + 90_500).toISOString(), NOW)).toBe(91);
		expect(secondsUntil(new Date(NOW - 1000).toISOString(), NOW)).toBe(0);
		expect(secondsUntil(null, NOW)).toBeNull();
		expect(clock(581)).toBe('9:41');
		expect(clock(5)).toBe('0:05');
	});
});

describe('the checkout', () => {
	const choice = { userId: 'u1', productId: 'sprout', optionId: 'store-channel-epay:wxpay', method: 'wxpay', customMinor: null };

	it('keeps the request ids of one choice while its order can be paid', () => {
		const storage = memory();
		const first = preparePending(storage, choice, NOW, newId);
		expect(preparePending(storage, choice, NOW + MIN, newId)).toEqual(first);
		// Another wallet is another order: the code shown is bound to its method.
		const other = preparePending(storage, { ...choice, optionId: 'store-channel-epay:alipay', method: 'alipay' }, NOW + MIN, newId);
		expect(other.orderRequestId).not.toBe(first.orderRequestId);
		// After an order's lifetime the ids are new.
		const later = preparePending(storage, { ...choice, optionId: 'store-channel-epay:alipay', method: 'alipay' }, NOW + MIN + ORDER_LIFETIME_MS, newId);
		expect(later.orderRequestId).not.toBe(other.orderRequestId);
		expect(loadPending(storage)?.orderRequestId).toBe(later.orderRequestId);
		storage.setItem(CHECKOUT_KEY, '{"broken":');
		expect(loadPending(storage)).toBeNull();
	});

	it('reuses, rotates or drops ids by what the failure says', () => {
		expect(afterFailure('payment_provider_rejected')).toBe('rotate');
		expect(afterFailure('payment_configuration_unavailable')).toBe('rotate');
		for (const code of ['order_not_payable', 'active_payment_attempt', 'idempotency_conflict', 'product_not_available', 'invalid_amount'])
			expect(afterFailure(code)).toBe('restart');
		for (const code of [null, 'payment_provider_ambiguous', 'internal_error', 'order_rate_limited', 'store_primary_unavailable'])
			expect(afterFailure(code)).toBe('keep');
		const storage = memory();
		const pending = { ...preparePending(storage, choice, NOW, newId), orderId: 'o1' };
		const rotated = pendingAfterFailure(pending, 'payment_provider_rejected', newId)!;
		expect(rotated.orderRequestId).toBe(pending.orderRequestId);
		expect(rotated.attemptRequestId).not.toBe(pending.attemptRequestId);
		// Before an order exists there is no attempt to rotate.
		expect(pendingAfterFailure({ ...pending, orderId: null }, 'payment_provider_rejected', newId)?.attemptRequestId).toBe(pending.attemptRequestId);
		expect(pendingAfterFailure(pending, 'payment_provider_ambiguous', newId)).toBe(pending);
		expect(pendingAfterFailure(pending, 'order_not_payable', newId)).toBeNull();
	});

	it('shows an unpaid order again only with its kept ids', () => {
		const storage = memory();
		const pending = { ...preparePending(storage, choice, NOW, newId), orderId: 'o1' };
		savePending(storage, pending);
		expect(resumable(storage, order(), NOW)).toEqual(pending);
		expect(resumable(storage, order({ id: 'o2' }), NOW)).toBeNull();
		expect(resumable(storage, order({ state: 'completed' }), NOW)).toBeNull();
		expect(resumable(storage, order(), NOW + 31 * MIN)).toBeNull();
		clearPending(storage, 'o2');
		expect(loadPending(storage)).not.toBeNull();
		clearPending(storage, 'o1');
		expect(loadPending(storage)).toBeNull();
	});

	it('follows the order to its end', () => {
		expect(phaseOf(order(), NOW, null)).toBe('waiting');
		expect(phaseOf(order(), NOW + 31 * MIN, null)).toBe('expired');
		expect(phaseOf(order({ state: 'expired' }), NOW, null)).toBe('expired');
		expect(phaseOf(order({ state: 'paid' }), NOW, NOW)).toBe('paid');
		expect(phaseOf(order({ state: 'paid' }), NOW + PAID_PATIENCE_MS, NOW)).toBe('slow');
		expect(phaseOf(order({ state: 'completed' }), NOW, null)).toBe('done');
		expect(phaseOf(order({ state: 'closed' }), NOW, null)).toBe('closed');
		expect(phaseOf(order({ state: 'refunded' }), NOW, null)).toBe('closed');
		expect(['waiting', 'paid'].every((p) => keepsPolling(p as never))).toBe(true);
		expect(['done', 'slow', 'expired', 'closed'].some((p) => keepsPolling(p as never))).toBe(false);
	});

	it('says what failed and what to do', () => {
		setLocale('zh');
		expect(failureText('payment_channel_unavailable', 409, 'payment Channel is not available')).toContain('支付方式现在不可用');
		expect(failureText('store_primary_unavailable', 503, '')).toBe('商店暂时不可用，请稍后再试。');
		expect(failureText(null, 404, 'Not Found')).toContain('还不支持在应用里购买');
		expect(failureText(null, null, 'all gateways unreachable')).toContain('连不上 LynShen 服务');
		expect(failureText('email_unverified', 403, 'Verify an email address at https://www.lynshen.org/dashboard')).toContain('Verify an email');
		expect(failureText('something_new', 400, 'odd')).toBe('odd');
	});
});
