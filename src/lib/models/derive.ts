// What a model id says about itself, for providers that send nothing else
// (an older gateway's /v1/models, Claude Code, Codex, custom providers): the
// vendor, the family, the version, a readable name and the capabilities the
// name or the stored entry shows. The gateway catalog replaces all of this
// where it answers (catalog.ts).

/** A model maker, as the browser groups models. */
export interface VendorInfo {
	key: string;
	/** English name; `zh` when Chinese readers know it by another name. */
	name: string;
	zh?: string;
	/** A Chinese maker (the "国产" keyword, the trial plan's first choice). */
	domestic?: boolean;
	/** More words a search may use for it. */
	words?: string[];
}

/** First match wins. Ids are matched lower-case, without a `vendor/` prefix. */
const VENDOR_RULES: [RegExp, VendorInfo][] = [
	[/^(auto|lynshen)(\b|$)/, { key: 'lynshen', name: 'LynShen', words: ['自动', 'auto'] }],
	[/claude|^(opus|sonnet|haiku|fable)(\b|$)/, { key: 'anthropic', name: 'Anthropic', words: ['claude'] }],
	[/(^|[^a-z])(gpt|chatgpt|codex|dall-e|whisper|sora)|^o[1-9](\b|$)/, { key: 'openai', name: 'OpenAI', words: ['gpt'] }],
	[/gemini|gemma|imagen|^veo/, { key: 'google', name: 'Google', zh: '谷歌', words: ['gemini'] }],
	[/grok/, { key: 'xai', name: 'xAI', words: ['grok'] }],
	[/deepseek/, { key: 'deepseek', name: 'DeepSeek', zh: '深度求索', domestic: true }],
	[/glm|zhipu|cogview|^z-?ai(\b|$)/, { key: 'zhipu', name: 'Zhipu', zh: '智谱', domestic: true, words: ['glm', 'z.ai'] }],
	[/kimi|moonshot/, { key: 'moonshot', name: 'Moonshot', zh: '月之暗面', domestic: true, words: ['kimi'] }],
	[/qwen|qwq|qvq|tongyi/, { key: 'qwen', name: 'Qwen', zh: '通义千问', domestic: true, words: ['阿里', '千问', 'alibaba'] }],
	[/doubao|^seed(ream|ance)?(\b|$)/, { key: 'bytedance', name: 'ByteDance', zh: '豆包', domestic: true, words: ['字节', 'doubao'] }],
	[/minimax|abab|hailuo/, { key: 'minimax', name: 'MiniMax', domestic: true, words: ['海螺'] }],
	[/hunyuan/, { key: 'tencent', name: 'Tencent', zh: '腾讯混元', domestic: true }],
	[/ernie|wenxin/, { key: 'baidu', name: 'Baidu', zh: '文心', domestic: true }],
	[/^step(\b|-)/, { key: 'stepfun', name: 'StepFun', zh: '阶跃星辰', domestic: true }],
	[/mimo/, { key: 'xiaomi', name: 'Xiaomi', zh: '小米', domestic: true, words: ['mimo'] }],
	[/longcat/, { key: 'meituan', name: 'LongCat', zh: '美团 LongCat', domestic: true }],
	[/baichuan/, { key: 'baichuan', name: 'Baichuan', zh: '百川', domestic: true }],
	[/^yi-/, { key: 'zeroone', name: '01.AI', zh: '零一万物', domestic: true }],
	[/mistral|mixtral|codestral|ministral|magistral|devstral|pixtral/, { key: 'mistral', name: 'Mistral' }],
	[/llama/, { key: 'meta', name: 'Meta', words: ['llama'] }],
	[/command-|cohere/, { key: 'cohere', name: 'Cohere' }]
];

export const OTHER_VENDOR: VendorInfo = { key: 'other', name: 'Other', zh: '其他' };

/** Known vendors by key (the gateway catalog names them by these keys too). */
export const VENDORS: Record<string, VendorInfo> = Object.fromEntries(
	[...VENDOR_RULES.map(([, v]) => v), OTHER_VENDOR].map((v) => [v.key, v])
);

/** The order vendors take in the browser when nothing else ranks them. */
export const VENDOR_ORDER = [
	'lynshen', 'anthropic', 'openai', 'google', 'xai', 'deepseek', 'zhipu', 'moonshot', 'qwen', 'minimax',
	'bytedance', 'xiaomi', 'tencent', 'baidu', 'stepfun', 'meituan', 'baichuan', 'zeroone', 'mistral', 'meta', 'cohere'
];

