// A stand-in for `lynshen daemon` in the browser fixture: the WebSocket the
// desktop opens is this object, which says hello and answers the skill ops
// from an in-memory state. Every op sent is kept in `window.__ops`.

type Frame = Record<string, any>;

const home = '/Users/me';
const personal = `${home}/.lynshen/skills`;
const project = `${home}/code/lynshen-desktop`;

const skill = (name: string, description: string, scope: 'user' | 'shared' | 'project', dir: string, extra: Frame = {}) => ({
	name,
	description,
	path: `${dir}/${name}`,
	scope,
	enabled: true,
	toggleable: true,
	removable: scope === 'user',
	...extra
});

const connector = (extra: Frame = {}): Frame => ({
	id: 'tg-3f9a1c2b',
	platform: 'telegram',
	name: '@aogiri_home_bot',
	link: 'https://t.me/aogiri_home_bot',
	enabled: true,
	proxy: null,
	proxy_source: 'environment',
	proxy_shown: 'http://127.0.0.1:7890',
	state: 'connected',
	error: null,
	settings: { approvals: true, notify: true, max_mode: 'auto' },
	bindings: [
		{ device: 'dev-tg-1', name: 'Chad Li (@chadli)', paired_at: Date.UTC(2026, 9, 16, 2, 10), last_seen: Date.UTC(2026, 9, 16, 5, 3) }
	],
	created_at: Date.UTC(2026, 9, 16, 2, 0),
	...extra
});

