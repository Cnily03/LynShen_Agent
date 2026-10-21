<script lang="ts">
	// The pages of the agent-UX change, for the browser regressions and the
	// screenshots: Settings → 技能 (installed and marketplace tabs), 插件,
	// and the sidebar with folded sections and the archive. Also the places
	// that show the product's name: the welcome page (?welcome, ?welcome=guide)
	// and Settings → 更新 (?updates; ?updates=found with the update prompt).
	// Settings → 编码智能体 with its Shell section (?agents on a Mac,
	// ?agents=windows on a PC without PowerShell 7).
	// Settings → 回复风格 (?styles; with &oldEngine a daemon before them).
	// Settings → MCP 与扩展 with 安卓手机（Android-Use） (?mcp).
	// The welcome page as a first run shows it: ?welcome (the sign-in; with
	// &authorize the browser approves it), ?welcome=relogin (after logging
	// out: 跳过 closes it), ?welcome=guide (the walkthrough). What closed it
	// shows in [data-testid=welcome-closed].
	// ?welcome&greeting: the first run as the app runs it: the sign-in, then
	// (signed in, or 开始使用 after 跳过) the one-time greeting over the
	// workbench (Greeting.svelte). Its end shows in [data-testid=greeting-done].
	import SettingsPage from '../../src/lib/settings/SettingsPage.svelte';
	import Sidebar from '../../src/lib/Sidebar.svelte';
	import Welcome from '../../src/lib/welcome/Welcome.svelte';
	import Greeting from '../../src/lib/welcome/Greeting.svelte';
	import { GREETING_SEEN_KEY, greetingDue } from '../../src/lib/welcome/flow';
	import { afterWelcomeSignIn } from '../../src/lib/welcome/firstRun';
	import UpdatePrompt from '../../src/lib/UpdatePrompt.svelte';
	import { updater } from '../../src/lib/updater.svelte';
	import ConfirmHost from '../../src/lib/ui/ConfirmHost.svelte';
	import Toaster from '../../src/lib/ui/Toaster.svelte';
	import { SessionStore } from '../../src/lib/session.svelte';
	import { Requirements, provideRequirements } from '../../src/lib/requirements.svelte';
	import { daemon } from '../../src/lib/protocol';
	import { setLocale } from '../../src/lib/i18n';
	const mode = new URL(location.href).searchParams;
	setLocale(mode.get('lang') === 'en' ? 'en' : 'zh');
	provideRequirements(new Requirements(daemon));
	let section = $state(
		mode.has('market') ? 'market' : mode.has('plugins') ? 'plugins' : mode.has('updates') ? 'updates' : mode.has('agents') ? 'agents' : mode.has('styles') ? 'styles' : mode.has('mcp') ? 'mcp' : 'skills'
	);
	// A newer version found on launch, asking whether to update now.
	if (mode.get('updates') === 'found') {
		updater.version = '9.9.9';
		updater.phase = 'available';
		updater.asking = true;
	}

	// The sidebar's projects: a few with conversations, some archived.
	const store = new SessionStore();
	const named = (path: string, titles: string[], archived: string[] = []) => {
		const p = store.createProject(path);
		const first = p.sessions[0];
		[...titles, ...archived].forEach((title, i) => {
			const id = i === 0 ? first.id : store.addSession(p);
			store.renameSession(id, title);
			const s = store.allSessions.find((x) => x.id === id)!;
			s.draft = false;
			if (i >= titles.length) store.archiveSession(id);
		});
		return p;
	};
	if (mode.has('sidebar')) {
		named('/Users/me/code/lynshen-desktop', ['技能页对标 ZCode', '侧栏归档入口', '修复模型选择器位置'], ['旧的发布脚本', '试验：玻璃效果']);
		named('/Users/me/code/LynShen-CLI', ['daemon 技能开关', 'clippy 清理'], ['0.4.30 发布']);
		named('/Users/me/code/gateway', ['CDN 客户端 IP'], ['Caddy 配置迁移', '限流调整', '日志轮转']);
	}
	let active = $state('');
	let welcomeOpen = $state(true);
	let greeting = $state(false);
	let greetingName = $state('');
	let greetingEnds = $state(0);
	function firstRunEnded(name: string) {
		if (!mode.has('greeting') || mode.get('welcome') === 'relogin') return;
		if (!greetingDue(true, !!localStorage.getItem(GREETING_SEEN_KEY))) return;
		greetingName = name;
		greeting = true;
	}
	let closedBy = $state('');
	const projects = $derived(store.userProjects);
