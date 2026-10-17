// The user's own settings for a built-in provider (Anthropic, OpenAI,
// DeepSeek…): a base URL in place of the built-in one, per model the fields
// that differ from the engine's table (window, output cap, thinking, effort
// tiers, input kinds, display name), and models the user added. Kept by
// provider id in localStorage; the built-in values stay the engine's
// (`lynshen providers`), so an engine update still reaches every field the
// user did not change. Custom providers cannot take a built-in id, so the
// two never meet.
//
// The merged provider is what the desktop lists and what it writes to
// config.json (`base_url`, `models`) for the default provider and for an
// @switch; the engine reads `reasoning` and `input_modalities` from there
// (LynShen CLI 0.6.2 and later).

import { DEFAULT_EFFORTS, MODALITIES, orderTiers, type ProviderModel } from '$lib/settings/providerFields';
import { normalizeBaseUrl } from './endpoint';

export const OVERRIDES_KEY = 'lynshen-provider-overrides';

/** The fields of a built-in model the user changed. `display_name: ''`
 *  drops the built-in display name. */
export type ModelOverride = Partial<
	Pick<ProviderModel, 'display_name' | 'context_window' | 'max_output_tokens' | 'reasoning' | 'reasoning_efforts' | 'input_modalities'>
>;

export interface ProviderOverride {
	/** Used instead of the built-in base URL. */
	base_url?: string;
	/** By built-in model name. */
	models?: Record<string, ModelOverride>;
	/** Models the provider's table does not have. */
	added?: ProviderModel[];
}

export type ProviderOverrides = Record<string, ProviderOverride>;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const isObject = (value: unknown): value is Record<string, unknown> =>
	!!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): string[] | undefined =>
	Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : undefined;
const count = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined;

/** One stored model change, without anything that is not a known field. */
function readModelOverride(value: unknown): ModelOverride {
	if (!isObject(value)) return {};
	const out: ModelOverride = {};
	if (typeof value.display_name === 'string') out.display_name = value.display_name;
	if (count(value.context_window)) out.context_window = count(value.context_window);
	if (count(value.max_output_tokens)) out.max_output_tokens = count(value.max_output_tokens);
	if (typeof value.reasoning === 'boolean') out.reasoning = value.reasoning;
	const efforts = strings(value.reasoning_efforts);
	if (efforts?.length) out.reasoning_efforts = efforts;
	const kinds = strings(value.input_modalities)?.filter((kind) => (MODALITIES as readonly string[]).includes(kind));
	if (kinds?.length) out.input_modalities = kinds;
	return out;
}

/** The stored overrides; anything unreadable counts as none. */
export function readOverrides(storage: Pick<Storage, 'getItem'>): ProviderOverrides {
	let raw: unknown;
	try {
		raw = JSON.parse(storage.getItem(OVERRIDES_KEY) || '{}');
	} catch {
		return {};
	}
	if (!isObject(raw)) return {};
	const out: ProviderOverrides = {};
	for (const [id, value] of Object.entries(raw)) {
		if (!isObject(value)) continue;
		const entry: ProviderOverride = {};
		if (typeof value.base_url === 'string' && value.base_url.trim()) entry.base_url = value.base_url.trim();
		if (isObject(value.models)) {
			const models: Record<string, ModelOverride> = {};
			for (const [name, change] of Object.entries(value.models)) {
				const read = readModelOverride(change);
				if (Object.keys(read).length) models[name] = read;
			}
			if (Object.keys(models).length) entry.models = models;
		}
		if (Array.isArray(value.added)) {
			const added = value.added.filter((m): m is ProviderModel => isObject(m) && typeof m.name === 'string' && !!m.name.trim());
			if (added.length) entry.added = added;
		}
		if (isCustomized(entry)) out[id] = entry;
	}
	return out;
}

export function writeOverrides(storage: Store, overrides: ProviderOverrides): void {
	if (Object.keys(overrides).length) storage.setItem(OVERRIDES_KEY, JSON.stringify(overrides));
	else storage.removeItem(OVERRIDES_KEY);
}

