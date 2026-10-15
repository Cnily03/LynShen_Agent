// The order of the pickers' lists: the quick switcher's few rows
// (favorites, recently used, the plan's recommendations) and the full
// browser's vendor sections, each family's current versions with the
// older ones folded under 更多版本.

import { compareVersion, VENDOR_ORDER } from './derive';
import type { PickItem } from './catalog';
import { searchModels } from './search';

export type QuickSection = 'favorite' | 'recent' | 'recommended';

export interface QuickRow {
	item: PickItem;
	section: QuickSection;
}

export interface QuickOptions {
	/** Item keys the user pinned, in pin order. */
	favorites: string[];
	/** Item keys picked lately, newest first. */
	recent: string[];
	/** The account is on the trial plan: domestic models lead its recommendations. */
	trial?: boolean;
	limit?: number;
}

/** Recommended order: what the plan pays for, then (trial) the domestic
 *  models, then the catalog's own order. */
function recommendedOrder(items: PickItem[], trial: boolean): PickItem[] {
	const planKnown = items.some((i) => i.inPlan !== undefined);
	const rank = (i: PickItem) => [planKnown && !i.inPlan ? 1 : 0, trial && !i.domestic ? 1 : 0, i.recommended ?? 0];
	return items
		.filter((i) => i.recommended !== undefined)
		.sort((a, b) => {
			const [x, y] = [rank(a), rank(b)];
			return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
		});
}

/**
 * The quick switcher's rows, about eight: the favorites, then the models used
 * lately (the one in use first), then the plan's recommendations that work.
 * Without recommendations (a custom provider, Claude Code) the rest of the
 * list fills in, in its own order. The model in use always shows.
 */
export function quickList(items: PickItem[], opts: QuickOptions): QuickRow[] {
	const limit = opts.limit ?? 8;
	const byKey = new Map(items.map((i) => [i.key, i]));
	const rows: QuickRow[] = [];
	const taken = new Set<string>();
	const add = (item: PickItem | undefined, section: QuickSection) => {
		if (!item || taken.has(item.key) || rows.length >= limit) return;
		taken.add(item.key);
		rows.push({ item, section });
	};
	for (const key of opts.favorites) add(byKey.get(key), 'favorite');
	const active = items.find((i) => i.active);
	if (active && !taken.has(active.key)) {
		// Room for the model in use, even past a long list of favorites.
		if (rows.length >= limit) taken.delete(rows.pop()!.item.key);
		add(active, 'recent');
	}
	for (const key of opts.recent) {
		const item = byKey.get(key);
		if (item && !item.drawsImages) add(item, 'recent');
	}
	const usable = items.filter((i) => i.health !== 'down' && !i.drawsImages);
	for (const item of recommendedOrder(usable, !!opts.trial)) add(item, 'recommended');
	if (!items.some((i) => i.recommended !== undefined)) for (const item of usable) add(item, 'recommended');
	return rows;
}

/** One model line in a vendor section. */
export interface BrowseFamily {
	key: string;
	/** The versions shown: the current ones, newest first. */
	shown: PickItem[];
	/** Older versions, under 更多版本. */
	more: PickItem[];
}

export interface BrowseSection {
	vendor: string;
	/** The vendor's catalog name, when the catalog sends one. */
	vendorName?: string;
	families: BrowseFamily[];
}

const down = (i: PickItem) => (i.health === 'down' ? 1 : 0);
const vendorRank = (vendor: string) => {
	const at = VENDOR_ORDER.indexOf(vendor);
	return at < 0 ? VENDOR_ORDER.length : at;
};

/** Splits a family into the versions shown and the ones folded: the catalog's
 *  current versions show; without a lifecycle (derived) only the newest. */
export function foldFamily(members: PickItem[]): { shown: PickItem[]; more: PickItem[] } {
	const sorted = [...members].sort((a, b) => -compareVersion(a, b) || a.name.localeCompare(b.name));
	const known = sorted.some((m) => m.legacy !== undefined);
	let shown = known ? sorted.filter((m) => !m.legacy) : sorted.slice(0, 1);
	if (!shown.length) shown = sorted.slice(0, 1);
	const more = sorted.filter((m) => !shown.includes(m));
	// A current version that does not work goes after the ones that do.
	return { shown: [...shown.filter((m) => !down(m)), ...shown.filter(down)], more };
}

