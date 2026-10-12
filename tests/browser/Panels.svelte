<script lang="ts">
	// The pages of the agent-UX change, for the browser regressions and the
	// screenshots: Settings → 技能 (installed and marketplace tabs), 插件,
	// and the sidebar with folded sections and the archive.
	import SettingsPage from '../../src/lib/settings/SettingsPage.svelte';
	import Sidebar from '../../src/lib/Sidebar.svelte';
	import ConfirmHost from '../../src/lib/ui/ConfirmHost.svelte';
	import Toaster from '../../src/lib/ui/Toaster.svelte';
	import { SessionStore } from '../../src/lib/session.svelte';
	import { Requirements, provideRequirements } from '../../src/lib/requirements.svelte';
	import { daemon } from '../../src/lib/protocol';
	import { setLocale } from '../../src/lib/i18n';
	const mode = new URL(location.href).searchParams;
	setLocale(mode.get('lang') === 'en' ? 'en' : 'zh');
	provideRequirements(new Requirements(daemon));
	let section = $state(mode.has('market') ? 'market' : mode.has('plugins') ? 'plugins' : 'skills');

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
{:else}
	<div class="settings-frame">
		<SettingsPage sessionId="draft-test" navWidth={260} bind:section onClose={() => {}} />
	</div>
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
	.canvas-stub {
		flex: 1;
		background: var(--bg);
		border-top-left-radius: var(--r-lg);
	}
</style>
