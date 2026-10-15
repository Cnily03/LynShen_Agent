// Model prices as the pickers show them: per 1M tokens, in the currency the
// user chose for balances (Settings → 通用 → 货币), input / output.

import { CNY_PER_USD } from '$lib/money';
import type { Money, Price } from './catalog';

export type Currency = 'CNY' | 'USD';

/** The amount in `currency`; converted from the other one when only it is known. */
export function amountIn(m: Money, currency: Currency, cnyPerUsd = CNY_PER_USD): number | undefined {
	if (currency === 'CNY') return m.cny ?? (m.usd !== undefined ? m.usd * cnyPerUsd : undefined);
	return m.usd ?? (m.cny !== undefined ? m.cny / cnyPerUsd : undefined);
}

/** ¥2, ¥0.35, ¥105, $1.25: three significant digits at most, no trailing zeros. */
export function fmtAmount(n: number, currency: Currency): string {
	const sign = currency === 'CNY' ? '¥' : '$';
	if (n === 0) return `${sign}0`;
	const digits = n >= 100 ? 0 : n >= 10 ? 1 : n >= 1 ? 2 : 3;
	const text = n.toFixed(digits).replace(/\.?0+$/, '');
	return `${sign}${text === '0' ? n.toPrecision(1) : text}`;
}

/** "¥2 / ¥8": input / output per 1M tokens; '' when either is unknown. */
export function priceText(p: Price | undefined, currency: Currency, cnyPerUsd?: number): string {
	if (!p) return '';
	const input = amountIn(p.input, currency, cnyPerUsd);
	const output = amountIn(p.output, currency, cnyPerUsd);
	if (input === undefined || output === undefined) return '';
	return `${fmtAmount(input, currency)} / ${fmtAmount(output, currency)}`;
}

/** The output price in CNY, for comparing models. */
export const outputCny = (p: Price, cnyPerUsd?: number) => amountIn(p.output, 'CNY', cnyPerUsd) ?? Infinity;
