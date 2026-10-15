import { describe, expect, it } from 'vitest';
import { buildModelRows, type ModelRow } from '$lib/composer/modelRows';
import { SAMPLE_CATALOG, SAMPLE_PLAIN_IDS } from './catalogSample';
import { catalogIndex, defaultModel, parseCatalog } from './gatewayCatalog';
import { itemsFromOptions, itemsFromRows } from './items';
import { browseLines, browseSections, foldFamily, openAtFirst, quickList, searchSections } from './rank';
import { cheapKeys, searchModels } from './search';
import { fmtAmount, priceText } from './price';
import type { PickItem } from './catalog';

const catalog = parseCatalog(SAMPLE_CATALOG)!;
const index = catalogIndex(catalog);
const lookup = (id: string) => index.get(id.toLowerCase());
const none = () => undefined;

const labels = { lynshen: 'LynShen', byok: 'BYOK' };
/** The composer's rows for a gateway session on `ids`, `active` in use. */
function gatewayRows(ids: string[], active = 'deepseek-v4.1-flash', extra: { id: string; models: { name: string }[] }[] = []): ModelRow[] {
	return buildModelRows({
		models: ids.map((model) => ({ model, active: model === active })),
		backendId: 'lynshen',
		provider: 'monoize',
		providersList: [{ id: 'monoize', models: ids.map((name) => ({ name, display_name: name })) }, ...extra],
		configured: ['monoize', ...extra.map((p) => p.id)],
		groups: labels
	});
}
const names = (items: PickItem[]) => items.map((i) => i.name);

describe('parseCatalog', () => {
	it('reads the contract body', () => {
		expect(catalog.plan).toEqual({ active: true, name: '体验套餐', trial: true, funding: 'plan' });
		expect(catalog.cnyPerUsd).toBe(7.1);
		const flash = catalog.models.find((m) => m.id === 'deepseek-v4.1-flash')!;
		expect(flash).toMatchObject({
			name: 'DeepSeek V4.1 Flash',
			vendor: 'deepseek',
			family: 'deepseek:deepseek v4',
			version: [4100],
			legacy: false,
			domestic: true,
			vision: false,
			reasoning: true,
			context: 384000,
			price: { input: { cny: 1 }, output: { cny: 2 } },
			inPlan: true,
			health: 'ok',
			efforts: ['low', 'medium', 'high'],
			source: 'catalog'
		});
		expect(catalog.models.find((m) => m.id === 'gpt-6.1-sol')!.health).toBe('down');
		expect(catalog.models.find((m) => m.id === 'gemini-3.7-flash')!.health).toBeUndefined();
		expect(catalog.models.find((m) => m.id === 'claude-opus-4-8')!.legacy).toBe(true);
		expect(catalog.models.find((m) => m.id === 'auto')!.autoTarget).toBe('claude-opus-5-5');
	});

	it('numbers the recommendations in catalog order', () => {
		expect(catalog.models.filter((m) => m.recommended !== undefined).map((m) => [m.id, m.recommended])).toEqual([
			['auto', 0],
			['claude-opus-5-5', 1],
			['claude-sonnet-5-5', 2],
			['gpt-6-sol', 3],
			['deepseek-v4.1-flash', 4],
			['glm-5.3', 5],
			['kimi-k3', 6]
		]);
	});

	it('describes a model the admin has not from its id', () => {
		expect(catalog.models.find((m) => m.id === 'mystery-x-2')).toMatchObject({ name: 'Mystery X 2', vendor: 'other', cataloged: false });
	});

	it('finds a model by its aliases and the name sent for it, in any case', () => {
		expect(lookup('DeepSeek-V4.1-Flash')?.id).toBe('deepseek-v4.1-flash');
		expect(lookup('zhipuai/glm-5.3')?.id).toBe('glm-5.3');
		expect(lookup('glm-5.3')?.requestModel).toBe('ZhipuAi/GLM-5.3');
	});

	it('refuses what is not a v1 catalog', () => {
		expect(parseCatalog({ data: [] })).toBeNull();
		expect(parseCatalog({ schema_version: 2, models: [] })).toBeNull();
		expect(parseCatalog(null)).toBeNull();
	});
});

