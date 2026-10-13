// What a sign-in on the welcome page sets up, so the app is ready at once:
// the first run is over, the trial is claimed right away (not only at the
// next start), and the LynShen engine runs on the account when the provider
// in config.json cannot run (a new computer has none).
import { readAuthProviders, readConfig, writeConfig } from '$lib/protocol';
import { PROVIDER_CATALOG } from '$lib/providers/catalog';
import { refreshMonoizeCatalog } from '$lib/providers/monoize';
import { trial } from '$lib/trial.svelte';
import { SETUP_DONE_KEY, accountProvider } from './flow';

/** Points the engine at the account's gateway when its provider cannot run;
 *  answers whether it did. */
export async function useAccountForEngine(): Promise<boolean> {
	const [cfg, auth] = await Promise.all([readConfig().catch(() => null), readAuthProviders()]);
	if (!accountProvider(cfg ?? {}, auth ?? [])) return false;
	const gateway = PROVIDER_CATALOG.providers.find((p) => p.id === 'monoize');
	if (!gateway) return false;
	await writeConfig({ provider: 'monoize', base_url: gateway.base_url, protocol: gateway.protocol });
	// The account's models, and a chat model among them.
	await refreshMonoizeCatalog();
	return true;
}

/** After a sign-in on the welcome page. */
export async function afterWelcomeSignIn(): Promise<void> {
	try {
		localStorage.setItem(SETUP_DONE_KEY, '1');
	} catch {
		/* no storage: the sign-in shows again next start, and is skipped there */
	}
	const claim = trial.signedIn();
	await useAccountForEngine().catch((e) => console.error('account provider', e));
	await claim;
}
