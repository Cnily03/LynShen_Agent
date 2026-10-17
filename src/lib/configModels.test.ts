import { describe, expect, it } from 'vitest';
import { configModelList, customModelsRepair } from './configModels';

describe('configModelList', () => {
	it('lists the engine models, else the gateway picks a new install has', () => {
		const picks = [{ name: 'deepseek-v4.1-flash' }, { name: 'claude-opus-5-5' }];
		expect(configModelList({ models: [{ name: 'a' }, { name: '' }, null], lynshen_models: picks })).toEqual([{ name: 'a' }]);
		expect(configModelList({ provider: 'monoize', models: [], lynshen_models: picks })).toEqual(picks);
		expect(configModelList({ provider: 'lynshen', lynshen_models: picks })).toEqual(picks);
		// Another provider runs on its own list only.
		expect(configModelList({ provider: 'openai', lynshen_models: picks })).toEqual([]);
		expect(configModelList({})).toEqual([]);
	});
});

describe('customModelsRepair', () => {
	const relay = {
		id: 'lynshen-relay',
		models: [
			{ name: 'deepseek-v4.1-flash', context_window: 400_000, max_output_tokens: 8192 },
			{ name: 'glm-5.3', context_window: 500_000, max_output_tokens: 8192 }
		]
	};
	// What "models to show" wrote over it: the gateway's list and windows.
	const gateway = [
		{ name: 'gpt-6-sol', context_window: 922_000, max_context_window: 0, max_output_tokens: 128_000, reasoning_efforts: ['low'] },
		{ name: 'deepseek-v4.1-flash', context_window: 1_000_000, max_context_window: 0, max_output_tokens: 384_000, reasoning_efforts: ['low'] }
	];

	it('puts back the list a user-added provider was saved with', () => {
		expect(customModelsRepair({ provider: 'lynshen-relay', model: 'deepseek-v4.1-flash', models: gateway }, [relay])).toEqual({
			models: relay.models
		});
		// The model it ran on is gone from its own list: the first one.
		expect(customModelsRepair({ provider: 'lynshen-relay', model: 'gpt-6-sol', models: gateway }, [relay])).toEqual({
			models: relay.models,
			model: 'deepseek-v4.1-flash'
		});
		// A window changed by hand in config.json is the saved one again.
		const edited = [{ ...relay.models[0], context_window: 1_000_000 }, relay.models[1]];
		expect(customModelsRepair({ provider: 'lynshen-relay', model: 'glm-5.3', models: edited }, [relay])).toEqual({ models: relay.models });
	});

	it('leaves a list that matches, even as the engine rewrote it', () => {
		// The engine saves its own copy with defaults for the fields left out.
		const rewritten = relay.models.map((m) => ({ ...m, max_context_window: 0, reasoning_efforts: ['none', 'low'], input_cost: 0 }));
		expect(customModelsRepair({ provider: 'lynshen-relay', model: 'glm-5.3', models: rewritten }, [relay])).toBeNull();
	});

	it('leaves the gateway, built-in providers and providers it does not know', () => {
		for (const provider of ['monoize', 'lynshen']) {
			expect(customModelsRepair({ provider, models: gateway }, [{ id: provider, models: relay.models }])).toBeNull();
		}
		expect(customModelsRepair({ provider: 'deepseek', models: gateway }, [relay])).toBeNull();
		expect(customModelsRepair({ provider: 'lynshen-relay', models: gateway }, [{ id: 'lynshen-relay', models: [] }])).toBeNull();
		expect(customModelsRepair({ models: gateway }, [relay])).toBeNull();
	});
});
