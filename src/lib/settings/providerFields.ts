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

/** Effort tiers the form offers, lowest first. "none" lets the composer turn
 *  thinking off; "ultra" is GPT's name for the top tier (the engine sends
 *  the model's highest other tier). */
export const EFFORT_TIERS = ['none', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'] as const;
export const MODALITIES = ['text', 'image'] as const;
/** What a model without a stated list gets: the engine's default tiers. */
export const DEFAULT_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'];
/** Today's values for a new model left empty. */
export const DEFAULT_CONTEXT = 128_000;
export const DEFAULT_MAX_OUTPUT = 8_192;

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

/** The tiers the composer offers for a model: none when it does not reason. */
export function modelEfforts(model?: Pick<ProviderModel, 'reasoning' | 'reasoning_efforts'> | null): string[] {
	if (!model || model.reasoning === false) return [];
	return model.reasoning_efforts ?? [];
}

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

/** The form's view of a stored model; unset fields show what applies today. */
export function draftFromModel(model: ProviderModel): ModelDraft {
	const reasoning = model.reasoning !== false;
	const kinds = (model.input_modalities ?? []).filter((kind) => (MODALITIES as readonly string[]).includes(kind));
	return {
		name: model.name,
		display_name: model.display_name ?? '',
		context: formatTokens(model.context_window),
		maxOutput: formatTokens(model.max_output_tokens),
		reasoning,
		efforts: reasoning ? orderTiers(model.reasoning_efforts?.length ? model.reasoning_efforts : DEFAULT_EFFORTS) : [],
		modalities: kinds.length ? kinds : [...MODALITIES]
	};
}

export type ModelField = 'name' | 'context' | 'maxOutput' | 'efforts' | 'modalities';
/** Problems per field, as i18n keys under `settings.custom.error`. */
export type ModelErrors = Partial<Record<ModelField, string>>;

/** `taken`: the other models' names in the provider. */
export function validateModel(draft: ModelDraft, taken: string[]): ModelErrors {
	const errors: ModelErrors = {};
	const name = draft.name.trim();
	if (!name) errors.name = 'nameRequired';
	else if (/\s/.test(name)) errors.name = 'nameSpaces';
	else if (taken.includes(name)) errors.name = 'nameTaken';
	const context = parseTokens(draft.context);
	const maxOutput = parseTokens(draft.maxOutput);
	if (context === 'invalid') errors.context = 'tokens';
	if (maxOutput === 'invalid') errors.maxOutput = 'tokens';
	const window = typeof context === 'number' ? context : DEFAULT_CONTEXT;
	const cap = typeof maxOutput === 'number' ? maxOutput : DEFAULT_MAX_OUTPUT;
	if (!errors.context && !errors.maxOutput && cap > window) errors.maxOutput = 'outputOverWindow';
	if (draft.reasoning && !draft.efforts.length) errors.efforts = 'effortRequired';
	if (!draft.modalities.length) errors.modalities = 'modalityRequired';
	return errors;
}

/** The stored entry for a valid draft. `previous` keeps what the form does
 *  not edit (prices, gateway windows). A model that does not think is also
 *  written with `["none"]`, which older engines read as "no thinking". */
export function modelFromDraft(draft: ModelDraft, previous?: ProviderModel): ProviderModel {
	const context = parseTokens(draft.context);
	const maxOutput = parseTokens(draft.maxOutput);
	const display = draft.display_name.trim();
	const model: ProviderModel = {
		...previous,
		name: draft.name.trim(),
		context_window: typeof context === 'number' ? context : DEFAULT_CONTEXT,
		max_output_tokens: typeof maxOutput === 'number' ? maxOutput : DEFAULT_MAX_OUTPUT,
		reasoning: draft.reasoning,
		reasoning_efforts: draft.reasoning ? orderTiers(draft.efforts) : ['none'],
		input_modalities: MODALITIES.filter((kind) => draft.modalities.includes(kind))
	};
	if (display && display !== model.name) model.display_name = display;
	else delete model.display_name;
	return model;
}

export type ProviderField = 'id' | 'base_url' | 'key' | 'models';
export type ProviderErrors = Partial<Record<ProviderField, string>>;

/** The provider part of the form. `taken`: ids of the other providers
 *  (empty when editing: the id is fixed then). */
export function validateProvider(
	form: { id: string; base_url: string; key: string; models: ProviderModel[] },
	opts: { taken: string[]; keyRequired: boolean }
): ProviderErrors {
	const errors: ProviderErrors = {};
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
