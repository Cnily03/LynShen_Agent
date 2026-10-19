<script lang="ts" module>
	/** Something to show from outside (an opened notification); `n` makes
	 *  the same one again a new request. */
	export type ShowRequest = ({ kind: 'requirement'; requirement: string } | { kind: 'session'; session: string; host?: string }) & {
		n: number;
	};
</script>

<script lang="ts">
	// One paired computer on the remote page: its list (sessions and desk) and
	// the pages opened over it, or, until its daemon has accepted this device,
	// a connecting / pair-again screen. The page keeps one mounted per
	// computer and hides all but the shown one, so each keeps its open pages
	// and their sessions keep streaming while another computer is shown.
	import { cubicOut } from 'svelte/easing';
	import type { Component, Snippet } from 'svelte';
	import TrayIcon from 'phosphor-svelte/lib/TrayIcon';
	import ListIcon from 'phosphor-svelte/lib/ListIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import QrCodeIcon from 'phosphor-svelte/lib/QrCodeIcon';
	import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import ChatCircleTextIcon from 'phosphor-svelte/lib/ChatCircleTextIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import RequirementList from './RequirementList.svelte';
	import RequirementCompose from './RequirementCompose.svelte';
	import RequirementScreen from './RequirementScreen.svelte';
	import DispatchList from './DispatchList.svelte';
	import DispatchComposer from './DispatchComposer.svelte';
	import DispatchScreen from './DispatchScreen.svelte';
	import DeskList from './DeskList.svelte';
	import Workbench from './Workbench.svelte';
	import DeskHome from './DeskHome.svelte';
	import DeskItemScreen from './DeskItemScreen.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import type { AgentView } from '$lib/agents.svelte';
	import { t } from '$lib/i18n';
	import lockup from '$lib/aogiri-lockup.svg?raw';
	import Projects from './Projects.svelte';
	import NewSessionDialog from './NewSessionDialog.svelte';
	import ProjectScreen from './ProjectScreen.svelte';
	import AddProjectScreen from './AddProjectScreen.svelte';
	import { baseName, type ProjectView } from './store.svelte';
	import { provideHost, type HostConnection } from './connection.svelte';
	import { sayViewing } from './push';
	import { pageVisible } from './visibility.svelte';
	import { untrack } from 'svelte';

	/* eslint-disable @typescript-eslint/no-explicit-any -- lazily loaded components */
	let {
		conn,
		name,
		hostName,
		hidden,
		wide,
		screens,
		switcher,
		resizer,
		chatHref,
		onAdd,
		onForget,
		onRepair,
		show
	}: {
		conn: HostConnection;
		/** The computer's name. */
		name: string;
		/** Its name on session pages, when several computers are paired. */
		hostName?: string;
		/** Another computer is shown. */
		hidden: boolean;
		wide: boolean;
		/** The heavy pages, once loaded. */
		screens: {
			RemoteSession: Component<any> | null;
			FilesScreen: Component<any> | null;
			ChangesScreen: Component<any> | null;
		};
		/** The computer switcher: in the list header, or (`true`) the wide
		 *  sidebar's foot. */
		switcher: Snippet<[boolean?]>;
		/** The web app's chat (app.lynshen.org): a way back to it in the sidebar. */
		chatHref?: string;
		/** The list column's resize handle (wide screens). */
		resizer: Snippet;
		/** Opens pairing (to scan this computer's code again). */
		onAdd: () => void;
		onForget: (ask?: boolean) => void;
		/** LAN: pair this device again. */
		onRepair: () => void;
		/** What to show (a notification was opened). */
		show?: ShowRequest | null;
	} = $props();
	/* eslint-enable @typescript-eslint/no-explicit-any */

	// The view keeps its computer: the page mounts a new one when it changes.
	// svelte-ignore state_referenced_locally
	provideHost(conn);

	type Tab = 'projects' | 'requirements' | 'dispatch' | 'desk';
	const TABS: Tab[] = ['projects', 'requirements', 'dispatch', 'desk'];
	/** The phone's bar: the dispatches live in 工作台, a new one starts from
	 *  the round button. */
	const PHONE_TABS: Tab[] = ['projects', 'desk', 'requirements'];
	const TAB_ICONS = { projects: ListIcon, requirements: ListChecksIcon, dispatch: PaperPlaneTiltIcon, desk: TrayIcon } as const;
	function badgeOf(name: Tab): number {
		if (name === 'requirements') return conn.requirements.pending;
		if (name === 'dispatch') return conn.dispatches.pending;
		if (name === 'desk') return conn.agents.pending + (wide ? 0 : conn.dispatches.pending);
		return 0;
	}
	/** A tab again (its own button) goes back to its list. */
	function pickTab(name: Tab) {
		if (tab === name && stacks[name].length && !wide) {
			stacks[name] = [];
			return;
		}
		tab = name;
	}
	/** 派一件事: the dispatch composer, over whatever tab is shown. */
	function dispatchNew() {
		if (wide) {
			tab = 'dispatch';
			stacks.dispatch = [];
			return;
		}
		push({ kind: 'compose' });
	}
	let tab = $state<Tab>('projects');
	const TAB_TITLES = {
		projects: 'shell.remote.sessions',
		requirements: 'shell.requirement.title',
		dispatch: 'shell.dispatch.title',
		desk: 'shell.desk.title'
	} as const;
	/** Pages opened over the tabs, last on top. */
	type Screen = { key: number } & (
		| { kind: 'session'; session?: string; agent?: string; cwd?: string; chat?: boolean; engine?: string; title: string }
		| { kind: 'project'; project: ProjectView }
		| { kind: 'add' }
		| { kind: 'files' | 'changes'; root: string; title: string; file?: string; line?: number }
		| { kind: 'dispatch'; id: string }
		| { kind: 'compose' }
		| { kind: 'desk'; item: string }
		| { kind: 'requirement'; id: string }
		| { kind: 'capture' }
	);
	/** Each tab keeps its own pages: switching tabs on a wide page shows that
	 *  tab's pane as it was left (and keeps its sessions streaming). */
	let stacks = $state<Record<Tab, Screen[]>>({ projects: [], requirements: [], dispatch: [], desk: [] });
	const stack = $derived(stacks[tab]);
	let nextKey = 0;
	type NewScreen = Screen extends infer S ? (S extends Screen ? Omit<S, 'key'> : never) : never;
	// Each page opened over a tab is a browser history entry, so the system
	// back (Android's button, a swipe) goes back a page rather than leaving
	// the app; the page's own back button goes through history too.
	function push(screen: NewScreen) {
		stacks[tab] = [...stacks[tab], { ...screen, key: nextKey++ } as Screen];
		history.pushState({ lynshenPage: true }, '');
	}
	function pop() {
		if (history.state?.lynshenPage) history.back();
		else drop();
	}
	/** The page on top gives way to `screen` (one history entry still). */
	function replace(screen: NewScreen) {
		stacks[tab] = [...stacks[tab].slice(0, -1), { ...screen, key: nextKey++ } as Screen];
	}
	function drop() {
		stacks[tab] = stacks[tab].slice(0, -1);
	}
	function onPopState() {
		if (!hidden && stacks[tab].length) drop();
	}
	/** Opens a page from the list: on a wide screen it replaces the right
	 *  pane's pages; on a phone it goes on top. */
	function open(screen: NewScreen) {
		if (wide && stacks[tab].length) {
			stacks[tab] = [{ ...screen, key: nextKey++ } as Screen];
			return;
		}
		push(screen);
	}

	// Pages slide in from the right on a phone and fade in on a wide pane
	// (CSS, .layer); a page closed with back slides out the same way. On a wide
	// pane the old page is replaced at once, not cross-faded.
	const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
	function layerOut(_node: Element) {
		if (wide || reducedMotion()) return { duration: 0 };
		return { duration: 200, easing: cubicOut, css: (t: number, u: number) => `transform: translateX(${u * 40}%); opacity: ${t}` };
	}

	/** The new-session dialog, for a given project or a choice of them. */
	let creating = $state<{ project?: ProjectView; replace: boolean } | null>(null);
	const ENGINE_TITLES: Record<string, string> = { claude: 'Claude Code', codex: 'Codex' };
	function create(project: ProjectView, engine: string) {
		const replace = creating?.replace ?? true;
		creating = null;
		const screen: NewScreen = {
			kind: 'session',
			cwd: project.path,
			chat: project.chats,
			engine: engine === 'lynshen' ? undefined : engine,
			title: ENGINE_TITLES[engine] ?? t('shell.remote.newSession')
		};
		if (replace) open(screen);
		else push(screen);
	}

	/** Past pairing and connected once: the lists and pages are showing. */
	const ready = $derived(conn.everConnected && !conn.relayError?.fatal);

	/** What the page on top shows, highlighted in its tab's list. */
	const top = $derived(stack.at(-1));
	const currentSession = $derived(top?.kind === 'session' ? top.session : undefined);
	const currentDispatch = $derived(top?.kind === 'dispatch' ? top.id : undefined);
	const currentDeskItem = $derived(top?.kind === 'desk' ? top.item : undefined);
	const currentRequirement = $derived(top?.kind === 'requirement' ? top.id : undefined);

	// A requirement or session asked for from outside (an opened
	// notification). A session opens in the sessions tab, its approval card
	// above the composer; the one already on top is left as it is.
	$effect(() => {
		const request = show;
		if (!request) return;
		untrack(() => {
			if (request.kind === 'requirement') {
				tab = 'requirements';
				open({ kind: 'requirement', id: request.requirement });
				return;
			}
			tab = 'projects';
			if (currentSession === request.session) return;
			open(sessionScreen(request.session));
		});
	});

	// The session this computer's view shows now goes to its daemon, so it
	// does not push to this phone about it; again every minute while shown
	// (the daemon forgets it after 90 s), and none once hidden.
	const viewing = $derived(!hidden && ready && pageVisible.visible ? (currentSession ?? null) : null);
	$effect(() => {
		const session = viewing;
		if (conn.agents.status !== 'on') return;
		sayViewing(conn.daemon, session);
		if (!session) return;
		const again = setInterval(() => sayViewing(conn.daemon, session), 60_000);
		return () => clearInterval(again);
	});

	/** A daemon session's page, from what the daemon's list knows of it. */
	function sessionScreen(session: string, title?: string): NewScreen {
		const agent = conn.agents.agentOfSession(session);
		const known = conn.agents.sessions.find((s) => s.session === session);
		return {
			kind: 'session',
			session,
			cwd: known?.cwd,
			engine: known?.engine && known.engine !== 'lynshen' ? known.engine : undefined,
			title: title ?? agent?.name ?? known?.title ?? session
		};
	}

	/** An agent's latest session, or a new one. */
	function agentScreen(id: string): NewScreen {
		const agent = conn.agents.agents.find((a) => a.id === id);
		const name = agent?.name ?? id;
		const latest = conn.agents.latestSession(id);
		return latest ? { kind: 'session', session: latest.session, title: name } : { kind: 'session', agent: id, title: name };
	}

	function openAgent(agent: AgentView) {
		open(agentScreen(agent.id));
	}