describe('defaultModel', () => {
	it('starts a trial user on a recommended model the plan pays for', () => {
		expect(defaultModel(catalog)?.id).toBe('deepseek-v4.1-flash');
	});
	it('takes the first recommendation without a plan, skipping what does not work', () => {
		const balance = parseCatalog({ ...SAMPLE_CATALOG, plan: null, models: SAMPLE_CATALOG.models.map((m) => ({ ...m, covered_by_plan: false })) });
		expect(defaultModel(balance)?.id).toBe('auto');
		const autoDown = parseCatalog({ ...SAMPLE_CATALOG, plan: null, models: SAMPLE_CATALOG.models.map((m) => ({ ...m, covered_by_plan: false, health: m.id === 'auto' ? { state: 'unavailable' } : m.health })) });
		expect(defaultModel(autoDown)?.id).toBe('claude-opus-5-5');
	});
	it('keeps to the models the engine lists', () => {
		expect(defaultModel(catalog, ['kimi-k3', 'gpt-image-2'])?.id).toBe('kimi-k3');
		expect(defaultModel(catalog, ['gpt-image-2'])).toBeUndefined();
		expect(defaultModel(null)).toBeUndefined();
	});
});

describe('itemsFromRows with the catalog', () => {
	const items = itemsFromRows(gatewayRows(SAMPLE_PLAIN_IDS), lookup);
	it('shows one row per model, named by the catalog', () => {
		expect(items.filter((i) => i.id.toLowerCase() === 'deepseek-v4.1-flash')).toHaveLength(1);
		expect(items.find((i) => i.id === 'deepseek-v4.1-flash')).toMatchObject({
			key: 'monoize::deepseek-v4.1-flash',
			value: '/model deepseek-v4.1-flash',
			active: true,
			inPlan: true
		});
		expect(names(items).slice(0, 3)).toEqual(['Auto', 'Claude Opus 5.5', 'Claude Opus 5']);
	});
	it('keeps the spelling in use and the canonical key', () => {
		const rows = itemsFromRows(gatewayRows(SAMPLE_PLAIN_IDS, 'DeepSeek-V4.1-Flash'), lookup);
		const flash = rows.filter((i) => i.key === 'monoize::deepseek-v4.1-flash');
		expect(flash).toHaveLength(1);
		expect(flash[0]).toMatchObject({ value: '/model DeepSeek-V4.1-Flash', active: true });
	});
});

