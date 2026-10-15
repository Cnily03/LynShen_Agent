import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setLocale, t } from '$lib/i18n';
import { autoLabel, currentLabel, fellBack, INSTALL, missingShells, sandboxInstead, shellLabel, shellOptions, type ShellsReply } from './shells';
import { runCommand, terminalRequests } from './sandbox/terminal.svelte';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('$lib/protocol', () => ({
	daemon: { connect: () => Promise.resolve(), request: (op: unknown) => request(op) },
	isUnknownOp: (error: unknown, op: string) => String(error).includes(`${op} requires session`)
}));

const windows = (fields: Partial<ShellsReply> = {}): ShellsReply => ({
	platform: 'windows',
	shell: 'auto',
	terminal_shell: null,
	auto: { id: 'gitbash', path: 'C:\\Program Files\\Git\\bin\\bash.exe' },
	auto_order: ['gitbash', 'pwsh', 'powershell'],
	shells: [
		{ id: 'pwsh', name: 'PowerShell 7', installed: false, path: null, version: null },
		{ id: 'powershell', name: 'Windows PowerShell 5.1', installed: true, path: 'C:\\Windows\\powershell.exe', version: '5.1.22621.4391' },
		{ id: 'gitbash', name: 'Git Bash', installed: true, path: 'C:\\Program Files\\Git\\bin\\bash.exe', version: '5.2.37' }
	],
	commands: {
		id: 'gitbash',
		name: 'Git Bash',
		label: 'Git Bash (bash 5.2.37)',
		path: 'C:\\Program Files\\Git\\bin\\bash.exe',
		version: '5.2.37',
		login: true,
		snapshot: false,
		notes: [],
		helper: { id: 'powershell', name: 'Windows PowerShell 5.1', version: '5.1.22621.4391' }
	},
	terminal: { program: 'C:\\Program Files\\Git\\bin\\bash.exe', args: ['--login', '-i'], env: { CHERE_INVOKING: '1' } },
	...fields
});

const mac = (fields: Partial<ShellsReply> = {}): ShellsReply => ({
	platform: 'macos',
	shell: 'auto',
	terminal_shell: null,
	auto: { id: 'zsh', path: '/bin/zsh' },
	auto_order: ['login', 'zsh', 'bash', 'sh'],
	shells: [
		{ id: 'zsh', name: 'zsh', installed: true, path: '/bin/zsh', version: '5.9' },
		{ id: 'bash', name: 'bash', installed: true, path: '/bin/bash', version: '3.2.57' },
		{ id: 'sh', name: 'sh', installed: false, path: null, version: null }
	],
	commands: { id: 'zsh', name: 'zsh', label: 'zsh 5.9', path: '/bin/zsh', version: '5.9', login: false, snapshot: true, notes: [], helper: null },
	terminal: { program: '/bin/zsh', args: ['-l'], env: {} },
	...fields
});

const labels = (reply: ShellsReply, value: string, follow = false) => shellOptions(reply, value, t, follow).map((o) => `${o.value}=${o.label}`);

beforeEach(() => setLocale('zh'));

