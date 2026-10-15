import { describe, expect, it } from 'vitest';
import { compareVersion, drawsImages, looksCheap, parseId, readsImages, thinks, vendorOf } from './derive';

describe('parseId', () => {
	const cases: [string, string, string, number[], string?][] = [
		['claude-opus-4-8', 'claude-opus', 'Claude Opus 4.8', [4, 8]],
		['claude-opus-5-5', 'claude-opus', 'Claude Opus 5.5', [5, 5]],
		['claude-opus-5', 'claude-opus', 'Claude Opus 5', [5]],
		['claude-haiku-4-5-20251001', 'claude-haiku', 'Claude Haiku 4.5 (20251001)', [4, 5], '20251001'],
		['gpt-6.1-sol', 'gpt-sol', 'GPT-6.1 Sol', [6, 1]],
		['gpt-5.5', 'gpt', 'GPT-5.5', [5, 5]],
		['gpt-image-2', 'gpt-image', 'GPT Image 2', [2]],
		['gpt-oss-120b', 'gpt-oss-120b', 'GPT OSS 120B', []],
		['gpt-4o', 'gpt~o', 'GPT-4o', [4]],
		['deepseek-v4.1-flash', 'deepseek-flash~v', 'DeepSeek V4.1 Flash', [4, 1]],
		['DeepSeek-V4.1-Flash', 'deepseek-flash~v', 'DeepSeek V4.1 Flash', [4, 1]],
		['deepseek-v4-pro-0813', 'deepseek-pro~v', 'DeepSeek V4 Pro (0813)', [4], '0813'],
		['glm-5.3-flash', 'glm-flash', 'GLM-5.3 Flash', [5, 3]],
		['zai-glm-5-2', 'glm', 'GLM-5.2', [5, 2]],
		['kimi-k3', 'kimi~k', 'Kimi K3', [3]],
		['kimi-k2.7', 'kimi~k', 'Kimi K2.7', [2, 7]],
		['minimax-m2.7', 'minimax~m', 'MiniMax M2.7', [2, 7]],
		['qwen3.8-max-0902', 'qwen-max', 'Qwen3.8 Max (0902)', [3, 8], '0902'],
		['qwen3.7-max-2026-06-08', 'qwen-max', 'Qwen3.7 Max (2026-06-08)', [3, 7], '2026-06-08'],
		['qwen-3-7-plus', 'qwen-plus', 'Qwen 3.7 Plus', [3, 7]],
		['grok-4.20-0309-reasoning', 'grok-reasoning', 'Grok 4.20 Reasoning (0309)', [4, 20], '0309'],
		['mistral-medium-latest', 'mistral-medium', 'Mistral Medium', []],
		['mistral-large-2411', 'mistral-large', 'Mistral Large (2411)', [], '2411'],
		['llama-3.3-70b-versatile', 'llama-70b-versatile', 'Llama 3.3 70B Versatile', [3, 3]],
		['openai/gpt-5.6-sol', 'gpt-sol', 'GPT-5.6 Sol', [5, 6]],
		['deepseek-v4-flash-vision-exp', 'deepseek-flash-vision~v', 'DeepSeek V4 Flash Vision (exp)', [4]],
		['codex-auto-review', 'codex-auto-review', 'Codex Auto Review', []],
		['o3-mini', 'o3-mini', 'o3 Mini', []],
		['auto', 'auto', 'Auto', []]
	];
	it.each(cases)('%s', (id, family, name, version, date = '') => {
		expect(parseId(id)).toMatchObject({ family, name, version, date });
	});

	it('marks pre-releases', () => {
		expect(parseId('gemini-3-pro-preview').preview).toBe(true);
		expect(parseId('gemini-3-pro').preview).toBe(false);
	});
});

describe('compareVersion', () => {
	const v = (id: string) => parseId(id);
	it('orders by numbers, not text', () => {
		expect(compareVersion(v('grok-4.20'), v('grok-4.6'))).toBeGreaterThan(0);
		expect(compareVersion(v('claude-opus-5-5'), v('claude-opus-5'))).toBeGreaterThan(0);
		expect(compareVersion(v('claude-opus-4-8'), v('claude-opus-5'))).toBeLessThan(0);
	});
	it('puts a dated snapshot below the undated name', () => {
		expect(compareVersion(v('deepseek-v4-pro-0813'), v('deepseek-v4-pro'))).toBeLessThan(0);
		expect(compareVersion(v('qwen3.8-max-0902'), v('qwen3.8-max-0801'))).toBeGreaterThan(0);
	});
});

describe('vendorOf', () => {
	it.each([
		['claude-sonnet-5', 'anthropic'],
		['gpt-6-luna', 'openai'],
		['codex-auto-review', 'openai'],
		['o3-mini', 'openai'],
		['gemini-3.7-flash', 'google'],
		['grok-4.6', 'xai'],
		['deepseek-v4.1-flash', 'deepseek'],
		['glm-5.3', 'zhipu'],
		['zai-glm-5-2', 'zhipu'],
		['kimi-k3', 'moonshot'],
		['qwen3.8-max-0902', 'qwen'],
		['minimax-m2.7', 'minimax'],
		['doubao-seed-2', 'bytedance'],
		['auto', 'lynshen'],
		['openai/gpt-oss-120b', 'openai'],
		['llama-3.3-70b-versatile', 'meta'],
		['mystery-model', 'other']
	])('%s → %s', (id, vendor) => {
		expect(vendorOf(id).key).toBe(vendor);
	});
	it('knows the Chinese makers', () => {
		expect(vendorOf('glm-5.3').domestic).toBe(true);
		expect(vendorOf('claude-opus-5').domestic).toBeFalsy();
	});
});

describe('capabilities from the id', () => {
	it('reads stored modalities first', () => {
		expect(readsImages('deepseek-v4-pro', ['text', 'image'])).toBe(true);
		expect(readsImages('claude-opus-5', ['text'])).toBe(false);
	});
	it('knows the families that read images', () => {
		expect(readsImages('claude-opus-4-8')).toBe(true);
		expect(readsImages('gpt-5.6-sol')).toBe(true);
		expect(readsImages('deepseek-v4-flash-vision-exp')).toBe(true);
		expect(readsImages('glm-4.5v')).toBe(true);
		expect(readsImages('deepseek-v4.1-flash')).toBe(false);
		expect(readsImages('gpt-oss-120b')).toBe(false);
		expect(readsImages('gpt-image-2')).toBe(false);
	});
	it('tells image makers, small models and thinking', () => {
		expect(drawsImages('gpt-image-2')).toBe(true);
		expect(drawsImages('grok-imagine-image')).toBe(true);
		expect(drawsImages('gpt-6-sol')).toBe(false);
		expect(looksCheap('glm-5.3-flash')).toBe(true);
		expect(looksCheap('claude-haiku-4-5-20251001')).toBe(true);
		expect(looksCheap('claude-opus-5')).toBe(false);
		expect(thinks(['none', 'low', 'high'])).toBe(true);
		expect(thinks(['none'])).toBe(false);
		expect(thinks(undefined)).toBe(false);
	});
});
