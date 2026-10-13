import { describe, expect, it, vi } from 'vitest';
import type { ImportScan, InstalledSkill, MarketSkill, MarketSourceState, SkillList } from './protocol';
import { isUnknownOp } from './protocol';
import {
	duplicateOf,
	enabledCount,
	filterMarket,
	filterSkills,
	foreignPlugins,
	groupSkills,
	homeOf,
	marketSources,
	marketTags,
	pendingSources,
	problemCounts,
	skillNameFrom,
	sortProblems,
	sourceProblems,
	sourceReason,
	TimeoutError,
	tildePath,
	validSkillName,
	withEnabled,
	withTimeout,
	without
} from './skills';

const skill = (name: string, scope: InstalledSkill['scope'], extra: Partial<InstalledSkill> = {}): InstalledSkill => ({
	name,
	description: `${name} does things`,
	path: `/x/${scope}/${name}`,
	scope,
	enabled: true,
	toggleable: true,
	removable: scope === 'user',
	...extra
});

const market = (id: string, source: string, extra: Partial<MarketSkill> = {}): MarketSkill => ({
	id,
	name: id,
	description: `${id} skill`,
	tags: [],
	source,
	sourceName: source === 'anthropic' ? 'Anthropic' : source.split('/')[0],
	isDefault: false,
	installed: false,
	license: '',
	redistributable: true,
	homepage: '',
	...extra
});

describe('installed skills', () => {
	const list = [
		skill('zeta', 'user'),
		skill('Alpha', 'project'),
		skill('beta', 'user', { enabled: false, description: 'Review pull requests' }),
		skill('notes', 'shared')
	];

	it('groups by scope (personal, shared, project) and sorts by name', () => {
		expect(groupSkills(list).map((g) => [g.scope, g.skills.map((s) => s.name)])).toEqual([
			['user', ['beta', 'zeta']],
			['shared', ['notes']],
			['project', ['Alpha']]
		]);
		expect(groupSkills([])).toEqual([]);
	});

	it('filters on name, description and folder, ignoring case', () => {
		expect(filterSkills(list, 'PULL').map((s) => s.name)).toEqual(['beta']);
		expect(filterSkills(list, '/shared/').map((s) => s.name)).toEqual(['notes']);
		expect(filterSkills(list, '  ')).toBe(list);
		expect(enabledCount(list)).toBe(3);
	});

	it('switches or drops one skill of a list', () => {
		const l: SkillList = { backend: 'lynshen', skills: list, problems: [], dirs: [], projectTrusted: null };
		expect(withEnabled(l, '/x/user/beta', true).skills.find((s) => s.name === 'beta')?.enabled).toBe(true);
		expect(l.skills.find((s) => s.name === 'beta')?.enabled).toBe(false);
		expect(without(l, '/x/user/zeta').skills.map((s) => s.name)).toEqual(['Alpha', 'beta', 'notes']);
	});

	it('counts and orders load problems, errors first', () => {
		const problems = [
			{ level: 'warning' as const, kind: 'duplicate', path: '/b', message: '' },
			{ level: 'error' as const, kind: 'unreadable', path: '/c', message: '' },
			{ level: 'warning' as const, kind: 'no_description', path: '/a', message: '' }
		];
		expect(problemCounts(problems)).toEqual({ errors: 1, warnings: 2 });
		expect(sortProblems(problems).map((p) => p.path)).toEqual(['/c', '/a', '/b']);
	});

	it('takes skill names in the Agent Skills format', () => {
		expect(validSkillName('release-notes')).toBe(true);
		for (const bad of ['', 'Release', 'a--b', '-a', 'a-', 'a b', 'x'.repeat(65), '发布']) expect(validSkillName(bad)).toBe(false);
		expect(skillNameFrom('  Code Review!  ')).toBe('code-review');
		expect(skillNameFrom('发布说明')).toBe('');
	});

	it('shows paths under the home folder with ~', () => {
		const dirs = (path: string) => ({ dirs: [{ scope: 'user' as const, path }] });
		expect(homeOf(dirs('/Users/me/.lynshen/skills'))).toBe('/Users/me');
		expect(homeOf(dirs('C:\\Users\\me\\.claude\\skills'))).toBe('C:\\Users\\me');
		expect(homeOf(dirs('/opt/skills'))).toBe('');
		expect(tildePath('/Users/me/.agents/skills/notes', '/Users/me')).toBe('~/.agents/skills/notes');
		expect(tildePath('/Users/meg/x', '/Users/me')).toBe('/Users/meg/x');
		expect(tildePath('/srv/x', '')).toBe('/srv/x');
		expect(duplicateOf('same name as /a/b')).toBe('/a/b');
	});

	it('knows a daemon too old for an op', () => {
		expect(isUnknownOp(new Error('skills_list requires session'), 'skills_list')).toBe(true);
		expect(isUnknownOp(new Error('unknown op skill_uninstall'), 'skill_uninstall')).toBe(true);
		expect(isUnknownOp(new Error('no such skill: /x'), 'skill_set_enabled')).toBe(false);
	});
});

