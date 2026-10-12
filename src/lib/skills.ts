// Pure logic for Settings → 技能 and 插件: filtering and grouping the skills
// an engine lists, the load-problem summary, the marketplace filters and the
// plugins other coding agents have. Framework-free so it is unit-testable.

import type { ImportScan, ImportSource, InstalledSkill, MarketSkill, SkillList, SkillProblem, SkillScope } from './protocol';

/** Group order on the page: the engine's own folder, the shared one, the project's. */
export const SCOPES: SkillScope[] = ['user', 'shared', 'project'];

/** Skills whose name, description or folder contains the query (case-insensitive). */
export function filterSkills(skills: InstalledSkill[], query: string): InstalledSkill[] {
	const q = query.trim().toLowerCase();
	if (!q) return skills;
	return skills.filter((s) => `${s.name}\n${s.description}\n${s.path}`.toLowerCase().includes(q));
}

export interface ScopeGroup {
	scope: SkillScope;
	skills: InstalledSkill[];
}

/** Skills per scope in SCOPES order, by name within one; empty scopes left out. */
export function groupSkills(skills: InstalledSkill[]): ScopeGroup[] {
	const byName = (a: InstalledSkill, b: InstalledSkill) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.path.localeCompare(b.path);
	return SCOPES.map((scope) => ({ scope, skills: skills.filter((s) => s.scope === scope).sort(byName) })).filter(
		(g) => g.skills.length > 0
	);
}

/** How many skills are switched on, of all listed. */
export function enabledCount(skills: InstalledSkill[]): number {
	return skills.filter((s) => s.enabled).length;
}

export function problemCounts(problems: SkillProblem[]): { errors: number; warnings: number } {
	const errors = problems.filter((p) => p.level === 'error').length;
	return { errors, warnings: problems.length - errors };
}

/** Errors first, then by path, so the list reads the same on every refresh. */
export function sortProblems(problems: SkillProblem[]): SkillProblem[] {
	return [...problems].sort((a, b) => (a.level === b.level ? a.path.localeCompare(b.path) : a.level === 'error' ? -1 : 1));
}

/** The list with one skill switched, before the engine confirms it. */
export function withEnabled(list: SkillList, path: string, enabled: boolean): SkillList {
	return { ...list, skills: list.skills.map((s) => (s.path === path ? { ...s, enabled } : s)) };
}

/** The list without one skill (deleted). */
export function without(list: SkillList, path: string): SkillList {
	return { ...list, skills: list.skills.filter((s) => s.path !== path) };
}

/** A new skill's name, as the Agent Skills format and `skill_create` take it. */
export function validSkillName(name: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) && name.length <= 64;
}

/** `Code Review` → `code-review`: a name suggestion from free text. */
export function skillNameFrom(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 64)
		.replace(/-+$/, '');
}

/** The home folder, from the personal skills folder the daemon names
 *  (`<home>/.lynshen/skills` or `<home>/.claude/skills`); '' when unknown. */
export function homeOf(list: Pick<SkillList, 'dirs'>): string {
	const user = list.dirs.find((d) => d.scope === 'user')?.path ?? '';
	const m = user.match(/^(.*?)[\\/]\.(?:lynshen|claude)[\\/]skills[\\/]?$/);
	return m ? m[1] : '';
}

/** `path` with the home folder shown as `~`. */
export function tildePath(path: string, home: string): string {
	if (!home || !path.startsWith(home)) return path;
	const rest = path.slice(home.length);
	return rest === '' || /^[\\/]/.test(rest) ? `~${rest}` : path;
}

/** The other skill a `duplicate` problem names (`same name as <path>`). */
export function duplicateOf(message: string): string {
	return message.replace(/^same name as /, '');
}

// ---------- marketplace ----------

export const marketKey = (s: MarketSkill) => `${s.source}:${s.id}`;

export interface MarketFilter {
	query: string;
	/** 'all', 'installed' or a source key (`anthropic`, `owner/repo`). */
	source: string;
	/** A tag, or '' for every tag. */
	tag: string;
}

export function filterMarket(skills: MarketSkill[], f: MarketFilter): MarketSkill[] {
	const q = f.query.trim().toLowerCase();
	return skills.filter((s) => {
		if (q && !`${s.name}\n${s.description}\n${s.id}\n${s.tags.join(' ')}`.toLowerCase().includes(q)) return false;
		if (f.tag && !s.tags.includes(f.tag)) return false;
		if (f.source === 'installed') return s.installed;
		return f.source === 'all' || s.source === f.source;
	});
}

export interface MarketSource {
	key: string;
	name: string;
	count: number;
}

/** The catalog's sources in its order (Anthropic first), with their sizes. */
export function marketSources(skills: MarketSkill[]): MarketSource[] {
	const out = new Map<string, MarketSource>();
	for (const s of skills) {
		const known = out.get(s.source);
		if (known) known.count++;
		else out.set(s.source, { key: s.source, name: s.sourceName || s.source, count: 1 });
	}
	return [...out.values()];
}

/** Tags of the skills a source filter shows, most used first. */
export function marketTags(skills: MarketSkill[], source: string): string[] {
	const counts = new Map<string, number>();
	for (const s of skills) {
		if (source !== 'all' && source !== 'installed' && s.source !== source) continue;
		if (source === 'installed' && !s.installed) continue;
		for (const tag of s.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
	}
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([tag]) => tag);
}

// ---------- plugins of other agents ----------

export interface ForeignPlugin {
	source: ImportSource;
	name: string;
	skills: string[];
	mcp: string[];
	/** Skills and servers of it LynShen does not have yet. */
	importable: number;
}

/** An MCP server's `from` names a plugin, not a project folder (absolute) or
 *  the tool's own settings (empty). */
const pluginOrigin = (from: string) => !!from && !/^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(from);

/** The plugins an import scan found, with the skills and MCP servers each brings. */
export function foreignPlugins(scan: ImportScan): ForeignPlugin[] {
	const out = new Map<string, ForeignPlugin>();
	const get = (source: ImportSource, name: string) => {
		const key = `${source}:${name}`;
		let p = out.get(key);
		if (!p) out.set(key, (p = { source, name, skills: [], mcp: [], importable: 0 }));
		return p;
	};
	for (const s of scan.skills) {
		if (!s.plugin) continue;
		const p = get(s.source, s.plugin);
		p.skills.push(s.name);
		if (!s.present) p.importable++;
	}
	for (const m of scan.mcp) {
		if (!pluginOrigin(m.from)) continue;
		const p = get(m.source, m.from);
		p.mcp.push(m.name);
		if (!m.present) p.importable++;
	}
	return [...out.values()].sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name));
}
