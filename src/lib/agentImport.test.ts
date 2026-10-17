import { describe, it, expect } from 'vitest';
import {
	byProject,
	bySource,
	defaultPicks,
	folderName,
	importedFolders,
	isPath,
	openableImports,
	mcpKey,
	planMcp,
	projectRows,
	sessionGroups,
	sessionKey,
	skillKey,
	skippedBySource,
	summarize
} from './agentImport';
import type { ImportMcp, ImportOutcome, ImportScan, ImportSession, ImportSkill, ImportUnreadable } from './protocol';

const session = (over: Partial<ImportSession> = {}): ImportSession => ({
	source: 'zcode',
	id: 's1',
	title: 'Fix it',
	cwd: '/p/a',
	updated_at_ms: 1000,
	messages: 3,
	imported: false,
	...over
});
const blocked = (over: Partial<ImportUnreadable> = {}): ImportUnreadable => ({
	source: 'dsh',
	id: 'session-old',
	title: 'Port the parser',
	cwd: '/p/a',
	updated_at_ms: 500,
	kind: 'old_format',
	...over
});
const skill = (over: Partial<ImportSkill> = {}): ImportSkill => ({
	source: 'codex',
	name: 'review',
	description: '',
	path: '/h/.codex/skills/review',
	plugin: null,
	present: false,
	...over
});
const server = (over: Partial<ImportMcp> = {}): ImportMcp => ({
	source: 'claude',
	from: '',
	name: 'files',
	transport: 'stdio',
	command: 'npx',
	args: [],
	url: null,
	present: false,
	entry: { name: 'files', transport: 'stdio', command: 'npx', enabled: true },
	...over
});
const outcome = (over: Partial<ImportOutcome> = {}): ImportOutcome => ({
	kind: 'session',
	source: 'zcode',
	key: 's1',
	status: 'imported',
	target: 'sabc',
	title: 'Fix it',
	cwd: '/p/a',
	engine: 'lynshen',
	cwd_exists: true,
	error: null,
	...over
});

describe('grouping', () => {
	it('orders tools as listed and drops empty ones', () => {
		const groups = bySource([session({ source: 'omp' }), session({ source: 'claude' }), session({ source: 'omp', id: 's2' })]);
		expect(groups.map((g) => [g.source, g.items.length])).toEqual([
			['claude', 1],
			['omp', 2]
		]);
	});

	it('puts the most recently used folder first, newest conversation first', () => {
		const groups = byProject([
			session({ id: 'old', cwd: '/p/a', updated_at_ms: 1 }),
			session({ id: 'b', cwd: '/p/b', updated_at_ms: 5 }),
			session({ id: 'new', cwd: '/p/a', updated_at_ms: 9 })
		]);
		expect(groups.map((g) => [g.cwd, g.sessions.map((s) => s.id)])).toEqual([
			['/p/a', ['new', 'old']],
			['/p/b', ['b']]
		]);
	});

	it('names a folder by its last component', () => {
		expect(folderName('/Users/me/proj/')).toBe('proj');
		expect(folderName('C:\\work\\app')).toBe('app');
	});
});

