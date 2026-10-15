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

const styleDir = `${home}/.lynshen/styles`;
const builtin = (id: string, name: string, description: string, instructions: string) => ({
	id,
	name,
	description,
	instructions,
	source: 'builtin',
	path: null,
	truncated: false
});

export const daemonState = {
	/** Answer the skill ops as a daemon older than them does. */
	old: false,
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
	/** The reply styles (styles_list) and config.json's `reply_style`. */
	styles: {
		styles: [
			builtin('default', '默认', '不加风格，按 LynShen 默认的方式回复', ''),
			builtin('concise', '简洁', '先给结论，省掉铺垫和复述', '- 第一句给出结论或结果。\n- 不写开场白和结尾总结。'),
			builtin('explanatory', '详细讲解', '说明做法、关键决定和取舍', '- 说明做了什么，也说明为什么这样做。'),
			builtin('learning', '教学引导', '边做边讲概念，邀请你写一小段', '- 边做边讲背后的概念和原理。'),
			builtin('formal', '正式汇报', '结论、过程、验证、风险的正式报告', '- 使用正式的书面语气。'),
			{
				id: 'code-review',
				name: '代码评审',
				description: '先列问题，按严重程度排序',
				instructions: '评审时先列出问题，按严重程度从高到低排列，每条写出文件和行号。',
				source: 'user',
				path: `${styleDir}/code-review.md`,
				truncated: false
			},
			{
				id: 'release',
				name: '发布说明',
				description: '面向用户的发布说明',
				instructions: '按“新增、修复、已知问题”写，每条一句。',
				source: 'project',
				path: `${project}/.lynshen/styles/release.md`,
				truncated: false
			}
		] as Frame[],
		default: 'default',
		dirs: [
			{ scope: 'user', path: styleDir },
			{ scope: 'project', path: `${project}/.lynshen/styles` }
		],
		projectTrusted: true,
		problems: [{ path: `${styleDir}/two words.md`, message: 'the file name cannot be a style id' }]
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

function reply(op: Frame): Frame | null {
	const s = daemonState;
	const list = () => (op.backend === 'claude' ? s.claude : s.list);
	if (s.old && String(op.op).startsWith('skill') && op.op !== 'skills_catalog' && op.op !== 'skill_install')
		return { type: 'error', message: `${op.op} requires session` };
	if (s.old && String(op.op).startsWith('style')) return { type: 'error', message: `${op.op} requires session` };
	switch (op.op) {
		case 'shells':
			return s.old ? { type: 'error', message: 'shells requires session' } : shellsReply();
		case 'skills_list':
			return { type: 'skills_list', ...list() };
		case 'styles_list': {
			// The default as the page last wrote it (`write_config`).
			const calls = ((window as unknown as { __calls?: Frame[] }).__calls ?? []).filter((c) => c.command === 'write_config' && 'reply_style' in c.args.patch);
			if (calls.length) s.styles.default = calls[calls.length - 1].args.patch.reply_style;
			return { type: 'styles_list', ...s.styles };
		}
		case 'style_save': {
			const id = op.style || String(op.name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'style';
			const saved = { id, name: op.name, description: op.description ?? '', instructions: op.instructions, source: 'user', path: `${styleDir}/${id}.md`, truncated: false };
			const at = s.styles.styles.findIndex((x: Frame) => x.id === id);
			if (at >= 0) s.styles.styles[at] = saved;
			else s.styles.styles.push(saved);
			return { type: 'style_saved', style: id, path: saved.path };
		}
		case 'style_delete': {
			const found = s.styles.styles.find((x: Frame) => x.id === op.style && x.source === 'user');
			if (!found) return { type: 'error', message: `not a personal style: ${op.style}` };
			s.styles.styles = s.styles.styles.filter((x: Frame) => x !== found);
			if (s.styles.default === op.style) s.styles.default = 'default';
			return { type: 'style_deleted', style: op.style };
		}
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