export const daemonState = {
	/** Answer the skill ops as a daemon older than them does. */
	old: false,
	/** Chat connectors (Settings → 聊天连接); `chats` picks a sample:
	 *  `empty`, `error` (no proxy reaches Telegram), `old` (a daemon without
	 *  connectors), else one bot with one bound account. */
	chats: '' as string,
	connectors: [] as Frame[],
	/** The computer `shells` describes: a Mac, or a Windows PC without PowerShell 7. */
	shellsPlatform: 'macos' as 'macos' | 'windows',
	/** Leave the catalog's first request unanswered (a stuck daemon). */
	stall: false,
	/** The engine reads the community sources again in the background. */
	refreshing: false,
	/** How long a `wait` request takes: the background refresh. */
	waitMs: 600,
	/** The catalog's sources as the engine last read them. */
	sources: [
		{ key: 'anthropic', name: 'Anthropic', origin: 'bundled', fetchedAt: null, error: null },
		{ key: 'obra/superpowers', name: 'Superpowers', origin: 'mirror', fetchedAt: Date.UTC(2026, 9, 13, 1, 30), error: null },
		{
			key: 'ComposioHQ/awesome-claude-skills',
			name: 'Composio',
			origin: 'github',
			fetchedAt: Date.UTC(2026, 9, 12, 1, 30),
			error: 'api.github.com: connection failed (Connection refused)'
		}
	] as Frame[],
	list: {
		backend: 'lynshen',
		skills: [
			skill('agent-browser', 'Browser automation for AI agents: open pages, fill forms, click and take screenshots.', 'user', personal),
			skill('frontend-design', 'Distinctive, production-grade frontend interfaces with a clear visual direction.', 'user', personal),
			skill('grill-me', 'Interview the user about a plan or design until every branch of the decision tree is resolved.', 'user', personal, { enabled: false }),
			skill('code-review', 'Review the current diff for correctness bugs, then suggest simplifications. Imported from Claude Code.', 'user', personal, { path: `${personal}/Code_Review` }),
			skill('ste-writing', 'Write technical prose in Simplified Technical English: reports, READMEs, release notes.', 'user', personal),
			skill('release-notes', 'Short release notes for this repository, titled by version and how well it was tested.', 'user', personal),
			skill('notes', 'Keep working notes in a NOTES.md beside the code; read them before each task.', 'shared', `${home}/.agents/skills`),
			skill('deploy-preview', 'Build the web bundle and deploy a preview to the staging host.', 'project', `${project}/.agents/skills`)
		],
		problems: [
			{ level: 'warning', kind: 'duplicate', path: `${home}/.agents/skills/frontend-design`, message: `same name as ${personal}/frontend-design` },
			{ level: 'warning', kind: 'no_description', path: `${personal}/scratch/SKILL.md`, message: 'no description, so the skill is not loaded' }
		],
		dirs: [
			{ scope: 'user', path: personal },
			{ scope: 'shared', path: `${home}/.agents/skills` },
			{ scope: 'project', path: `${project}/.lynshen/skills` },
			{ scope: 'project', path: `${project}/.agents/skills` }
		],
		projectTrusted: true
	} as Frame,
	claude: {
		backend: 'claude',
		skills: [
			skill('frontend-design', 'Distinctive, production-grade frontend interfaces.', 'user', `${home}/.claude/skills`, { toggleable: false }),
			skill('mcp-builder', 'Guide for building high-quality MCP servers.', 'user', `${home}/.claude/skills`, { toggleable: false })
		],
		problems: [],
		dirs: [{ scope: 'user', path: `${home}/.claude/skills` }],
		projectTrusted: null
	} as Frame,
	catalog: ([
		['algorithmic-art', 'Algorithmic art', 'Create generative art with p5.js: seeded randomness, flow fields and particle systems.', ['art', 'design']],
		['brand-guidelines', 'Brand guidelines', 'Apply Anthropic’s brand colors and typography to artifacts.', ['design']],
		['canvas-design', 'Canvas design', 'Make posters and visual art as .png and .pdf with design philosophy.', ['design']],
		['docx', 'Word documents', 'Create, edit and analyze .docx files with tracked changes and comments.', ['documents'], false],
		['frontend-design', 'Frontend design', 'Distinctive, production-grade frontend interfaces that avoid generic AI looks.', ['design', 'web'], true, true],
		['mcp-builder', 'MCP builder', 'Guide for building high-quality MCP servers that let models use outside services.', ['development']],
		['pdf', 'PDF', 'Extract text and tables, fill forms, merge and split PDF files.', ['documents'], false],
		['skill-creator', 'Skill creator', 'Create new skills and improve existing ones, with evaluations.', ['development']],
		['webapp-testing', 'Web app testing', 'Test local web applications with Playwright: screenshots, logs and checks.', ['development', 'web']],
		['theme-factory', 'Theme factory', 'Style slides, docs and pages with ten preset themes or a new one.', ['design']]
	] as any[][])
		.map(([id, name, description, tags, redistributable = true, installed = false]) => ({
			id,
			name,
			description,
			tags,
			source: 'anthropic',
			sourceName: 'Anthropic',
			isDefault: false,
			installed,
			license: redistributable ? 'Apache-2.0' : 'Proprietary',
			redistributable,
			homepage: `https://github.com/anthropics/skills/tree/main/skills/${id}`
		}))
		.concat(
			[
				['brainstorming', 'Turn a rough idea into a design through questions, before any code is written.'],
				['systematic-debugging', 'Find the root cause first: reproduce, isolate, then fix with a test.'],
				['test-driven-development', 'Write the failing test, make it pass, then refactor.'],
				['writing-plans', 'Break an approved design into small, verifiable implementation steps.']
			].map(([id, description]) => ({
				id,
				name: id,
				description,
				tags: [],
				source: 'obra/superpowers',
				sourceName: 'Superpowers',
				isDefault: false,
				installed: id === 'brainstorming',
				license: '',
				redistributable: true,
				homepage: `https://github.com/obra/superpowers/tree/HEAD/skills/${id}`
			}))
		)
		.concat([
			{
				id: 'changelog-generator',
				name: 'changelog-generator',
				description: 'Turn the commits since the last release into a changelog for users.',
				tags: [],
				source: 'ComposioHQ/awesome-claude-skills',
				sourceName: 'Composio',
				isDefault: false,
				installed: false,
				license: '',
				redistributable: true,
				homepage: 'https://github.com/ComposioHQ/awesome-claude-skills/tree/HEAD/changelog-generator'
			}
		]) as Frame[]
};

