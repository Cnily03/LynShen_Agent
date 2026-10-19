import { describe, expect, it } from 'vitest';
import { draftFromModel, modelFromDraft, validateModel } from '$lib/settings/providerFields';
import {
	OVERRIDES_KEY,
	applyOverride,
	diffModel,
	isCustomized,
	mergeModel,
	overrideFromEdit,
	readOverrides,
	setOverride,
	writeOverrides,
	type ProviderOverrides
} from './overrides';

// Anthropic as `lynshen providers` lists it (no `reasoning`, no input kinds).
const anthropic = {
	id: 'anthropic',
	base_url: 'https://api.anthropic.com',
	format: 'anthropic',
	models: [
		{ name: 'claude-fable-5', display_name: 'Claude Fable 5', context_window: 200_000, max_output_tokens: 64_000, reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh', 'max'] },
		{ name: 'claude-haiku-4-5', context_window: 200_000, max_output_tokens: 64_000, reasoning_efforts: ['none'] },
		{ name: 'claude-legacy', reasoning_efforts: [] }
	]
};

function memory(initial?: string) {
	const data = new Map<string, string>(initial === undefined ? [] : [[OVERRIDES_KEY, initial]]);
	return {
		data,
		getItem: (key: string) => data.get(key) ?? null,
		setItem: (key: string, value: string) => void data.set(key, value),
		removeItem: (key: string) => void data.delete(key)
	};
}

/** The form's round trip for a model left as it was. */
const untouched = (m: (typeof anthropic.models)[number]) => modelFromDraft(draftFromModel(m), m, m);

describe('built-in provider overrides', () => {
	it('an untouched form stores nothing', () => {
		expect(overrideFromEdit(anthropic, { base_url: anthropic.base_url, models: anthropic.models.map(untouched) })).toBeNull();
		// An empty base URL, or the same one written differently, is the built-in one.
		expect(overrideFromEdit(anthropic, { base_url: '', models: anthropic.models })).toBeNull();
		expect(overrideFromEdit(anthropic, { base_url: ' https://api.anthropic.com/ ', models: anthropic.models })).toBeNull();
	});

	it('keeps only the fields the user changed, and the models they added', () => {
		const [fable, haiku, legacy] = anthropic.models;
		const edited = [
			modelFromDraft({ ...draftFromModel(fable), context: '1M', maxOutput: '128k', efforts: ['low', 'medium', 'high', 'minimal'] }, fable, fable),
			modelFromDraft({ ...draftFromModel(haiku), reasoning: false, modalities: ['text'] }, haiku, haiku),
			// Emptied fields keep the built-in values (here: none).
			modelFromDraft({ ...draftFromModel(legacy), context: '', maxOutput: '' }, legacy, legacy),
			modelFromDraft({ ...draftFromModel({ name: 'claude-next' }), name: 'claude-next', context: '400k' })
		];
		const entry = overrideFromEdit(anthropic, { base_url: 'https://www.lynshen.org/v1', models: edited });
		expect(entry).toEqual({
			base_url: 'https://www.lynshen.org/v1',
			models: {
				'claude-fable-5': { context_window: 1_000_000, max_output_tokens: 128_000, reasoning_efforts: ['minimal', 'low', 'medium', 'high'] },
				'claude-haiku-4-5': { reasoning: false, input_modalities: ['text'] }
			},
			added: [{ name: 'claude-next', context_window: 400_000, max_output_tokens: 32_000, reasoning: true, reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh'], input_modalities: ['text', 'image'] }]
		});
		expect('context_window' in edited[2]).toBe(false);
	});

	it('merges the changes into what the engine reads', () => {
		const entry = {
			base_url: 'https://www.lynshen.org/v1',
			models: {
				'claude-fable-5': { context_window: 1_000_000, reasoning_efforts: ['low', 'high'] },
				'claude-haiku-4-5': { reasoning: false, input_modalities: ['text'] }
			},
			added: [{ name: 'claude-next', context_window: 400_000 }, { name: 'claude-fable-5', context_window: 1 }]
		};
		const merged = applyOverride(anthropic, entry);
		expect(merged.id).toBe('anthropic');
		expect(merged.format).toBe('anthropic');
		expect(merged.base_url).toBe('https://www.lynshen.org/v1');
		expect(merged.models).toEqual([
			// Changed tiers state reasoning: the engine keeps such a list as it is.
			{ ...anthropic.models[0], context_window: 1_000_000, reasoning: true, reasoning_efforts: ['low', 'high'] },
			// Thinking off: "none" only, for older engines.
			{ ...anthropic.models[1], reasoning: false, reasoning_efforts: ['none'], input_modalities: ['text'] },
			anthropic.models[2],
			// An added model never replaces a built-in one.
			{ name: 'claude-next', context_window: 400_000 }
		]);
		// The built-in entry itself is left alone.
		expect(anthropic.models[0].context_window).toBe(200_000);
		expect(applyOverride(anthropic, undefined)).toBe(anthropic);
		expect(applyOverride(anthropic, {})).toBe(anthropic);
	});

	it('reads back what it merged as no further change', () => {
		const entry = overrideFromEdit(anthropic, {
			base_url: anthropic.base_url,
			models: [modelFromDraft({ ...draftFromModel(anthropic.models[0]), efforts: ['high'] }, anthropic.models[0], anthropic.models[0]), ...anthropic.models.slice(1)]
		});
		const merged = applyOverride(anthropic, entry);
		const again = overrideFromEdit(anthropic, { base_url: merged.base_url, models: merged.models.map((m) => modelFromDraft(draftFromModel(m), m, anthropic.models.find((b) => b.name === m.name))) });
		expect(again).toEqual(entry);
	});

	it('handles display names and thinking turned back on', () => {
		const fable = anthropic.models[0];
		expect(diffModel(fable, { ...fable, display_name: 'Fable' })).toEqual({ display_name: 'Fable' });
		expect(diffModel(fable, { ...fable, display_name: undefined })).toEqual({ display_name: '' });
		expect(mergeModel(fable, { display_name: '' })).not.toHaveProperty('display_name');
		const off = { ...fable, reasoning: false };
		expect(diffModel(off, { ...fable, reasoning: true })).toEqual({ reasoning: true });
		expect(mergeModel(off, { reasoning: true, reasoning_efforts: ['high'] })).toMatchObject({ reasoning: true, reasoning_efforts: ['high'] });
	});

	it('an empty window or cap on a built-in model keeps its value', () => {
		const fable = anthropic.models[0];
		const cleared = { ...draftFromModel(fable), context: '', maxOutput: '' };
		expect(validateModel(cleared, [], fable)).toEqual({});
		expect(modelFromDraft(cleared, fable, fable)).toMatchObject({ context_window: 200_000, max_output_tokens: 64_000 });
		// Only the output is checked against the built-in window.
		expect(validateModel({ ...cleared, maxOutput: '300k' }, [], fable).maxOutput).toBe('outputOverWindow');
		// No built-in window: nothing to compare against.
		expect(validateModel({ ...cleared, maxOutput: '300k' }, [], {})).toEqual({});
	});

	it('stores by provider id and reads only known fields back', () => {
		const storage = memory();
		let all: ProviderOverrides = {};
		all = setOverride(all, 'anthropic', { base_url: 'https://www.lynshen.org/v1' });
		all = setOverride(all, 'deepseek', null);
		writeOverrides(storage, all);
		expect(readOverrides(storage)).toEqual({ anthropic: { base_url: 'https://www.lynshen.org/v1' } });
		writeOverrides(storage, setOverride(all, 'anthropic', {}));
		expect(storage.data.has(OVERRIDES_KEY)).toBe(false);

		const odd = memory(
			JSON.stringify({
				anthropic: { base_url: ' ', models: { 'claude-fable-5': { context_window: -1, max_output_tokens: 1.5, input_modalities: ['audio'], price: 3 }, x: { reasoning: false } }, added: [{ name: '' }, 'x', { name: 'm' }] },
				openai: 'nope',
				deepseek: {}
			})
		);
		expect(readOverrides(odd)).toEqual({ anthropic: { models: { x: { reasoning: false } }, added: [{ name: 'm' }] } });
		expect(readOverrides(memory('not json'))).toEqual({});
		expect(readOverrides(memory('[1]'))).toEqual({});
		expect(isCustomized({ models: {} })).toBe(false);
	});
});
