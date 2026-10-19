// 获取可用模型 / 自动配置 in the provider form: the models an endpoint lists
// (GET …/models, read by the app: provider_models.rs) become model entries,
// with the window, output cap, thinking tiers and input kinds that the list
// itself states or a model catalog knows for the same name. The catalogs, in
// order: the LynShen gateway's model catalog (signed in), the engine's
// built-in provider tables (`lynshen providers`) and the vendored provider
// catalog (models.dev).
//
// Whether a model thinks is known only when a source states it: a
// `reasoning` flag, or tiers other than "none". A table entry that only
// offers "none" and has no flag says nothing: LynShen CLI 0.7.0 lists every
// Chat Completions model that way, thinking or not.

import type { ListedModel } from '$lib/protocol';
import type { CatalogModel } from '$lib/models/gatewayCatalog';
import {
	DEFAULT_CONTEXT,
	DEFAULT_EFFORTS,
	defaultMaxOutput,
	EFFORT_TIERS,
	MODALITIES,
	offersThinking,
	orderTiers,
	type ProviderModel
} from '$lib/settings/providerFields';

/** What a catalog knows about a model. `reasoning` is set only when a
 *  source states it; `reasoning_efforts` only with `reasoning: true`. */
export type KnownModel = Partial<
	Pick<ProviderModel, 'display_name' | 'context_window' | 'max_output_tokens' | 'reasoning' | 'reasoning_efforts' | 'input_modalities'>
>;

/** The part after a vendor prefix: "anthropic/claude-fable-5" → "claude-fable-5". */
const bare = (name: string) => name.slice(name.lastIndexOf('/') + 1).toLowerCase();

/** `reasoning` and `reasoning_efforts` from a stated flag and tier list. */
function thinking(flag: boolean | undefined, tiers: string[] | undefined): KnownModel {
	if (flag === false) return { reasoning: false };
	if (offersThinking(tiers)) return { reasoning: true, reasoning_efforts: [...tiers] };
	return flag === true ? { reasoning: true } : {};
}

/** What the endpoint's list says about a model (provider_models.rs reads
 *  the window, output cap, input kinds, thinking and tiers it states). */
export function knownFromListed(m: ListedModel): KnownModel {
	const tiers = m.reasoning_efforts && orderTiers(m.reasoning_efforts.filter((tier) => (EFFORT_TIERS as readonly string[]).includes(tier)));
	const known: KnownModel = thinking(m.reasoning, tiers);
	if (m.context_window) known.context_window = m.context_window;
	if (m.max_output_tokens) known.max_output_tokens = m.max_output_tokens;
	if (m.input_modalities?.length) known.input_modalities = [...m.input_modalities];
	return known;
}

/** A gateway catalog row as model fields. A row the admin has not described
 *  gives only the numbers and tiers it has (its thinking and image flags are
 *  guesses from the id); so does a described row without a thinking flag. */
export function knownFromCatalog(m: CatalogModel): KnownModel {
	const known: KnownModel = thinking(m.cataloged && m.reasoningStated ? m.reasoning : undefined, m.efforts);
	if (m.context) known.context_window = m.context;
	if (m.maxOutput) known.max_output_tokens = m.maxOutput;
	if (m.cataloged) {
		if (m.name && m.name !== m.id) known.display_name = m.name;
		known.input_modalities = m.vision ? ['text', 'image'] : ['text'];
	}
	return known;
}

/** A model of a provider table (engine or vendored catalog) as model fields.
 *  Only "none" without a `reasoning` flag is unknown, not "does not think". */
export function knownFromTable(m: ProviderModel): KnownModel {
	const known: KnownModel = thinking(m.reasoning, m.reasoning_efforts);
	if (m.context_window) known.context_window = m.context_window;
	if (m.max_output_tokens) known.max_output_tokens = m.max_output_tokens;
	if (m.input_modalities?.length) known.input_modalities = [...m.input_modalities];
	return known;
}

const isKnown = (known?: KnownModel | null): known is KnownModel => !!known && Object.keys(known).length > 0;

/** The sources in order, field by field: each field from the first source
 *  that has it; thinking (the flag with its tiers) from the first that
 *  states it, tiers from a later one that agrees when the first has none. */