describe('marketplace', () => {
	const catalog = [
		market('frontend-design', 'anthropic', { tags: ['design', 'web'], installed: true }),
		market('mcp-builder', 'anthropic', { tags: ['dev'] }),
		market('brainstorm', 'obra/superpowers'),
		market('canvas', 'anthropic', { tags: ['design'] })
	];

	it('lists sources in catalog order with their sizes', () => {
		expect(marketSources(catalog)).toEqual([
			{ key: 'anthropic', name: 'Anthropic', count: 3 },
			{ key: 'obra/superpowers', name: 'obra', count: 1 }
		]);
	});

	it('offers the tags of the shown source, most used first', () => {
		expect(marketTags(catalog, 'all')).toEqual(['design', 'dev', 'web']);
		expect(marketTags(catalog, 'obra/superpowers')).toEqual([]);
		expect(marketTags(catalog, 'installed')).toEqual(['design', 'web']);
	});

	it('filters by query, source, installed and tag together', () => {
		const ids = (f: Parameters<typeof filterMarket>[1]) => filterMarket(catalog, f).map((s) => s.id);
		expect(ids({ query: '', source: 'all', tag: '' })).toHaveLength(4);
		expect(ids({ query: 'BRAIN', source: 'all', tag: '' })).toEqual(['brainstorm']);
		expect(ids({ query: '', source: 'anthropic', tag: 'design' })).toEqual(['frontend-design', 'canvas']);
		expect(ids({ query: '', source: 'installed', tag: '' })).toEqual(['frontend-design']);
		expect(ids({ query: 'web', source: 'all', tag: '' })).toEqual(['frontend-design']);
	});
});

