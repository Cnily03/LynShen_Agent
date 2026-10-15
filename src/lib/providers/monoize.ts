import { fetchMonoizeModels, readConfig, writeConfig, type MonoizeModel, type MonoizeRoute } from '$lib/protocol';
import { newlyOffered } from '$lib/lynshenModels';
import { DEFAULT_MODELS } from '$lib/defaultModels';
import { gatewayCatalog } from '$lib/models/catalogStore.svelte';
import { catalogIndex, defaultModel, type CatalogModel as GatewayModel, type GatewayCatalog } from '$lib/models/gatewayCatalog';
import { PROVIDER_CATALOG, gatewayCatalogModel } from './catalog';

/** A gateway model as the picker and config.json hold it. */
export interface MonoizeModelEntry {
	/** The request id; never a display label. */
	name: string;
	/** What pickers show: the model id alone (the route is `groups`). */
	display_name: string;
	/** Gateway Groups that route this model for the signed-in key. */
	groups: string[];
	/** The Providers the key may pick for this model, in routing order. */
	routes: MonoizeRoute[];
	reasoning_efforts?: string[];
	context_window?: number;
	/** Input and output together, when the gateway records it. */
	context_total?: number;
	max_output_tokens?: number;
	[key: string]: unknown;
}

type CatalogModel = { name: string; reasoning_efforts?: string[]; context_window?: number; max_output_tokens?: number };

const catalogModel = (id: string): CatalogModel | undefined => gatewayCatalogModel(id);

/** A model that draws images and cannot chat (gpt-image-2, grok-imagine-image…). */
export const isImageModel = (name: string) => /image/i.test(name);

/** The window older versions stored for any model the gateway had none for. */
const OLD_GUESS = 128_000;

/**
 * Turns the gateway's model list into picker entries. Metadata comes from what
 * the user already configured for that id, else the bundled catalog, so every
 * model keeps its reasoning efforts (a model with none listed would offer only
 * "none" in the picker). The window is the gateway's registered one, else the
 * one already stored, else the catalog's, else 0 (unknown: the engine then
 * compacts when the upstream says a request is too long). A stored 128K is the
 * guess older versions wrote for every unknown model, which capped 1M models
 * at 128K: it counts as unknown.
 */
export function monoizeEntries(
	list: MonoizeModel[],
	known: { name: string }[] = [],
	/** The gateway's model catalog, where it has one: names, efforts, windows. */
	described: (id: string) => GatewayModel | undefined = () => undefined
): MonoizeModelEntry[] {
	const stored = new Map(known.map((m) => [m.name, m]));
	return list
		.filter((m) => !m.routing_status || m.routing_status === 'ready')
		.map((m) => {
			const previous = stored.get(m.id) as Partial<MonoizeModelEntry> | undefined;
			const catalog = catalogModel(m.id);
			const live = described(m.id);
			const efforts = previous?.reasoning_efforts?.length
				? previous.reasoning_efforts
				: live?.efforts.length
					? live.efforts
					: catalog?.reasoning_efforts;
			const kept = previous?.context_window === OLD_GUESS ? 0 : previous?.context_window;
			const window = m.context_window || kept || live?.context || catalog?.context_window || 0;
			const output = m.max_output_tokens || previous?.max_output_tokens || live?.maxOutput || catalog?.max_output_tokens;
			const total = m.context_total || previous?.context_total || live?.contextTotal || 0;
			return {
				...catalog,
				...previous,
				name: m.id,
				// The catalog's name for people; the id when the admin has not described it.
				display_name: live?.cataloged ? live.name : m.id === 'auto' ? 'Auto' : m.id,
				groups: m.groups ?? [],
				routes: m.providers ?? [],
				context_window: window,
				...(total ? { context_total: total } : {}),
				...(output ? { max_output_tokens: output } : {}),
				...(efforts?.length ? { reasoning_efforts: efforts } : {})
			};
		});
}

/** Update labels from the current key's routes, retaining model configuration. */
export async function refreshMonoizeCatalog() {
	const template = PROVIDER_CATALOG.providers.find((p) => p.id === 'monoize');
	if (!template) return;
	// The plain list routes; the catalog (a newer gateway) names the models
	// and recommends the plan's default.
	const [list, described] = await Promise.all([fetchMonoizeModels(), gatewayCatalog.refresh().catch(() => null)]);
	const index = catalogIndex(described);
	const custom = JSON.parse(localStorage.getItem('lynshen-custom-providers') || '[]');
	const existing = custom.find((p: { id: string }) => p.id === 'monoize');
	const models = monoizeEntries(list, existing?.models ?? [], (id) => index.get(id.toLowerCase()));
	const entry = { ...existing, id: 'monoize', name: template.name, base_url: template.base_url,
		format: template.protocol, builtin: false, source: 'catalog', models };
	localStorage.setItem('lynshen-custom-providers', JSON.stringify([...custom.filter((p: { id: string }) => p.id !== 'monoize'), entry]));
	// An engine on the gateway reads its windows (and compacts by them) from
	// config.json: keep them current there too, not only when Settings is open.
	const cfg = await readConfig().catch(() => null);
	if (cfg) {
		const patch = pickedMonoizeModels(models, cfg, described);
		if (Object.keys(patch).length) await writeConfig(patch);
	}
}

