// Test data: a catalog body as the gateway sends it (contract MC-API v1) for a
// trial account, with the cases the pickers must handle (legacy versions, an
// unavailable and an unstable model, aliases, a model the admin has not
// described, an image model). Used by the unit tests and the browser fixture
// (tests/browser/main.ts); the app does not import it.

const cny = (input: number, output: number) => ({
	group: '默认',
	multiplier: '1',
	input_per_1m: { cny: String(input), usd: (input / 7.1).toFixed(6) },
	output_per_1m: { cny: String(output), usd: (output / 7.1).toFixed(6) },
	cache_read_per_1m: null,
	varies_by_route: false
});
const health = (state: string, attempts = 600, ok = 590) => ({
	state,
	attempts_2h: attempts,
	successes_2h: ok,
	success_rate_2h: attempts ? (ok / attempts).toFixed(4) : null,
	attempts_24h: attempts * 10,
	successes_24h: ok * 10,
	success_rate_24h: attempts ? (ok / attempts).toFixed(4) : null,
	last_success_at: ok ? '2026-10-15T06:41:12Z' : null
});
const caps = (context: number, image: boolean, reasoning: boolean, efforts: string[] = reasoning ? ['low', 'medium', 'high'] : []) => ({
	context_window: context,
	context_total: null,
	max_output_tokens: 64000,
	image_input: image,
	reasoning,
	effort_levels: efforts
});
interface Row {
	id: string;
	name: string;
	vendor: [string, string] | null;
	family: string | null;
	order: number;
	lifecycle?: 'current' | 'legacy';
	recommended?: boolean;
	aliases?: string[];
	request?: string;
	caps: ReturnType<typeof caps>;
	health: ReturnType<typeof health>;
	price: ReturnType<typeof cny> | null;
	covered: boolean;
	auto?: string;
	kind?: 'chat' | 'image';
}
const row = (r: Row) => ({
	id: r.id,
	request_model: r.request ?? r.id,
	display_name: r.name,
	vendor: r.vendor ? { id: r.vendor[0], name: r.vendor[1] } : null,
	family: r.family,
	version_order: r.order,
	lifecycle: r.lifecycle ?? 'current',
	recommended: r.recommended ?? false,
	cataloged: r.vendor !== null,
	kind: r.kind ?? 'chat',
	auto_target: r.auto ?? null,
	aliases: r.aliases ?? [],
	capabilities: r.caps,
	health: r.health,
	price: r.price,
	covered_by_plan: r.covered
});

const ANTHROPIC: [string, string] = ['anthropic', 'Anthropic'];
const OPENAI: [string, string] = ['openai', 'OpenAI'];

