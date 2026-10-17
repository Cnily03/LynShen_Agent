// The LynShen models the user chose to show, as config.json keeps them
// (`lynshen_models`, read by the engines). The gateway's metadata for them
// (display names, windows, per-group windows) can change after the pick, so
// the saved entries are refreshed from /v1/models at startup.

import { fetchLynShenModels, readConfig, writeConfig, type LynShenModel } from './protocol';
import { DEFAULT_MODELS } from './defaultModels';
import { gatewayCatalogModel } from './providers/catalog';
import { isGatewayProvider } from './configModels';

/** Models the account is offered that it was not offered before: shown at
 *  once (put on sale since the last look). `lynshen_models_seen` remembers
 *  every id offered, so a model the user unchecked stays hidden. Without a
 *  record yet (an older config), only an Auto model counts as new: that is
 *  the one put on sale with this version. Returns the new ids and the
 *  record to save. */
export function newlyOffered(ids: string[], cfg: Record<string, unknown>): { fresh: string[]; seen: string[] } {
	const isAuto = (id: string) => /(^|[-_])auto$/i.test(id);
	const recorded = Array.isArray(cfg.lynshen_models_seen)
		? new Set((cfg.lynshen_models_seen as unknown[]).map(String))
		: new Set(ids.filter((id) => !isAuto(id)));
	return { fresh: ids.filter((id) => !recorded.has(id)), seen: ids };
}

/** Efforts that say something: not missing, and not only "none" (the explicit
 *  unknown older versions saved for every model). */
const knownEfforts = (value: unknown): string[] | undefined =>
	Array.isArray(value) && value.some((e) => typeof e === 'string' && e !== 'none') ? (value as string[]) : undefined;

/** The reasoning efforts a gateway model offers. The gateway's list has none,
 *  so they come from the bundled catalog (Auto: its target's), else from what
 *  was saved before; ["none"] only when neither knows the model. */
export function gatewayEfforts(m: LynShenModel & { auto_target?: string }, previous?: unknown): string[] {
	return (
		knownEfforts(m.reasoning_efforts) ??
		knownEfforts(gatewayCatalogModel(m.auto_target || m.id)?.reasoning_efforts) ??
		knownEfforts(previous) ?? ['none']
	);
}

/** One saved entry. Explicit unknowns (0 / ["none"]), as the engine's own
 *  login writes them: a missing field would read back as a default. */
export function savedModel(m: LynShenModel, previous?: Record<string, unknown>): Record<string, unknown> {
	return {
		name: m.id,
		context_window: m.context_window ?? 0,
		max_context_window: m.max_context_window ?? 0,
		max_output_tokens: m.max_output_tokens ?? 0,
		reasoning_efforts: gatewayEfforts(m, previous?.reasoning_efforts),
		...(m.display_name ? { display_name: m.display_name } : m.id === 'auto' ? { display_name: 'Auto' } : {}),
		...(m.group_context_windows ? { group_context_windows: m.group_context_windows } : {})
	};
}

/** Refreshes saved metadata, or initializes recommendations after the first
 * account login. Existing user selections and their order are preserved; a
 * pick the account can no longer reach (its group was taken away) is
 * dropped. */
export async function refreshLynShenModels(): Promise<boolean> {
	const [live, cfg] = await Promise.all([fetchLynShenModels(), readConfig()]);
	const saved = Array.isArray(cfg.lynshen_models) ? (cfg.lynshen_models as Record<string, unknown>[]) : [];
	if (!live.length) return false;
	const byId = new Map(live.map((m) => [m.id, m]));
	const recommended = DEFAULT_MODELS.flatMap((id) => {
		const model = byId.get(id);
		return model ? [savedModel(model)] : [];
	});
	const kept = saved.flatMap((entry) => {
		const model = byId.get(String(entry.name));
		return model ? [savedModel(model, entry)] : [];
	});
	// A model the gateway newly lists (put on sale since the last look) is
	// shown at once: only the user's own unchecking hides a model. `seen`
	// holds every id the account was offered, so a hidden one stays hidden.
	const offer = newlyOffered(live.map((m) => m.id), cfg);
	const fresh = live.filter((m) => offer.fresh.includes(m.id)).map((m) => savedModel(m));
	const base = kept.length ? kept : recommended.length ? recommended : live.slice(0, 6).map((m) => savedModel(m));
	const next = [...base, ...fresh.filter((m) => !base.some((b) => b.name === m.name))];
	const patch: Record<string, unknown> = {};
	if (JSON.stringify(next) !== JSON.stringify(saved)) patch.lynshen_models = next;
	if (JSON.stringify(offer.seen) !== JSON.stringify(cfg.lynshen_models_seen)) patch.lynshen_models_seen = offer.seen;
	if (cfg.provider === 'lynshen') {
		if (JSON.stringify(cfg.models) !== JSON.stringify(next)) patch.models = next;
		if (!next.some((model) => model.name === cfg.model)) {
			patch.model = next[0].name;
			const efforts = next[0].reasoning_efforts as string[];
			if (!efforts.includes(String(cfg.reasoning_effort))) {
				patch.reasoning_effort = efforts.includes('medium') ? 'medium' : efforts[0];
			}
		}
	}
	if (!Object.keys(patch).length) return false;
	await writeConfig(patch);
	return true;
}

/** What "models to show" (ModelSetup) saves: the picks, the windows typed
 *  for them and every id the account was offered. While the gateway is the
 *  engine's provider the picks are its model list too (the composer menu
 *  reads it), and a current model that is no longer picked gives way to the
 *  first pick. Any other provider keeps its own list and windows: the picks
 *  replaced them, so a provider the user limited to 400K ran on the
 *  gateway's 1M windows (ticket #34). */
export function modelSetupPatch(
	cfg: Record<string, unknown>,
	chosen: Record<string, unknown>[],
	overrides: Record<string, number>,
	seen: string[]
): Record<string, unknown> {
	const patch: Record<string, unknown> = {
		lynshen_models: chosen,
		context_window_overrides: overrides,
		lynshen_models_seen: seen
	};
	if (isGatewayProvider(cfg.provider) && chosen.length) {
		patch.models = chosen;
		if (!chosen.some((m) => m.name === cfg.model)) patch.model = chosen[0].name;
	}
	return patch;
}
