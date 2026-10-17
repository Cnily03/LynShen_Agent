import { describe, expect, it } from 'vitest';
import {
	acceptsImages,
	DEFAULT_CONTEXT,
	DEFAULT_EFFORTS,
	DEFAULT_MAX_OUTPUT,
	draftFromModel,
	formatTokens,
	modelEfforts,
	modelFromDraft,
	newModelDraft,
	orderTiers,
	parseTokens,
	SAFE_EFFORTS,
	validateModel,
	validateProvider,
	validBaseUrl
} from './providerFields';

describe('parseTokens', () => {
	it('reads whole numbers with k and M units', () => {
		expect(parseTokens('128k')).toBe(128_000);
		expect(parseTokens('128K')).toBe(128_000);
		expect(parseTokens('1M')).toBe(1_000_000);
		expect(parseTokens('1.5m')).toBe(1_500_000);
		expect(parseTokens(' 200,000 ')).toBe(200_000);
		expect(parseTokens('8192')).toBe(8192);
	});
	it('tells empty from invalid', () => {
		expect(parseTokens('  ')).toBe('empty');
		for (const bad of ['0', '-5', 'abc', '1.5', '12kb', '1e6', '0.0001k', 'k', '1.2.3k'])
			expect(parseTokens(bad), bad).toBe('invalid');
	});
	it('round-trips through formatTokens', () => {
		for (const n of [8192, 32_000, 128_000, 200_000, 272_000, 1_000_000, 1_048_576, 1_500_000, 2_000_000]) {
			expect(parseTokens(formatTokens(n)), String(n)).toBe(n);
		}
		expect(formatTokens(128_000)).toBe('128k');
		expect(formatTokens(1_000_000)).toBe('1M');
		expect(formatTokens(1_500_000)).toBe('1.5M');
		expect(formatTokens(1_048_576)).toBe('1048576');
		expect(formatTokens(0)).toBe('');
		expect(formatTokens(undefined)).toBe('');
	});
});

describe('validBaseUrl', () => {
	it('takes http(s) URLs with a host only', () => {
		expect(validBaseUrl('https://api.example.com/v1')).toBe(true);
		expect(validBaseUrl('http://127.0.0.1:11434/v1')).toBe(true);
		expect(validBaseUrl(' https://api.example.com ')).toBe(true);
		for (const bad of ['', 'api.example.com/v1', 'ftp://x.com', 'https://', 'https://a b.com', 'not a url'])
			expect(validBaseUrl(bad), bad).toBe(false);
	});
});

describe('model drafts', () => {
	it('a new model starts with what applies today', () => {
		const model = modelFromDraft({ ...newModelDraft(), name: 'my-model' });
		expect(model).toEqual({
			name: 'my-model',
			context_window: DEFAULT_CONTEXT,
			max_output_tokens: DEFAULT_MAX_OUTPUT,
			reasoning: true,
			reasoning_efforts: DEFAULT_EFFORTS,
			input_modalities: ['text', 'image']
		});
	});

	it('an existing entry without the new fields reads as today', () => {
		const draft = draftFromModel({ name: 'gpt-x', context_window: 272_000, max_output_tokens: 128_000, reasoning_efforts: [] });
		expect(draft).toMatchObject({ context: '272k', maxOutput: '128k', reasoning: true, efforts: DEFAULT_EFFORTS, modalities: ['text', 'image'] });
		// A "none"-only list is a model that can think, offered only off.
		expect(draftFromModel({ name: 'deepseek-chat', reasoning_efforts: ['none'] })).toMatchObject({ reasoning: true, efforts: ['none'] });
		expect(draftFromModel({ name: 'kimi-k3', reasoning: true })).toMatchObject({ reasoning: true, efforts: DEFAULT_EFFORTS });
	});

	it('writes thinking off, tiers in order, modalities and keeps other keys', () => {
		const previous = { name: 'old', input_cost: 2, display_name: 'Old', reasoning_efforts: ['minimal', 'high'] };
		const draft = { ...draftFromModel(previous), name: 'new', context: '1M', maxOutput: '64k', efforts: ['ultra', 'low', 'minimal'] };
		expect(modelFromDraft(draft, previous)).toEqual({
			name: 'new',
			display_name: 'Old',
			input_cost: 2,
			context_window: 1_000_000,
			max_output_tokens: 64_000,
			reasoning: true,
			reasoning_efforts: ['minimal', 'low', 'ultra'],
			input_modalities: ['text', 'image']
		});
		const off = modelFromDraft({ ...draft, reasoning: false, modalities: ['text'], display_name: '' }, previous);
		expect(off.reasoning).toBe(false);
		expect(off.reasoning_efforts).toEqual(['none']);
		expect(off.input_modalities).toEqual(['text']);
		expect('display_name' in off).toBe(false);
		// Read back: thinking off; the default tiers wait for 支持思考.
		expect(draftFromModel(off)).toMatchObject({ reasoning: false, efforts: DEFAULT_EFFORTS, modalities: ['text'] });
		// Turned back on, the draft is valid as it is (the default tiers).
		expect(validateModel({ ...draftFromModel(off), reasoning: true }, [])).toEqual({});
		// A model that does not think but lists tiers keeps them for when it does.
		expect(draftFromModel({ name: 'm', reasoning: false, reasoning_efforts: ['high', 'low'] }).efforts).toEqual(['low', 'high']);
	});

	it('orders known tiers and keeps unknown ones', () => {
		expect(orderTiers(['max', 'none', 'ultra', 'low', 'minimal'])).toEqual(['none', 'minimal', 'low', 'max', 'ultra']);
		expect(orderTiers(['turbo', 'high', 'none'])).toEqual(['none', 'high', 'turbo']);
		// "default" (the provider's own setting, CLI 0.7.1) stays first.
		expect(orderTiers(['high', 'none', 'default', 'low'])).toEqual(['default', 'none', 'low', 'high']);
	});

	it('a model of a built-in provider the engine says does not think offers the provider default or off', () => {
		const off = { name: 'minimax-m1', reasoning: false, reasoning_efforts: ['none'] };
		expect(draftFromModel(off, SAFE_EFFORTS)).toMatchObject({ reasoning: false, efforts: ['default', 'none'] });
		const on = modelFromDraft({ ...draftFromModel(off, SAFE_EFFORTS), reasoning: true }, off);
		expect(on).toMatchObject({ reasoning: true, reasoning_efforts: ['default', 'none'] });
		// The engine's own list (CLI 0.7.1) is kept as it is.
		const deepseek = { name: 'deepseek-v4-pro', reasoning: true, reasoning_efforts: ['default', 'none', 'low', 'high', 'max'] };
		expect(draftFromModel(deepseek, SAFE_EFFORTS).efforts).toEqual(['default', 'none', 'low', 'high', 'max']);
		expect(validateModel({ ...draftFromModel({ name: 'minimax-m2', reasoning: true, reasoning_efforts: ['default'] }), name: 'minimax-m2' }, [])).toEqual({});
	});

	it('validates names, token counts, tiers and modalities', () => {
		const ok = { ...newModelDraft(), name: 'm', context: '200k', maxOutput: '32k' };
		expect(validateModel(ok, [])).toEqual({});
		expect(validateModel({ ...ok, name: ' ' }, []).name).toBe('nameRequired');
		expect(validateModel({ ...ok, name: 'a b' }, []).name).toBe('nameSpaces');
		expect(validateModel(ok, ['m']).name).toBe('nameTaken');
		expect(validateModel({ ...ok, context: '12q' }, []).context).toBe('tokens');
		expect(validateModel({ ...ok, maxOutput: '0' }, []).maxOutput).toBe('tokens');
		expect(validateModel({ ...ok, context: '16k', maxOutput: '32k' }, []).maxOutput).toBe('outputOverWindow');
		// Empty fields take today's defaults (128k window, 8k output).
		expect(validateModel({ ...ok, context: '', maxOutput: '' }, [])).toEqual({});
		expect(validateModel({ ...ok, efforts: [] }, []).efforts).toBe('effortRequired');
		expect(validateModel({ ...ok, reasoning: false, efforts: [] }, [])).toEqual({});
		expect(validateModel({ ...ok, modalities: [] }, []).modalities).toBe('modalityRequired');
	});
});

