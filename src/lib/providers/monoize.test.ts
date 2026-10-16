import { describe, expect, it } from 'vitest';
import { monoizeEntries, pickedMonoizeModels } from './monoize';
import { catalogIndex, parseCatalog } from '$lib/models/gatewayCatalog';
import { SAMPLE_CATALOG, SAMPLE_PLAIN_IDS } from '$lib/models/catalogSample';

describe('monoizeEntries', () => {
	it('keeps every model its reasoning efforts, matching the catalog regardless of case', () => {
		const [deepseek, unknown] = monoizeEntries([
			{ id: 'DeepSeek-V4.1-Flash', groups: ['代理'] },
			{ id: 'brand-new-model', groups: ['default'] }
		]);
		expect(deepseek).toMatchObject({
			name: 'DeepSeek-V4.1-Flash',
			display_name: 'DeepSeek-V4.1-Flash',
			groups: ['代理'],
			reasoning_efforts: ['low', 'high', 'max']
		});
		expect(unknown.name).toBe('brand-new-model');
		expect(unknown.reasoning_efforts).toBeUndefined();
	});

	it('prefers what the user configured and drops unroutable models', () => {
		const entries = monoizeEntries(
			[
				{ id: 'gpt-5.5', groups: ['default'] },
				{ id: 'offline', routing_status: 'no_channel' }
			],
			[{ name: 'gpt-5.5', reasoning_efforts: ['low', 'high'], context_window: 400_000 } as { name: string }]
		);
		expect(entries).toHaveLength(1);
		expect(entries[0]).toMatchObject({ reasoning_efforts: ['low', 'high'], context_window: 400_000 });
	});

	it('keeps a model the plan does not include: the balance can run it, the pickers mark it', () => {
		const entries = monoizeEntries([
			{ id: 'deepseek-v4.1-flash', routing_status: 'ready' },
			{ id: 'claude-opus-5-5', routing_status: 'model_not_in_plan' },
			{ id: 'glm-5.3', routing_status: 'plan_inactive' },
			{ id: 'offline', routing_status: 'no_channel' }
		]);
		expect(entries.map((e) => e.name)).toEqual(['deepseek-v4.1-flash', 'claude-opus-5-5', 'glm-5.3']);
	});

	it('takes the window the gateway registers, and never guesses one', () => {
		const [registered, stored, catalogOnly, nothing, guessed] = monoizeEntries(
			[
				{ id: 'glm-5.3', context_window: 128_000, max_output_tokens: 32_000 },
				{ id: 'gpt-5.5', context_window: null },
				{ id: 'DeepSeek-V4.1-Flash', context_window: null },
				{ id: 'brand-new-model' },
				{ id: 'gemini-9-flash' }
			],
			[
				{ name: 'glm-5.3', context_window: 1_310_720 } as { name: string },
				{ name: 'gpt-5.5', context_window: 400_000 } as { name: string },
				{ name: 'gemini-9-flash', context_window: 128_000 } as { name: string }
			]
		);
		// The gateway's registered window wins over a larger stale one.
		expect(registered).toMatchObject({ context_window: 128_000, max_output_tokens: 32_000 });
		expect(stored.context_window).toBe(400_000);
		expect(catalogOnly.context_window).toBe(1_000_000);
		// Unknown stays unknown; the 128K older versions guessed counts as unknown.
		expect(nothing.context_window).toBe(0);
		expect(guessed.context_window).toBe(0);
	});
});

