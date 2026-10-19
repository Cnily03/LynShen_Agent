// Fields of a provider the user adds or edits (Settings → 提供商): the base
// URL and, per model, the context window, the output cap, whether it
// thinks, its effort tiers and its input kinds. Pure helpers, so the form's
// rules stay unit-testable. The engine reads the same fields from
// config.json `models` (LynShen CLI: `reasoning`, `input_modalities`; older
// CLIs ignore them and keep their earlier behavior).

/** A model entry as the desktop stores it (localStorage and config.json). */
export interface ProviderModel {
	name: string;
	display_name?: string | null;
	context_window?: number;
	max_context_window?: number;
	max_output_tokens?: number;
	/** false: the model does not reason. Unset: `reasoning_efforts` decides. */
	reasoning?: boolean;
	reasoning_efforts?: string[];
	/** "text", "image". Unset: both. */
	input_modalities?: string[];
}

/** Effort tiers the form offers. "default" comes first: it sends no
 *  thinking setting, so the provider's own applies (LynShen CLI 0.7.1 lists
 *  it first for Chat Completions models that think). The rest go lowest
 *  first, as the engine ranks them (agent-core `EFFORT_ORDER`). "none" lets
 *  the composer turn thinking off; "minimal" is the lowest tier that still
 *  thinks (GPT-5's Responses value); "ultra" is GPT's name for the top tier
 *  (the engine sends the model's highest other tier). */