describe('validateProvider', () => {
	const form = { id: 'my-llm', base_url: 'https://llm.example.com/v1', key: '', models: [{ name: 'm' }] };
	it('accepts a complete provider', () => {
		expect(validateProvider(form, { taken: [], keyRequired: false })).toEqual({});
	});
	it('names each problem', () => {
		expect(validateProvider({ ...form, id: '' }, { taken: [], keyRequired: false }).id).toBe('idRequired');
		expect(validateProvider({ ...form, id: 'my llm' }, { taken: [], keyRequired: false }).id).toBe('idChars');
		expect(validateProvider(form, { taken: ['my-llm'], keyRequired: false }).id).toBe('idTaken');
		expect(validateProvider({ ...form, base_url: ' ' }, { taken: [], keyRequired: false }).base_url).toBe('urlRequired');
		expect(validateProvider({ ...form, base_url: 'llm.example.com' }, { taken: [], keyRequired: false }).base_url).toBe('url');
		expect(validateProvider(form, { taken: [], keyRequired: true }).key).toBe('keyRequired');
		expect(validateProvider({ ...form, models: [] }, { taken: [], keyRequired: false }).models).toBe('modelRequired');
	});
	it('a built-in provider may keep its base URL and has its id and models', () => {
		const builtin = { taken: ['anthropic'], keyRequired: false, builtin: true };
		expect(validateProvider({ id: 'anthropic', base_url: '', key: '', models: [] }, builtin)).toEqual({});
		expect(validateProvider({ id: 'anthropic', base_url: 'www.lynshen.org', key: '', models: [] }, builtin).base_url).toBe('url');
		expect(validateProvider({ id: 'anthropic', base_url: '', key: '', models: [] }, { ...builtin, keyRequired: true }).key).toBe('keyRequired');
	});
});

describe('engine-facing reads', () => {
	it('a model that does not reason offers no tiers', () => {
		expect(modelEfforts({ reasoning: false, reasoning_efforts: ['none'] })).toEqual([]);
		expect(modelEfforts({ reasoning_efforts: ['low', 'high'] })).toEqual(['low', 'high']);
		expect(modelEfforts(undefined)).toEqual([]);
	});
	it('a model that thinks always offers tiers (the engine\'s default ones without a list)', () => {
		expect(modelEfforts({ reasoning: true })).toEqual(DEFAULT_EFFORTS);
		expect(modelEfforts({ reasoning: true, reasoning_efforts: [] })).toEqual(DEFAULT_EFFORTS);
		expect(modelEfforts({})).toEqual(DEFAULT_EFFORTS);
	});
	it('images are accepted unless the modalities leave them out', () => {
		expect(acceptsImages({})).toBe(true);
		expect(acceptsImages(undefined)).toBe(true);
		expect(acceptsImages({ input_modalities: [] })).toBe(true);
		expect(acceptsImages({ input_modalities: ['text', 'image'] })).toBe(true);
		expect(acceptsImages({ input_modalities: ['text'] })).toBe(false);
	});
});