/** The shell settings as the page last wrote them (`write_config`). */
function shellSettings(): { shell: string; terminal_shell: string | null } {
	const settings = { shell: 'auto', terminal_shell: null as string | null };
	const calls = ((window as unknown as { __calls?: Frame[] }).__calls ?? []).filter((c) => c.command === 'write_config');
	for (const call of calls) {
		if ('shell' in call.args.patch) settings.shell = call.args.patch.shell;
		if ('terminal_shell' in call.args.patch) settings.terminal_shell = call.args.patch.terminal_shell;
	}
	return settings;
}

/** The `shells` reply: a Mac with zsh and bash, or a Windows PC with
 *  Windows PowerShell and Git Bash but no PowerShell 7. */
function shellsReply(): Frame {
	const { shell, terminal_shell } = shellSettings();
	const windows = daemonState.shellsPlatform === 'windows';
	const shells = windows
		? [
				{ id: 'pwsh', name: 'PowerShell 7', installed: false, path: null, version: null },
				{ id: 'powershell', name: 'Windows PowerShell 5.1', installed: true, path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', version: '5.1.22621.4391' },
				{ id: 'gitbash', name: 'Git Bash', installed: true, path: 'C:\\Program Files\\Git\\bin\\bash.exe', version: '5.2.37' }
			]
		: [
				{ id: 'zsh', name: 'zsh', installed: true, path: '/bin/zsh', version: '5.9' },
				{ id: 'bash', name: 'bash', installed: true, path: '/bin/bash', version: '3.2.57' },
				{ id: 'sh', name: 'sh', installed: true, path: '/bin/sh', version: 'bash 3.2.57' }
			];
	const auto = windows ? shells[2] : shells[0];
	const chosen = shells.find((x) => x.id === shell && x.installed) ?? auto;
	const notes = shell !== 'auto' && chosen.id !== shell ? [`${shell} is not installed; commands run in ${chosen.name}`] : [];
	const terminal = shells.find((x) => x.id === (terminal_shell ?? shell) && x.installed) ?? auto;
	return {
		type: 'shells',
		platform: daemonState.shellsPlatform,
		shell,
		terminal_shell,
		auto: { id: auto.id, path: auto.path },
		auto_order: windows ? ['gitbash', 'pwsh', 'powershell'] : ['login', 'zsh', 'bash', 'sh'],
		shells,
		commands: {
			id: chosen.id,
			name: chosen.name,
			label: chosen.name,
			path: chosen.path,
			version: chosen.version,
			login: false,
			snapshot: !windows,
			notes,
			helper: chosen.id === 'gitbash' ? { id: 'powershell', name: 'Windows PowerShell 5.1', version: '5.1.22621.4391' } : null
		},
		terminal: { program: terminal.path, args: terminal.id === 'gitbash' ? ['--login', '-i'] : windows ? ['-NoLogo'] : ['-l'], env: {} }
	};
}

/** The connector ops, as the daemon answers them (LynShen-CLI docs/chat-connectors.md). */
function connectorReply(op: Frame): Frame | null {
	const s = daemonState;
	const list = () => ({ type: 'connectors', connectors: s.connectors });
	const found = s.connectors.find((c) => c.id === op.connector);
	if (s.chats === 'old' && String(op.op).startsWith('connector_')) return { type: 'error', message: `${op.op} requires session` };
	switch (op.op) {
		case 'connector_list':
			return list();
		case 'connector_add': {
			const n = s.connectors.length + 1;
			let added: Frame;
			if (op.platform === 'qq') {
				if (!/^\d+$/.test(String(op.app_id ?? '')) || String(op.secret ?? '').length < 8) return { type: 'error', message: 'the QQ AppID is a number (QQ 开放平台 → 开发设置)' };
				added = connector({ id: `qq-${n}`, platform: 'qq', name: '@梧桐助手', link: null, state: 'connecting', proxy: null, proxy_source: 'none', proxy_shown: null, bindings: [] });
			} else if (op.platform === 'discord') {
				if (String(op.token ?? '').split('.').length !== 3) return { type: 'error', message: 'this is not a Discord bot token' };
				added = connector({ id: `dc-${n}`, platform: 'discord', name: '@aogiri_dc', link: 'https://discord.com/oauth2/authorize?client_id=777&scope=bot&permissions=0', state: 'connecting', proxy: op.proxy ?? null, bindings: [] });
			} else {
				if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(String(op.token ?? '').trim())) return { type: 'error', message: 'this is not a Telegram bot token (@BotFather gives one like 123456789:AA…)' };
				if (String(op.token).includes('REVOKED')) return { type: 'error', message: 'Telegram does not know this token: copy it again from @BotFather' };
				added = connector({ id: `tg-${n}`, name: '@aogiri_work_bot', link: 'https://t.me/aogiri_work_bot', state: 'connecting', proxy: op.proxy ?? null, proxy_source: op.proxy ? 'setting' : 'environment', proxy_shown: op.proxy ?? 'http://127.0.0.1:7890', bindings: [] });
			}
			s.connectors.push(added);
			return { type: 'connector_added', connector: added };
		}
		case 'connector_set': {
			if (!found) return { type: 'error', message: 'connector_set requires a known connector' };
			if (typeof op.enabled === 'boolean') Object.assign(found, { enabled: op.enabled, state: op.enabled ? 'connecting' : 'stopped', error: null });
			for (const key of ['approvals', 'notify', 'max_mode']) if (key in op) found.settings[key] = op[key];
			if ('proxy' in op) Object.assign(found, { proxy: op.proxy || null, proxy_source: op.proxy === 'direct' ? 'none' : op.proxy ? 'setting' : 'environment', proxy_shown: op.proxy && op.proxy !== 'direct' ? op.proxy : op.proxy ? null : 'http://127.0.0.1:7890' });
			return list();
		}
		case 'connector_remove':
			s.connectors = s.connectors.filter((c) => c.id !== op.connector);
			return { type: 'connector_removed', connector: op.connector };
		case 'connector_bind_start':
			if (!found) return { type: 'error', message: 'connector_bind_start requires a known connector' };
			return { type: 'connector_bind_code', connector: found.id, code: 'K7QXA2B9', expires_at: Date.now() + 5 * 60_000, link: found.platform === 'telegram' ? `${found.link}?start=K7QXA2B9` : null };
		case 'device_revoke':
			for (const c of s.connectors) c.bindings = c.bindings.filter((b: Frame) => b.device !== op.device);
			return { type: 'device_revoked', device: op.device };
		// 远程访问 lists the phones; a chat account is a device too, of kind chat.
		case 'device_list':
			return {
				type: 'devices',
				devices: [
					{ id: 'dev-phone', name: 'iPhone', paired_at: Date.UTC(2026, 9, 12), kind: 'device', last_seen: null },
					...s.connectors.flatMap((c) => c.bindings.map((b: Frame) => ({ id: b.device, name: b.name, paired_at: b.paired_at, kind: 'chat', platform: 'telegram', connector: c.id, last_seen: b.last_seen })))
				]
			};
		case 'relay_status':
			return { type: 'relay_status', enabled: false, connected: false, host: null, url: 'wss://app.lynshen.org/relay/v1' };
		default:
			return null;
	}
}

