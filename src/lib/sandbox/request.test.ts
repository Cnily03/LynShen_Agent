import { describe, it, expect } from 'vitest';
import {
	approvalChoices,
	baseName,
	buildSandboxApproveOp,
	commandsIsolated,
	dirOf,
	parseEscalation,
	parseSandboxRequest,
	parseSandboxState,
	TERMINAL_FEEDBACK,
	writeTarget,
	type SandboxRequest
} from './request';
import { typedCommand } from './terminal.svelte';

const request = (fields: Record<string, unknown>): SandboxRequest => {
	const req = parseSandboxRequest({ type: 'approval_request', call_id: 'c1', name: 'bash', ...fields });
	if (!req) throw new Error('not a sandbox request');
	return req;
};

describe('parseSandboxRequest', () => {
	it('ignores a request without a known kind (an older engine, codex scopes)', () => {
		expect(parseSandboxRequest({ type: 'approval_request', call_id: 'c1', name: 'bash', summary: 'ls' })).toBeNull();
		expect(parseSandboxRequest({ type: 'approval_request', call_id: 'c1', scopes: ['session', 'rule'] })).toBeNull();
		expect(parseSandboxRequest({ type: 'approval_request', call_id: 'c1', kind: 'weird' })).toBeNull();
	});

	it('reads every contract field', () => {
		expect(
			request({
				kind: 'escalation',
				must_ask: true,
				justification: ' install the deps ',
				cwd: '/w',
				command: 'npm install -g pnpm\n',
				paths: ['/usr/local/lib/x', 3, ''],
				dir_suggestion: '/usr/local/lib',
				prefix: 'npm install',
				scopes: ['once', 'session', 'bogus', 'project'],
				elevation: 'terminal'
			})
		).toEqual({
			kind: 'escalation',
			mustAsk: true,
			justification: 'install the deps',
			cwd: '/w',
			command: 'npm install -g pnpm',
			paths: ['/usr/local/lib/x'],
			dirSuggestion: '/usr/local/lib',
			prefix: 'npm install',
			scopes: ['once', 'session', 'project'],
			elevation: 'terminal'
		});
	});

	it('defaults missing fields to the narrowest answer', () => {
		const req = request({ kind: 'command', justification: null, command: null, dir_suggestion: null, prefix: null, elevation: 'sudo' });
		expect(req).toMatchObject({ mustAsk: false, justification: '', command: '', paths: [], dirSuggestion: '', prefix: '', elevation: null });
		expect(req.scopes).toEqual(['once']);
	});
});

describe('approvalChoices', () => {
	it('offers the session and saved prefix answers the engine allows', () => {
		const c = approvalChoices(request({ kind: 'escalation', prefix: 'npm install', scopes: ['once', 'session', 'project'] }));
		expect(c).toMatchObject({ once: true, session: true, project: true, pathSession: false, pathProject: false, terminal: false });
	});

	it('gives a must-ask request nothing beyond its scopes', () => {
		const c = approvalChoices(request({ kind: 'rule', must_ask: true, prefix: 'git push', scopes: ['once'], dir_suggestion: '/x' }));
		expect(c).toMatchObject({ once: true, session: false, project: false, pathSession: false, pathProject: false });
	});

	it('needs a prefix for a command allow, not for an edit', () => {
		expect(approvalChoices(request({ kind: 'command', scopes: ['once', 'session', 'project'] }))).toMatchObject({ session: false, project: false });
		expect(approvalChoices(request({ kind: 'edit', scopes: ['once', 'session'] }))).toMatchObject({ session: true, project: false });
	});

	it('answers a write outside the workspace for its directory', () => {
		const c = approvalChoices(
			request({ kind: 'outside_write', paths: ['/Users/me/Desktop/a.txt'], dir_suggestion: '/Users/me/Desktop', prefix: 'cp', scopes: ['once', 'session', 'project'] })
		);
		expect(c).toMatchObject({ session: false, project: false, pathSession: true, pathProject: true, target: '/Users/me/Desktop' });
	});

	it('offers both kinds of answer for a command that names a directory', () => {
		const c = approvalChoices(request({ kind: 'escalation', dir_suggestion: '/opt/homebrew', prefix: 'brew install', scopes: ['once', 'session', 'project'] }));
		expect(c).toMatchObject({ session: true, project: true, pathSession: true, pathProject: true, target: '/opt/homebrew' });
	});

	it('offers the terminal for a terminal elevation only where one can open', () => {
		const req = request({ kind: 'elevation', command: 'sudo port install x', elevation: 'terminal', must_ask: true, scopes: ['once'] });
		expect(approvalChoices(req).terminal).toBe(false);
		expect(approvalChoices(req, { terminal: true }).terminal).toBe(true);
		expect(approvalChoices({ ...req, elevation: 'uac' }, { terminal: true }).terminal).toBe(false);
	});
});

