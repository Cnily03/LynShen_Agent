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

export const daemonState = {
	/** Answer the skill ops as a daemon older than them does. */
	old: false,
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

function reply(op: Frame): Frame | null {
	const s = daemonState;
	const list = () => (op.backend === 'claude' ? s.claude : s.list);
	if (s.old && String(op.op).startsWith('skill') && op.op !== 'skills_catalog' && op.op !== 'skill_install')
		return { type: 'error', message: `${op.op} requires session` };
	switch (op.op) {
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
