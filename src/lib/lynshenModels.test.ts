import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchLynShenModels = vi.fn();
const readConfig = vi.fn();
const writeConfig = vi.fn((_patch: Record<string, unknown>) => Promise.resolve());
vi.mock('./protocol', () => ({
	fetchLynShenModels: () => fetchLynShenModels(),
	readConfig: () => readConfig(),
	writeConfig: (patch: Record<string, unknown>) => writeConfig(patch)
}));

import { gatewayEfforts, modelSetupPatch, refreshLynShenModels, savedModel } from './lynshenModels';

beforeEach(() => vi.clearAllMocks());

describe('refreshLynShenModels', () => {
	it('brings the picked models up to the gateway, keeping the pick and its order, dropping lost ones', async () => {
		const old = savedModel({ id: 'b' });
		readConfig.mockResolvedValue({ provider: 'lynshen', lynshen_models: [old, { name: 'gone', context_window: 1 }] });
		fetchLynShenModels.mockResolvedValue([
			{ id: 'a', context_window: 100 },
			{ id: 'b', context_window: 200, display_name: 'Bee', group_context_windows: { g: { context_window: 300, max_context_window: 300 } } }
		]);
		expect(await refreshLynShenModels()).toBe(true);
		const patch = writeConfig.mock.calls[0][0] as { lynshen_models: Record<string, unknown>[]; models: unknown };
		// `gone` left with a group the account lost: it is not shown any more.
		expect(patch.lynshen_models.map((m) => [m.name, m.display_name, m.context_window])).toEqual([['b', 'Bee', 200]]);
		expect(patch.models).toBe(patch.lynshen_models);
	});

	it('shows a model put on sale since the last look, but keeps one the user hid hidden', async () => {
		readConfig.mockResolvedValue({
			provider: 'lynshen',
			lynshen_models: [savedModel({ id: 'a' })],
			lynshen_models_seen: ['a', 'hidden']
		});
		fetchLynShenModels.mockResolvedValue([{ id: 'a' }, { id: 'hidden' }, { id: 'auto' }]);
		expect(await refreshLynShenModels()).toBe(true);
		const patch = writeConfig.mock.calls[0][0] as { lynshen_models: { name: string }[]; lynshen_models_seen: string[] };
		expect(patch.lynshen_models.map((m) => m.name)).toEqual(['a', 'auto']);
		expect(patch.lynshen_models_seen).toEqual(['a', 'hidden', 'auto']);
	});

	it('writes nothing when the gateway says the same', async () => {
		readConfig.mockResolvedValue({
			provider: 'deepseek',
			lynshen_models: [savedModel({ id: 'b', context_window: 200 })],
			lynshen_models_seen: ['b']
		});
		fetchLynShenModels.mockResolvedValue([{ id: 'b', context_window: 200 }]);
		expect(await refreshLynShenModels()).toBe(false);
		expect(writeConfig).not.toHaveBeenCalled();
	});

	it('initializes first-login defaults instead of leaving the bootstrap gpt-5.5 model', async () => {
		readConfig.mockResolvedValue({ provider: 'lynshen', model: 'gpt-5.5', models: [{ name: 'gpt-5.5' }], lynshen_models: [] });
		fetchLynShenModels.mockResolvedValue([{ id: 'gpt-5.5' }, { id: 'claude-sonnet-5-5' }, { id: 'gpt-6.1-sol' }]);
		expect(await refreshLynShenModels()).toBe(true);
		const patch = writeConfig.mock.calls[0][0] as { model: string; models: { name: string }[]; lynshen_models: unknown };
		expect(patch.models.map((m) => m.name)).toEqual(['gpt-6.1-sol', 'claude-sonnet-5-5']);
		expect(patch.models).toBe(patch.lynshen_models);
		expect(patch.model).toBe('gpt-6.1-sol');
	});

	it('repairs the active bootstrap list when saved account models already exist', async () => {
		const saved = [savedModel({ id: 'gpt-6.1-sol' })];
		readConfig.mockResolvedValue({ provider: 'lynshen', model: 'gpt-5.5', models: [{ name: 'gpt-5.5' }], lynshen_models: saved });
		fetchLynShenModels.mockResolvedValue([{ id: 'gpt-6.1-sol' }]);
		expect(await refreshLynShenModels()).toBe(true);
		expect(writeConfig.mock.calls[0][0]).toMatchObject({ models: saved, model: 'gpt-6.1-sol' });
	});

	it('initializes account defaults without switching a BYOK provider', async () => {
		readConfig.mockResolvedValue({ provider: 'deepseek', model: 'my-model', models: [{ name: 'my-model' }], lynshen_models: [] });
		fetchLynShenModels.mockResolvedValue([{ id: 'gpt-6.1-sol' }]);
		expect(await refreshLynShenModels()).toBe(true);
		expect(writeConfig.mock.calls[0][0]).toEqual({
			lynshen_models: [savedModel({ id: 'gpt-6.1-sol' })],
			lynshen_models_seen: ['gpt-6.1-sol']
		});
	});

	it('does not overwrite an existing single-model user selection', async () => {
		const saved = [savedModel({ id: 'gpt-5.5' })];
		readConfig.mockResolvedValue({
			provider: 'lynshen',
			model: 'gpt-5.5',
			models: saved,
			lynshen_models: saved,
			lynshen_models_seen: ['gpt-5.5', 'gpt-6.1-sol']
		});
		fetchLynShenModels.mockResolvedValue([{ id: 'gpt-5.5' }, { id: 'gpt-6.1-sol' }]);
		expect(await refreshLynShenModels()).toBe(false);
		expect(writeConfig).not.toHaveBeenCalled();
	});

	it('keeps the current bootstrap config when the account catalog is empty', async () => {
		readConfig.mockResolvedValue({ provider: 'lynshen', model: 'gpt-5.5', models: [{ name: 'gpt-5.5' }], lynshen_models: [] });
		fetchLynShenModels.mockResolvedValue([]);
		expect(await refreshLynShenModels()).toBe(false);
		expect(writeConfig).not.toHaveBeenCalled();
	});

	it('uses available account models when none of the recommendations are served', async () => {
		readConfig.mockResolvedValue({ provider: 'lynshen', model: 'gpt-5.5', lynshen_models: [] });
		fetchLynShenModels.mockResolvedValue([{ id: 'private-model', reasoning_efforts: ['low', 'high'] }]);
		expect(await refreshLynShenModels()).toBe(true);
		expect(writeConfig.mock.calls[0][0]).toMatchObject({ model: 'private-model', reasoning_effort: 'low' });
	});
});