</script>

<svelte:window onpopstate={onPopState} />

<div class="host" class:wide {hidden}>
	{#if conn.relayError?.fatal}
		<div class="pair">
			<div class="corner">{@render switcher()}</div>
			<span class="hero warn"><QrCodeIcon size={28} /></span>
			<h1>{t('shell.remote.relayFatalTitle')}</h1>
			<p>
				{conn.relayError.kind === 'pair-invalid' ? t('shell.remote.relayPairInvalid') : t('shell.remote.relayRevoked')}
			</p>
			<div class="actions">
				<Button variant="primary" onclick={onAdd}><QrCodeIcon size={16} /> {t('shell.remote.scanQr')}</Button>
				<Button variant="ghost" onclick={() => onForget(false)}>{t('shell.remote.forget')}</Button>
			</div>
		</div>
	{:else if conn.awaitingConfirm}
		<!-- Paired; the computer confirms the device once the codes match. -->
		<div class="pair">
			<div class="corner">{@render switcher()}</div>
			<span class="hero"><DesktopIcon size={28} /></span>
			<h1>{t('shell.remote.pairCheck.checkTitle')}</h1>
			<p class="check" aria-label={t('shell.remote.pairCheck.checkLabel', { code: conn.checkCode })}>
				{conn.checkCode.slice(0, 3)}<span class="gap"></span>{conn.checkCode.slice(3)}
			</p>
			<p>{t('shell.remote.pairCheck.checkHint')}</p>
			<p class="status"><CircleNotchIcon size={14} class="spin" /> {t('shell.remote.pairCheck.waiting')}</p>
			<div class="actions"><Button variant="ghost" size="sm" onclick={() => onForget()}>{t('shell.remote.pairCheck.cancel')}</Button></div>
		</div>
	{:else if !ready}
		<div class="pair">
			<div class="corner">{@render switcher()}</div>
			<span class="hero" class:warn={conn.state.tone === 'off'}>
				{#if conn.state.tone === 'wait'}<CircleNotchIcon size={28} class="spin" />{:else}<DesktopIcon size={28} />{/if}
			</span>
			<h1>{name}</h1>
			{#key conn.state.text}<p class="status">{t(conn.state.text)}</p>{/key}
			<div class="actions"><Button variant="ghost" size="sm" onclick={() => onForget()}>{t('shell.remote.forget')}</Button></div>
		</div>
	{:else}
		<aside class="side">
			{#if wide}<div class="brand" role="img" aria-label={t('common.appName')}>{@html lockup}</div>{/if}
			<nav>
				{#if wide && chatHref}
					<a class="chat" href={chatHref}>
						<ChatCircleTextIcon size={18} />
						<span class="label">{t('shell.remote.backToChat')}</span>
					</a>
				{/if}
				{#snippet tabButton(name: Tab)}
					{@const Icon = TAB_ICONS[name]}
					{@const badge = badgeOf(name)}
					<button class:on={tab === name} aria-current={tab === name ? 'page' : undefined} onclick={() => pickTab(name)}>
						<Icon size={wide ? 18 : 22} weight={tab === name ? 'fill' : 'regular'} />
						<span class="label">{t(TAB_TITLES[name])}</span>
						{#if badge > 0}<span class="badge">{badge}</span>{/if}
					</button>
				{/snippet}
				{#if wide}
					{#each TABS as name (name)}{@render tabButton(name)}{/each}
				{:else}
					<!-- The phone: three tabs and the round 派一件事 button (the
					     dispatches are listed in 工作台). -->
					<div class="tabs">
						{#each PHONE_TABS as name (name)}{@render tabButton(name)}{/each}
					</div>
					<button class="go" onclick={dispatchNew} aria-label={t('shell.remote.go')}>
						<PaperPlaneTiltIcon size={22} weight="fill" />
					</button>
				{/if}
			</nav>
			<!-- Outside the scrolling list, so the switcher's menu is not cut off.
			     Wide: the nav names the tab, the switcher sits in the foot. -->
			{#if !wide}
				<div class="top">
					<h1>{t(TAB_TITLES[tab])}</h1>
					{@render switcher()}
				</div>
			{/if}
			<main>
				{#if conn.kind === 'lan' && conn.agents.status === 'unreachable'}
					<!-- The daemon served this page, so a failing connection most likely
					     means this device's token was revoked; offer to pair again. -->
					<div class="refused">
						<div class="refused-msg"><Notice tone="warn">{t('shell.remote.refused')}</Notice></div>
						<Button size="sm" onclick={onRepair}>{t('shell.remote.repair')}</Button>
					</div>
				{/if}
				<!-- Both tabs stay mounted so a switch keeps their scroll and
				     folded state; the shown one fades in. -->
				<div class="tabbody" hidden={tab !== 'projects'}>
					<Projects
						current={currentSession}
						onOpenSession={(s, project) =>
							open({
								kind: 'session',
								session: s.session,
								cwd: s.cwd,
								chat: project?.chats,
								engine: s.engine && s.engine !== 'lynshen' ? s.engine : undefined,
								title: s.title || t('shell.remote.untitled')
							})}
						onNewSession={(project) => (creating = { project, replace: true })}
						onAddProject={() => open({ kind: 'add' })}
						onHistory={(project) => open({ kind: 'project', project })}
						onFiles={(project) => open({ kind: 'files', root: project.path, title: project.name })}
						onChanges={(project) => open({ kind: 'changes', root: project.path, title: project.name })}
						onOpenAgent={openAgent}
					/>
				</div>
				<div class="tabbody" hidden={tab !== 'requirements'}>
					<RequirementList
						current={currentRequirement}
						composing={wide ? stacks.requirements.length === 0 : false}
						onNew={() => (wide ? (stacks.requirements = []) : push({ kind: 'capture' }))}
						onOpen={(id) => open({ kind: 'requirement', id })}
					/>
				</div>
				<div class="tabbody" hidden={tab !== 'dispatch'}>
					<DispatchList
						current={currentDispatch}
						composing={wide ? stacks.dispatch.length === 0 : false}
						onNew={() => (wide ? (stacks.dispatch = []) : push({ kind: 'compose' }))}
						onOpen={(d) => open({ kind: 'dispatch', id: d.id })}
					/>
				</div>
				<div class="tabbody" hidden={tab !== 'desk'}>
					{#if wide}
						<DeskList
							current={currentDeskItem}
							onOpen={(item) => open({ kind: 'desk', item })}
							onOpenAgent={(id) => open(agentScreen(id))}
						/>
					{:else}
						<Workbench
							{name}
							current={currentDeskItem}
							onOpenDesk={(item) => open({ kind: 'desk', item })}
							onOpenAgent={(id) => open(agentScreen(id))}
							onOpenSession={(s) => open(sessionScreen(s))}
							onOpenDispatch={(id) => open({ kind: 'dispatch', id })}
							onNewDispatch={dispatchNew}
						/>
					{/if}
				</div>
			</main>
			{#if wide}
				<div class="foot">{@render switcher(true)}</div>
				{@render resizer()}
			{/if}
		</aside>
		<section class="pane">
			<!-- With nothing opened from the list, a wide pane shows the tab's
			     own page: the composer, the desk's queue. -->
			{#if wide && stack.length === 0}
				{#if tab === 'requirements'}
					<RequirementCompose onNoted={(id) => open({ kind: 'requirement', id })} />
				{:else if tab === 'dispatch'}
					<DispatchComposer onSent={(d) => open({ kind: 'dispatch', id: d.id })} />
				{:else if tab === 'desk'}
					<DeskHome onOpenSession={(s) => push(sessionScreen(s))} onOpenAgent={(id) => push(agentScreen(id))} />
				{:else}
					<div class="pane-empty">
						<h1>{t('shell.remote.pickSomething')}</h1>
						<button class="start" onclick={() => (creating = { replace: true })}><PlusIcon size={16} />{t('shell.remote.newSession')}</button>
					</div>
				{/if}
			{/if}
			{#each TABS as name (name)}
			{#each stacks[name] as screen, i (screen.key)}
				<div class="layer" hidden={name !== tab} style:z-index={20 + i} out:layerOut>
					{#if screen.kind === 'session'}
						{@const root = screen.cwd && !screen.chat && !screen.agent ? screen.cwd : null}
						{#if screens.RemoteSession}
							<screens.RemoteSession
								session={screen.session}
								agent={screen.agent}
								cwd={screen.cwd}
								chat={screen.chat}
								engine={screen.engine}
								title={screen.title}
								{hostName}
								register={conn.register}
								onBack={wide && i === 0 ? undefined : pop}
								onFiles={root ? () => push({ kind: 'files', root, title: baseName(root) }) : undefined}
								onFile={root ? (file: string, line?: number) => push({ kind: 'files', root, title: baseName(root), file, line }) : undefined}
								onChanges={root ? () => push({ kind: 'changes', root, title: baseName(root) }) : undefined}
							/>
						{:else}
							{@render loadingPage(screen.title)}
						{/if}
					{:else if screen.kind === 'project'}
						{@const project = screen.project}
						<ProjectScreen
							{project}
							onBack={pop}
							onOpenSession={(session, cwd, title, engine) =>
								push({ kind: 'session', session, cwd, chat: project.chats, engine, title })}
							onNewSession={() => (creating = { project, replace: false })}
							onFiles={() => push({ kind: 'files', root: project.path, title: project.name })}
							onChanges={() => push({ kind: 'changes', root: project.path, title: project.name })}
						/>
					{:else if screen.kind === 'add'}
						<AddProjectScreen onBack={pop} onAdded={pop} />
					{:else if screen.kind === 'dispatch'}
						{@const id = screen.id}
						<DispatchScreen
							{id}
							onBack={pop}
							onOpenSession={(session, title) => push(sessionScreen(session, title))}
							onOpenProcess={() => push({ kind: 'session', session: id, title: t('shell.dispatch.title') })}
						/>
					{:else if screen.kind === 'compose'}
						<DispatchComposer
							onBack={pop}
							onSent={(d) => {
								replace({ kind: 'dispatch', id: d.id });
							}}
						/>
					{:else if screen.kind === 'requirement'}
						<RequirementScreen id={screen.id} onBack={pop} onOpenSession={(s, title) => push(sessionScreen(s, title))} />
					{:else if screen.kind === 'capture'}
						<RequirementCompose
							onBack={pop}
							onNoted={(id) => {
								replace({ kind: 'requirement', id });
							}}
						/>
					{:else if screen.kind === 'desk'}
						<DeskItemScreen
							key={screen.item}
							onBack={pop}
							onOpenSession={(s) => push(sessionScreen(s))}
							onOpenAgent={(id) => push(agentScreen(id))}
						/>
					{:else if screen.kind === 'files'}
						{#if screens.FilesScreen}
							<screens.FilesScreen root={screen.root} title={screen.title} file={screen.file} line={screen.line} onBack={pop} />
						{:else}
							{@render loadingPage(screen.title)}
						{/if}
					{:else if screens.ChangesScreen}
						<screens.ChangesScreen root={screen.root} title={screen.title} onBack={pop} />
					{:else}
						{@render loadingPage(screen.title)}
					{/if}
				</div>
			{/each}
			{/each}
		</section>
		{#if creating}
			<NewSessionDialog project={creating.project} onCreate={create} onClose={() => (creating = null)} />
		{/if}
	{/if}
</div>

{#snippet loadingPage(title: string)}
	<div class="loading-page">
		<header>
			<button class="back" onclick={pop} aria-label={t('shell.remote.back')}><ArrowLeftIcon size={18} /></button>
			<span class="title">{title}</span>
		</header>
		<div class="loading-body"><CircleNotchIcon size={22} class="spin" /></div>
	</div>
{/snippet}

<style>
	/* The page's grid places the list and the pane; this box adds none. */
	.host {
		display: contents;
	}
	.host[hidden] {
		display: none;
	}
	.layer {
		position: fixed;
		inset: 0;
		animation: layer-in var(--t-med) var(--ease-out);
	}
	/* A page pushed on a phone slides in from the right. */
	@keyframes layer-in {
		from {
			transform: translateX(32%);
			opacity: 0;
		}
	}
	/* On a phone the pages cover the screen; the pane itself adds no box. */
	.pane {
		display: contents;
	}
	.pane-empty {
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 22px;
		padding-bottom: 12vh;
		animation: fade var(--t-slow) var(--ease-out);
	}
	.pane-empty h1 {
		margin: 0;
		font-size: var(--fs-2xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		text-align: center;
	}
	.start {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 36px;
		padding: 0 16px;
		border: none;
		border-radius: var(--r-full);
		background: var(--text);
		color: var(--bg);
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 500;
		cursor: pointer;
	}
	/* Wide screens: the list in the page's resizable left column, pages in
	   the right one. The pane is the containing block of its fixed-position
	   pages (transform), so they fill it instead of the window. */
	.wide .side {
		position: relative;
		/* Above the pane: the switcher's menu opens over it. */
		z-index: 1;
		container: side / inline-size;
		display: flex;
		flex-direction: column;
		min-width: 0;
		border-right: 1px solid var(--hairline);
		background: var(--sidebar);
	}
	/* Wide: as the chat's sidebar — the name, the sections one per row. */
	.brand {
		padding: calc(env(safe-area-inset-top) + 14px) 16px 6px;
		line-height: 0;
		color: var(--text);
	}
	.brand :global(svg) {
		height: 20px;
		width: auto;
	}
	.wide nav {
		position: static;
		flex-direction: column;
		/* Full-width rows, not the phone bar's end-aligned buttons (ticket #51). */
		align-items: stretch;
		gap: 2px;
		padding: 6px 8px 8px;
		border: none;
		background: none;
	}
	.wide nav button,
	.wide nav .chat {
		flex: none;
		flex-direction: row;
		justify-content: flex-start;
		gap: 10px;
		height: 36px;
		padding: 0 10px;
		border-radius: var(--r-md);
		color: var(--text);
		font-size: var(--fs-sm);
		text-decoration: none;
	}
	.wide nav .chat {
		display: flex;
		align-items: center;
	}
	.wide nav :global(svg) {
		flex: none;
		color: var(--dim);
	}
	.wide nav button:hover,
	.wide nav .chat:hover {
		background: var(--surface2);
	}
	.wide nav button:active {
		transform: none;
	}
	.wide nav button.on {
		background: var(--surface2);
		font-weight: 500;
	}
	.wide nav button.on :global(svg) {
		color: var(--text);
	}
	.wide nav .label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.wide .badge {
		position: static;
		animation: none;
	}
	.foot {
		padding: 8px;
		border-top: 1px solid var(--hairline);
	}
	.wide main {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 12px 24px;
		border-top: 1px solid var(--hairline);
	}
	.wide .pane {
		display: flex;
		position: relative;
		min-width: 0;
		transform: translateZ(0);
		overflow: hidden;
	}
	/* Pages on a wide pane replace each other: a quick fade, no slide. */
	.wide .layer {
		animation-name: pane-in;
	}
	main {
		padding: 0 16px calc(env(safe-area-inset-bottom) + 76px);
	}
	/* The phone's title bar stays at the top; 工作台's number cards stick
	   under it (--top-h). */
	.top {
		position: sticky;
		top: 0;
		z-index: 5;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: calc(env(safe-area-inset-top) + 16px) 16px 10px;
		background: var(--bg);
	}
	.side {
		--top-h: calc(env(safe-area-inset-top) + 60px);
	}
	.wide .top {
		padding: 10px 12px 10px 16px;
	}
	.top h1 {
		flex: 1 0 auto;
		margin: 0;
	}
	.wide .top h1 {
		font-size: var(--fs-lg);
	}
	.tabbody:not([hidden]) {
		animation: rise var(--t-med) var(--ease-out);
	}
	h1 {
		margin: 4px 0 8px;
		font-family: var(--font-sans);
		font-size: var(--fs-xl);
		font-weight: 600;
	}
	.refused {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 12px;
		animation: rise var(--t-med) var(--ease-out);
	}
	.refused-msg {
		flex: 1;
		min-width: 0;
	}
	/* The phone's bar: three labelled tabs in a rounded strip and, beside
	   it, the round 派一件事 button (the one accent-filled control here). */
	nav {
		position: fixed;
		left: 12px;
		right: 12px;
		bottom: calc(env(safe-area-inset-bottom) + 10px);
		z-index: 10;
		display: flex;
		align-items: flex-end;
		gap: 8px;
	}
	.tabs {
		flex: 1;
		display: flex;
		height: 56px;
		padding: 4px;
		border: 1px solid var(--hairline);
		border-radius: 28px;
		background: color-mix(in srgb, var(--panel) 88%, transparent);
		backdrop-filter: blur(18px) saturate(1.4);
		-webkit-backdrop-filter: blur(18px) saturate(1.4);
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.18);
	}
	.go {
		flex: none;
		display: grid;
		place-items: center;
		width: 56px;
		height: 56px;
		border: none;
		border-radius: 28px;
		background: var(--accent);
		color: var(--on-accent);
		box-shadow: 0 6px 24px rgb(0 0 0 / 0.22);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition: transform var(--t-fast) var(--ease-out);
	}
	.go:active {
		transform: scale(0.94);
	}
	nav .tabs button {
		border-radius: 24px;
	}
	nav .tabs button.on {
		background: rgb(128 128 128 / 0.13);
	}
	nav button {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		padding: 6px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-2xs);
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	nav button:hover {
		color: var(--text);
	}
	nav button:active {
		transform: scale(0.94);
	}
	nav button.on {
		color: var(--accent-bright);
	}
	.badge {
		position: absolute;
		top: 0;
		left: calc(50% + 8px);
		min-width: 16px;
		padding: 0 4px;
		border-radius: var(--r-full);
		background: var(--warn);
		color: #000;
		font-size: var(--fs-2xs);
		line-height: 16px;
		animation: pop-in var(--t-pop) var(--ease-enter);
	}
	/* Connecting and pair-again: one centered column across the page, with
	   the switcher in the corner. */
	.pair {
		position: relative;
		grid-column: 1 / -1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		max-width: 420px;
		width: 100%;
		min-height: 100dvh;
		margin: 0 auto;
		padding: calc(env(safe-area-inset-top) + 24px) 20px calc(env(safe-area-inset-bottom) + 24px);
		text-align: center;
		animation: rise var(--t-slow) var(--ease-out);
	}
	.corner {
		position: absolute;
		top: calc(env(safe-area-inset-top) + 12px);
		right: 16px;
	}
	.pair h1 {
		margin: 8px 0 4px;
	}
	.pair p {
		margin: 6px 0 0;
		font-size: var(--fs-md);
		color: var(--dim);
		line-height: 1.55;
	}
	.pair .status {
		animation: fade var(--t-med) var(--ease-out);
	}
	.hero {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 56px;
		height: 56px;
		margin-bottom: 8px;
		border-radius: var(--r-lg);
		background: var(--surface2);
		border: 1px solid var(--hairline);
		color: var(--accent-bright);
		transition: color var(--t-med) var(--ease-out);
	}
	.hero.warn {
		color: var(--warn);
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-top: 24px;
	}
	.loading-page {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg);
	}
	.loading-page header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: calc(env(safe-area-inset-top) + 8px) 12px 8px;
		border-bottom: 1px solid var(--hairline);
		background: var(--panel);
	}
	.loading-page .back {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
	}
	.loading-page .title {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		font-size: var(--fs-lg);
		font-weight: 600;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.loading-body {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--dim);
	}
	.pair .check {
		margin: 12px 0 4px;
		font-family: var(--font-mono);
		font-size: 34px;
		font-weight: 600;
		letter-spacing: 0.08em;
		color: var(--text);
	}
	.check .gap {
		display: inline-block;
		width: 0.4em;
	}
</style>