function sectionOrder(sections: BrowseSection[], trial: boolean, best: (s: BrowseSection) => number): BrowseSection[] {
	return sections.sort(
		(a, b) =>
			(trial ? Number(!a.families[0]?.shown[0]?.domestic) - Number(!b.families[0]?.shown[0]?.domestic) : 0) ||
			best(a) - best(b) ||
			vendorRank(a.vendor) - vendorRank(b.vendor) ||
			a.vendor.localeCompare(b.vendor)
	);
}

/**
 * The full browser's sections: one per vendor, one entry per family (and
 * provider: the same model through two providers is two lines). Families
 * that do not work go last in their section, then by the plan's
 * recommendations, then newest first.
 */
export function browseSections(items: PickItem[], opts: { trial?: boolean } = {}): BrowseSection[] {
	const families = new Map<string, PickItem[]>();
	for (const item of items) {
		const key = `${item.provider ?? ''}|${item.family}`;
		families.set(key, [...(families.get(key) ?? []), item]);
	}
	const sections = new Map<string, BrowseSection>();
	for (const [key, members] of families) {
		const { shown, more } = foldFamily(members);
		const vendor = shown[0].vendor;
		const section = sections.get(vendor) ?? { vendor, ...(shown[0].vendorName ? { vendorName: shown[0].vendorName } : {}), families: [] };
		section.families.push({ key, shown, more });
		sections.set(vendor, section);
	}
	const rec = (f: BrowseFamily) => Math.min(...f.shown.map((i) => i.recommended ?? 1e9));
	for (const section of sections.values()) {
		// A family none of whose versions works goes last (its first shown is then down).
		section.families.sort(
			(a, b) =>
				down(a.shown[0]) - down(b.shown[0]) ||
				rec(a) - rec(b) ||
				-compareVersion(a.shown[0], b.shown[0]) ||
				a.shown[0].name.localeCompare(b.shown[0].name)
		);
	}
	return sectionOrder([...sections.values()], !!opts.trial, (s) => Math.min(...s.families.map(rec)));
}

/** The browser's sections for a query: every matching version on its own
 *  line (nothing folded), sections ordered by their best match. */
export function searchSections(items: PickItem[], query: string): BrowseSection[] {
	const hits = searchModels(items, query);
	const sections = new Map<string, BrowseSection & { best: number }>();
	hits.forEach(({ item }, rank) => {
		const section = sections.get(item.vendor) ?? {
			vendor: item.vendor,
			...(item.vendorName ? { vendorName: item.vendorName } : {}),
			families: [],
			best: rank
		};
		section.families.push({ key: item.key, shown: [item], more: [] });
		sections.set(item.vendor, section);
	});
	return [...sections.values()].sort((a, b) => a.best - b.best).map(({ best: _, ...s }) => s);
}

/** One line of the browser's list: a vendor heading, a model, or a family's
 *  更多版本 toggle. Headings are not stops for the arrow keys. */
export type BrowseLine =
	| { kind: 'vendor'; key: string; section: BrowseSection }
	| { kind: 'model'; key: string; item: PickItem; folded: boolean }
	| { kind: 'more'; key: string; family: BrowseFamily; open: boolean };

/** The sections as lines, with the families in `open` unfolded. */
export function browseLines(sections: BrowseSection[], open: Set<string>): BrowseLine[] {
	const lines: BrowseLine[] = [];
	for (const section of sections) {
		lines.push({ kind: 'vendor', key: `v:${section.vendor}`, section });
		for (const family of section.families) {
			for (const item of family.shown) lines.push({ kind: 'model', key: item.key, item, folded: false });
			if (!family.more.length) continue;
			const unfolded = open.has(family.key);
			if (unfolded) for (const item of family.more) lines.push({ kind: 'model', key: item.key, item, folded: true });
			lines.push({ kind: 'more', key: `m:${family.key}`, family, open: unfolded });
		}
	}
	return lines;
}

/** The families to show unfolded at first: the one whose folded version is in use. */
export function openAtFirst(sections: BrowseSection[]): Set<string> {
	return new Set(sections.flatMap((s) => s.families).filter((f) => f.more.some((i) => i.active)).map((f) => f.key));
}
