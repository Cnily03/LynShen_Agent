// A model's quiet second line in the pickers: state, window, price, plan
// and capabilities, joined with " · " (design.md §4: metadata as plain
// text, no pills; a status colour only on the dot).

import { fmtContext } from '$lib/composer/modelRows';
import { t } from '$lib/i18n';
import type { PickItem } from './catalog';
import { priceText, type Currency } from './price';

export interface FactsOptions {
	currency: Currency;
	cnyPerUsd?: number;
	/** The name of the model Auto points at. */
	nameOf?: (id: string) => string | undefined;
}

/** The second line's parts, most telling first. */
export function factsOf(item: PickItem, o: FactsOptions): string[] {
	const parts: string[] = [];
	if (item.health === 'down') parts.push(t('models.health.down'));
	else if (item.health === 'degraded') parts.push(t('models.health.degraded'));
	if (item.autoTarget) parts.push(t('models.autoTarget', { name: o.nameOf?.(item.autoTarget) ?? item.autoTarget }));
	if (item.context) parts.push(t('models.context', { n: fmtContext(item.context) }));
	const price = priceText(item.price, o.currency, o.cnyPerUsd);
	if (price) parts.push(t('models.price', { price }));
	if (item.inPlan) parts.push(t('models.inPlan'));
	if (item.drawsImages) parts.push(t('models.draws'));
	else {
		if (item.vision) parts.push(t('models.vision'));
		if (item.reasoning) parts.push(t('models.reasoning'));
	}
	if (item.providerName) parts.push(item.providerName);
	if (item.note) parts.push(item.note);
	return parts;
}

/** The quick switcher's one fact at the right of the name: the state when it
 *  is not good, else 套餐内, else the price, else the window. */
export function shortFactsOf(item: PickItem, o: FactsOptions): string[] {
	if (item.health === 'down') return [t('models.health.down')];
	if (item.health === 'degraded') return [t('models.health.degraded')];
	if (item.inPlan) return [t('models.inPlan')];
	const price = priceText(item.price, o.currency, o.cnyPerUsd);
	if (price) return [price];
	return item.context ? [fmtContext(item.context)] : [];
}

/** The row's tooltip: the id sent, and what the price means. */
export function tipOf(item: PickItem): string {
	const lines = [item.id];
	if (item.price) lines.push(t('models.priceTip'));
	if (item.price?.variesByRoute) lines.push(t('models.priceVaries'));
	return lines.join(' · ');
}