describe('fallback without a catalog', () => {
	const items = itemsFromRows(gatewayRows(SAMPLE_PLAIN_IDS), none);
	it('derives names, vendors and families from the ids', () => {
		expect(items.find((i) => i.id === 'claude-opus-4-8')).toMatchObject({ name: 'Claude Opus 4.8', vendor: 'anthropic', family: 'claude-opus', source: 'derived' });
		expect(items.find((i) => i.id === 'kimi-k3')).toMatchObject({ name: 'Kimi K3', vendor: 'moonshot', domestic: true });
	});
	it('has no price, health or plan', () => {
		expect(items.some((i) => i.price || i.health || i.inPlan !== undefined)).toBe(false);
	});
	it('folds two spellings of one model', () => {
		expect(items.filter((i) => i.id.toLowerCase() === 'deepseek-v4.1-flash')).toHaveLength(1);
	});
	it('recommends the curated menu on the gateway only', () => {
		expect(items.find((i) => i.id === 'auto')?.recommended).toBe(0);
		const byok = itemsFromRows(
			gatewayRows(['deepseek-v4.1-flash'], 'deepseek-v4.1-flash', [{ id: 'deepseek', models: [{ name: 'deepseek-v4-pro' }] }]),
			none
		);
		const own = byok.find((i) => i.provider === 'deepseek')!;
		expect(own.providerName).toBe('deepseek');
		expect(own.recommended).toBeUndefined();
	});
	it('names Claude Code models in full', () => {
		const rows = buildModelRows({
			models: [
				{ model: 'opus', vendor: 'claude-opus-4-8', label: 'Opus 4.8', active: true, context_window: 200000 },
				{ model: 'opus[1m]', vendor: 'claude-opus-4-8[1m]', label: 'Opus 4.8 (1M context)', active: false }
			],
			backendId: 'claude',
			provider: '',
			providersList: [],
			configured: [],
			groups: labels,
			toolMode: 'system',
			localLabel: '此电脑'
		});
		const tool = itemsFromRows(rows, none);
		expect(tool.map((i) => [i.name, i.note, i.value])).toEqual([
			['Claude Opus 4.8', '此电脑', '/model opus'],
			['Opus 4.8 (1M context)', '此电脑', '/model opus[1m]']
		]);
	});
	it('reads settings options the same way', () => {
		const opts = itemsFromOptions(
			[
				{ provider: 'monoize', name: 'glm-5.3' },
				{ provider: 'custom-a', name: 'my-model', display_name: 'My Model', input_modalities: ['text', 'image'] }
			],
			'glm-5.3',
			lookup
		);
		expect(opts.map((i) => [i.key, i.name, i.active, i.vision])).toEqual([
			['monoize::glm-5.3', 'GLM-5.3', true, false],
			['custom-a::my-model', 'My Model', false, true]
		]);
	});
});

describe('quickList', () => {
	const items = itemsFromRows(gatewayRows(SAMPLE_PLAIN_IDS), lookup);
	const keys = (rows: ReturnType<typeof quickList>) => rows.map((r) => `${r.section}:${r.item.id}`);
	it('lists favorites, then recents with the model in use, then the plan’s picks', () => {
		const rows = quickList(items, {
			favorites: ['monoize::claude-opus-4-8'],
			recent: ['monoize::glm-5.3', 'monoize::deepseek-v4.1-flash', 'monoize::gone-model'],
			trial: true
		});
		expect(keys(rows)).toEqual([
			'favorite:claude-opus-4-8',
			'recent:deepseek-v4.1-flash',
			'recent:glm-5.3',
			// Trial: what the plan pays for first, then the rest in catalog order.
			'recommended:kimi-k3',
			'recommended:auto',
			'recommended:claude-opus-5-5',
			'recommended:claude-sonnet-5-5',
			'recommended:gpt-6-sol'
		]);
	});
	it('leaves out models that do not work and image models from the picks', () => {
		const all = quickList(items, { favorites: [], recent: [], limit: 50 });
		expect(all.some((r) => r.item.id === 'gpt-6.1-sol' || r.item.id === 'gpt-image-2')).toBe(false);
	});
	it('keeps a favorite that does not work, marked', () => {
		const rows = quickList(items, { favorites: ['monoize::gpt-6.1-sol'], recent: [] });
		expect(rows[0].item).toMatchObject({ id: 'gpt-6.1-sol', health: 'down' });
	});
	it('always shows the model in use', () => {
		const favorites = items.filter((i) => !i.active).slice(0, 10).map((i) => i.key);
		const rows = quickList(items, { favorites, recent: [] });
		expect(rows).toHaveLength(8);
		expect(rows.at(-1)!.item.active).toBe(true);
	});
	it('fills from the list where nothing is recommended', () => {
		const byok = itemsFromOptions(['a-1', 'b-2', 'c-3'].map((name) => ({ provider: 'custom', name })), 'b-2', none);
		expect(keys(quickList(byok, { favorites: [], recent: [] }))).toEqual(['recent:b-2', 'recommended:a-1', 'recommended:c-3']);
	});
});

