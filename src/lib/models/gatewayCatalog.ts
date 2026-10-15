// The gateway's model catalog (GET /api/desktop/models/catalog, contract
// notes/model-catalog-contract.md, MC-API): one row per model the device key
// can route, with its name, vendor, family, version order, lifecycle,
// capabilities, health, price and plan coverage. This module reads the body;
// gatewayCatalog.svelte.ts fetches and keeps it.

import { derivedInfo, type Health, type ModelInfo, type Money, type Price } from './catalog';
import { VENDORS } from './derive';

/** A catalog row as the pickers and the engine's model list use it. */
export interface CatalogModel extends ModelInfo {
	source: 'catalog';
	/** The name to send with this key (an alias when only it routes). */
	requestModel: string;
	/** Effort levels the model takes; [] when it has none or they are unknown. */
	efforts: string[];
	contextTotal?: number;
	maxOutput?: number;
	/** The admin has not described it: name, vendor and family come from the id. */
	cataloged: boolean;
}

export interface CatalogPlan {
	active: boolean;
	name: string;
	trial: boolean;
	funding: 'plan' | 'balance';
}

export interface GatewayCatalog {
	generatedAt: string;
	cnyPerUsd?: number;
	plan: CatalogPlan | null;
	/** In the gateway's order. */
	models: CatalogModel[];
}

const obj = (v: unknown): Record<string, unknown> | null =>
	v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
/** A positive number from a number or a decimal string; undefined otherwise. */
function num(v: unknown): number | undefined {
	const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
	return Number.isFinite(n) && n >= 0 ? n : undefined;
}
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x) : []);

function money(v: unknown): Money | undefined {
	const o = obj(v);
	if (!o) return undefined;
	const cny = num(o.cny);
	const usd = num(o.usd);
	return cny === undefined && usd === undefined ? undefined : { ...(cny !== undefined ? { cny } : {}), ...(usd !== undefined ? { usd } : {}) };
}

function price(v: unknown): Price | undefined {
	const o = obj(v);
	if (!o) return undefined;
	const input = money(o.input_per_1m);
	const output = money(o.output_per_1m);
	if (!input || !output) return undefined;
	return { input, output, ...(o.varies_by_route === true ? { variesByRoute: true } : {}) };
}

const HEALTH: Record<string, Health> = { ok: 'ok', degraded: 'degraded', unavailable: 'down' };

/** One row; null when it has no id. */
function modelOf(raw: unknown, recommendedAt: number | undefined): CatalogModel | null {
	const o = obj(raw);
	const id = str(o?.id).trim();
	if (!o || !id) return null;
	const caps = obj(o.capabilities) ?? {};
	const vendor = obj(o.vendor);
	const cataloged = o.cataloged !== false;
	const efforts = strings(caps.effort_levels);
	const context = num(caps.context_window);
	// What the id says fills in what the catalog leaves out (an entry the
	// admin has not described has no vendor, family or name of its own).
	const derived = derivedInfo({ id, context_window: context, reasoning_efforts: efforts });
	const vendorKey = (cataloged && str(vendor?.id).toLowerCase()) || derived.vendor;
	const family = cataloged && str(o.family) ? `${vendorKey}:${str(o.family).toLowerCase()}` : derived.family;
	const order = num(o.version_order);
	const requestModel = str(o.request_model) || id;
	const health = obj(o.health);
	const aliases = [...new Set([...strings(o.aliases), ...(requestModel !== id ? [requestModel] : [])])];
	return {
		...derived,
		id,
		name: (cataloged && str(o.display_name).trim()) || derived.name,
		vendor: vendorKey,
		...(cataloged && str(vendor?.name) ? { vendorName: str(vendor?.name) } : {}),
		family,
		version: cataloged && order ? [order] : derived.version,
		date: cataloged && order ? '' : derived.date,
		legacy: o.lifecycle === 'legacy',
		aliases,
		keywords: [str(vendor?.name), str(o.family)].filter(Boolean),
		domestic: VENDORS[vendorKey]?.domestic ?? derived.domestic,
		vision: typeof caps.image_input === 'boolean' ? caps.image_input : derived.vision,
		reasoning: typeof caps.reasoning === 'boolean' ? caps.reasoning : derived.reasoning,
		...(context ? { context } : {}),
		...(price(o.price) ? { price: price(o.price) } : {}),
		...(typeof o.covered_by_plan === 'boolean' ? { inPlan: o.covered_by_plan } : {}),
		...(HEALTH[str(health?.state)] ? { health: HEALTH[str(health?.state)] } : {}),
		...(recommendedAt !== undefined ? { recommended: recommendedAt } : {}),
		...(str(o.auto_target) ? { autoTarget: str(o.auto_target) } : {}),
		source: 'catalog',
		requestModel,
		efforts,
		...(num(caps.context_total) ? { contextTotal: num(caps.context_total) } : {}),
		...(num(caps.max_output_tokens) ? { maxOutput: num(caps.max_output_tokens) } : {}),
		cataloged
	};
}

/** Reads a catalog body; null when it is not one (an unknown schema, no models list). */
export function parseCatalog(body: unknown): GatewayCatalog | null {
	const root = obj(body);
	if (!root || !Array.isArray(root.models) || num(root.schema_version) !== 1) return null;
	const plan = obj(root.plan);
	let recommended = 0;
	const models = root.models.flatMap((raw) => {
		const m = modelOf(raw, obj(raw)?.recommended === true ? recommended : undefined);
		if (m?.recommended !== undefined) recommended++;
		return m ? [m] : [];
	});
	return {
		generatedAt: str(root.generated_at),
		...(num(root.cny_per_usd) ? { cnyPerUsd: num(root.cny_per_usd) } : {}),
		plan: plan
			? {
					active: plan.active !== false,
					name: str(plan.name),
					trial: plan.trial === true,
					funding: plan.plan_funding === 'balance' ? 'balance' : 'plan'
				}
			: null,
		models
	};
}

/** Finds a model by its id, the name sent for it, or an alias; the gateway
 *  resolves names case-insensitively, and so does this. */
export function catalogIndex(catalog: GatewayCatalog | null): Map<string, CatalogModel> {
	const index = new Map<string, CatalogModel>();
	for (const m of catalog?.models ?? []) {
		for (const name of [m.id, m.requestModel, ...m.aliases]) {
			const key = name.toLowerCase();
			if (!index.has(key)) index.set(key, m);
		}
	}
	return index;
}

/**
 * The model a new user starts on: the plan's first recommendation that can
 * chat and works, preferring what the plan pays for (a trial: the domestic
 * models of its group). `among` limits it to the names the engine lists.
 * Undefined when the catalog recommends nothing usable.
 */
export function defaultModel(catalog: GatewayCatalog | null, among?: string[]): CatalogModel | undefined {
	if (!catalog) return undefined;
	const allowed = among ? new Set(among.map((n) => n.toLowerCase())) : null;
	const listed = (m: CatalogModel) => !allowed || [m.id, m.requestModel, ...m.aliases].some((n) => allowed.has(n.toLowerCase()));
	const usable = catalog.models.filter((m) => m.recommended !== undefined && !m.drawsImages && m.health !== 'down' && listed(m));
	const trial = !!catalog.plan?.trial;
	const rank = (m: CatalogModel) => [m.inPlan ? 0 : 1, trial && !m.domestic ? 1 : 0, m.recommended ?? 0];
	return usable.sort((a, b) => {
		const [x, y] = [rank(a), rank(b)];
		return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
	})[0];
}
