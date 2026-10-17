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
		nameOf: (id) => gatewayCatalog.lookup(id)?.name,
		bucket: payingBucket()
	};
}

/** Who pays this device's requests: the device's choice as last read, else
 *  as the catalog says; null when neither knows (signed out, an older
 *  gateway). */
export function payingBucket(): 'plan' | 'balance' | null {
	const catalog = gatewayCatalog.data;
	return trial.funding ?? catalog?.bucket ?? catalog?.plan?.funding ?? null;
}

/** Reads the catalog again when it is stale (a minute) or the plan's funding
 *  changed: a picker opening calls it. */
export function refreshCatalog(): void {
	void gatewayCatalog.refreshIfStale(trial.funding);
}

/** The device pays with the trial plan: the catalog says so, else the trial
 *  claim (a plan without `trial: false` from an older gateway is the trial).
 *  A device on the balance is not on the trial, whatever the account has. */
export function onTrial(): boolean {
	if (payingBucket() === 'balance') return false;
	const plan = gatewayCatalog.data?.plan;
	if (plan) return plan.active && plan.trial;
	return trial.plan ? trial.plan.trial !== false : false;
}