describe('conversations that cannot be imported (DSH)', () => {
	const scan = (over: Partial<ImportScan>): ImportScan => ({ sessions: [], skipped: [], skills: [], mcp: [], ...over });

	it('gives a tool a group when all it has cannot be imported, after the others', () => {
		const groups = sessionGroups(
			scan({ sessions: [session({ source: 'zcode' })], unreadable: [blocked(), blocked({ id: 'b', kind: 'newer_format' })] })
		);
		expect(groups.map((g) => [g.source, g.items.length, g.unreadable.map((u) => u.id)])).toEqual([
			['zcode', 1, []],
			['dsh', 0, ['session-old', 'b']]
		]);
		// A scan from before this field existed.
		expect(sessionGroups(scan({ sessions: [session({ source: 'dsh' })] })).map((g) => g.unreadable)).toEqual([[]]);
		expect(sessionGroups(scan({}))).toEqual([]);
	});

	it('lists them in their folder, the folder ordered by its newest conversation, no folder last', () => {
		const rows = projectRows(
			[session({ source: 'dsh', id: 'new', cwd: '/p/a', updated_at_ms: 900 }), session({ source: 'dsh', id: 'b1', cwd: '/p/b', updated_at_ms: 100 })],
			[
				blocked({ id: 'nf', cwd: '', updated_at_ms: 9999 }),
				blocked({ id: 'b-old', cwd: '/p/b', updated_at_ms: 950 }),
				blocked({ id: 'c-old', cwd: '/p/c', updated_at_ms: 50 })
			]
		);
		expect(rows.map((r) => [r.cwd, r.sessions.map((s) => s.id), r.unreadable.map((u) => u.id)])).toEqual([
			['/p/b', ['b1'], ['b-old']],
			['/p/a', ['new'], []],
			['/p/c', [], ['c-old']],
			['', [], ['nf']]
		]);
		// Without any, the order is byProject's.
		const plain = [session({ id: 'x', cwd: '/p/a', updated_at_ms: 1 }), session({ id: 'y', cwd: '/p/b', updated_at_ms: 2 })];
		expect(projectRows(plain).map((r) => r.cwd)).toEqual(byProject(plain).map((g) => g.cwd));
	});

	it('sums them up with the other reasons', () => {
		expect(
			skippedBySource([
				{ source: 'dsh', count: 1, kind: 'old_format', reason: 'format 3 from an older DSH, which opening it in DSH updates' },
				{ source: 'dsh', count: 1, kind: 'newer_format', reason: 'format 5 from a newer DSH' },
				{ source: 'dsh', count: 1, kind: 'newer_format', reason: 'event review/verdict from a newer DSH' },
				{ source: 'claude', count: 1, kind: 'no_folder', reason: 'no working folder recorded' }
			])
		).toEqual([
			{ source: 'claude', count: 1, whole: false, whys: [{ why: 'no_folder', count: 1 }] },
			{
				source: 'dsh',
				count: 3,
				whole: false,
				whys: [
					{ why: 'old_format', count: 1 },
					{ why: 'newer_format', count: 2 }
				]
			}
		]);
		// Nothing they have is picked.
		expect(defaultPicks(scan({ unreadable: [blocked()] }))).toEqual({});
	});
});

describe('defaultPicks', () => {
	it('skips what was imported, what LynShen has, and what comes with a plugin', () => {
		const picks = defaultPicks({
			sessions: [session(), session({ id: 'done', imported: true })],
			skipped: [],
			skills: [skill(), skill({ name: 'had', path: '/x', present: true }), skill({ name: 'pdf', path: '/y', plugin: 'pdf' })],
			mcp: [server(), server({ name: 'had', present: true }), server({ name: 'notion', from: 'notion' })]
		});
		expect(Object.keys(picks).sort()).toEqual(
			[sessionKey(session()), skillKey(skill()), mcpKey(server())].sort()
		);
	});
});

describe('planMcp', () => {
	it('skips names already configured and the second pick of a name', () => {
		const a = server();
		const b = server({ source: 'codex', name: 'files' });
		const c = server({ name: 'search' });
		const d = server({ name: 'mine' });
		const plan = planMcp([a, b, c, d], ['mine']);
		expect(plan.add).toEqual([a, c]);
		expect(plan.skip).toEqual([b, d]);
	});
});

