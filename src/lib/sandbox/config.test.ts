import { describe, it, expect } from 'vitest';
import {
	addDirectoryPatch,
	addRulePatch,
	GLOBAL,
	pathKey,
	projectKey,
	readSandboxSettings,
	removeDirectoryPatch,
	removeRulePatch,
	samePath,
	updateRulePatch
} from './config';

// The contract's example file, with keys and fields this page does not know.
const CFG = () => ({
	model: 'deepseek-v4.1-flash',
	sandbox: 'workspace-write',
	sandbox_network: true,
	sandbox_directories: [{ path: '/abs', mode: 'rw', note: 'kept' }],
	command_rules: [{ prefix: 'git push', action: 'ask' }],
	always_allow_scope: 'project',
	projects: {
		'/abs/project/root': {
			sandbox_directories: [{ path: '/abs/other', mode: 'rw' }],
			command_rules: [{ prefix: 'npm install', action: 'allow', saved_at: 1 }],
			trust: true
		},
		'/abs/elsewhere': { command_rules: [{ prefix: 'make', action: 'allow' }] }
	}
});

describe('readSandboxSettings', () => {
	it('reads the contract format, the open project after the global entries', () => {
		const s = readSandboxSettings(CFG(), '/abs/elsewhere/');
		expect(s).toMatchObject({ mode: 'workspace-write', network: true, alwaysScope: 'project' });
		expect(s.directories).toEqual([
			{ path: '/abs', mode: 'rw', scope: GLOBAL },
			{ path: '/abs/other', mode: 'rw', scope: '/abs/project/root' }
		]);
		expect(s.rules).toEqual([
			{ prefix: 'git push', action: 'ask', scope: GLOBAL },
			{ prefix: 'make', action: 'allow', scope: '/abs/elsewhere' },
			{ prefix: 'npm install', action: 'allow', scope: '/abs/project/root' }
		]);
	});

	it("falls back to the engine's defaults and skips malformed entries", () => {
		const s = readSandboxSettings({ sandbox: 'bogus', sandbox_directories: [{ mode: 'rw' }, 'x'], command_rules: [{ prefix: 'rm', action: 'nuke' }], projects: [] });
		expect(s).toEqual({ mode: 'workspace-write', network: true, alwaysScope: 'project', directories: [], rules: [] });
		expect(readSandboxSettings({ sandbox: 'full-access', sandbox_network: false, always_allow_scope: 'global' })).toMatchObject({
			mode: 'full-access',
			network: false,
			alwaysScope: 'global'
		});
	});
});

describe('patches', () => {
	it('changes only the global list it touches, keeping its entries', () => {
		const patch = addDirectoryPatch(CFG(), GLOBAL, '/Users/me/Desktop');
		expect(patch).toEqual({
			sandbox_directories: [
				{ path: '/abs', mode: 'rw', note: 'kept' },
				{ path: '/Users/me/Desktop', mode: 'rw' }
			]
		});
		// Listed already: its mode changes, the entry keeps its fields.
		expect(addDirectoryPatch(CFG(), GLOBAL, '/abs/', 'ro')).toEqual({ sandbox_directories: [{ path: '/abs', mode: 'ro', note: 'kept' }] });
		expect(removeDirectoryPatch(CFG(), GLOBAL, '/abs')).toEqual({ sandbox_directories: [] });
	});

	it("changes one project's list and keeps the other projects and keys", () => {
		const cfg = CFG();
		const patch = addDirectoryPatch(cfg, '/abs/project/root/', '/Users/me/Downloads', 'ro');
		expect(patch).toEqual({
			projects: {
				'/abs/project/root': {
					sandbox_directories: [
						{ path: '/abs/other', mode: 'rw' },
						{ path: '/Users/me/Downloads', mode: 'ro' }
					],
					command_rules: [{ prefix: 'npm install', action: 'allow', saved_at: 1 }],
					trust: true
				},
				'/abs/elsewhere': { command_rules: [{ prefix: 'make', action: 'allow' }] }
			}
		});
		// The read is not changed in place.
		expect(cfg).toEqual(CFG());
	});

	it('creates a project entry, and drops one left empty', () => {
		expect(addRulePatch({}, '/new/root', ' cargo test ', 'allow')).toEqual({
			projects: { '/new/root': { command_rules: [{ prefix: 'cargo test', action: 'allow' }] } }
		});
		const patch = removeRulePatch(CFG(), '/abs/elsewhere', { prefix: 'make', action: 'allow' });
		expect(Object.keys(patch.projects as object)).toEqual(['/abs/project/root']);
	});

	it('keeps a project entry that still has a key this page does not know, an empty list too', () => {
		const cfg = { projects: { '/p': { command_rules: [{ prefix: 'make', action: 'allow' }], network_hosts: [] } } };
		expect(removeRulePatch(cfg, '/p', { prefix: 'make', action: 'allow' })).toEqual({
			projects: { '/p': { command_rules: [], network_hosts: [] } }
		});
	});

	it('edits a rule in place and keeps its other fields', () => {
		const was = { prefix: 'npm install', action: 'allow' as const };
		expect(updateRulePatch(CFG(), '/abs/project/root', was, { prefix: 'npm ci', action: 'ask' })).toMatchObject({
			projects: { '/abs/project/root': { command_rules: [{ prefix: 'npm ci', action: 'ask', saved_at: 1 }] } }
		});
		// Gone meanwhile (the engine rewrote the list): added instead.
		expect(updateRulePatch(CFG(), GLOBAL, { prefix: 'ls', action: 'allow' }, { prefix: 'ls -la', action: 'allow' })).toEqual({
			command_rules: [
				{ prefix: 'git push', action: 'ask' },
				{ prefix: 'ls -la', action: 'allow' }
			]
		});
	});

	it('gives an added rule with a listed prefix the new action', () => {
		expect(addRulePatch(CFG(), GLOBAL, 'git push', 'forbid')).toEqual({ command_rules: [{ prefix: 'git push', action: 'forbid' }] });
	});

	it('removes one rule only', () => {
		const cfg = { command_rules: [{ prefix: 'a', action: 'allow' }, { prefix: 'a', action: 'allow' }, { prefix: 'b', action: 'ask' }] };
		expect(removeRulePatch(cfg, GLOBAL, { prefix: 'a', action: 'allow' })).toEqual({
			command_rules: [
				{ prefix: 'a', action: 'allow' },
				{ prefix: 'b', action: 'ask' }
			]
		});
	});
});

describe('paths', () => {
	it('compares paths the way the file system names them', () => {
		expect(samePath('/a/b/', '/a/b')).toBe(true);
		expect(samePath('/a/B', '/a/b')).toBe(false);
		expect(samePath('C:\\Users\\Me\\', 'c:/users/me')).toBe(true);
		expect(pathKey('C:\\')).toBe('c:/');
		expect(pathKey('/')).toBe('/');
	});

	it("uses the file's own spelling of a project root", () => {
		expect(projectKey({ projects: { 'C:\\Code\\App': {} } }, 'c:/code/app/')).toBe('C:\\Code\\App');
		expect(projectKey({}, '/x')).toBe('/x');
	});
});