/** `overrides` with the entry of `id` replaced (null: removed). */
export function setOverride(overrides: ProviderOverrides, id: string, entry: ProviderOverride | null): ProviderOverrides {
	const next = { ...overrides };
	if (entry && isCustomized(entry)) next[id] = entry;
	else delete next[id];
	return next;
}

export function isCustomized(entry?: ProviderOverride | null): boolean {
	return !!entry && (!!entry.base_url || !!Object.keys(entry.models ?? {}).length || !!entry.added?.length);
}

/** The tiers the engine uses for a model: its list, or the default one. */
const effortsOf = (m: ProviderModel) => (m.reasoning_efforts?.length ? m.reasoning_efforts : DEFAULT_EFFORTS);
/** The input kinds of a model: its list, or both. */
const kindsOf = (m: ProviderModel): string[] => (m.input_modalities?.length ? m.input_modalities : [...MODALITIES]);
/** The display name a model shows besides its name ('' for none). */
const labelOf = (m: ProviderModel) => (m.display_name && m.display_name !== m.name ? m.display_name : '');
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((v) => b.includes(v)) && b.every((v) => a.includes(v));

/** A built-in model with the user's changes. Changed tiers also state
 *  `reasoning: true`: the engine keeps a list the user set as it is (and
 *  would otherwise refresh older Claude tiers). A model that does not think
 *  also lists only "none", which older engines read as "no thinking". */
export function mergeModel(base: ProviderModel, change?: ModelOverride): ProviderModel {
	if (!change || !Object.keys(change).length) return base;
	const model: ProviderModel = { ...base, ...change };
	if (change.display_name === '') delete model.display_name;
	if (change.reasoning === false) model.reasoning_efforts = ['none'];
	else if (change.reasoning_efforts) model.reasoning = true;
	return model;
}

/** The provider as the user set it up: their base URL, their changes on the
 *  built-in models, then the models they added. */
export function applyOverride<P extends { base_url: string; models: ProviderModel[] }>(provider: P, entry?: ProviderOverride | null): P {
	if (!isCustomized(entry)) return provider;
	const names = new Set(provider.models.map((m) => m.name));
	const models = provider.models.map((m) => mergeModel(m, entry?.models?.[m.name]));
	for (const model of entry?.added ?? []) if (!names.has(model.name)) models.push({ ...model });
	return { ...provider, base_url: entry?.base_url || provider.base_url, models };
}

/** What differs between a built-in model and the user's version of it. */
export function diffModel(base: ProviderModel, edited: ProviderModel): ModelOverride {
	const change: ModelOverride = {};
	if (labelOf(edited) !== labelOf(base)) change.display_name = labelOf(edited);
	if (edited.context_window && edited.context_window !== base.context_window) change.context_window = edited.context_window;
	if (edited.max_output_tokens && edited.max_output_tokens !== base.max_output_tokens) change.max_output_tokens = edited.max_output_tokens;
	const thinks = edited.reasoning !== false;
	if (thinks !== (base.reasoning !== false)) change.reasoning = thinks;
	if (thinks && !sameSet(effortsOf(edited), effortsOf(base))) change.reasoning_efforts = orderTiers(effortsOf(edited));
	if (!sameSet(kindsOf(edited), kindsOf(base))) change.input_modalities = MODALITIES.filter((kind) => kindsOf(edited).includes(kind));
	return change;
}

/** The override that turns the built-in provider into the edited one, or
 *  null when they are the same. An empty base URL is the built-in one. */
export function overrideFromEdit(
	base: { base_url: string; models: ProviderModel[] },
	edited: { base_url: string; models: ProviderModel[] }
): ProviderOverride | null {
	const entry: ProviderOverride = {};
	const url = edited.base_url.trim();
	if (url && normalizeBaseUrl(url) !== normalizeBaseUrl(base.base_url)) entry.base_url = url;
	const builtIn = new Map(base.models.map((m) => [m.name, m]));
	for (const model of edited.models) {
		const original = builtIn.get(model.name);
		if (!original) {
			(entry.added ??= []).push(model);
			continue;
		}
		const change = diffModel(original, model);
		if (Object.keys(change).length) (entry.models ??= {})[model.name] = change;
	}
	return isCustomized(entry) ? entry : null;
}
