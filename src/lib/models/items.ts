// Picker rows as the model components list them (PickItem): the composer's
// rows (composer/modelRows.ts) and the settings pickers' options, each
// described by the gateway catalog where it has the model, else by its id.

import type { ModelRow } from '$lib/composer/modelRows';
import { dedupe, isGateway, modelInfo, type PickItem } from './catalog';
import type { CatalogModel } from './gatewayCatalog';

export type CatalogLookup = (id: string) => CatalogModel | undefined;

/** Claude Code / Codex name their models briefly ("Opus 4.8"): the full name
 *  from the id is used when it ends with that name ("Claude Opus 4.8"). */
function fullName(label: string, derived: string): string {
	return label && !derived.toLowerCase().endsWith(label.toLowerCase()) ? label : derived;
}

/** The key favorites and recents keep: the provider and the model's id
 *  (the catalog's id when it knows the model by an alias). */
export const pickKey = (provider: string | undefined, id: string) => `${provider ?? ''}::${id}`;

/** The composer's model rows. `lookup` is the gateway catalog. */
export function itemsFromRows(rows: ModelRow[], lookup: CatalogLookup): PickItem[] {
	const providers = new Set(rows.map((r) => r.provider));
	return dedupe(
		rows.map((row): PickItem => {
			const id = row.model ?? row.id;
			const tool = row.provider === 'claude' || row.provider === 'codex';
			// A Claude Code / Codex model on the gateway is the gateway's model too.
			const gateway = isGateway(row.provider) || (tool && !!row.onGateway);
			const found = gateway ? lookup(id) : undefined;
			const info = modelInfo(
				{ id, display_name: tool ? '' : row.label, context_window: row.context, reasoning_efforts: row.efforts, input_modalities: row.modalities },
				found,
				{ gateway }
			);
			return {
				...info,
				...(tool && !found ? { name: fullName(row.label, info.name) } : {}),
				key: pickKey(row.provider, found?.id ?? id),
				value: row.command,
				provider: row.provider,
				...(providers.size > 1 && row.group ? { providerName: row.group } : {}),
				active: row.active,
				// Where it runs (Claude Code, Codex), or the route a gateway model is pinned to.
				...(tool && row.where ? { note: row.where } : row.choices?.length ? { note: row.detail } : {}),
				...(row.choices?.length || row.groupsPage ? { routes: row.choices?.length ?? 0 } : {})
			};
		})
	);
}

/** One model of a provider, as the settings pickers know it. */
export interface ModelOption {
	provider: string;
	/** Shown when the list spans several providers. */
	providerName?: string;
	name: string;
	display_name?: string | null;
	context_window?: number;
	reasoning_efforts?: string[];
	input_modalities?: string[];
	/** What the picker hands back (default: the name). */
	value?: string;
}

/** The settings pickers' options; `current` is the value in use. */
export function itemsFromOptions(options: ModelOption[], current: string, lookup: CatalogLookup): PickItem[] {
	const providers = new Set(options.map((o) => o.provider));
	return dedupe(
		options.map((o): PickItem => {
			const gateway = isGateway(o.provider);
			const found = gateway ? lookup(o.name) : undefined;
			const info = modelInfo(
				{ id: o.name, display_name: o.display_name, context_window: o.context_window, reasoning_efforts: o.reasoning_efforts, input_modalities: o.input_modalities },
				found,
				{ gateway }
			);
			const value = o.value ?? o.name;
			return {
				...info,
				key: pickKey(o.provider, found?.id ?? o.name),
				value,
				provider: o.provider,
				...(providers.size > 1 && o.providerName ? { providerName: o.providerName } : {}),
				active: value === current
			};
		})
	);
}