/** The sample connectors for `daemonState.chats`. */
export function chatSample(kind: string): Frame[] {
	if (kind === 'empty' || kind === 'old') return [];
	if (kind === 'all')
		return [
			connector(),
			connector({ id: 'dc-7a1b', platform: 'discord', name: '@aogiri_dc', link: 'https://discord.com/oauth2/authorize?client_id=777&scope=bot&permissions=0', bindings: [{ device: 'dev-dc-1', name: 'Chad (@chad)', paired_at: Date.UTC(2026, 9, 16, 3), last_seen: null }] }),
			connector({ id: 'qq-102030405', platform: 'qq', name: '@梧桐助手', link: null, proxy_source: 'none', proxy_shown: null, bindings: [] })
		];
	if (kind === 'error')
		return [connector({ state: 'error', proxy_source: 'none', proxy_shown: null, error: 'cannot reach Telegram: https://api.telegram.org/bot<token>/getUpdates: Connection Failed: Connect error: connection timed out', bindings: [] })];
	return [connector()];
}

function reply(op: Frame): Frame | null {
	const s = daemonState;
	if (String(op.op).startsWith('connector_') || ['device_revoke', 'device_list', 'relay_status'].includes(op.op)) return connectorReply(op);
	const list = () => (op.backend === 'claude' ? s.claude : s.list);
	if (s.old && String(op.op).startsWith('skill') && op.op !== 'skills_catalog' && op.op !== 'skill_install')
		return { type: 'error', message: `${op.op} requires session` };
	switch (op.op) {
		case 'shells':
			return s.old ? { type: 'error', message: 'shells requires session' } : shellsReply();
		case 'skills_list':
			return { type: 'skills_list', ...list() };
		case 'skill_set_enabled': {
			const found = s.list.skills.find((x: Frame) => x.path === op.path);
			if (!found) return { type: 'error', message: `no such skill: ${op.path}` };
			found.enabled = op.enabled;
			return { type: 'skills_list', ...s.list };
		}
		case 'skill_uninstall': {
			if (op.skill) {
				const item = s.catalog.find((x) => x.id === op.skill);
				if (item) item.installed = false;
				return { type: 'skill_uninstalled', path: `${personal}/${op.skill}` };
			}
			list().skills = list().skills.filter((x: Frame) => x.path !== op.path);
			return { type: 'skill_uninstalled', path: op.path };
		}
		case 'skill_create':
			s.list.skills.push(skill(op.name, op.description, 'user', personal));
			return { type: 'skill_created', path: `${personal}/${op.name}/SKILL.md` };
		case 'skills_catalog': {
			if (s.stall && !op.wait) return null;
			if (op.refresh) s.refreshing = true;
			// The refresh ends: every source read.
			if (op.wait && s.refreshing) {
				s.refreshing = false;
				for (const source of s.sources) if (source.origin !== 'bundled') Object.assign(source, { origin: 'mirror', fetchedAt: Date.now(), error: null });
			}
			const failed = s.sources.filter((x) => x.error);
			const catalog: Frame = {
				type: 'skills_catalog',
				skills: s.catalog,
				warnings: s.old ? ['Composio: GitHub API rate limit exceeded'] : failed.map((x) => `${x.name}: ${x.error}`),
				installDir: op.backend === 'claude' ? `${home}/.claude/skills` : personal
			};
			// An engine before the cached catalog reports no sources.
			return s.old ? catalog : { ...catalog, sources: s.sources, refreshing: s.refreshing };
		}
		case 'skill_install': {
			const item = s.catalog.find((x) => x.id === op.skill);
			if (op.skill === 'mcp-builder') return { type: 'error', message: 'GitHub returned 403 for the skill tree' };
			if (item) item.installed = true;
			return { type: 'skill_installed', path: `${personal}/${op.skill}` };
		}
		default:
			return typeof op.id === 'number' ? { type: 'error', message: `${op.op} requires session` } : null;
	}
}

export function installFakeDaemon() {
	const ops: Frame[] = [];
	class FakeSocket {
		readyState = 1;
		onmessage: ((e: { data: string }) => void) | null = null;
		onerror: (() => void) | null = null;
		onclose: (() => void) | null = null;
		constructor() {
			setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'hello', protocol: 2, version: 'test' }) }));
		}
		send(text: string) {
			const op = JSON.parse(text) as Frame;
			ops.push(op);
			const answer = reply(op);
			if (answer) setTimeout(() => this.onmessage?.({ data: JSON.stringify({ ...answer, id: op.id }) }), op.wait ? daemonState.waitMs : 30);
		}
		close() {}
	}
	Object.assign(window, { WebSocket: FakeSocket, __ops: ops, __daemon: daemonState });
}