describe('browseSections', () => {
	const items = itemsFromRows(gatewayRows(SAMPLE_PLAIN_IDS), lookup);
	const sections = browseSections(items, { trial: true });
	const family = (id: string) => sections.flatMap((s) => s.families).find((f) => [...f.shown, ...f.more].some((i) => i.id === id))!;
	it('groups by vendor, domestic first for a trial', () => {
		expect(sections.map((s) => s.vendor)).toEqual(['deepseek', 'zhipu', 'moonshot', 'lynshen', 'anthropic', 'openai', 'google', 'other']);
	});
	it('folds legacy versions under the current one', () => {
		expect(family('claude-opus-4-8').shown.map((i) => i.id)).toEqual(['claude-opus-5-5']);
		expect(family('claude-opus-4-8').more.map((i) => i.id)).toEqual(['claude-opus-5', 'claude-opus-4-8']);
		// Two current versions both show; the unavailable one still sorts by version inside its family.
		expect(family('gpt-6-sol').shown.map((i) => i.id)).toEqual(['gpt-6.1-sol', 'gpt-6-sol']);
	});
	it('puts families that do not work last in their section', () => {
		const openai = sections.find((s) => s.vendor === 'openai')!;
		expect(openai.families.map((f) => f.shown[0].id)).toEqual(['gpt-image-2', 'gpt-6.1-sol', 'gpt-5.5']);
	});
	it('folds by version without a lifecycle', () => {
		const derived = itemsFromRows(gatewayRows(SAMPLE_PLAIN_IDS), none);
		const opus = derived.filter((i) => i.family === 'claude-opus');
		expect(foldFamily(opus)).toMatchObject({
			shown: [{ id: 'claude-opus-5-5' }],
			more: [{ id: 'claude-opus-5' }, { id: 'claude-opus-4-8' }]
		});
		const sectioned = browseSections(derived);
		expect(sectioned[0].vendor).toBe('lynshen');
	});
});

describe('search', () => {
	const items = itemsFromRows(gatewayRows(SAMPLE_PLAIN_IDS), lookup);
	const ids = (q: string) => searchModels(items, q).map((h) => h.item.id);
	it('matches names, ids and versions', () => {
		expect(ids('opus')).toEqual(['claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8']);
		expect(ids('4.8')[0]).toBe('claude-opus-4-8');
		expect(ids('opus 4.8')).toEqual(['claude-opus-4-8']);
		expect(ids('claude-opus-4-8')[0]).toBe('claude-opus-4-8');
		expect(ids('gpt6')).toContain('gpt-6-sol');
		expect(ids('K3')).toEqual(['kimi-k3']);
	});
	it('matches aliases and vendors', () => {
		expect(ids('zhipuai')).toEqual(['glm-5.3']);
		expect(ids('v4.1-flash-0910')).toEqual(['deepseek-v4.1-flash']);
		expect(ids('智谱')).toEqual(['glm-5.3', 'glm-5.3-flash']);
		expect(ids('anthropic')).toHaveLength(5);
	});
	it('matches Chinese property words', () => {
		expect(ids('国产').sort()).toEqual(['deepseek-v4-pro', 'deepseek-v4.1-flash', 'glm-5.3', 'glm-5.3-flash', 'kimi-k3']);
		expect(ids('国产模型')).toEqual(ids('国产'));
		expect(ids('看图')).toContain('kimi-k3');
		expect(ids('看图')).not.toContain('glm-5.3');
		expect(ids('能看图的国产模型')).toEqual(['kimi-k3']);
		expect(ids('思考')).not.toContain('glm-5.3-flash');
		expect(ids('套餐')).toHaveLength(5);
		expect(ids('自动')).toEqual(['auto']);
	});
	it('finds the models at a quarter of the typical price, or small models without prices', () => {
		expect([...cheapKeys(items)].sort()).toEqual(['monoize::deepseek-v4-pro', 'monoize::deepseek-v4.1-flash', 'monoize::glm-5.3', 'monoize::glm-5.3-flash']);
		expect(ids('便宜')).toContain('glm-5.3-flash');
		expect(ids('便宜 claude')).toEqual([]);
		expect(ids('便宜的国产模型').sort()).toEqual(['deepseek-v4-pro', 'deepseek-v4.1-flash', 'glm-5.3', 'glm-5.3-flash']);
		const derived = itemsFromRows(gatewayRows(SAMPLE_PLAIN_IDS), none);
		expect(searchModels(derived, '便宜').map((h) => h.item.id).sort()).toEqual(['deepseek-v4.1-flash', 'gemini-3.7-flash', 'glm-5.3-flash']);
	});
	it('puts models that do not work after those that do', () => {
		expect(ids('sol')).toEqual(['gpt-6-sol', 'gpt-5.6-sol', 'gpt-6.1-sol']);
	});
	it('finds nothing for an empty query or a miss', () => {
		expect(ids('  ')).toEqual([]);
		expect(ids('llama')).toEqual([]);
	});
	it('shows every matching version, sectioned by vendor', () => {
		const sections = searchSections(items, 'flash');
		expect(sections.map((s) => s.vendor)).toEqual(['deepseek', 'zhipu', 'google']);
		expect(sections.every((s) => s.families.every((f) => f.more.length === 0))).toBe(true);
	});
});

