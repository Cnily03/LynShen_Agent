// The shell LynShen's commands and the terminal panel run in: `shell` and
// `terminal_shell` in ~/.lynshen/config.json (the engine's docs/sandbox.md,
// "Shell"). The daemon's `shells` op lists the shells this computer has,
// with their versions, and what each setting comes to; a daemon before it
// answers `shells requires session` (see `isUnknownOp`).

export interface ShellEntry {
	/** `pwsh`, `powershell`, `gitbash` (Windows); `zsh`, `bash`, `sh`. */
	id: string;
	name: string;
	installed: boolean;
	path: string | null;
	version: string | null;
}

/** What a terminal opens: the program, its arguments and the variables it adds. */
export interface TerminalShell {
	program: string;
	args: string[];
	env: Record<string, string>;
}

export interface ShellsReply {
	platform: 'windows' | 'macos' | 'linux';
	/** The settings as config.json has them; `terminal_shell` null follows `shell`. */
	shell: string;
	terminal_shell: string | null;
	/** What `auto` takes on this computer now. */
	auto: { id: string; path: string };
	/** What `auto` tries, in order; `login` is the user's login shell. */
	auto_order: string[];
	shells: ShellEntry[];
	/** What the model's commands run in now. */
	commands: {
		id: string;
		name: string;
		label: string;
		path: string;
		version: string | null;
		login: boolean;
		/** Commands have the login shell's environment (zsh, bash). */
		snapshot: boolean;
		/** Why it is not what `shell` asks (in the engine's words). */
		notes: string[];
		/** With Git Bash: the PowerShell for Windows-native work. */
		helper: { id: string; name: string; version: string | null } | null;
	};
	terminal: TerminalShell;
}

export type Translate = (key: string, vars?: Record<string, string>) => string;

/** A shell's name as the settings show it, without its version. */
export function shellName(id: string): string {
	switch (id) {
		case 'pwsh':
			return 'PowerShell 7';
		case 'powershell':
			return 'Windows PowerShell 5.1';
		case 'gitbash':
			return 'Git Bash';
		default:
			return id;
	}
}

/** A shell's name with its version: "PowerShell 7.5.2", "Windows
 *  PowerShell 5.1.22621.4391", "Git Bash 5.2.37", "zsh 5.9". */
export function shellLabel(id: string, version?: string | null): string {
	if (!version) return shellName(id);
	switch (id) {
		case 'pwsh':
			return `PowerShell ${version}`;
		case 'powershell':
			return `Windows PowerShell ${version}`;
		case 'gitbash':
			return `Git Bash ${version}`;
		case 'sh':
			return `sh (${version})`;
		default:
			return `${id} ${version}`;
	}
}

/** Installing a shell that is missing (Windows): the winget command 安装
 *  types and runs in the terminal panel, and the official download page. */
export const INSTALL: Record<string, { command: string; url: string }> = {
	pwsh: {
		command: 'winget install --id Microsoft.PowerShell -e --source winget',
		url: 'https://learn.microsoft.com/powershell/scripting/install/installing-powershell-on-windows'
	},
	gitbash: {
		command: 'winget install --id Git.Git -e --source winget',
		url: 'https://git-scm.com/downloads/win'
	}
};

/** The shells to offer an install for: the installable ones not installed. */
export function missingShells(reply: ShellsReply): ShellEntry[] {
	return reply.shells.filter((s) => !s.installed && INSTALL[s.id]);
}

/** The `auto` option: on Windows its order ("Git Bash, else PowerShell 7,
 *  then Windows PowerShell 5.1"; nothing after Windows PowerShell, which
 *  every Windows has), elsewhere the login shell it takes now. */
export function autoLabel(reply: ShellsReply, tr: Translate): string {
	let order = reply.auto_order.filter((id) => id !== 'login');
	const last = order.indexOf('powershell');
	if (last >= 0) order = order.slice(0, last + 1);
	if (reply.platform === 'windows' && order.length) {
		const [first, ...rest] = order.map(shellName);
		if (!rest.length) return tr('settings.shells.autoOne', { first });
		return tr('settings.shells.autoOrder', { first, rest: rest.join(tr('settings.shells.orThen')) });
	}
	return tr('settings.shells.autoLogin', { name: reply.auto.id });
}

export type ShellOption = {
	value: string;
	label: string;
};

/** The choices of a shell setting whose value is `value`: auto, then the
 *  shells offered here — on Windows PowerShell 7 and Windows PowerShell
 *  always (7 marked 未安装 when missing) and Git Bash once installed;
 *  elsewhere only the installed ones — and the path or name in use when it
 *  is none of these. `follow`: the terminal's 跟随命令 option first ('' =
 *  no `terminal_shell`). */
export function shellOptions(reply: ShellsReply, value: string, tr: Translate, follow = false): ShellOption[] {
	const options: ShellOption[] = [];
	if (follow) options.push({ value: '', label: tr('settings.shells.followCommands') });
	options.push({ value: 'auto', label: autoLabel(reply, tr) });
	for (const s of reply.shells) {
		const always = reply.platform === 'windows' && s.id !== 'gitbash';
		if (!s.installed && !always && s.id !== value) continue;
		const label = s.installed ? shellLabel(s.id, s.version) : tr('settings.shells.notInstalled', { name: shellName(s.id) });
		options.push({ value: s.id, label });
	}
	if (value && !options.some((o) => o.value === value)) {
		options.push({ value, label: tr('settings.shells.custom', { path: value }) });
	}
	return options;
}

/** What the model's commands run in now, for the line under the setting. */
export function currentLabel(reply: ShellsReply): string {
	return shellLabel(reply.commands.id, reply.commands.version);
}

/** The chosen shell is not what runs: it is not installed (or the path is
 *  not a shell commands run in). */
export function fellBack(reply: ShellsReply): boolean {
	const chosen = reply.shell.trim() || 'auto';
	if (chosen === 'auto') return false;
	if (reply.shells.some((s) => s.id === chosen)) return reply.commands.id !== chosen;
	return reply.commands.path !== chosen;
}