describe('marketplace sources', () => {
	const state = (key: string, extra: Partial<MarketSourceState> = {}): MarketSourceState => ({
		key,
		name: key.split('/')[0],
		origin: 'github',
		fetchedAt: 1_700_000_000_000,
		error: null,
		...extra
	});
	const sources = [
		state('anthropic', { name: 'Anthropic', origin: 'bundled', fetchedAt: null }),
		state('obra/superpowers', { origin: 'mirror' }),
		state('Ikaleio/skills', { error: 'api.github.com: connection failed' }),
		state('ComposioHQ/awesome-claude-skills', { origin: null, fetchedAt: null, error: 'timed out' }),
		state('new/source', { origin: null, fetchedAt: null })
	];

	it('warns about each failed source, saying whether its cached skills still show', () => {
		expect(sourceProblems(sources)).toEqual([
			{
				key: 'Ikaleio/skills',
				name: 'Ikaleio',
				kind: 'cached',
				reason: 'network',
				fetchedAt: 1_700_000_000_000,
				error: 'api.github.com: connection failed'
			},
			{ key: 'ComposioHQ/awesome-claude-skills', name: 'ComposioHQ', kind: 'empty', reason: 'network', fetchedAt: null, error: 'timed out' }
		]);
		// An engine without per-source state: nothing here (its warnings show instead).
		expect(sourceProblems(undefined)).toEqual([]);
	});

	it('says why a source failed from the engine error, GitHub first', () => {
		expect(sourceReason('api.github.com: DNS lookup failed (failed to lookup address)')).toBe('network');
		expect(sourceReason('raw.githubusercontent.com: timed out or the connection broke (os error 60)')).toBe('network');
		expect(sourceReason('api.github.com: the proxy refused the connection')).toBe('network');
		expect(sourceReason('api.github.com answered HTTP 502')).toBe('network');
		expect(sourceReason('api.github.com answered HTTP 403')).toBe('limited');
		expect(sourceReason('api.github.com answered HTTP 429; LynShen mirror: software.lynshen.org: connection failed')).toBe('limited');
		expect(sourceReason('api.github.com answered HTTP 404')).toBe('missing');
		expect(sourceReason('no SKILL.md found in https://github.com/o/r')).toBe('missing');
		// The mirror's own failure does not decide it.
		expect(sourceReason('api.github.com answered HTTP 404; LynShen mirror: software.lynshen.org: timed out')).toBe('missing');
		expect(sourceReason('reading the repository failed')).toBe('other');
	});

	it('names the sources read for the first time while the engine refreshes', () => {
		expect(pendingSources(sources, true)).toEqual(['new']);
		expect(pendingSources(sources, false)).toEqual([]);
		expect(pendingSources(undefined, true)).toEqual([]);
	});

	it('gives up on an answer that does not come', async () => {
		vi.useFakeTimers();
		try {
			const never = withTimeout(new Promise<never>(() => {}), 15_000);
			const caught = never.catch((e) => e);
			vi.advanceTimersByTime(15_000);
			expect(await caught).toBeInstanceOf(TimeoutError);
			await expect(withTimeout(Promise.resolve(7), 15_000)).resolves.toBe(7);
			await expect(withTimeout(Promise.reject(new Error('refused')), 15_000)).rejects.toThrow('refused');
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('plugins of other agents', () => {
	it('gathers each plugin with its skills and servers; project and own settings are not plugins', () => {
		const entry = { name: 'x', transport: 'stdio' as const, enabled: true };
		const scan: ImportScan = {
			sessions: [],
			skills: [
				{ source: 'claude', name: 'docx', description: '', path: '/p/docx', plugin: 'document-skills', present: false },
				{ source: 'claude', name: 'pdf', description: '', path: '/p/pdf', plugin: 'document-skills', present: true },
				{ source: 'codex', name: 'mine', description: '', path: '/c/mine', plugin: null, present: false }
			],
			mcp: [
				{ source: 'claude', from: 'document-skills', name: 'files', transport: 'stdio', command: 'x', args: [], url: null, present: false, entry },
				{ source: 'claude', from: '/Users/me/project', name: 'proj', transport: 'stdio', command: 'x', args: [], url: null, present: false, entry },
				{ source: 'codex', from: 'C:\\work\\repo', name: 'win', transport: 'stdio', command: 'x', args: [], url: null, present: false, entry },
				{ source: 'zcode', from: '', name: 'own', transport: 'stdio', command: 'x', args: [], url: null, present: false, entry },
				{ source: 'codex', from: 'notion', name: 'notion', transport: 'http', command: null, args: null, url: 'https://x', present: true, entry }
			]
		};
		expect(foreignPlugins(scan)).toEqual([
			{ source: 'claude', name: 'document-skills', skills: ['docx', 'pdf'], mcp: ['files'], importable: 2 },
			{ source: 'codex', name: 'notion', skills: [], mcp: ['notion'], importable: 0 }
		]);
	});
});