describe('summarize', () => {
	it('counts per kind and lists failures', () => {
		const summary = summarize(
			[
				outcome(),
				outcome({ key: 's2', status: 'existing' }),
				outcome({ key: 's3', status: 'failed', title: null, error: 'gone' }),
				outcome({ kind: 'skill', key: '/h/skills/review', status: 'imported', cwd: null }),
				outcome({ kind: 'skill', key: '/h/skills/pdf', status: 'failed', title: null, error: 'denied' })
			],
			[
				{ server: server(), status: 'imported' },
				{ server: server({ name: 'x' }), status: 'failed', error: 'no daemon' }
			]
		);
		expect(summary.sessions).toEqual({ imported: 1, existing: 1, failed: 1 });
		expect(summary.skills).toEqual({ imported: 1, existing: 0, failed: 1 });
		expect(summary.mcp).toEqual({ imported: 1, existing: 0, failed: 1 });
		expect(summary.failures).toEqual([
			{ label: 's3', error: 'gone' },
			{ label: 'pdf', error: 'denied' },
			{ label: 'x', error: 'no daemon' }
		]);
	});

	it('lists the folders of imported conversations that still exist, once each', () => {
		expect(
			importedFolders([
				outcome(),
				outcome({ key: 's2', status: 'existing' }),
				outcome({ key: 's3', cwd: '/p/gone', cwd_exists: false }),
				outcome({ key: 's4', status: 'failed', cwd: '/p/c' }),
				outcome({ key: 's5', cwd: '/p/b' }),
				outcome({ kind: 'skill', cwd: null })
			])
		).toEqual(['/p/a', '/p/b']);
	});
});

describe('opening what a run brought over (ticket #35)', () => {
	it('lists the conversations that open by id in a folder that still exists', () => {
		expect(
			openableImports([
				outcome({ source: 'codex', engine: 'codex', target: 'cx-copy', title: '添加关闭预启动开关', cwd: 'D:\\我要干大活\\三角帧不掉洲' }),
				outcome({ key: 's2', status: 'existing', target: 'sdef', title: null }),
				outcome({ key: 's3', cwd: '/p/gone', cwd_exists: false }),
				outcome({ key: 's4', status: 'failed', target: null }),
				outcome({ key: 's5', source: 'opencode', engine: 'acp', target: 'ses_copy' }),
				outcome({ kind: 'skill', key: '/s/pdf', target: '/x/pdf', cwd: null, engine: null })
			])
		).toEqual([
			{ source: 'codex', id: 'cx-copy', title: '添加关闭预启动开关', cwd: 'D:\\我要干大活\\三角帧不掉洲', engine: 'codex' },
			{ source: 'zcode', id: 'sdef', title: 's2', cwd: '/p/a', engine: 'lynshen' }
		]);
	});
});

describe('what the scan could not read', () => {
	it('groups it per tool, a store that did not open included', () => {
		expect(
			skippedBySource([
				{ source: 'opencode', count: 0, kind: 'unreadable', reason: 'opencode.db cannot be read (file is not a database)' },
				{ source: 'claude', count: 2, kind: 'unrecognised', reason: 'not a session file (no JSON rows)' },
				{ source: 'claude', count: 1, kind: 'no_folder', reason: 'no working folder recorded' },
				{ source: 'claude', count: 1, kind: 'unreadable', reason: 'file cannot be opened (denied)' },
				{ source: 'claude', count: 1, kind: 'unreadable', reason: 'a project folder cannot be read' },
				{ source: 'opencode', count: 1, kind: 'unrecognised', reason: 'session file is not valid JSON' }
			])
		).toEqual([
			{
				source: 'claude',
				count: 5,
				whole: false,
				whys: [
					{ why: 'unrecognised', count: 2 },
					{ why: 'no_folder', count: 1 },
					{ why: 'unreadable', count: 2 }
				]
			},
			{
				source: 'opencode',
				count: 1,
				whole: true,
				whys: [
					{ why: 'store', count: 0 },
					{ why: 'unrecognised', count: 1 }
				]
			}
		]);
		expect(skippedBySource([{ source: 'omp', count: 4, kind: 'unrecognised', reason: 'no session header' }])).toEqual([
			{ source: 'omp', count: 4, whole: false, whys: [{ why: 'unrecognised', count: 4 }] }
		]);
		expect(skippedBySource([])).toEqual([]);
	});

	it('tells project folders from plugin names on every OS', () => {
		for (const path of ['/Users/me/app', 'C:\\Users\\me\\app', 'D:/work/app', '\\\\server\\share']) {
			expect(isPath(path), path).toBe(true);
		}
		for (const name of ['figma', 'document-skills', 'c:plugin']) expect(isPath(name), name).toBe(false);
	});
});
