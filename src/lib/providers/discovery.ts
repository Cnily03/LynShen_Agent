// 获取可用模型 / 自动配置 in the provider form: the models an endpoint lists
// (GET …/models, read by the app: provider_models.rs) become model entries,
// with the window, output cap, thinking tiers and input kinds a model
// catalog knows for the same name. The catalogs, in order: the LynShen
// gateway's model catalog (signed in), the engine's built-in provider tables
// (`lynshen providers`) and the vendored provider catalog (models.dev).

import type { ListedModel } from '$lib/protocol';
import type { CatalogModel } from '$lib/models/gatewayCatalog';
import { DEFAULT_CONTEXT, DEFAULT_EFFORTS, DEFAULT_MAX_OUTPUT, MODALITIES, type ProviderModel } from '$lib/settings/providerFields';

/** What a catalog knows about a model. */
export type KnownModel = Partial<
	Pick<ProviderModel, 'display_name' | 'context_window' | 'max_output_tokens' | 'reasoning' | 'reasoning_efforts' | 'input_modalities'>
>;

/** The part after a vendor prefix: "anthropic/claude-fable-5" → "claude-fable-5". */
const bare = (name: string) => name.slice(name.lastIndexOf('/') + 1).toLowerCase();

/** A gateway catalog row as model fields. A row the admin has not described
 *  gives only the numbers it has (its thinking and image flags are guesses
 *  from the id). */
export function knownFromCatalog(m: CatalogModel): KnownModel {
	const known: KnownModel = {};
	if (m.context) known.context_window = m.context;
	if (m.maxOutput) known.max_output_tokens = m.maxOutput;
	if (m.efforts.length) known.reasoning_efforts = [...m.efforts];
	if (m.cataloged) {
		if (m.name && m.name !== m.id) known.display_name = m.name;
		known.reasoning = m.reasoning;
		if (!m.reasoning) delete known.reasoning_efforts;
		known.input_modalities = m.vision ? ['text', 'image'] : ['text'];
	}
	return known;
}

/** A model of a provider table (engine or vendored catalog) as model fields. */
export function knownFromTable(m: ProviderModel): KnownModel {
	const known: KnownModel = {};
	if (m.context_window) known.context_window = m.context_window;
	if (m.max_output_tokens) known.max_output_tokens = m.max_output_tokens;
	const efforts = m.reasoning_efforts ?? [];
	if (m.reasoning === false || (efforts.length && efforts.every((e) => e === 'none'))) known.reasoning = false;
	else if (efforts.length) known.reasoning_efforts = [...efforts];
	if (m.input_modalities?.length) known.input_modalities = [...m.input_modalities];
	return known;
}

const isKnown = (known?: KnownModel | null): known is KnownModel => !!known && Object.keys(known).length > 0;

/** Looks a name up in the gateway catalog, then in the tables: by the name,
 *  then by the name without its vendor prefix (either side). */
export function modelLookup(sources: { gateway?: (id: string) => CatalogModel | undefined; tables: ProviderModel[][] }) {
	const byName = new Map<string, ProviderModel>();
	const byBare = new Map<string, ProviderModel>();
	for (const table of sources.tables) {
		for (const m of table) {
			if (!byName.has(m.name.toLowerCase())) byName.set(m.name.toLowerCase(), m);
			if (!byBare.has(bare(m.name))) byBare.set(bare(m.name), m);
		}
	}
	return (name: string): KnownModel | undefined => {
		const row = sources.gateway?.(name) ?? (name.includes('/') ? sources.gateway?.(bare(name)) : undefined);
		const fromGateway = row ? knownFromCatalog(row) : undefined;
		if (isKnown(fromGateway)) return fromGateway;
		const m = byName.get(name.toLowerCase()) ?? byBare.get(bare(name));
		const fromTable = m ? knownFromTable(m) : undefined;
		return isKnown(fromTable) ? fromTable : undefined;
	};
}

/** The entry for a listed model: what the endpoint says, then what the
 *  catalog knows, then the form's defaults for a new model. */
export function modelFromListed(listed: ListedModel, known?: KnownModel): ProviderModel {
	const window = listed.context_window || known?.context_window || DEFAULT_CONTEXT;
	const output = Math.min(listed.max_output_tokens || known?.max_output_tokens || DEFAULT_MAX_OUTPUT, window);
	const thinks = known?.reasoning !== false;
	const kinds = (listed.input_modalities?.length ? listed.input_modalities : known?.input_modalities)?.filter((k) =>
		(MODALITIES as readonly string[]).includes(k)
	);
	const model: ProviderModel = {
		name: listed.id,
		context_window: window,
		max_output_tokens: output,
		reasoning: thinks,
		reasoning_efforts: thinks ? (known?.reasoning_efforts?.length ? [...known.reasoning_efforts] : [...DEFAULT_EFFORTS]) : ['none'],
		input_modalities: kinds?.length ? kinds : [...MODALITIES]
	};
	const label = listed.display_name || known?.display_name;
	if (label && label !== listed.id) model.display_name = label;
	return model;
}

/** 自动配置: the catalog's values over a model already in the list (its name
 *  and display name stay); null when nothing changes. */
export function configureModel(model: ProviderModel, known: KnownModel): ProviderModel | null {
	const next: ProviderModel = { ...model };
	if (known.context_window) next.context_window = known.context_window;
	if (known.max_output_tokens) next.max_output_tokens = Math.min(known.max_output_tokens, next.context_window || known.max_output_tokens);
	if (known.reasoning === false) {
		next.reasoning = false;
		next.reasoning_efforts = ['none'];
	} else if (known.reasoning_efforts?.length) {
		next.reasoning = true;
		next.reasoning_efforts = [...known.reasoning_efforts];
	}
	if (known.input_modalities?.length) next.input_modalities = MODALITIES.filter((k) => known.input_modalities!.includes(k));
	return JSON.stringify(next) === JSON.stringify(model) ? null : next;
}