export const SAMPLE_CATALOG = {
	schema_version: 1,
	generated_at: '2026-10-15T07:12:30Z',
	cny_per_usd: '7.1',
	plan: { active: true, name: '体验套餐', trial: true, plan_funding: 'plan' },
	health_policy: { short_window_seconds: 7200, long_window_seconds: 86400, min_attempts: 5, unavailable_min_attempts_long: 3, degraded_below: '0.8', computed_at: '2026-10-15T07:12:01Z' },
	models: [
		row({ id: 'auto', name: 'Auto', vendor: ['lynshen', 'LynShen'], family: null, order: 0, recommended: true, auto: 'claude-opus-5-5', caps: caps(1000000, true, true), health: health('ok'), price: cny(35.5, 177.5), covered: false }),
		row({ id: 'claude-opus-5-5', name: 'Claude Opus 5.5', vendor: ANTHROPIC, family: 'Claude Opus', order: 5500, recommended: true, caps: caps(1000000, true, true), health: health('ok'), price: cny(35.5, 177.5), covered: false }),
		row({ id: 'claude-opus-5', name: 'Claude Opus 5', vendor: ANTHROPIC, family: 'Claude Opus', order: 5000, lifecycle: 'legacy', caps: caps(1000000, true, true), health: health('ok'), price: cny(35.5, 177.5), covered: false }),
		row({ id: 'claude-opus-4-8', name: 'Claude Opus 4.8', vendor: ANTHROPIC, family: 'Claude Opus', order: 4800, lifecycle: 'legacy', caps: caps(200000, true, true), health: health('ok'), price: cny(106.5, 532.5), covered: false }),
		row({ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (1M context, extended thinking)', vendor: ANTHROPIC, family: 'Claude Sonnet', order: 5500, recommended: true, caps: caps(1000000, true, true), health: health('degraded', 600, 420), price: cny(21.3, 106.5), covered: false }),
		row({ id: 'claude-sonnet-5', name: 'Claude Sonnet 5', vendor: ANTHROPIC, family: 'Claude Sonnet', order: 5000, lifecycle: 'legacy', caps: caps(1000000, true, true), health: health('degraded', 100, 44), price: cny(21.3, 106.5), covered: false }),
		row({ id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol', vendor: OPENAI, family: 'GPT Sol', order: 6100, caps: caps(1050000, true, true), health: health('unavailable', 820, 0), price: cny(8.9, 71), covered: false }),
		row({ id: 'gpt-6-sol', name: 'GPT-6 Sol', vendor: OPENAI, family: 'GPT Sol', order: 6000, recommended: true, caps: caps(1050000, true, true), health: health('ok'), price: cny(8.9, 71), covered: false }),
		row({ id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', vendor: OPENAI, family: 'GPT Sol', order: 5600, lifecycle: 'legacy', caps: caps(1050000, true, true), health: health('ok'), price: cny(8.9, 71), covered: false }),
		row({ id: 'gpt-5.5', name: 'GPT-5.5', vendor: OPENAI, family: 'GPT', order: 5500, lifecycle: 'legacy', caps: caps(400000, true, true), health: health('unavailable', 547, 0), price: cny(8.9, 71), covered: false }),
		row({ id: 'gpt-image-2', name: 'GPT Image 2', vendor: OPENAI, family: 'GPT Image', order: 2000, kind: 'image', caps: caps(0, true, false), health: health('ok'), price: null, covered: false }),
		row({ id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', vendor: ['deepseek', 'DeepSeek'], family: 'DeepSeek V4', order: 4100, recommended: true, aliases: ['DeepSeek-V4.1-Flash', 'deepseek-v4.1-flash-0910'], caps: caps(384000, false, true), health: health('ok', 658, 656), price: cny(1, 2), covered: true }),
		row({ id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', vendor: ['deepseek', 'DeepSeek'], family: 'DeepSeek V4', order: 4000, lifecycle: 'legacy', aliases: ['deepseek-v4-pro-0813'], caps: caps(128000, false, true), health: health('ok'), price: cny(4, 16), covered: true }),
		row({ id: 'glm-5.3', name: 'GLM-5.3', vendor: ['zhipu', '智谱'], family: 'GLM', order: 5300, recommended: true, request: 'ZhipuAi/GLM-5.3', aliases: ['ZhipuAi/GLM-5.3'], caps: caps(128000, false, true), health: health('ok'), price: cny(4, 16), covered: true }),
		row({ id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', vendor: ['zhipu', '智谱'], family: 'GLM Flash', order: 5300, caps: caps(128000, false, false), health: health('ok'), price: cny(0.5, 1), covered: true }),
		row({ id: 'kimi-k3', name: 'Kimi K3', vendor: ['moonshot', 'Kimi'], family: 'Kimi K', order: 3000, recommended: true, caps: caps(256000, true, true), health: health('ok'), price: cny(4, 21), covered: true }),
		row({ id: 'gemini-3.7-flash', name: 'Gemini 3.7 Flash', vendor: ['google', 'Google'], family: 'Gemini Flash', order: 3700, caps: caps(1048576, true, true), health: health('unknown', 1, 0), price: cny(2.1, 17.8), covered: false }),
		row({ id: 'mystery-x-2', name: 'mystery-x-2', vendor: null, family: null, order: 0, caps: caps(32000, false, false), health: health('unknown', 0, 0), price: null, covered: false })
	]
};

/** The same account's plain list (`/api/desktop/oauth/models`), as an older
 *  gateway answers: ids only, two spellings of one model, no names. */
export const SAMPLE_PLAIN_IDS = [
	'auto', 'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5-5', 'claude-sonnet-5', 'gpt-6.1-sol',
	'gpt-6-sol', 'gpt-5.6-sol', 'gpt-5.5', 'gpt-image-2', 'deepseek-v4.1-flash', 'DeepSeek-V4.1-Flash', 'deepseek-v4-pro',
	'glm-5.3', 'glm-5.3-flash', 'kimi-k3', 'gemini-3.7-flash', 'mystery-x-2'
];
