// Pure logic for Settings → 导入 (one-click import from the other coding
// agents): grouping what the scan found, what is picked by default, which
// MCP servers still need adding, and the summary of a run. Framework-free so
// it is unit-testable.

import type {
	ImportMcp,
	ImportOutcome,
	ImportScan,
	ImportSession,
	ImportSkill,
	ImportSkipKind,
	ImportSkipped,
	ImportSource,
	ImportUnreadable
} from './protocol';

export const SOURCES: ImportSource[] = ['claude', 'codex', 'opencode', 'zcode', 'omp', 'dsh'];

export const SOURCE_LABELS: Record<ImportSource, string> = {
	claude: 'Claude Code',
	codex: 'Codex',
	opencode: 'opencode',
	zcode: 'zcode',
	omp: 'omp',
	dsh: 'DeepSeek Harness (DSH)'
};

export const sessionKey = (s: ImportSession) => `session:${s.source}:${s.id}`;
export const skillKey = (s: ImportSkill) => `skill:${s.source}:${s.path}`;
export const mcpKey = (m: ImportMcp) => `mcp:${m.source}:${m.from}:${m.name}`;

/** Last path component (either separator). */
export function folderName(path: string): string {
	return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;
}

/** An absolute path (a project folder), not a plugin name: `/x`, `C:\x`,
 *  `C:/x` or `\\server\share`. */
export function isPath(text: string): boolean {
	return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(text);
}

/** A reason as the page words it; `store` is a whole database that did not open. */
export type SkipWhy = ImportSkipKind | 'store';

export interface SkippedGroup {
	source: ImportSource;
	/** Conversations left out. */
	count: number;
	/** A whole store (a database) could not be read. */
	whole: boolean;
	/** Each reason once, in the order first seen, with how many it left out (0 for a store). */
	whys: { why: SkipWhy; count: number }[];
}

/** What the scan could not read, per tool in SOURCES order. */
export function skippedBySource(skipped: ImportSkipped[]): SkippedGroup[] {
	return SOURCES.map((source) => {
		const items = skipped.filter((s) => s.source === source);
		const whys: SkippedGroup['whys'] = [];
		for (const s of items) {
			const why: SkipWhy = s.count === 0 ? 'store' : s.kind;
			const seen = whys.find((w) => w.why === why);
			if (seen) seen.count += s.count;
			else whys.push({ why, count: s.count });
		}
		return {
			source,
			count: items.reduce((n, s) => n + s.count, 0),
			whole: items.some((s) => s.count === 0),
			whys
		};
	}).filter((g) => g.whys.length > 0);
}

export interface ProjectGroup {
	cwd: string;
	sessions: ImportSession[];
}
export interface SourceGroup<T> {
	source: ImportSource;
	items: T[];
}

/** Items per tool, in SOURCES order; tools with nothing are left out. */
export function bySource<T extends { source: ImportSource }>(items: T[]): SourceGroup<T>[] {
	return SOURCES.map((source) => ({ source, items: items.filter((x) => x.source === source) })).filter(
		(g) => g.items.length > 0
	);
}

export interface SessionGroup {
	source: ImportSource;
	items: ImportSession[];
	/** Conversations found that cannot be imported, each with why. */
	unreadable: ImportUnreadable[];
}

/** Conversations per tool in SOURCES order, with the ones that cannot be
 *  imported; tools with neither are left out. */
export function sessionGroups(scan: ImportScan): SessionGroup[] {
	const unreadable = scan.unreadable ?? [];
	return SOURCES.map((source) => ({
		source,
		items: scan.sessions.filter((s) => s.source === source),
		unreadable: unreadable.filter((u) => u.source === source)
	})).filter((g) => g.items.length > 0 || g.unreadable.length > 0);
}

export interface ProjectRows extends ProjectGroup {
	unreadable: ImportUnreadable[];
}

/** A tool's conversations per folder as byProject orders them, the ones that
 *  cannot be imported in their folder too; the ones without a folder last
 *  (under ''). */
export function projectRows(sessions: ImportSession[], unreadable: ImportUnreadable[] = []): ProjectRows[] {
	const rows = new Map<string, ProjectRows>();
	const newest = new Map<string, number>();
	const row = (cwd: string, at: number) => {
		newest.set(cwd, Math.max(newest.get(cwd) ?? 0, at));
		let r = rows.get(cwd);
		if (!r) rows.set(cwd, (r = { cwd, sessions: [], unreadable: [] }));
		return r;
	};
	const byTime = <T extends { updated_at_ms: number }>(list: T[]) => [...list].sort((a, b) => b.updated_at_ms - a.updated_at_ms);
	for (const s of byTime(sessions)) row(s.cwd, s.updated_at_ms).sessions.push(s);
	for (const u of byTime(unreadable)) row(u.cwd, u.updated_at_ms).unreadable.push(u);
	return [...rows.values()].sort(
		(a, b) => Number(!a.cwd) - Number(!b.cwd) || (newest.get(b.cwd) ?? 0) - (newest.get(a.cwd) ?? 0)
	);
}