/** The id without a router's `vendor/` prefix or a Claude alias suffix ("opus[1m]"). */
export function bareId(id: string): string {
	return id.trim().toLowerCase().replace(/\[[^\]]*\]$/, '').split('/').pop() ?? '';
}

export function vendorOf(id: string): VendorInfo {
	const bare = bareId(id);
	const prefix = id.includes('/') ? id.toLowerCase().split('/')[0] : '';
	return (
		VENDOR_RULES.find(([re]) => re.test(bare))?.[1] ??
		(prefix ? VENDOR_RULES.find(([re]) => re.test(prefix))?.[1] : undefined) ??
		OTHER_VENDOR
	);
}

/** Words written in capitals or with a fixed spelling. */
const SPELLING: Record<string, string> = {
	gpt: 'GPT', glm: 'GLM', oss: 'OSS', deepseek: 'DeepSeek', minimax: 'MiniMax', qwen: 'Qwen', kimi: 'Kimi',
	claude: 'Claude', gemini: 'Gemini', gemma: 'Gemma', grok: 'Grok', llama: 'Llama', ernie: 'ERNIE', vl: 'VL',
	mimo: 'MiMo', longcat: 'LongCat', doubao: 'Doubao', hunyuan: 'Hunyuan', ai: 'AI', tts: 'TTS', asr: 'ASR',
	auto: 'Auto', codex: 'Codex', api: 'API'
};
/** Vendor words that lead an id without naming the model (`zai-glm-5-2`). */
const VENDOR_PREFIXES = new Set(['zai', 'z', 'openai', 'anthropic', 'google', 'meta', 'xai', 'x', 'moonshotai', 'mistralai']);
/** Words that mark a pre-release; kept in the name, not in the family. */
const PREVIEW_WORDS = new Set(['preview', 'exp', 'experimental', 'beta', 'alpha', 'rc']);
/** Words that say nothing about the model (`mistral-medium-latest`). */
const NOISE_WORDS = new Set(['latest', 'chat', 'instruct']);

/** One model id, taken apart. */
export interface ParsedId {
	/** Family key: the words that are not the version or a date. */
	family: string;
	/** Version numbers, most significant first ([4, 8] for 4.8); [] for none. */
	version: number[];
	/** A dated snapshot (20251001, 0813, 2026-06-08), compared as text. */
	date: string;
	/** A pre-release (preview, exp, beta). */
	preview: boolean;
	/** The readable name: "Claude Opus 4.8", "GPT-5.6 Sol", "Kimi K3". */
	name: string;
}

const cap = (w: string) => SPELLING[w] ?? (w.charAt(0).toUpperCase() + w.slice(1));
const isDate = (w: string) => /^(19|20)\d{6}$/.test(w) || /^\d{4}$/.test(w);
const nums = (s: string) => s.split('.').filter(Boolean).map(Number);

/**
 * Takes an id apart: claude-opus-4-8 → family claude-opus, version 4.8;
 * gpt-6.1-sol → gpt-sol 6.1; deepseek-v4.1-flash → deepseek-flash~v 4.1;
 * kimi-k3 → kimi~k 3; qwen3.8-max-0902 → qwen-max 3.8 (0902);
 * claude-haiku-4-5-20251001 → claude-haiku 4.5 (20251001).
 */