describe('prices', () => {
	it('formats amounts', () => {
		expect(fmtAmount(2, 'CNY')).toBe('¥2');
		expect(fmtAmount(0.35, 'CNY')).toBe('¥0.35');
		expect(fmtAmount(177.5, 'CNY')).toBe('¥178');
		expect(fmtAmount(21.3, 'CNY')).toBe('¥21.3');
		expect(fmtAmount(0.140845, 'USD')).toBe('$0.141');
	});
	it('shows input / output in the chosen currency', () => {
		const flash = lookup('deepseek-v4.1-flash')!;
		expect(priceText(flash.price, 'CNY')).toBe('¥1 / ¥2');
		expect(priceText(flash.price, 'USD')).toBe('$0.141 / $0.282');
		expect(priceText({ input: { usd: 1 }, output: { usd: 2 } }, 'CNY', 7)).toBe('¥7 / ¥14');
		expect(priceText(undefined, 'CNY')).toBe('');
	});
});

describe('browseLines', () => {
	const items = itemsFromRows(gatewayRows(SAMPLE_PLAIN_IDS, 'claude-opus-4-8'), lookup);
	const sections = browseSections(items);
	it('unfolds the family whose older version is in use', () => {
		const open = openAtFirst(sections);
		const lines = browseLines(sections, open);
		const anthropic = lines.slice(lines.findIndex((l) => l.key === 'v:anthropic'));
		expect(anthropic.slice(0, 5).map((l) => (l.kind === 'model' ? `${l.item.id}${l.folded ? ' (folded)' : ''}` : l.kind === 'more' ? `more ${l.open}` : l.key))).toEqual([
			'v:anthropic',
			'claude-opus-5-5',
			'claude-opus-5 (folded)',
			'claude-opus-4-8 (folded)',
			'more true'
		]);
	});
	it('keeps other families folded', () => {
		const lines = browseLines(sections, new Set());
		expect(lines.some((l) => l.kind === 'model' && l.item.id === 'claude-opus-4-8')).toBe(false);
		expect(lines.filter((l) => l.kind === 'more').length).toBe(4);
	});
});

describe('recents', () => {
	it('leave image models out of the quick list', () => {
		const items = itemsFromRows(gatewayRows(SAMPLE_PLAIN_IDS), lookup);
		const rows = quickList(items, { favorites: [], recent: ['monoize::gpt-image-2', 'monoize::kimi-k3'] });
		expect(rows.some((r) => r.item.id === 'gpt-image-2')).toBe(false);
		expect(rows[1]).toMatchObject({ section: 'recent', item: { id: 'kimi-k3' } });
	});
});