</script>

<ConfirmHost />
<Toaster />
{#if mode.has('sidebar')}
	<div class="sb-frame" data-testid="sidebar">
		<Sidebar
			{projects}
			activeId={active}
			width={292}
			onSelect={(id) => (active = id)}
			onNewProject={() => {}}
			onNewSession={() => {}}
			onNewChat={() => {}}
			onNewTask={() => {}}
			onCloseSession={() => {}}
			onCloseProject={() => {}}
			onArchiveSession={(id) => store.archiveSession(id)}
			onUnarchiveSession={(id) => store.unarchiveSession(id)}
			onPinSession={() => {}}
			onMoveSession={() => {}}
			onMoveProject={() => {}}
			onRenameSession={() => {}}
			onSessionMenu={() => {}}
			onProjectMenu={() => {}}
			onHistory={() => {}}
			footer={{ loggedIn: true, onManageAccount: () => {}, onSettings: () => {}, onUpdate: () => {}, onLoggedOut: () => {} }}
		/>
		<div class="canvas-stub"></div>
	</div>
{:else if mode.has('welcome')}
	{#if !welcomeOpen && mode.has('greeting')}
		<div class="canvas-stub greeting-stub" data-testid="workbench"><textarea aria-label="composer" data-testid="composer"></textarea></div>
	{/if}
	{#if greeting}
		<Greeting
			name={greetingName}
			onDone={() => {
				localStorage.setItem(GREETING_SEEN_KEY, '1');
				greeting = false;
				greetingEnds++;
				(document.querySelector('[data-testid=composer]') as HTMLElement | null)?.focus();
			}}
		/>
	{/if}
	{#if mode.has('greeting')}<p data-testid="greeting-done" hidden>{greetingEnds}</p>{/if}
	{#if welcomeOpen}
		<Welcome
			sessionId="draft-test"
			loggedIn={false}
			configured={false}
			startAt={mode.get('welcome') === 'guide' ? 'guide' : 'login'}
			firstRun={mode.get('welcome') !== 'relogin'}
			onRefreshAuth={() => {}}
			onOpenSettings={() => {}}
			onSignedIn={async (user) => {
				await afterWelcomeSignIn();
				welcomeOpen = false;
				closedBy = 'signed-in';
				firstRunEnded(user.username);
			}}
			onDismiss={() => {
				welcomeOpen = false;
				closedBy = 'dismissed';
			}}
			onClose={(c) => {
				welcomeOpen = false;
				closedBy = `start:${c.backend}${c.model ? `:${c.model}` : ''}`;
				firstRunEnded('');
			}}
		/>
	{:else}
		<p data-testid="welcome-closed">{closedBy}</p>
	{/if}
{:else}
	<div class="settings-frame">
		<SettingsPage sessionId="draft-test" navWidth={260} bind:section onClose={() => {}} />
	</div>
	{#if mode.has('updates')}<UpdatePrompt />{/if}
{/if}

<style>
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-sans);
	}
	.settings-frame {
		position: relative;
		height: 100vh;
		background: var(--bg);
	}
	.sb-frame {
		display: flex;
		height: 100vh;
		background: var(--sidebar);
	}
	.greeting-stub {
		position: fixed;
		inset: 0;
		padding: 40px;
	}
	.greeting-stub textarea {
		width: 60%;
		height: 80px;
	}
	.canvas-stub {
		flex: 1;
		background: var(--bg);
		border-top-left-radius: var(--r-lg);
	}
</style>
