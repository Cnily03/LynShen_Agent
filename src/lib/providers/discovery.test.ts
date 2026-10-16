import { describe, expect, it } from 'vitest';
import { SAMPLE_CATALOG } from '$lib/models/catalogSample';
import { catalogIndex, parseCatalog } from '$lib/models/gatewayCatalog';
import { configureModel, knownFromTable, modelFromListed, modelLookup } from './discovery';

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
		expect(lookup('anthropic/claude-fable-5')).toEqual({ context_window: 200_000, max_output_tokens: 64_000, reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] });
		expect(lookup('claude-haiku-4-5')).toMatchObject({ reasoning: false });
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
		expect(configureModel({ name: 'glm-5.3-flash', reasoning_efforts: ['low'] }, lookup('glm-5.3-flash')!)).toMatchObject({ reasoning: false, reasoning_efforts: ['none'] });
	});

	it('reads a table entry that only offers "none" as not thinking', () => {
		expect(knownFromTable({ name: 'x', reasoning_efforts: ['none'] })).toEqual({ reasoning: false });
		expect(knownFromTable({ name: 'x', reasoning_efforts: [] })).toEqual({});
		expect(knownFromTable({ name: 'x', reasoning: false, reasoning_efforts: ['low'] })).toEqual({ reasoning: false });
	});
});
