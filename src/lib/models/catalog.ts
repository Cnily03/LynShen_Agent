// One model as every picker shows it (ModelInfo), and the row a picker lists
// (PickItem). The facts come from the gateway's catalog where it has the
// model (gatewayCatalog.svelte.ts), else from the id and whatever the
// provider's list stored (derivedInfo): an older gateway, Claude Code,
// Codex and custom providers have no price or health.

import { DEFAULT_MODELS } from '$lib/defaultModels';
import { drawsImages, looksCheap, parseId, readsImages, thinks, vendorOf, VENDORS } from './derive';

export type Health = 'ok' | 'degraded' | 'down';

/** An amount in both currencies, as the gateway converts it (either may be missing). */
export interface Money {
	cny?: number;
	usd?: number;
}

/** What 1M tokens cost on the first route the gateway tries for this key. */
export interface Price {
	input: Money;
	output: Money;
	/** Another route of the key bills differently (a fallback may cost more or less). */
	variesByRoute?: boolean;
}

export interface ModelInfo {
	/** The id requests use. */
	id: string;
	/** The full name people read: "Claude Opus 4.8". */
	name: string;
	/** Vendor key (derive.ts VENDORS) and, from the catalog, its shown name. */
	vendor: string;
	vendorName?: string;
	/** Versions of one model line share a family; the browser folds them. */
	family: string;
	version: number[];
	date: string;
	/** An older version the catalog keeps for those who pinned it: folded
	 *  under 更多版本. Derived models leave it unset (the newest one leads). */
	legacy?: boolean;
	/** Other ids and spellings that reach the same model. */
	aliases: string[];
	/** More words a search finds it by (the catalog's keywords). */
	keywords: string[];
	domestic: boolean;
	vision: boolean;
	reasoning: boolean;
	/** Draws images and cannot chat. */
	drawsImages: boolean;
	cheap: boolean;
	context?: number;
	price?: Price;
	/** The account's plan pays for it. */
	inPlan?: boolean;
	health?: Health;
	/** Place among the plan's recommendations (0 first); unset: not recommended. */
	recommended?: number;
	/** The Auto model: the model it points at now. */
	autoTarget?: string;
	source: 'catalog' | 'derived';
}

/** A row of a picker: a model and how this picker refers to it. */
export interface PickItem extends ModelInfo {
	/** Unique in the picker, stable across pickers: `provider::id`.
	 *  Favorites and recents keep it. */
	key: string;
	/** What the picker hands back when the row is picked. */
	value: string;
	/** The provider that runs it, and its name when the list spans several. */
	provider?: string;
	providerName?: string;
	active: boolean;
	/** A line the caller adds (the gateway route, "此电脑 · LynShen"). */
	note?: string;
	/** Several routes serve it: the row offers its route page. */
	routes?: number;
}

/** What a provider's model list stores about one model. */
export interface StoredModel {
	id: string;
	display_name?: string | null;
	context_window?: number;
	reasoning_efforts?: unknown;
	/** From the custom provider form: ["text", "image"]. */
	input_modalities?: unknown;
}

/** The gateway providers: the gateway's catalog speaks for their models. */
export const isGateway = (provider?: string) => provider === 'monoize' || provider === 'lynshen';

/** A name worth showing: not empty, and not just the id again. */
function givenName(m: StoredModel): string {
	const name = (m.display_name ?? '').trim();
	return name && name.toLowerCase() !== m.id.toLowerCase() ? name : '';
}

/** The facts the id and the stored entry give (no price, health or plan). */
export function derivedInfo(m: StoredModel, opts: { gateway?: boolean } = {}): ModelInfo {
	const parsed = parseId(m.id);
	const vendor = vendorOf(m.id);
	// The gateway's curated menu (defaultModels.ts) stands in for the plan's
	// recommendations until the gateway sends its own.
	const at = opts.gateway ? DEFAULT_MODELS.findIndex((d) => d.toLowerCase() === m.id.toLowerCase()) : -1;
	return {
		id: m.id,
		name: givenName(m) || parsed.name,
		vendor: vendor.key,
		family: parsed.family,
		version: parsed.version,
		date: parsed.date,
		aliases: [],
		keywords: [],
		domestic: !!vendor.domestic,
		vision: readsImages(m.id, m.input_modalities),
		reasoning: thinks(m.reasoning_efforts),
		drawsImages: drawsImages(m.id),
		cheap: looksCheap(m.id),
		...(m.context_window ? { context: m.context_window } : {}),
		...(at >= 0 ? { recommended: at } : {}),
		source: 'derived'
	};
}

/** The vendor's name in the reader's language. */
export function vendorLabel(info: Pick<ModelInfo, 'vendor' | 'vendorName'>, locale: 'zh' | 'en'): string {
	const known = VENDORS[info.vendor];
	if (known) return locale === 'zh' ? (known.zh ?? known.name) : known.name;
	return info.vendorName || info.vendor;
}

/**
 * Merges what the catalog knows with what the provider stored: the catalog
 * wins on names, prices and health; the stored window and efforts fill in
 * what it leaves out. Without a catalog entry the derived facts stand.
 */
export function modelInfo(m: StoredModel, catalog: ModelInfo | undefined, opts: { gateway?: boolean } = {}): ModelInfo {
	const derived = derivedInfo(m, opts);
	if (!catalog) return derived;
	return {
		...catalog,
		// The request keeps the id the list names (an alias resolves on the gateway).
		id: m.id,
		context: catalog.context ?? derived.context,
		reasoning: catalog.reasoning || derived.reasoning,
		aliases: [...new Set([...catalog.aliases, ...(catalog.id !== m.id ? [catalog.id] : [])])]
	};
}

/** Keeps one row per model of a provider: ids that differ only in case
 *  ("DeepSeek-V4.1-Flash", "deepseek-v4.1-flash") are one model, the other
 *  spelling an alias. The row that is in use is kept. */
export function dedupe(items: PickItem[]): PickItem[] {
	const out: PickItem[] = [];
	const at = new Map<string, number>();
	for (const item of items) {
		const id = `${item.provider ?? ''}::${item.id.toLowerCase()}`;
		const seen = at.get(id);
		if (seen === undefined) {
			at.set(id, out.length);
			out.push(item);
			continue;
		}
		const kept = out[seen];
		const [keep, drop] = item.active && !kept.active ? [item, kept] : [kept, item];
		out[seen] = { ...keep, aliases: [...new Set([...keep.aliases, drop.id])] };
	}
	return out;
}