describe('shell options', () => {
	it('names each shell with its version', () => {
		expect(shellLabel('pwsh', '7.5.2')).toBe('PowerShell 7.5.2');
		expect(shellLabel('pwsh', null)).toBe('PowerShell 7');
		expect(shellLabel('powershell', '5.1.22621.4391')).toBe('Windows PowerShell 5.1.22621.4391');
		expect(shellLabel('gitbash', '5.2.37')).toBe('Git Bash 5.2.37');
		expect(shellLabel('zsh', '5.9')).toBe('zsh 5.9');
		expect(shellLabel('sh', 'bash 3.2.57')).toBe('sh (bash 3.2.57)');
	});

	it('on Windows: auto in its order, PowerShell 7 even when missing, Git Bash once installed', () => {
		expect(autoLabel(windows(), t)).toBe('自动（推荐：Git Bash，没有时用 PowerShell 7，再没有时用 Windows PowerShell 5.1）');
		// PowerShell 7 first: Windows PowerShell is always there, so Git Bash is never reached.
		expect(autoLabel(windows({ auto_order: ['pwsh', 'powershell', 'gitbash'] }), t)).toBe('自动（推荐：PowerShell 7，没有时用 Windows PowerShell 5.1）');
		expect(labels(windows(), 'auto').slice(1)).toEqual([
			'pwsh=PowerShell 7（未安装）',
			'powershell=Windows PowerShell 5.1.22621.4391',
			'gitbash=Git Bash 5.2.37'
		]);
		const noGit = windows();
		noGit.shells[2] = { ...noGit.shells[2], installed: false, path: null, version: null };
		expect(labels(noGit, 'auto').map((l) => l.split('=')[0])).toEqual(['auto', 'pwsh', 'powershell']);
		// Chosen and since removed: still listed, marked.
		expect(labels(noGit, 'gitbash')).toContain('gitbash=Git Bash（未安装）');
		setLocale('en');
		expect(autoLabel(windows(), t)).toBe('Auto (recommended: Git Bash, else PowerShell 7, then Windows PowerShell 5.1)');
	});

	it('on macOS: auto names the login shell, only installed shells are offered', () => {
		expect(autoLabel(mac(), t)).toBe('自动（推荐：登录 shell，现在是 zsh）');
		expect(labels(mac(), 'auto')).toEqual(['auto=自动（推荐：登录 shell，现在是 zsh）', 'zsh=zsh 5.9', 'bash=bash 3.2.57']);
		// A path in config.json stays choosable.
		expect(labels(mac({ shell: '/opt/homebrew/bin/bash' }), '/opt/homebrew/bin/bash').at(-1)).toBe(
			'/opt/homebrew/bin/bash=自定义：/opt/homebrew/bin/bash'
		);
		// The terminal's list starts with following the commands' shell.
		expect(labels(mac(), '', true).slice(0, 2)).toEqual(['=跟随命令使用的 Shell', 'auto=自动（推荐：登录 shell，现在是 zsh）']);
	});

	it('offers to install a missing PowerShell 7 and Git Bash with winget', () => {
		expect(INSTALL.pwsh.command).toBe('winget install --id Microsoft.PowerShell -e --source winget');
		expect(INSTALL.gitbash.command).toBe('winget install --id Git.Git -e --source winget');
		expect(missingShells(windows()).map((s) => s.id)).toEqual(['pwsh']);
		const bare = windows();
		bare.shells = bare.shells.map((s) => (s.id === 'powershell' ? s : { ...s, installed: false, path: null, version: null }));
		expect(missingShells(bare).map((s) => s.id)).toEqual(['pwsh', 'gitbash']);
		expect(missingShells(mac())).toEqual([]);
	});

	it('tells when the chosen shell is not the one that runs', () => {
		expect(fellBack(windows())).toBe(false);
		expect(fellBack(windows({ shell: 'pwsh' }))).toBe(true);
		expect(fellBack(windows({ shell: 'gitbash' }))).toBe(false);
		expect(fellBack(mac({ shell: '/bin/zsh' }))).toBe(false);
		expect(fellBack(mac({ shell: '/usr/local/bin/fish' }))).toBe(true);
		// The Windows sandbox runs PowerShell instead of Git Bash: said as
		// that, not as a missing shell.
		const pwsh = { id: 'pwsh', name: 'PowerShell 7', label: 'PowerShell 7.5.2', path: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', version: '7.5.2', login: true, snapshot: false, notes: ['Git Bash cannot run in the Windows sandbox (preview): commands run in PowerShell 7 instead'], helper: null, instead_of: 'gitbash' };
		for (const shell of ['gitbash', 'auto']) {
			const reply = windows({ shell, commands: pwsh });
			expect(sandboxInstead(reply)).toBe(true);
			expect(fellBack(reply)).toBe(false);
		}
		expect(sandboxInstead(windows())).toBe(false);
		expect(currentLabel(windows())).toBe('Git Bash 5.2.37');
	});
});

describe('安装 in the terminal panel', () => {
	it('types the command and presses Enter', () => {
		expect(runCommand(INSTALL.pwsh.command, false)).toBe('winget install --id Microsoft.PowerShell -e --source winget\r');
		expect(runCommand('winget install x', true)).toBe('\u001b[200~winget install x\u001b[201~\r');
		expect(runCommand('a\nb', true)).toBeNull();
		expect(runCommand('  ', false)).toBeNull();
	});

	it('hands the tab its command once, with whether to run it', () => {
		terminalRequests.open(INSTALL.gitbash.command, '', '', true);
		expect(terminalRequests.request?.run).toBe(true);
		terminalRequests.assign('tab-1', { cwd: '', command: INSTALL.gitbash.command, run: true });
		expect(terminalRequests.take('tab-1')).toEqual({ command: INSTALL.gitbash.command, run: true });
		expect(terminalRequests.take('tab-1')).toBeNull();
		terminalRequests.assign('tab-2', { cwd: '/w', command: 'sudo make install' });
		expect(terminalRequests.take('tab-2')).toEqual({ command: 'sudo make install', run: false });
	});
});

describe('the shells store', () => {
	it('opens the terminal the reply names, and the default without the op', async () => {
		vi.resetModules();
		const { shells } = await import('./shellStore.svelte');
		request.mockRejectedValueOnce(new Error('shells requires session'));
		expect(await shells.terminal()).toBeNull();
		expect(shells.unsupported).toBe(true);
		request.mockResolvedValueOnce(mac());
		await shells.load(true);
		expect(shells.unsupported).toBe(false);
		expect(await shells.terminal()).toEqual({ program: '/bin/zsh', args: ['-l'], env: {} });
		expect(request).toHaveBeenLastCalledWith({ op: 'shells', refresh: true });
	});

	it('does not hold the first terminal for a slow daemon', async () => {
		vi.resetModules();
		const { shells } = await import('./shellStore.svelte');
		request.mockReturnValueOnce(new Promise(() => {}));
		expect(await shells.terminal(20)).toBeNull();
	});
});