/** A tool's conversations per folder: the most recently used folder first,
 *  newest conversation first within it. */
export function byProject(sessions: ImportSession[]): ProjectGroup[] {
	const groups = new Map<string, ImportSession[]>();
	for (const s of [...sessions].sort((a, b) => b.updated_at_ms - a.updated_at_ms)) {
		const list = groups.get(s.cwd);
		if (list) list.push(s);
		else groups.set(s.cwd, [s]);
	}
	return [...groups].map(([cwd, list]) => ({ cwd, sessions: list }));
}

/** What a scan picks by default: conversations not imported yet, skills and
 *  servers LynShen does not have. Ones that come with a plugin are left for
 *  the user to choose: they often rely on the tool they came with. */
export function defaultPicks(scan: ImportScan): Record<string, boolean> {
	const picks: Record<string, boolean> = {};
	for (const s of scan.sessions) if (!s.imported) picks[sessionKey(s)] = true;
	for (const s of scan.skills) if (!s.present && !s.plugin) picks[skillKey(s)] = true;
	for (const m of scan.mcp) if (!m.present && !m.from) picks[mcpKey(m)] = true;
	return picks;
}

export interface McpPlan {
	add: ImportMcp[];
	/** A server of that name is already configured (or picked twice). */
	skip: ImportMcp[];
}

/** Splits the picked servers into ones to add and ones whose name LynShen
 *  already has; the first of two picks with one name wins. */
export function planMcp(picked: ImportMcp[], configured: Iterable<string>): McpPlan {
	const taken = new Set(configured);
	const plan: McpPlan = { add: [], skip: [] };
	for (const m of picked) {
		if (taken.has(m.name)) plan.skip.push(m);
		else {
			taken.add(m.name);
			plan.add.push(m);
		}
	}
	return plan;
}

export interface Tally {
	imported: number;
	existing: number;
	failed: number;
}
export interface McpResult {
	server: ImportMcp;
	status: 'imported' | 'existing' | 'failed';
	error?: string;
}
export interface RunSummary {
	sessions: Tally;
	skills: Tally;
	mcp: Tally;
	/** What failed, with why. */
	failures: { label: string; error: string }[];
}

function tally(statuses: string[]): Tally {
	return {
		imported: statuses.filter((s) => s === 'imported').length,
		existing: statuses.filter((s) => s === 'existing').length,
		failed: statuses.filter((s) => s === 'failed').length
	};
}

export function summarize(outcomes: ImportOutcome[], mcp: McpResult[]): RunSummary {
	const of = (kind: ImportOutcome['kind']) => outcomes.filter((o) => o.kind === kind).map((o) => o.status);
	return {
		sessions: tally(of('session')),
		skills: tally(of('skill')),
		mcp: tally(mcp.map((r) => r.status)),
		failures: [
			...outcomes
				.filter((o) => o.status === 'failed')
				.map((o) => ({ label: o.title || (o.kind === 'skill' ? folderName(o.key) : o.key), error: o.error ?? '' })),
			...mcp.filter((r) => r.status === 'failed').map((r) => ({ label: r.server.name, error: r.error ?? '' }))
		]
	};
}

/** A conversation a run brought over, as the result opens it. */
export interface OpenableImport {
	source: ImportSource;
	/** The copy to open (`ImportOutcome.target`). */
	id: string;
	title: string;
	cwd: string;
	/** The backend it continues on. */
	engine: 'lynshen' | 'claude' | 'codex';
}

/** The conversations of a run that the result can open in their project:
 *  imported (or imported before), in a folder that still exists, on a
 *  backend that opens a conversation by its id. OpenCode copies (engine
 *  acp) open from the project's history, which knows the agent. */
export function openableImports(outcomes: ImportOutcome[]): OpenableImport[] {
	const out: OpenableImport[] = [];
	for (const o of outcomes) {
		if (o.kind !== 'session' || o.status === 'failed' || !o.target || !o.cwd || !o.cwd_exists) continue;
		if (o.engine !== 'lynshen' && o.engine !== 'claude' && o.engine !== 'codex') continue;
		out.push({ source: o.source, id: o.target, title: o.title || o.key, cwd: o.cwd, engine: o.engine });
	}
	return out;
}

/** Folders of the conversations a run brought over that still exist: the
 *  projects to show them under. */
export function importedFolders(outcomes: ImportOutcome[]): string[] {
	const out: string[] = [];
	for (const o of outcomes) {
		if (o.kind !== 'session' || o.status === 'failed' || !o.cwd || !o.cwd_exists) continue;
		if (!out.includes(o.cwd)) out.push(o.cwd);
	}
	return out;
}