describe('pickedMonoizeModels', () => {
	const live = monoizeEntries([
		{ id: 'glm-5.3', groups: ['国模'], providers: [{ id: 'p-a', name: '代理', group: '国模', account_class: 'private' }] },
		{ id: 'kimi-k3', groups: ['代理'], providers: [{ id: 'p-b', name: '新科研', group: '代理', account_class: 'private' }] }
	]);

	it('drops picks, the model and pinned Providers a lost group took away', () => {
		const patch = pickedMonoizeModels(live, {
			provider: 'monoize',
			model: 'grok-4.7',
			lynshen_models: [{ name: 'grok-4.7' }, { name: 'kimi-k3' }],
			monoize_providers: { 'grok-4.7': 'p-x', 'glm-5.3': 'p-gone', 'kimi-k3': 'p-b' }
		});
		expect((patch.lynshen_models as { name: string }[]).map((m) => m.name)).toEqual(['kimi-k3']);
		expect((patch.models as { name: string }[]).map((m) => m.name)).toEqual(['kimi-k3']);
		expect(patch.model).toBe('kimi-k3');
		expect(patch.monoize_providers).toEqual({ 'kimi-k3': 'p-b' });
	});

	it('shows every model when nothing was picked, and leaves another provider alone', () => {
		expect((pickedMonoizeModels(live, { provider: 'monoize', model: 'glm-5.3' }).models as unknown[]).length).toBe(2);
		// Another provider: the engine's list and model stay; the saved pick
		// only takes the gateway's current limits.
		const other = pickedMonoizeModels(live, { provider: 'deepseek', lynshen_models: [{ name: 'glm-5.3' }], lynshen_models_seen: ['glm-5.3', 'kimi-k3'] });
		expect(Object.keys(other)).toEqual(['lynshen_models']);
		expect((other.lynshen_models as { name: string }[]).map((m) => m.name)).toEqual(['glm-5.3']);
	});

	it('shows a model put on sale since the last look, keeping a hidden one hidden', () => {
		const withAuto = monoizeEntries([
			{ id: 'glm-5.3', groups: ['国模'], providers: [] },
			{ id: 'kimi-k3', groups: ['代理'], providers: [] },
			{ id: 'LS-Auto', groups: ['海外'], providers: [] }
		]);
		const patch = pickedMonoizeModels(withAuto, {
			provider: 'monoize',
			model: 'glm-5.3',
			lynshen_models: [{ name: 'glm-5.3' }],
			lynshen_models_seen: ['glm-5.3', 'kimi-k3']
		});
		expect((patch.lynshen_models as { name: string }[]).map((m) => m.name)).toEqual(['glm-5.3', 'LS-Auto']);
		expect((patch.models as { name: string }[]).map((m) => m.name)).toEqual(['glm-5.3', 'LS-Auto']);
		expect(patch.lynshen_models_seen).toEqual(['glm-5.3', 'kimi-k3', 'LS-Auto']);
	});

	it('without a record yet, counts only an Auto model as new', () => {
		const withAuto = monoizeEntries([
			{ id: 'glm-5.3', groups: [], providers: [] },
			{ id: 'kimi-k3', groups: [], providers: [] },
			{ id: 'LS-Auto', groups: [], providers: [] }
		]);
		const patch = pickedMonoizeModels(withAuto, { provider: 'monoize', model: 'glm-5.3', lynshen_models: [{ name: 'glm-5.3' }] });
		expect((patch.lynshen_models as { name: string }[]).map((m) => m.name)).toEqual(['glm-5.3', 'LS-Auto']);
	});

	it('moves an image model off the chat model to the image model', () => {
		const models = monoizeEntries([{ id: 'gpt-image-2' }, { id: 'glm-5.3' }]);
		const patch = pickedMonoizeModels(models, { provider: 'monoize', model: 'gpt-image-2', lynshen_models: [] });
		expect(patch.image_model).toBe('gpt-image-2');
		expect(patch.model).toBe('glm-5.3');
	});
});

describe('saved gateway picks', () => {
	it('follow the gateway\u2019s current window', () => {
		const models = monoizeEntries([{ id: 'claude-opus-5-5', context_window: 1_000_000, max_output_tokens: 128_000 } as never]);
		const cfg = {
			provider: 'monoize',
			lynshen_models: [{ name: 'claude-opus-5-5', context_window: 0, max_context_window: 128_000, max_output_tokens: 0, reasoning_efforts: ['high'] }],
			lynshen_models_seen: ['claude-opus-5-5']
		};
		const patch = pickedMonoizeModels(models, cfg);
		expect(patch.lynshen_models).toEqual([
			{ name: 'claude-opus-5-5', context_window: 1_000_000, max_context_window: 0, max_output_tokens: 128_000, reasoning_efforts: ['high'] }
		]);
		// Nothing changed since: nothing to write.
		expect(pickedMonoizeModels(models, { ...cfg, lynshen_models: patch.lynshen_models }).lynshen_models).toBeUndefined();
	});
});

describe('with the gateway catalog', () => {
	const described = parseCatalog(SAMPLE_CATALOG)!;
	const index = catalogIndex(described);
	const lookup = (id: string) => index.get(id.toLowerCase());
	const live = monoizeEntries(
		SAMPLE_PLAIN_IDS.map((id) => ({ id, groups: ['默认'] })),
		[],
		lookup
	);

	it('names the models and takes their efforts and windows', () => {
		expect(live.find((m) => m.name === 'claude-opus-4-8')).toMatchObject({ display_name: 'Claude Opus 4.8', context_window: 200000 });
		expect(live.find((m) => m.name === 'kimi-k3')).toMatchObject({ display_name: 'Kimi K3', reasoning_efforts: ['low', 'medium', 'high'] });
		// The admin has not described it: its id stays its name.
		expect(live.find((m) => m.name === 'mystery-x-2')?.display_name).toBe('mystery-x-2');
	});

	it('starts a new user on the plan’s recommendation, not the first model', () => {
		const patch = pickedMonoizeModels(live, { provider: 'monoize' }, described);
		expect(patch.model).toBe('deepseek-v4.1-flash');
		// Without the catalog (an older gateway): the curated menu's first, not the list's.
		expect(pickedMonoizeModels(live, { provider: 'monoize' }).model).toBe('auto');
		const domestic = monoizeEntries(['mystery-x-2', 'glm-5.3', 'kimi-k3', 'deepseek-v4.1-flash'].map((id) => ({ id })));
		expect(pickedMonoizeModels(domestic, { provider: 'monoize' }).model).toBe('deepseek-v4.1-flash');
		// A model in use stays.
		expect(pickedMonoizeModels(live, { provider: 'monoize', model: 'gpt-6-sol' }, described).model).toBeUndefined();
	});
});