export const EFFORT_TIERS = ['default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export const MODALITIES = ['text', 'image'] as const;
/** What a model without a stated list gets: the engine's default tiers. */
export const DEFAULT_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'];
/** What a model of a built-in provider thinks with when no source states
 *  its tiers: the provider's default, or off. The engine lists the tiers
 *  each built-in endpoint documents; DEFAULT_EFFORTS there could send a
 *  setting the endpoint rejects. */
export const SAFE_EFFORTS = ['default', 'none'];
/** Today's values for a new model left empty. */
export const DEFAULT_CONTEXT = 128_000;
export const DEFAULT_MAX_OUTPUT = 8_192;
/** The same for a model that thinks: room for the thinking and an answer.
 *  With 8k, thinking at a high effort could use up the whole cap, and the
 *  reply ended with no answer. */
export const DEFAULT_REASONING_MAX_OUTPUT = 32_000;

/** The output cap of a new model whose field is left empty, never over its
 *  window (0 or undefined: unknown). */
export function defaultMaxOutput(reasoning: boolean, window?: number): number {
	const cap = reasoning ? DEFAULT_REASONING_MAX_OUTPUT : DEFAULT_MAX_OUTPUT;
	return window ? Math.min(cap, window) : cap;
}

const UNITS: Record<string, number> = { k: 1_000, m: 1_000_000 };

/** "128k" → 128000, "1M" → 1000000, "1.5M" → 1500000, "8192" → 8192.
 *  "empty" for blank input; "invalid" for anything that is not a positive
 *  whole number of tokens. */
export function parseTokens(text: string): number | 'empty' | 'invalid' {
	const raw = text.trim().replace(/[,_\s]/g, '');
	if (!raw) return 'empty';
	const match = /^(\d+(?:\.\d+)?)([kKmM]?)$/.exec(raw);
	if (!match) return 'invalid';
	const value = Number(match[1]) * (match[2] ? UNITS[match[2].toLowerCase()] : 1);
	return Number.isSafeInteger(value) && value > 0 ? value : 'invalid';
}

/** The shortest text `parseTokens` reads back as `n`: 128000 → "128k",
 *  1000000 → "1M", 1500000 → "1.5M", 8192 → "8192". */
export function formatTokens(n?: number): string {
	if (!n || n <= 0) return '';
	if (n >= 1_000_000 && n % 100_000 === 0) return `${n / 1_000_000}M`;
	if (n % 1000 === 0) return `${n / 1000}k`;
	return String(n);
}

/** An http(s) URL with a host and nothing a request could not carry. */
export function validBaseUrl(text: string): boolean {
	const url = text.trim();
	if (!url || /\s/.test(url)) return false;
	try {
		const parsed = new URL(url);
		return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && !!parsed.hostname;
	} catch {
		return false;
	}
}

/** The tiers the engine offers for a model: none when it does not reason,
 *  its list, or the default tiers when it lists none (the engine's
 *  `read_model_configs`). */
export function modelEfforts(model?: Pick<ProviderModel, 'reasoning' | 'reasoning_efforts'> | null): string[] {
	if (!model || model.reasoning === false) return [];
	return model.reasoning_efforts?.length ? model.reasoning_efforts : DEFAULT_EFFORTS;
}

/** A tier list that offers thinking: a tier other than "none". */
export const offersThinking = (tiers?: string[] | null): tiers is string[] => !!tiers?.some((tier) => tier !== 'none');

/** Image attachments may go to the model (unset modalities: yes). */
export function acceptsImages(model?: Pick<ProviderModel, 'input_modalities'> | null): boolean {
	const kinds = model?.input_modalities;
	return !kinds?.length || kinds.includes('image');
}

/** Tiers in the form's order; unknown tiers a config already had stay at the end. */
export function orderTiers(tiers: string[]): string[] {
	const known = EFFORT_TIERS.filter((tier) => tiers.includes(tier)) as string[];
	const other = tiers.filter((tier) => !(EFFORT_TIERS as readonly string[]).includes(tier));
	return [...known, ...new Set(other)];
}

/** One model as the form edits it. */
export interface ModelDraft {
	name: string;
	display_name: string;
	context: string;
	maxOutput: string;
	reasoning: boolean;
	efforts: string[];
	modalities: string[];
}

export function newModelDraft(): ModelDraft {
	return {
		name: '',
		display_name: '',
		context: '',
		maxOutput: '',
		reasoning: true,
		efforts: [...DEFAULT_EFFORTS],
		modalities: [...MODALITIES]
	};
}

/** The form's view of a stored model; unset fields show what applies today.
 *  A model that does not think keeps `offTiers` in the draft (the default
 *  tiers; SAFE_EFFORTS for a built-in provider's model), so turning 支持思考
 *  on offers them. */
export function draftFromModel(model: ProviderModel, offTiers: string[] = DEFAULT_EFFORTS): ModelDraft {
	const reasoning = model.reasoning !== false;
	const kinds = (model.input_modalities ?? []).filter((kind) => (MODALITIES as readonly string[]).includes(kind));
	const tiers = model.reasoning_efforts ?? [];
	return {
		name: model.name,
		display_name: model.display_name ?? '',
		context: formatTokens(model.context_window),
		maxOutput: formatTokens(model.max_output_tokens),
		reasoning,
		efforts: orderTiers(reasoning ? (tiers.length ? tiers : DEFAULT_EFFORTS) : offersThinking(tiers) ? tiers : offTiers),
		modalities: kinds.length ? kinds : [...MODALITIES]
	};
}

export type ModelField = 'name' | 'context' | 'maxOutput' | 'efforts' | 'modalities';
/** Problems per field, as i18n keys under `settings.custom.error`. */
export type ModelErrors = Partial<Record<ModelField, string>>;

/** What an empty window or output field stands for: the model's built-in
 *  value (a built-in provider's model, which may have none), or, without
 *  this, DEFAULT_CONTEXT and DEFAULT_MAX_OUTPUT. */
export type TokenFallback = Pick<ProviderModel, 'context_window' | 'max_output_tokens'>;

/** `taken`: the other models' names in the provider. */
export function validateModel(draft: ModelDraft, taken: string[], fallback?: TokenFallback): ModelErrors {
	const errors: ModelErrors = {};
	const name = draft.name.trim();
	if (!name) errors.name = 'nameRequired';
	else if (/\s/.test(name)) errors.name = 'nameSpaces';
	else if (taken.includes(name)) errors.name = 'nameTaken';
	const context = parseTokens(draft.context);
	const maxOutput = parseTokens(draft.maxOutput);
	if (context === 'invalid') errors.context = 'tokens';
	if (maxOutput === 'invalid') errors.maxOutput = 'tokens';
	const window = typeof context === 'number' ? context : fallback ? fallback.context_window || 0 : DEFAULT_CONTEXT;
	const cap = typeof maxOutput === 'number' ? maxOutput : fallback ? fallback.max_output_tokens || 0 : defaultMaxOutput(draft.reasoning, window);
	// An unknown window (0) or cap (0) is not compared.
	if (!errors.context && !errors.maxOutput && window && cap > window) errors.maxOutput = 'outputOverWindow';
	if (draft.reasoning && !draft.efforts.length) errors.efforts = 'effortRequired';
	if (!draft.modalities.length) errors.modalities = 'modalityRequired';
	return errors;
}

/** The stored entry for a valid draft. `previous` keeps what the form does
 *  not edit (prices, gateway windows). A model that does not think is also
 *  written with `["none"]`, which older engines read as "no thinking".
 *  `fallback`: see TokenFallback (a field it has no value for is left out). */
export function modelFromDraft(draft: ModelDraft, previous?: ProviderModel, fallback?: TokenFallback): ProviderModel {
	const context = parseTokens(draft.context);
	const maxOutput = parseTokens(draft.maxOutput);
	const display = draft.display_name.trim();
	const window = typeof context === 'number' ? context : fallback ? fallback.context_window || undefined : DEFAULT_CONTEXT;
	const model: ProviderModel = {
		...previous,
		name: draft.name.trim(),
		context_window: window,
		max_output_tokens:
			typeof maxOutput === 'number' ? maxOutput : fallback ? fallback.max_output_tokens || undefined : defaultMaxOutput(draft.reasoning, window),
		reasoning: draft.reasoning,
		reasoning_efforts: draft.reasoning ? orderTiers(draft.efforts) : ['none'],
		input_modalities: MODALITIES.filter((kind) => draft.modalities.includes(kind))
	};
	if (display && display !== model.name) model.display_name = display;
	else delete model.display_name;
	if (model.context_window === undefined) delete model.context_window;
	if (model.max_output_tokens === undefined) delete model.max_output_tokens;
	return model;
}

export type ProviderField = 'id' | 'base_url' | 'key' | 'models';
export type ProviderErrors = Partial<Record<ProviderField, string>>;

/** The provider part of the form. `taken`: ids of the other providers
 *  (empty when editing: the id is fixed then). `builtin`: the settings of a
 *  built-in provider, whose id and models are given and whose base URL may
 *  stay empty (the built-in one). */
export function validateProvider(
	form: { id: string; base_url: string; key: string; models: ProviderModel[] },
	opts: { taken: string[]; keyRequired: boolean; builtin?: boolean }
): ProviderErrors {
	const errors: ProviderErrors = {};
	if (opts.builtin) {
		if (form.base_url.trim() && !validBaseUrl(form.base_url)) errors.base_url = 'url';
		if (opts.keyRequired && !form.key.trim()) errors.key = 'keyRequired';
		return errors;
	}
	const id = form.id.trim();
	if (!id) errors.id = 'idRequired';
	else if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) errors.id = 'idChars';
	else if (opts.taken.includes(id)) errors.id = 'idTaken';
	if (!form.base_url.trim()) errors.base_url = 'urlRequired';
	else if (!validBaseUrl(form.base_url)) errors.base_url = 'url';
	if (opts.keyRequired && !form.key.trim()) errors.key = 'keyRequired';
	if (!form.models.length) errors.models = 'modelRequired';
	return errors;
}
