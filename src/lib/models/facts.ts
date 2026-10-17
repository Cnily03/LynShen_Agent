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
	/** Who pays this device's requests. On the plan, a model the plan does
	 *  not include is marked (the gateway refuses it, `model_not_in_plan`);
	 *  on the balance the plan is not mentioned. Unknown: as the catalog says. */
	bucket?: 'plan' | 'balance' | null;
}

/** The plan's part of the facts: 套餐内, or on the plan 套餐外 (the balance
 *  can run it); nothing on the balance. */
export function planFacts(item: PickItem, bucket: FactsOptions['bucket'], short = false): string[] {
	if (bucket === 'balance') return [];
	if (item.inPlan) return [t('models.inPlan')];
	if (bucket === 'plan' && item.inPlan === false) return [t(short ? 'models.outOfPlanShort' : 'models.outOfPlan')];
	return [];
}

/** On the plan, the gateway refuses this model: the row says so. */
export const outsidePlan = (item: PickItem, o: FactsOptions) => o.bucket === 'plan' && item.inPlan === false;

/** The second line's parts, most telling first. */
export function factsOf(item: PickItem, o: FactsOptions): string[] {
	const parts: string[] = [];
	if (item.health === 'down') parts.push(t('models.health.down'));
	else if (item.health === 'degraded') parts.push(t('models.health.degraded'));
	// Outside the plan the device pays with: before the rest.
	if (outsidePlan(item, o)) parts.push(...planFacts(item, o.bucket));
	if (item.autoTarget) parts.push(t('models.autoTarget', { name: o.nameOf?.(item.autoTarget) ?? item.autoTarget }));
	if (item.context) parts.push(t('models.context', { n: fmtContext(item.context) }));
	const price = priceText(item.price, o.currency, o.cnyPerUsd);
	if (price) parts.push(t('models.price', { price }));
	if (!outsidePlan(item, o)) parts.push(...planFacts(item, o.bucket));
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
 *  is not good, else 套餐内 / 套餐外 (on the plan), else the price, else the
 *  window. */
export function shortFactsOf(item: PickItem, o: FactsOptions): string[] {
	if (item.health === 'down') return [t('models.health.down')];
	if (item.health === 'degraded') return [t('models.health.degraded')];
	const plan = planFacts(item, o.bucket, true);
	if (plan.length) return plan;
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