describe('gatewayEfforts', () => {
	it('takes the bundled catalog\'s efforts for a gateway model (the gateway lists none)', () => {
		expect(gatewayEfforts({ id: 'deepseek-v4.1-flash' })).toEqual(['low', 'high', 'max']);
		expect(gatewayEfforts({ id: 'DeepSeek-V4.1-Flash' })).toEqual(['low', 'high', 'max']);
	});

	it('gives Auto its target\'s efforts and keeps the gateway\'s own when it sends them', () => {
		expect(gatewayEfforts({ id: 'auto', auto_target: 'kimi-k3' })).toEqual(['low', 'medium', 'high']);
		expect(gatewayEfforts({ id: 'kimi-k3', reasoning_efforts: ['high'] })).toEqual(['high']);
	});

	it('keeps a known earlier list, and offers only "none" for a model nobody knows', () => {
		expect(gatewayEfforts({ id: 'not-in-catalog' }, ['low', 'high'])).toEqual(['low', 'high']);
		expect(gatewayEfforts({ id: 'not-in-catalog' }, ['none'])).toEqual(['none']);
		expect(gatewayEfforts({ id: 'not-in-catalog' })).toEqual(['none']);
	});

	it('upgrades a saved "none"-only entry when the models are refreshed', async () => {
		readConfig.mockResolvedValue({
			provider: 'lynshen',
			lynshen_models: [{ name: 'deepseek-v4.1-flash', reasoning_efforts: ['none'] }],
			lynshen_models_seen: ['deepseek-v4.1-flash']
		});
		fetchLynShenModels.mockResolvedValue([{ id: 'deepseek-v4.1-flash', context_window: 1_000_000 }]);
		expect(await refreshLynShenModels()).toBe(true);
		const patch = writeConfig.mock.calls[0][0] as { models: { reasoning_efforts: string[] }[] };
		expect(patch.models[0].reasoning_efforts).toEqual(['low', 'high', 'max']);
	});
});

describe('modelSetupPatch', () => {
	const chosen = [savedModel({ id: 'gpt-6-sol', context_window: 922_000 }), savedModel({ id: 'deepseek-v4.1-flash', context_window: 1_000_000 })];
	const seen = ['gpt-6-sol', 'deepseek-v4.1-flash', 'kimi-k3'];

	it('makes the picks the model list while the gateway is the provider', () => {
		for (const provider of ['monoize', 'lynshen']) {
			expect(modelSetupPatch({ provider, model: 'deepseek-v4.1-flash' }, chosen, {}, seen)).toEqual({
				lynshen_models: chosen,
				context_window_overrides: {},
				lynshen_models_seen: seen,
				models: chosen
			});
		}
		// The current model was unchecked: the first pick takes over.
		expect(modelSetupPatch({ provider: 'monoize', model: 'kimi-k3' }, chosen, {}, seen)).toMatchObject({ models: chosen, model: 'gpt-6-sol' });
		// Nothing picked: the list stays.
		expect(modelSetupPatch({ provider: 'monoize', model: 'kimi-k3' }, [], {}, seen)).not.toHaveProperty('models');
	});

	it('keeps the list and model of any other provider (ticket #34)', () => {
		for (const provider of ['lynshen-relay', 'deepseek', '']) {
			const patch = modelSetupPatch({ provider, model: 'deepseek-v4.1-flash' }, chosen, { 'kimi-k3': 262_144 }, seen);
			expect(patch).toEqual({ lynshen_models: chosen, context_window_overrides: { 'kimi-k3': 262_144 }, lynshen_models_seen: seen });
		}
	});
});