export function parseId(id: string): ParsedId {
	const bare = bareId(id);
	const words = bare.split(/[-_\s]+/).filter(Boolean);
	const family: string[] = [];
	/** Readable parts in id order; the version is one part. */
	const parts: string[] = [];
	const version: number[] = [];
	let versionAt = -1;
	let versionDone = false;
	let prefix = '';
	let date = '';
	let preview = false;
	const startVersion = (label: string, numbers: string, mark = '') => {
		versionAt = parts.length;
		parts.push(label);
		version.push(...nums(numbers));
		if (mark) prefix = mark;
	};
	for (let i = 0; i < words.length; i++) {
		const w = words[i];
		// 2026-06-08: a date in three words.
		if (i > 0 && /^(19|20)\d{2}$/.test(w) && /^\d{2}$/.test(words[i + 1] ?? '') && /^\d{2}$/.test(words[i + 2] ?? '')) {
			date = `${w}-${words[i + 1]}-${words[i + 2]}`;
			i += 2;
			versionDone = true;
			continue;
		}
		// 20251001, 0813, 2411: a dated snapshot.
		if (i > 0 && isDate(w)) {
			date = w;
			versionDone = true;
			continue;
		}
		// "4", "5.6", "v4.1"; claude-style "4-8" continues the version.
		const plain = /^v?(\d+(?:\.\d+)*)$/.exec(w);
		if (plain && !versionDone && (!version.length || versionAt === parts.length - 1)) {
			if (!version.length) startVersion(w.startsWith('v') ? `V${plain[1]}` : plain[1], plain[1], w.startsWith('v') ? 'v' : '');
			else {
				parts[versionAt] += `.${plain[1]}`;
				version.push(...nums(plain[1]));
			}
			continue;
		}
		if (version.length) versionDone = true;
		// "70b", "120b": a size, part of the family.
		if (/^\d+(\.\d+)?[bm]$/.test(w)) {
			family.push(w);
			parts.push(w.toUpperCase());
			continue;
		}
		if (!version.length) {
			// "k3", "m2.7", "r1" after the first word: a lettered version.
			const lettered = /^([a-z])(\d+(?:\.\d+)*)$/.exec(w);
			if (lettered && i > 0) {
				startVersion(`${lettered[1].toUpperCase()}${lettered[2]}`, lettered[2], lettered[1]);
				versionDone = true;
				continue;
			}
			// "4o": a version with a letter after it.
			const suffixed = /^(\d+(?:\.\d+)*)([a-z])$/.exec(w);
			if (suffixed && i > 0) {
				startVersion(w, suffixed[1], suffixed[2]);
				versionDone = true;
				continue;
			}
			// "qwen3.8", "gpt4": a name with its version fused on.
			const fused = /^([a-z]{3,})(\d+(?:\.\d+)*)$/.exec(w);
			if (fused) {
				family.push(fused[1]);
				startVersion(`${cap(fused[1])}${fused[2]}`, fused[2]);
				continue;
			}
		}
		if (PREVIEW_WORDS.has(w)) {
			preview = true;
			parts.push(`(${w})`);
			continue;
		}
		if (NOISE_WORDS.has(w)) continue;
		if (i === 0 && VENDOR_PREFIXES.has(w) && words.length > 1) continue;
		family.push(w);
		parts.push(/^o\d$/.test(w) ? w : cap(w));
	}
	// GPT-5.6 and GLM-5.3 join the version with a hyphen, as their makers write them.
	let name = '';
	parts.forEach((part, i) => {
		const joined = i === versionAt && i > 0 && /^(GPT|GLM)$/.test(parts[i - 1]) && /^\d/.test(part);
		name += (i === 0 ? '' : joined ? '-' : ' ') + part;
	});
	if (date) name += ` (${date})`;
	return {
		family: (family.join('-') || bare) + (prefix ? `~${prefix}` : ''),
		version,
		date,
		preview,
		name: name || id
	};
}

/** Compares versions, then dates: newest first is `-compareVersion`. */
export function compareVersion(a: { version: number[]; date?: string }, b: { version: number[]; date?: string }): number {
	const n = Math.max(a.version.length, b.version.length);
	for (let i = 0; i < n; i++) {
		const d = (a.version[i] ?? 0) - (b.version[i] ?? 0);
		if (d) return d;
	}
	// A dated snapshot is older than the undated name that follows the newest.
	if ((a.date ?? '') !== (b.date ?? '')) {
		if (!a.date) return 1;
		if (!b.date) return -1;
		return a.date < b.date ? -1 : 1;
	}
	return 0;
}

/** A model that draws images and cannot chat (gpt-image-2, seedream, imagen). */
export const drawsImages = (id: string) => /image|imagen|dall-e|seedream|cogview|imagine|midjourney|flux/i.test(bareId(id));

/** Small, fast models: "便宜" in a search when no price is known. */
export const looksCheap = (id: string) => /(^|[-_.])(flash|mini|lite|nano|haiku|air|turbo|small|tiny|instant)([-_.]|$)/i.test(bareId(id));

/**
 * Whether the model reads images, as far as the stored entry or the name
 * says: `input_modalities` when the entry has them, else the families known
 * to (Claude, Gemini, GPT-4o and later, Grok 4, names with vision or VL).
 */
export function readsImages(id: string, modalities?: unknown): boolean {
	if (Array.isArray(modalities)) return modalities.includes('image');
	const bare = bareId(id);
	if (drawsImages(bare)) return false;
	if (/(^|[-_])(vision|vl|omni)([-_]|$)|\d(\.\d+)?v([-_]|$)/.test(bare)) return true;
	if (/claude|gemini|grok-4|gpt-4o|gpt-4\.1|gpt-[5-9]/.test(bare)) return !/gpt-oss|codex/.test(bare);
	return false;
}

/** A model that offers thinking efforts beyond "none". */
export const thinks = (efforts?: unknown) =>
	Array.isArray(efforts) && efforts.some((e) => typeof e === 'string' && e !== 'none');
