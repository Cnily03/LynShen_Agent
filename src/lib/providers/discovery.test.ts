import { describe, expect, it } from 'vitest';
import { SAMPLE_CATALOG } from '$lib/models/catalogSample';
import { catalogIndex, parseCatalog } from '$lib/models/gatewayCatalog';
import { configureModel, knownFromCatalog, knownFromListed, knownFromTable, mergeKnown, modelFromListed, modelLookup, staysThinking } from './discovery';

const index = catalogIndex(parseCatalog(SAMPLE_CATALOG));
const gateway = (id: string) => index.get(id.toLowerCase());
// The engine's built-in Anthropic table and a vendored OpenRouter entry.
const engine = [
	{ name: 'claude-fable-5', context_window: 200_000, max_output_tokens: 64_000, reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
	{ name: 'claude-haiku-4-5', context_window: 200_000, max_output_tokens: 64_000, reasoning_efforts: ['none'] }
];
const vendored = [{ name: 'qwen/qwen3.5-coder', context_window: 262_144, max_output_tokens: 65_536, reasoning_efforts: ['low', 'high'] }];
const lookup = modelLookup({ gateway, tables: [engine, vendored] });

describe('model discovery', () => {
	it('knows a model from the gateway catalog first, then the tables', () => {
		expect(lookup('claude-opus-5-5')).toEqual({
			display_name: 'Claude Opus 5.5',
			context_window: 1_000_000,
			max_output_tokens: 64_000,
			reasoning: true,
			reasoning_efforts: ['low', 'medium', 'high'],
			input_modalities: ['text', 'image']
		});
		// By an alias, case-insensitive.
		expect(lookup('DeepSeek-V4.1-Flash')).toMatchObject({ context_window: 384_000, input_modalities: ['text'] });
		// A catalog model that does not think: no tiers.
		expect(lookup('glm-5.3-flash')).toMatchObject({ reasoning: false });
		expect(lookup('glm-5.3-flash')).not.toHaveProperty('reasoning_efforts');
		// Not described by the admin: only its numbers.
		expect(lookup('mystery-x-2')).toEqual({ context_window: 32_000, max_output_tokens: 64_000 });
		// The engine's table, also under a vendor prefix (OpenRouter-style ids).
		expect(lookup('anthropic/claude-fable-5')).toEqual({
			context_window: 200_000,
			max_output_tokens: 64_000,
			reasoning: true,
			reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max']
		});
		// Only "none" and no flag: whether it thinks is not known.
		expect(lookup('claude-haiku-4-5')).toEqual({ context_window: 200_000, max_output_tokens: 64_000 });
		// The vendored catalog by the bare name.
		expect(lookup('qwen3.5-coder')).toMatchObject({ context_window: 262_144, reasoning_efforts: ['low', 'high'] });
		expect(lookup('totally-unknown')).toBeUndefined();
		expect(modelLookup({ tables: [] })('claude-fable-5')).toBeUndefined();
	});

	it('makes an entry from what the endpoint says, then the catalog, then the defaults', () => {
		expect(modelFromListed({ id: 'claude-opus-5-5' }, lookup('claude-opus-5-5'))).toEqual({
			name: 'claude-opus-5-5',
			display_name: 'Claude Opus 5.5',
			context_window: 1_000_000,
			max_output_tokens: 64_000,
			reasoning: true,
			reasoning_efforts: ['low', 'medium', 'high'],
			input_modalities: ['text', 'image']
		});
		// The endpoint's own window and input kinds win.
		expect(modelFromListed({ id: 'anthropic/claude-fable-5', display_name: 'Anthropic: Claude Fable 5', context_window: 1_000_000, max_output_tokens: 128_000, input_modalities: ['text'] }, lookup('anthropic/claude-fable-5'))).toMatchObject({
			display_name: 'Anthropic: Claude Fable 5',
			context_window: 1_000_000,
			max_output_tokens: 128_000,
			input_modalities: ['text']
		});
		// Nothing known: what an empty form gives.
		expect(modelFromListed({ id: 'my-model' })).toEqual({
			name: 'my-model',
			context_window: 128_000,
			max_output_tokens: 8192,
			reasoning: true,
			reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
			input_modalities: ['text', 'image']
		});
		// Not thinking: written as the form writes it.
		expect(modelFromListed({ id: 'glm-5.3-flash' }, lookup('glm-5.3-flash'))).toMatchObject({ reasoning: false, reasoning_efforts: ['none'] });
		// An output cap never exceeds the window.
		expect(modelFromListed({ id: 'small', context_window: 16_000 }, { max_output_tokens: 64_000 }).max_output_tokens).toBe(16_000);
	});

	it('自动配置 puts the catalog values over a listed model', () => {
		const typed = { name: 'claude-opus-5-5', display_name: 'Opus', context_window: 128_000, max_output_tokens: 8192, reasoning: true, reasoning_efforts: ['none', 'low'], input_modalities: ['text'] };
		expect(configureModel(typed, lookup('claude-opus-5-5')!)).toEqual({
			...typed,
			context_window: 1_000_000,
			max_output_tokens: 64_000,
			reasoning_efforts: ['low', 'medium', 'high'],
			input_modalities: ['text', 'image']
		});
		const configured = configureModel(typed, lookup('claude-opus-5-5')!)!;
		expect(configureModel(configured, lookup('claude-opus-5-5')!)).toBeNull();
		// Thinking is never turned off: a catalog that says "does not think"
		// leaves a thinking model as it is (and the form says so).
		const thinkingFlash = { name: 'glm-5.3-flash', reasoning: true, reasoning_efforts: ['low'] };
		expect(configureModel(thinkingFlash, lookup('glm-5.3-flash')!)).toMatchObject({ reasoning: true, reasoning_efforts: ['low'], context_window: 128_000 });
		expect(staysThinking(thinkingFlash, lookup('glm-5.3-flash'))).toBe(true);
		expect(staysThinking({ name: 'glm-5.3-flash', reasoning: false }, lookup('glm-5.3-flash'))).toBe(false);
		expect(staysThinking(thinkingFlash, lookup('claude-opus-5-5'))).toBe(false);
	});

	it('reads only a flag or thinking tiers as a statement about thinking', () => {
		// LynShen CLI 0.7.0 lists every Chat Completions model with only "none".
		expect(knownFromTable({ name: 'x', reasoning_efforts: ['none'] })).toEqual({});
		expect(knownFromTable({ name: 'x', reasoning_efforts: [] })).toEqual({});
		expect(knownFromTable({ name: 'x', reasoning_efforts: ['none', 'low', 'high'] })).toEqual({ reasoning: true, reasoning_efforts: ['none', 'low', 'high'] });
		// LynShen CLI 0.7.1 states it.
		expect(knownFromTable({ name: 'x', reasoning: false, reasoning_efforts: ['none'] })).toEqual({ reasoning: false });
		expect(knownFromTable({ name: 'x', reasoning: false, reasoning_efforts: ['low'] })).toEqual({ reasoning: false });
		expect(knownFromTable({ name: 'x', reasoning: true, reasoning_efforts: ['none'] })).toEqual({ reasoning: true });
	});

	// The owner's report (0.9.1): models of another provider showed no
	// thinking. The engine's tables list them with only "none"; a catalog
	// further down knows they think.
	it('takes thinking from any source that states it, the endpoint first', () => {
		const engine070 = [
			{ name: 'deepseek-v4-pro', context_window: 1_000_000, max_output_tokens: 384_000, reasoning_efforts: ['none'] },
			{ name: 'kimi-k2-thinking', context_window: 262_144, max_output_tokens: 262_144, reasoning_efforts: ['none'] },
			{ name: 'gpt-4o', context_window: 128_000, max_output_tokens: 16_384, reasoning_efforts: ['none'] }
		];
		const catalog = [{ name: 'deepseek-v4-pro', context_window: 1_000_000, max_output_tokens: 128_000, reasoning_efforts: ['none', 'high', 'max'] }];
		const find = modelLookup({ tables: [engine070, catalog] });
		// Numbers from the first table, thinking from the one that states it.
		expect(find('deepseek-v4-pro')).toEqual({ context_window: 1_000_000, max_output_tokens: 384_000, reasoning: true, reasoning_efforts: ['none', 'high', 'max'] });
		expect(find('deepseek/deepseek-v4-pro')).toMatchObject({ reasoning: true });
		// Nobody says: the model is added thinking, with the default tiers.
		expect(find('kimi-k2-thinking')).not.toHaveProperty('reasoning');
		expect(modelFromListed({ id: 'kimi-k2-thinking' }, find('kimi-k2-thinking'))).toMatchObject({
			reasoning: true,
			reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh'],
			context_window: 262_144
		});
		// 自动配置 on a model 0.9.1 had turned off: it stays as the user has it
		// until a source says it thinks.
		const off = { name: 'kimi-k2-thinking', reasoning: false, reasoning_efforts: ['none'], context_window: 262_144, max_output_tokens: 262_144 };
		expect(configureModel(off, find('kimi-k2-thinking')!)).toBeNull();
		expect(configureModel(off, mergeKnown([knownFromListed({ id: 'kimi-k2-thinking', reasoning: true }), find('kimi-k2-thinking')])!)).toMatchObject({
			reasoning: true,
			reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh']
		});
		// The endpoint's statement comes before the catalogs, either way.
		expect(modelFromListed({ id: 'claude-opus-5-5', reasoning: false }, lookup('claude-opus-5-5'))).toMatchObject({ reasoning: false, reasoning_efforts: ['none'] });
		expect(modelFromListed({ id: 'glm-5.3-flash', reasoning: true }, lookup('glm-5.3-flash'))).toMatchObject({
			reasoning: true,
			reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh']
		});
		// The cost: a model that does not think and that CLI 0.7.0 lists the
		// same way is added thinking too (CLI 0.7.1 states it; the user can
		// clear 支持思考).
		expect(modelFromListed({ id: 'gpt-4o' }, find('gpt-4o'))).toMatchObject({ reasoning: true });
		expect(modelFromListed({ id: 'gpt-4o' }, modelLookup({ tables: [[{ name: 'gpt-4o', reasoning: false, reasoning_efforts: ['none'] }]] })('gpt-4o'))).toMatchObject({
			reasoning: false,
			reasoning_efforts: ['none']
		});
	});

	it('reads the thinking and tiers an endpoint states', () => {
		expect(knownFromListed({ id: 'a' })).toEqual({});
		expect(knownFromListed({ id: 'a', reasoning: true })).toEqual({ reasoning: true });
		expect(knownFromListed({ id: 'a', reasoning: false, reasoning_efforts: ['low'] })).toEqual({ reasoning: false });
		// Tiers alone say it thinks; unknown tiers are dropped, the rest ordered.
		expect(knownFromListed({ id: 'a', reasoning_efforts: ['max', 'turbo', 'none', 'low'] })).toEqual({ reasoning: true, reasoning_efforts: ['none', 'low', 'max'] });
		expect(knownFromListed({ id: 'a', reasoning: true, reasoning_efforts: ['none'] })).toEqual({ reasoning: true });
		expect(knownFromListed({ id: 'a', context_window: 200_000, input_modalities: ['text'] })).toEqual({ context_window: 200_000, input_modalities: ['text'] });
		// The stated tiers become the entry's.
		expect(modelFromListed({ id: 'claude-x', reasoning: true, reasoning_efforts: ['high', 'max'] })).toMatchObject({ reasoning: true, reasoning_efforts: ['high', 'max'] });
	});

	it('reads a gateway row without a thinking flag as unknown', () => {
		const body = structuredClone(SAMPLE_CATALOG) as { models: { id: string; capabilities: Record<string, unknown> }[] };
		const kimi = body.models.find((r) => r.id === 'kimi-k3')!;
		kimi.capabilities.reasoning = null;
		kimi.capabilities.effort_levels = [];
		const row = catalogIndex(parseCatalog(body)).get('kimi-k3')!;
		expect(row.cataloged).toBe(true);
		expect(knownFromCatalog(row)).not.toHaveProperty('reasoning');
		expect(knownFromCatalog(gateway('glm-5.3-flash')!)).toMatchObject({ reasoning: false });
	});

	it('merges sources field by field', () => {
		expect(mergeKnown([])).toBeUndefined();
		expect(mergeKnown([undefined, {}])).toBeUndefined();
		expect(mergeKnown([{ context_window: 1 }, { context_window: 2, max_output_tokens: 3, reasoning: false }, { reasoning: true }])).toEqual({
			context_window: 1,
			max_output_tokens: 3,
			reasoning: false
		});
		// Tiers from a later source that agrees.
		expect(mergeKnown([{ reasoning: true }, { reasoning: false }, { reasoning: true, reasoning_efforts: ['low'] }])).toEqual({ reasoning: true, reasoning_efforts: ['low'] });
	});
});