export function mergeKnown(sources: (KnownModel | null | undefined)[]): KnownModel | undefined {
	const out: KnownModel = {};
	for (const k of sources) {
		if (!k) continue;
		if (out.display_name === undefined && k.display_name) out.display_name = k.display_name;
		if (out.context_window === undefined && k.context_window) out.context_window = k.context_window;
		if (out.max_output_tokens === undefined && k.max_output_tokens) out.max_output_tokens = k.max_output_tokens;
		if (out.input_modalities === undefined && k.input_modalities?.length) out.input_modalities = [...k.input_modalities];
		if (out.reasoning === undefined && k.reasoning !== undefined) {
			out.reasoning = k.reasoning;
			if (k.reasoning && k.reasoning_efforts?.length) out.reasoning_efforts = [...k.reasoning_efforts];
		} else if (out.reasoning === true && !out.reasoning_efforts && k.reasoning === true && k.reasoning_efforts?.length) {
			out.reasoning_efforts = [...k.reasoning_efforts];
		}
	}
	return isKnown(out) ? out : undefined;
}

/** Looks a name up in the gateway catalog, then in the tables: by the name,
 *  then by the name without its vendor prefix (either side). Every match
 *  counts (mergeKnown): a name in several tables takes each field from the
 *  first one that has it. */
export function modelLookup(sources: { gateway?: (id: string) => CatalogModel | undefined; tables: ProviderModel[][] }) {
	const byName = new Map<string, ProviderModel[]>();
	const byBare = new Map<string, ProviderModel[]>();
	const add = (map: Map<string, ProviderModel[]>, key: string, m: ProviderModel) => {
		const list = map.get(key);
		if (list) list.push(m);
		else map.set(key, [m]);
	};
	for (const table of sources.tables) {
		for (const m of table) {
			add(byName, m.name.toLowerCase(), m);
			add(byBare, bare(m.name), m);
		}
	}
	return (name: string): KnownModel | undefined => {
		const row = sources.gateway?.(name) ?? (name.includes('/') ? sources.gateway?.(bare(name)) : undefined);
		const matches = [...new Set([...(byName.get(name.toLowerCase()) ?? []), ...(byBare.get(bare(name)) ?? [])])];
		return mergeKnown([row ? knownFromCatalog(row) : undefined, ...matches.map(knownFromTable)]);
	};
}

/** The entry for a listed model: what the endpoint says, then what the
 *  catalog knows, then the form's defaults for a new model. A model that no
 *  source states tiers for thinks with `fallback` (the default tiers;
 *  SAFE_EFFORTS on a built-in provider). */
export function modelFromListed(listed: ListedModel, known?: KnownModel, fallback: string[] = DEFAULT_EFFORTS): ProviderModel {
	const k = mergeKnown([knownFromListed(listed), known]) ?? {};
	const window = k.context_window || DEFAULT_CONTEXT;
	const thinks = k.reasoning !== false;
	const output = k.max_output_tokens ? Math.min(k.max_output_tokens, window) : defaultMaxOutput(thinks, window);
	const kinds = k.input_modalities?.filter((kind) => (MODALITIES as readonly string[]).includes(kind));
	const model: ProviderModel = {
		name: listed.id,
		context_window: window,
		max_output_tokens: output,
		reasoning: thinks,
		reasoning_efforts: thinks ? (offersThinking(k.reasoning_efforts) ? [...k.reasoning_efforts] : [...fallback]) : ['none'],
		input_modalities: kinds?.length ? kinds : [...MODALITIES]
	};
	const label = listed.display_name || k.display_name;
	if (label && label !== listed.id) model.display_name = label;
	return model;
}

/** 自动配置: the catalog's values over a model already in the list (its name
 *  and display name stay); null when nothing changes. Thinking is turned on
 *  (with the stated tiers, else the model's own, else `fallback`) when a
 *  source says the model thinks, and never turned off: a model set to think
 *  keeps thinking (see `staysThinking`). */
export function configureModel(model: ProviderModel, known: KnownModel, fallback: string[] = DEFAULT_EFFORTS): ProviderModel | null {
	const next: ProviderModel = { ...model };
	if (known.context_window) next.context_window = known.context_window;
	if (known.max_output_tokens) next.max_output_tokens = Math.min(known.max_output_tokens, next.context_window || known.max_output_tokens);
	if (known.reasoning === true) {
		next.reasoning = true;
		next.reasoning_efforts = offersThinking(known.reasoning_efforts)
			? [...known.reasoning_efforts]
			: offersThinking(model.reasoning_efforts) && model.reasoning !== false
				? model.reasoning_efforts
				: [...fallback];
	}
	if (known.input_modalities?.length) next.input_modalities = MODALITIES.filter((k) => known.input_modalities!.includes(k));
	return JSON.stringify(next) === JSON.stringify(model) ? null : next;
}

/** A model set to think that a source says does not: 自动配置 leaves it
 *  thinking and says so. */
export const staysThinking = (model: ProviderModel, known?: KnownModel) => known?.reasoning === false && model.reasoning !== false;