describe('paths', () => {
	it('takes the directory of a path on every system', () => {
		expect(dirOf('/Users/me/Desktop/a.txt')).toBe('/Users/me/Desktop');
		expect(dirOf('/a')).toBe('/');
		expect(dirOf('C:\\Users\\me\\Desktop\\a.txt')).toBe('C:\\Users\\me\\Desktop');
		expect(dirOf('C:\\a.txt')).toBe('C:\\');
		expect(dirOf('/Users/me/dir/')).toBe('/Users/me');
		expect(baseName('/Users/me/Desktop/')).toBe('Desktop');
		expect(baseName('C:\\Users\\me\\OneDrive\\Desktop')).toBe('Desktop');
	});

	it("prefers the engine's directory to the first path's", () => {
		expect(writeTarget(request({ kind: 'outside_write', paths: ['/a/b/c.txt'] }))).toBe('/a/b');
		expect(writeTarget(request({ kind: 'outside_write', paths: ['/a/b/c.txt'], dir_suggestion: '/a' }))).toBe('/a');
		expect(writeTarget(request({ kind: 'command' }))).toBe('');
	});
});

describe('buildSandboxApproveOp', () => {
	it('builds the op for each answer', () => {
		expect(buildSandboxApproveOp('c1', { type: 'once' })).toEqual({ op: 'approve', call_id: 'c1', decision: 'allow' });
		expect(buildSandboxApproveOp('c1', { type: 'session' })).toEqual({ op: 'approve', call_id: 'c1', decision: 'allow', scope: 'session' });
		expect(buildSandboxApproveOp('c1', { type: 'project' })).toEqual({ op: 'approve', call_id: 'c1', decision: 'allow', scope: 'project' });
		expect(buildSandboxApproveOp('c1', { type: 'dir', path: '/d', persist: 'project' })).toEqual({
			op: 'approve',
			call_id: 'c1',
			decision: 'allow',
			add_dir: { path: '/d', persist: 'project' }
		});
	});

	it('sends a deny with its feedback, or a plain deny for none', () => {
		expect(buildSandboxApproveOp('c1', { type: 'deny', feedback: '  use the local copy  ' })).toEqual({
			op: 'approve',
			call_id: 'c1',
			decision: 'deny',
			feedback: 'use the local copy'
		});
		expect(buildSandboxApproveOp('c1', { type: 'deny', feedback: '  ' })).toEqual({ op: 'approve', call_id: 'c1', decision: 'deny' });
		expect(buildSandboxApproveOp('c1', { type: 'deny', feedback: TERMINAL_FEEDBACK }).feedback).toBe(
			'用户会在自己的终端里运行这条命令，等用户告诉你结果。'
		);
	});
});

describe('sandbox state', () => {
	it('reads the sandbox event', () => {
		expect(
			parseSandboxState({
				type: 'sandbox',
				mode: 'workspace-write',
				network: true,
				enforced: true,
				unavailable: null,
				directories: [{ path: '/d', mode: 'ro', source: 'project' }, { path: '/e', mode: 'rw', source: 'odd' }, { mode: 'rw' }]
			})
		).toEqual({
			mode: 'workspace-write',
			network: true,
			enforced: true,
			unavailable: '',
			directories: [
				{ path: '/d', mode: 'ro', source: 'project' },
				{ path: '/e', mode: 'rw', source: 'session' }
			]
		});
	});

	it('says commands are isolated only when the sandbox is in force', () => {
		const windows = parseSandboxState({ mode: 'workspace-write', enforced: false });
		expect(commandsIsolated(windows, true)).toBe(false);
		expect(commandsIsolated(parseSandboxState({ mode: 'full-access', enforced: false }), false)).toBe(false);
		expect(commandsIsolated(parseSandboxState({ mode: 'workspace-write', enforced: true }), false)).toBe(true);
		// Before the engine says anything (an older one never does): Windows has no sandbox.
		expect(commandsIsolated(null, true)).toBe(false);
		expect(commandsIsolated(null, false)).toBe(true);
	});

	it('reads the escalated record', () => {
		expect(
			parseEscalation({ type: 'escalated', call_id: 'c9', kind: 'escalation', command: 'brew install jq', justification: 'needs jq', cwd: '/w', paths: [], by: 'mode' })
		).toEqual({ callId: 'c9', what: 'escalation', command: 'brew install jq', justification: 'needs jq', cwd: '/w', paths: [], by: 'mode' });
		expect(parseEscalation({ type: 'escalated', by: 'nobody' })).toMatchObject({ what: '', by: '', command: '' });
	});
});

describe('typedCommand', () => {
	it('types one line without anything that would run it', () => {
		expect(typedCommand('sudo port install jq\n', false)).toBe('sudo port install jq');
		expect(typedCommand('sudo a\r', false)).toBe('sudo a');
		expect(typedCommand('echo\ta\u001b[201~', false)).toBe('echo a[201~');
		expect(typedCommand('  \n', true)).toBeNull();
	});

	it('types several lines only as a bracketed paste', () => {
		expect(typedCommand('sudo a\nsudo b', false)).toBeNull();
		expect(typedCommand('sudo a\r\nsudo b', true)).toBe('\u001b[200~sudo a\nsudo b\u001b[201~');
	});
});
