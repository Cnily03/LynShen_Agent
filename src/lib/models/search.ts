// Finding a model by what people type: its name, id, aliases and vendor, a
// version ("4.8"), or a plain word for what it is ("便宜", "国产", "看图").

import { VENDORS } from './derive';
import type { PickItem } from './catalog';
import { outputCny } from './price';

/** Words that mean a property, in Chinese and English. */
const TAG_WORDS = {
	domestic: ['国产', '国内', '国模', '中国', 'domestic', 'china', 'chinese'],
	vision: ['看图', '识图', '读图', '图片', '图像', '视觉', '多模态', 'vision', 'image', 'images', 'multimodal'],
	reasoning: ['思考', '推理', '深度思考', 'reasoning', 'thinking', 'think'],
	drawsImages: ['画图', '生图', '绘图', '作图', '生成图片', '图片生成', 'draw', 'drawing'],
	cheap: ['便宜', '低价', '实惠', '省钱', '划算', '性价比', 'cheap', 'budget'],
	inPlan: ['套餐', '套餐内', '体验', 'plan', 'included'],
	long: ['长上下文', '超长', 'long'],
	auto: ['自动', 'auto']
};
/** Words a Chinese query wraps around what it asks for ("能看图的模型"). */
const FILLER = /模型|的|能|可以|支持|用|一些|有|哪些|吗/g;

const CJK = /[㐀-鿿]/;

/** The Chinese words a query can hold without spaces, longest first. */
const VOCABULARY = [
	...new Set([
		...Object.values(TAG_WORDS).flat(),
		...Object.values(VENDORS).flatMap((v) => [v.zh ?? '', ...(v.words ?? [])])
	])
]
	.filter((w) => CJK.test(w))
	.sort((a, b) => b.length - a.length);

export const normalize = (s: string) => s.normalize('NFKC').toLowerCase().trim();
/** Without separators: "gpt5" finds gpt-5.6-sol, "opus48" finds claude-opus-4-8. */
const compact = (s: string) => s.replace(/[\s\-_.]+/g, '');

interface Haystack {
	/** Name, id and aliases, normalized. */
	names: string[];
	/** Their words ("claude", "opus", "4.8"). */
	words: string[];
	/** Their compact forms. */
	compacts: string[];
	/** Vendor names and property words. */
	tags: string[];
}

const cache = new WeakMap<PickItem, Haystack>();

/** An id with claude-style version digits read as a version: claude-opus-4.8. */
const dotted = (id: string) => id.replace(/(\d)-(?=\d(\D|$))/g, '$1.');

function haystack(item: PickItem, cheapest: boolean): Haystack {
	const cached = cache.get(item);
	if (cached) return cached;
	const names = [...new Set([item.name, item.id, dotted(item.id), ...item.aliases].map(normalize))];
	const words = [...new Set(names.flatMap((n) => n.split(/[\s\-_/()]+/)).filter(Boolean))];
	const vendor = VENDORS[item.vendor];
	const tags = [
		item.vendor,
		item.vendorName ?? '',
		vendor?.name ?? '',
		vendor?.zh ?? '',
		...(vendor?.words ?? []),
		...item.keywords,
		...(item.domestic ? TAG_WORDS.domestic : []),
		...(item.vision ? TAG_WORDS.vision : []),
		...(item.reasoning ? TAG_WORDS.reasoning : []),
		...(item.drawsImages ? TAG_WORDS.drawsImages : []),
		...(cheapest ? TAG_WORDS.cheap : []),
		...(item.inPlan ? TAG_WORDS.inPlan : []),
		...((item.context ?? 0) >= 1_000_000 ? TAG_WORDS.long : []),
		...(item.vendor === 'lynshen' ? TAG_WORDS.auto : []),
		...(item.providerName ? [item.providerName] : [])
	]
		.map(normalize)
		.filter(Boolean);
	const hay = { names, words, compacts: names.map(compact), tags };
	cache.set(item, hay);
	return hay;
}

/** How well one query word matches: 0 not at all, higher is better. */
function wordScore(token: string, hay: Haystack): number {
	if (hay.names.some((n) => n === token)) return 6;
	if (hay.names.some((n) => n.startsWith(token))) return 5;
	if (hay.words.some((w) => w === token)) return 4;
	if (hay.words.some((w) => w.startsWith(token))) return 3;
	if (hay.names.some((n) => n.includes(token))) return 2;
	const flat = compact(token);
	if (flat && hay.compacts.some((c) => c.includes(flat))) return 2;
	if (hay.tags.some((tag) => tag === token || (token.length > 1 && tag.startsWith(token)))) return 1;
	// "国产模型", "能看图的国产": Chinese without spaces, holding property or
	// vendor words; the model must have each of them.
	if (CJK.test(token)) {
		let rest = token.replace(FILLER, '');
		if (!rest) return 1;
		const found: string[] = [];
		for (const word of VOCABULARY) {
			if (!rest.includes(word)) continue;
			found.push(word);
			rest = rest.split(word).join('');
		}
		if (!found.length) return hay.tags.some((tag) => tag.includes(rest)) || hay.names.some((n) => n.includes(rest)) ? 1 : 0;
		if (!found.every((word) => hay.tags.includes(word))) return 0;
		return !rest || hay.tags.some((tag) => tag.includes(rest)) || hay.names.some((n) => n.includes(rest)) ? 1 : 0;
	}
	return 0;
}

/** The priced items that cost at most a quarter of the typical (median)
 *  output price, or, without prices, the small fast lines (flash, mini,
 *  haiku …). */
export function cheapKeys(items: PickItem[]): Set<string> {
	const priced = items.filter((i) => i.price && !i.drawsImages);
	if (!priced.length) return new Set(items.filter((i) => i.cheap).map((i) => i.key));
	const cost = (i: PickItem) => outputCny(i.price!);
	const sorted = priced.map(cost).sort((a, b) => a - b);
	const mid = sorted.length / 2;
	const median = sorted.length % 2 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2;
	return new Set(priced.filter((i) => cost(i) <= median / 4).map((i) => i.key));
}

export interface SearchHit {
	item: PickItem;
	score: number;
}

/**
 * The items every word of the query matches, best first. Words are split on
 * spaces; each must match the name, id, an alias, the vendor or a property
 * word. Ties go to models that work, then to the recommended, then to newer
 * versions.
 */
export function searchModels(items: PickItem[], query: string): SearchHit[] {
	const q = normalize(query);
	if (!q) return [];
	const tokens = q.split(/\s+/).filter(Boolean);
	const cheap = cheapKeys(items);
	const hits: SearchHit[] = [];
	for (const item of items) {
		const hay = haystack(item, cheap.has(item.key));
		let score = 0;
		for (const token of tokens) {
			const s = wordScore(token, hay);
			if (!s) {
				score = 0;
				break;
			}
			score += s;
		}
		if (score) hits.push({ item, score: score / tokens.length });
	}
	return hits.sort(
		(a, b) =>
			b.score - a.score ||
			Number(a.item.health === 'down') - Number(b.item.health === 'down') ||
			Number(!a.item.inPlan) - Number(!b.item.inPlan) ||
			(a.item.recommended ?? 1e9) - (b.item.recommended ?? 1e9) ||
			b.item.version.join('.').localeCompare(a.item.version.join('.'), undefined, { numeric: true }) ||
			a.item.name.localeCompare(b.item.name)
	);
}