/** The limits a gateway model's saved entry follows from the gateway. */
function limitsOf(m: Record<string, unknown>) {
	return { context_window: m.context_window, max_context_window: m.max_context_window, max_output_tokens: m.max_output_tokens };
}

/** A gateway model as `lynshen_models` keeps it (what the engines read). */
function monoizeSaved(m: MonoizeModelEntry): Record<string, unknown> {
	return {
		name: m.name,
		...(m.display_name && m.display_name !== m.name ? { display_name: m.display_name } : {}),
		context_window: m.context_window ?? 0,
		// No maximum: one equal to the window kept an override from raising it.
		max_context_window: 0,
		max_output_tokens: m.max_output_tokens ?? 0,
		reasoning_efforts: m.reasoning_efforts?.length ? m.reasoning_efforts : ['none']
	};
}

/** What config.json keeps of the gateway list: the models chosen to show
 *  (`lynshen_models`) that the key can still reach — one whose group was
 *  taken away is dropped — and, on the gateway, the engine's model list:
 *  those picks in their order, or every model when nothing was picked. */
export function pickedMonoizeModels(
	models: MonoizeModelEntry[],
	cfg: Record<string, unknown>,
	/** The gateway's catalog: a new user starts on the plan's recommendation. */
	described: GatewayCatalog | null = null
): Record<string, unknown> {
	const live = new Map(models.map((m) => [m.name, m]));
	const saved = Array.isArray(cfg.lynshen_models) ? (cfg.lynshen_models as { name?: unknown }[]) : [];
	// Kept picks take the gateway's current window and output limit: stored
	// once, they otherwise kept whatever the gateway said back then.
	const kept = saved
		.filter((m) => live.has(String(m.name)))
		.map((m) => ({ ...m, ...limitsOf(monoizeSaved(live.get(String(m.name))!)) }));
	// Put on sale since the last look: shown at once (see newlyOffered).
	const offer = newlyOffered(models.map((m) => m.name), cfg);
	const fresh = kept.length
		? offer.fresh.filter((name) => !kept.some((m) => m.name === name)).map((name) => monoizeSaved(live.get(name)!))
		: [];
	const picked = [...kept, ...fresh];
	const patch: Record<string, unknown> = {};
	if (JSON.stringify(picked) !== JSON.stringify(saved)) patch.lynshen_models = picked;
	if (JSON.stringify(offer.seen) !== JSON.stringify(cfg.lynshen_models_seen)) patch.lynshen_models_seen = offer.seen;
	// A Provider pinned for a model that no longer serves it would be refused
	// (provider_unavailable): the gateway picks again once the pin is gone.
	const pins = (cfg.monoize_providers ?? {}) as Record<string, string>;
	const keptPins = Object.fromEntries(
		Object.entries(pins).filter(([model, route]) => live.get(model)?.routes.some((r) => r.id === route))
	);
	if (Object.keys(keptPins).length !== Object.keys(pins).length) patch.monoize_providers = keptPins;
	if (cfg.provider === 'monoize') {
		const shown = picked.length ? picked.map((m) => live.get(String(m.name))!) : models;
		patch.models = shown;
		// An image model cannot chat: one left as the chat model draws images
		// instead, and the chat takes a model that can: the plan's
		// recommendation (the catalog's), else the first one.
		const chats = shown.filter((m) => !isImageModel(m.name));
		const current = String(cfg.model ?? '');
		if (isImageModel(current) && !cfg.image_model) patch.image_model = current;
		if (chats.length && (isImageModel(current) || !shown.some((m) => m.name === current))) {
			const pick = defaultModel(described, chats.map((m) => m.name));
			const names = pick ? [pick.id, pick.requestModel, ...pick.aliases].map((n) => n.toLowerCase()) : [];
			// An older gateway recommends nothing: the curated menu's order stands in.
			const curated = DEFAULT_MODELS.map((id) => chats.find((m) => m.name.toLowerCase() === id)).find(Boolean);
			patch.model = (chats.find((m) => names.includes(m.name.toLowerCase())) ?? curated ?? chats[0]).name;
		}
	}
	return patch;
}
