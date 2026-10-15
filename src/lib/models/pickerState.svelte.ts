// What every model picker reads from the app: the currency prices show in,
// the gateway's exchange rate and model names, and whether the account is
// on the trial plan (its recommendations lead with domestic models).
// Called inside a component's $derived, these stay reactive.

import { prefs } from '$lib/prefs.svelte';
import { trial } from '$lib/trial.svelte';
import { gatewayCatalog } from './catalogStore.svelte';
import type { FactsOptions } from './facts';

export function factsOptions(): FactsOptions {
	return {
		currency: prefs.balanceCurrency,
		cnyPerUsd: gatewayCatalog.data?.cnyPerUsd,
		nameOf: (id) => gatewayCatalog.lookup(id)?.name
	};
}

/** Reads the catalog again when it is stale (a minute) or the plan's funding
 *  changed: a picker opening calls it. */
export function refreshCatalog(): void {
	void gatewayCatalog.refreshIfStale(trial.funding);
}

/** The account is on the trial plan: the catalog says so, else the trial claim
 *  (a plan without `trial: false` from an older gateway is the trial). */
export function onTrial(): boolean {
	const plan = gatewayCatalog.data?.plan;
	if (plan) return plan.active && plan.trial;
	return trial.plan ? trial.plan.trial !== false : false;
}
