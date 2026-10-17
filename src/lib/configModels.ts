// The models the native engine offers, read from config.json before any
// engine has reported its own list (a draft, the home page), and the rules
// for who may write that list.

/** The LynShen gateway: the old `lynshen` login or the `monoize` key the
 *  desktop signs in with. Its models are the ones picked to show
 *  (`lynshen_models`); every other provider keeps its own `models`. */
export const isGatewayProvider = (id: unknown): boolean => id === 'lynshen' || id === 'monoize';

/** config.json's `models`, or, before the engine first wrote them (a new
 *  install signed in to the gateway), the gateway models picked to show
 *  (`lynshen_models`): the engine runs on those whenever the provider is
 *  the gateway. Entries without a name are skipped. */
export function configModelList(cfg: Record<string, unknown>): Record<string, unknown>[] {
	const named = (key: string) =>
		(Array.isArray(cfg[key]) ? (cfg[key] as unknown[]) : []).filter(
			(m): m is Record<string, unknown> => !!m && typeof m === 'object' && typeof (m as Record<string, unknown>).name === 'string' && (m as Record<string, unknown>).name !== ''
		);
	const models = named('models');
	if (models.length) return models;
	return isGatewayProvider(cfg.provider) ? named('lynshen_models') : [];
}

type Named = { name?: unknown; context_window?: unknown; max_output_tokens?: unknown };

/** What the engine budgets a model list by: each model's name, window and
 *  output cap, in order (the engine writes defaults for the rest, so the
 *  other fields are not compared). */
const limits = (models: unknown): string =>
	JSON.stringify(
		(Array.isArray(models) ? (models as Named[]) : []).map((m) => [
			String(m?.name ?? ''),
			Number(m?.context_window) || 0,
			Number(m?.max_output_tokens) || 0
		])
	);

/**
 * The config.json patch that puts back the models of a provider the user
 * added (Settings → 提供商) while it is the engine's provider, when the list
 * there is not the one saved for it; null when it is, or when the provider is
 * the gateway, built in, or not one the user added. "Models to show" (the
 * gateway's model list) used to replace the active provider's list whatever
 * it was, so a provider limited to 400K ran on the gateway's 1M windows
 * (ticket #34).
 */
export function customModelsRepair(
	cfg: Record<string, unknown>,
	custom: { id: string; models?: Named[] }[]
): Record<string, unknown> | null {
	const id = cfg.provider;
	if (typeof id !== 'string' || !id || isGatewayProvider(id)) return null;
	const own = custom.find((p) => p.id === id)?.models ?? [];
	if (!own.length || limits(cfg.models) === limits(own)) return null;
	const patch: Record<string, unknown> = { models: own };
	if (!own.some((m) => m.name === cfg.model)) patch.model = own[0].name;
	return patch;
}
