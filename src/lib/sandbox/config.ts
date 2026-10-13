// The sandbox settings in ~/.lynshen/config.json (sandbox contract, config
// format): the sandbox mode, the network switch, the writable directories
// and the command rules, each for every project (top level) or for one
// project (`projects.<root>`), and where 始终允许 keeps its rules. The
// engine reads and writes the same file (a saved 始终允许 rule, a directory
// added from a card), so every change here is a patch of the top-level
// keys it touches, built over a fresh read: keys and entries this page does
// not know stay as the file has them.

import { SANDBOX_MODES, type SandboxMode } from './request';

export type DirMode = 'ro' | 'rw';
export type RuleAction = 'allow' | 'ask' | 'forbid';
export const RULE_ACTIONS: readonly RuleAction[] = ['allow', 'ask', 'forbid'];
export type AlwaysAllowScope = 'project' | 'global';

/** Where an entry lives: '' for every project, else the project's root as
 *  config.json keys it. */
export type Scope = string;
export const GLOBAL: Scope = '';

export interface DirEntry {
	path: string;
	mode: DirMode;
	scope: Scope;
}

export interface RuleEntry {
	prefix: string;
	action: RuleAction;
	scope: Scope;
}

export interface SandboxSettings {
	mode: SandboxMode;
	network: boolean;
	alwaysScope: AlwaysAllowScope;
	/** Every project's first, then each project's, the given project's first. */
	directories: DirEntry[];
	rules: RuleEntry[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** A path as compared (not as written): one separator, no trailing one, and
 *  case-insensitive for a Windows drive path. */
export function pathKey(path: string): string {
	const slashes = path.trim().replace(/\\/g, '/');
	const trimmed = slashes.length > 1 ? slashes.replace(/\/+$/, '') : slashes;
	const key = /^[A-Za-z]:(\/|$)/.test(trimmed) ? trimmed.toLowerCase() : trimmed;
	return /^[a-z]:$/.test(key) ? `${key}/` : key;
}
export const samePath = (a: string, b: string) => pathKey(a) === pathKey(b);

/** The key config.json uses for a project root (the file's own spelling
 *  when it has one), or the root as given. */
export function projectKey(cfg: Json, root: string): string {
	const projects = isObject(cfg.projects) ? cfg.projects : {};
	return Object.keys(projects).find((k) => samePath(k, root)) ?? root;
}

function readDirs(v: unknown, scope: Scope): DirEntry[] {
	return list(v).flatMap((d) =>
		isObject(d) && typeof d.path === 'string' && d.path
			? [{ path: d.path, mode: d.mode === 'ro' ? ('ro' as const) : ('rw' as const), scope }]
			: []
	);
}

function readRules(v: unknown, scope: Scope): RuleEntry[] {
	return list(v).flatMap((r) =>
		isObject(r) && typeof r.prefix === 'string' && RULE_ACTIONS.includes(r.action as RuleAction)
			? [{ prefix: r.prefix, action: r.action as RuleAction, scope }]
			: []
	);
}

/** The sandbox settings config.json holds; the engine's defaults where it
 *  has none. `project`: the open project, listed right after the global
 *  entries. */
export function readSandboxSettings(cfg: Json, project = ''): SandboxSettings {
	const projects = isObject(cfg.projects) ? cfg.projects : {};
	const roots = Object.keys(projects).sort((a, b) => {
		const ap = project && samePath(a, project) ? 0 : 1;
		const bp = project && samePath(b, project) ? 0 : 1;
		return ap - bp || a.localeCompare(b);
	});
	const directories = readDirs(cfg.sandbox_directories, GLOBAL);
	const rules = readRules(cfg.command_rules, GLOBAL);
	for (const root of roots) {
		const p = projects[root];
		if (!isObject(p)) continue;
		directories.push(...readDirs(p.sandbox_directories, root));
		rules.push(...readRules(p.command_rules, root));
	}
	return {
		mode: SANDBOX_MODES.includes(cfg.sandbox as SandboxMode) ? (cfg.sandbox as SandboxMode) : 'workspace-write',
		network: cfg.sandbox_network !== false,
		alwaysScope: cfg.always_allow_scope === 'global' ? 'global' : 'project',
		directories,
		rules
	};
}

const LIST_KEYS = ['sandbox_directories', 'command_rules'];

/** The patch that replaces one list (`sandbox_directories` or
 *  `command_rules`) of a scope: the top-level key, or `projects` with that
 *  project's entry changed and every other project and key kept. A project
 *  left with nothing (no other key, these two lists empty) is dropped. */
function listPatch(cfg: Json, scope: Scope, key: 'sandbox_directories' | 'command_rules', next: unknown[]): Json {
	if (scope === GLOBAL) return { [key]: next };
	const projects: Json = isObject(cfg.projects) ? { ...cfg.projects } : {};
	const name = projectKey(cfg, scope);
	const entry: Json = isObject(projects[name]) ? { ...(projects[name] as Json) } : {};
	entry[key] = next;
	const empty = Object.entries(entry).every(([k, v]) => LIST_KEYS.includes(k) && Array.isArray(v) && v.length === 0);
	if (empty) delete projects[name];
	else projects[name] = entry;
	return { projects };
}

function scopeList(cfg: Json, scope: Scope, key: 'sandbox_directories' | 'command_rules'): unknown[] {
	if (scope === GLOBAL) return list(cfg[key]);
	const projects = isObject(cfg.projects) ? cfg.projects : {};
	const entry = projects[projectKey(cfg, scope)];
	return isObject(entry) ? list(entry[key]) : [];
}

const isDir = (d: unknown, path: string) => isObject(d) && typeof d.path === 'string' && samePath(d.path, path);

/** Adds a writable directory (or changes its mode when it is listed). */
export function addDirectoryPatch(cfg: Json, scope: Scope, path: string, mode: DirMode = 'rw'): Json {
	const current = scopeList(cfg, scope, 'sandbox_directories');
	const next = current.some((d) => isDir(d, path))
		? current.map((d) => (isDir(d, path) ? { ...(d as Json), mode } : d))
		: [...current, { path, mode }];
	return listPatch(cfg, scope, 'sandbox_directories', next);
}

export function removeDirectoryPatch(cfg: Json, scope: Scope, path: string): Json {
	const current = scopeList(cfg, scope, 'sandbox_directories');
	return listPatch(cfg, scope, 'sandbox_directories', current.filter((d) => !isDir(d, path)));
}

const isRule = (r: unknown, rule: { prefix: string; action: RuleAction }) =>
	isObject(r) && r.prefix === rule.prefix && r.action === rule.action;

/** Adds a command rule; a rule with the same prefix in the scope takes the new action. */
export function addRulePatch(cfg: Json, scope: Scope, prefix: string, action: RuleAction): Json {
	const clean = prefix.trim();
	const current = scopeList(cfg, scope, 'command_rules');
	const same = (r: unknown) => isObject(r) && typeof r.prefix === 'string' && r.prefix.trim() === clean;
	const next = current.some(same) ? current.map((r) => (same(r) ? { ...(r as Json), action } : r)) : [...current, { prefix: clean, action }];
	return listPatch(cfg, scope, 'command_rules', next);
}

/** Replaces a rule (found by its prefix and action as last read) in place,
 *  keeping its other fields; added when it is gone meanwhile. */
export function updateRulePatch(
	cfg: Json,
	scope: Scope,
	was: { prefix: string; action: RuleAction },
	now: { prefix: string; action: RuleAction }
): Json {
	const current = scopeList(cfg, scope, 'command_rules');
	const at = current.findIndex((r) => isRule(r, was));
	if (at < 0) return addRulePatch(cfg, scope, now.prefix, now.action);
	const next = current.map((r, i) => (i === at ? { ...(r as Json), prefix: now.prefix.trim(), action: now.action } : r));
	return listPatch(cfg, scope, 'command_rules', next);
}

export function removeRulePatch(cfg: Json, scope: Scope, rule: { prefix: string; action: RuleAction }): Json {
	const current = scopeList(cfg, scope, 'command_rules');
	const at = current.findIndex((r) => isRule(r, rule));
	return listPatch(cfg, scope, 'command_rules', at < 0 ? current : current.filter((_, i) => i !== at));
}
