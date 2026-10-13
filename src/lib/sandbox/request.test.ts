import { describe, it, expect } from 'vitest';
import {
	approvalChoices,
	baseName,
	buildSandboxApproveOp,
	commandsIsolated,
	parseEscalation,
	parseSandboxRequest,
	parseSandboxState,
	TERMINAL_FEEDBACK,
	type SandboxRequest
} from './request';
import { cleanCommand, typedCommand } from './terminal.svelte';

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

	it('reads malformed fields as the narrowest answer', () => {
		const req = request({
			kind: 'escalation',
			must_ask: 'false',
			scopes: 'session',
			prefix: 42,
			dir_suggestion: ['/Users/me'],
			paths: '/Users/me/x',
			command: { run: 'rm -rf ~' },
			elevation: true,
			justification: 'x'.repeat(200000)
		});
		expect(req).toMatchObject({ scopes: ['once'], prefix: '', dirSuggestion: '', paths: [], command: '', elevation: null });
		expect(approvalChoices(req, { terminal: true })).toMatchObject({ session: false, project: false, pathSession: false, pathProject: false, terminal: false });
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

	it('needs a prefix for a command allow, not for an edit or a tool', () => {
		expect(approvalChoices(request({ kind: 'command', scopes: ['once', 'session', 'project'] }))).toMatchObject({ session: false, project: false });
		expect(approvalChoices(request({ kind: 'edit', scopes: ['once', 'session'] }))).toMatchObject({ session: true, project: false });
		expect(approvalChoices(request({ kind: 'tool', name: 'mcp__srv__lookup', scopes: ['once', 'session'] }))).toMatchObject({ session: true, project: false });
		expect(approvalChoices(request({ kind: 'tool', scopes: ['once'] }))).toMatchObject({ session: false, project: false });
		// a manual-mode command in the sandbox: once and the session only
		expect(approvalChoices(request({ kind: 'command', prefix: 'npm test', scopes: ['once', 'session'] }))).toMatchObject({ session: true, project: false });
	});

	it("answers a write outside the workspace for the engine's directory, though it allows the write once only", () => {
		// a file tool's write, and a command whose text writes outside
		for (const command of [null, 'cp shot.png ~/Desktop/']) {
			const c = approvalChoices(
				request({ kind: 'outside_write', command, paths: ['/Users/me/Desktop/a.txt'], dir_suggestion: '/Users/me/Desktop', prefix: command ? 'cp shot.png' : null, scopes: ['once'] })
			);
			expect(c).toMatchObject({ session: false, project: false, pathSession: true, pathProject: true, target: '/Users/me/Desktop' });
		}
	});

	it('offers no directory the engine did not suggest', () => {
		// ~/notes.txt: the engine withholds the home directory (and a root, the credentials)
		const home = approvalChoices(request({ kind: 'outside_write', paths: ['/Users/me/notes.txt'], dir_suggestion: null, scopes: ['once', 'session', 'project'] }));
		expect(home).toMatchObject({ pathSession: false, pathProject: false, target: '' });
		const root = approvalChoices(request({ kind: 'outside_write', paths: ['/etc'], scopes: ['once'] }));
		expect(root).toMatchObject({ pathSession: false, pathProject: false, target: '' });
		// a must-ask request is allowed once at most, whatever it suggests
		const sudo = approvalChoices(
			request({ kind: 'elevation', must_ask: true, command: 'sudo cp x /usr/local/bin/', paths: ['/usr/local/bin/x'], dir_suggestion: '/usr/local/bin', scopes: ['once'] })
		);
		expect(sudo).toMatchObject({ session: false, project: false, pathSession: false, pathProject: false });
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
	it('takes the last part of a path on every system', () => {
		expect(baseName('/Users/me/Desktop/')).toBe('Desktop');
		expect(baseName('C:\\Users\\me\\OneDrive\\Desktop')).toBe('Desktop');
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
		expect(typedCommand('sudo a\rsudo b', false)).toBeNull();
		expect(typedCommand('sudo a\r\nsudo b', true)).toBe('\u001b[200~sudo a\nsudo b\u001b[201~');
	});

	it('pastes even one line where the shell takes a bracketed paste', () => {
		expect(typedCommand('sudo port install jq', true)).toBe('\u001b[200~sudo port install jq\u001b[201~');
	});

	it('never lets the command end the paste or send a control key', () => {
		// the end marker inside the command, then a line that would run
		const typed = typedCommand('echo a\u001b[201~\nrm -rf ~', true) ?? '';
		expect(typed).toBe('\u001b[200~echo a[201~\nrm -rf ~\u001b[201~');
		expect(typed.split('\u001b[201~')).toHaveLength(2);
		// 8-bit CSI, Ctrl-C, Ctrl-J (a newline is only ever \n), Ctrl-M, Ctrl-O, Ctrl-D, DEL, ESC
		const nasty = 'sudo a\u009b201~\u0003\u000f\u0004\u007f\u001bOM\u0085b';
		expect(typedCommand(nasty, false)).toBe('sudo a201~OMb');
		expect(typedCommand(nasty, true)).toBe('\u001b[200~sudo a201~OMb\u001b[201~');
		for (const raw of ['a\u0000b', 'a\u0008b', 'a\u001ab', 'a\u001cb', 'a\u0090b'])
			expect(typedCommand(raw, false)).toBe('ab');
	});

	it('copies a command of several lines cleaned the same way', () => {
		expect(cleanCommand('sudo a\u001b[201~\r\nsudo\tb\u0003\n')).toBe('sudo a[201~\nsudo b');
	});
});
