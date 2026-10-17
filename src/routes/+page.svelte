<script lang="ts">
	import { refreshMonoizeCatalog } from '$lib/providers/monoize';
	import { DaemonSync } from '$lib/daemonSync.svelte';
	import { onMount, tick, untrack } from 'svelte';
	import { crossfade } from '$lib/ui/viewTransition';
	import { engine } from '$lib/engineVersion.svelte';
	import { listen } from '@tauri-apps/api/event';
	import { invoke } from '@tauri-apps/api/core';
	import { getCurrentWebview } from '@tauri-apps/api/webview';
	import TerminalWindowIcon from 'phosphor-svelte/lib/TerminalWindowIcon';
	import ChatCircleTextIcon from 'phosphor-svelte/lib/ChatCircleTextIcon';
	import SessionMark from '$lib/SessionMark.svelte';
	import { sessionStatus } from '$lib/sessionStatus';
	import { joinPath, parseFileHref, pathExt } from '$lib/fileRefs';
	import { PROVIDER_CATALOG } from '$lib/providers/catalog';
	import { applyOverride, readOverrides } from '$lib/providers/overrides';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import TargetIcon from 'phosphor-svelte/lib/TargetIcon';
	import GitDiffIcon from 'phosphor-svelte/lib/GitDiffIcon';
	import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
	import FilesIcon from 'phosphor-svelte/lib/FilesIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
	import PulseIcon from 'phosphor-svelte/lib/PulseIcon';
	import TreeStructureIcon from 'phosphor-svelte/lib/TreeStructureIcon';
	import UsersThreeIcon from 'phosphor-svelte/lib/UsersThreeIcon';
	import Toaster from '$lib/ui/Toaster.svelte';
	import ModelSetup from '$lib/ModelSetup.svelte';
	import { modelSetup } from '$lib/modelSetupState.svelte';
	import ConfirmHost from '$lib/ui/ConfirmHost.svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import { toast } from '$lib/ui/toast.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { cycleTheme } from '$lib/theme.svelte';
	import {
		isPermissionGranted,
		requestPermission,
		sendNotification
	} from '@tauri-apps/plugin-notification';
	import { ChatState, shownTitle } from '$lib/chat.svelte';
	import { needsClaudeYoloRespawn } from '$lib/approval';
	import {
		readAuthProviders,
		listProviders,
		listDir,
		gitCheckpointCapture,
		checkBackend,
		daemon
	} from '$lib/protocol';
	import { dispatch } from '$lib/backends/router';
	import { caps } from '$lib/backends';
	import { defaultBackendFor, loadBackendSettings } from '$lib/backends/settings';
	import { onOpenUrl } from '@tauri-apps/plugin-deep-link';
	import { authLinkOpened } from '$lib/signInPoll';
	import { updater } from '$lib/updater.svelte';
	import { teamSwitch } from '$lib/agents/teamSwitch.svelte';
	import { checkDaemonVersion } from '$lib/daemonVersion';
	import { shells } from '$lib/shellStore.svelte';
	import UpdatePrompt from '$lib/UpdatePrompt.svelte';
	import TrialGrantCard from '$lib/TrialGrantCard.svelte';
	import { trial } from '$lib/trial.svelte';
	import { browser, type WebRef } from '$lib/browser.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { fmtTokens } from '$lib/usageStats';
	import { cloudSync } from '$lib/cloudSync.svelte';
	import { t } from '$lib/i18n';
	import { SessionStore, listedSessions } from '$lib/session.svelte';
	import { workspaces } from '$lib/workbench/workspaceStore.svelte';
	import { autoRetry } from '$lib/autoRetry.svelte';
	import { refreshLynShenModels } from '$lib/lynshenModels';
	import {
		activateTab,
		closeTab,
		emptyLayout,
		findLeaf,
		leafOfTab,
		leavesOf,
		serializeLayout,
		type TileLayout,
		type TileTab
	} from '$lib/workbench/tiles';
	import {
		chatPanel,
		chatSessionOf,
		chatSessionsIn,
		openChatTab,
		openElsewhere as placeElsewhere,
		reconcileLayout,
		TOOL_SIDE_RATIO,
		TOOL_SPLIT_MIN_CHAT
	} from '$lib/workbench/canvas';
	import { tuiBackendOf, tuiTabTitle } from '$lib/workbench/tuiTab';
	import { canHandOffToTui, isValidResumeSessionId } from '$lib/tuiHandoff';
	import type { TabIcon } from '$lib/workbench/tabChrome';
	import Mosaic from '$lib/workbench/Mosaic.svelte';
	import HomePage from '$lib/HomePage.svelte';
	import TitleBar from '$lib/shell/TitleBar.svelte';
	import TabChromePopover from '$lib/workbench/TabChromePopover.svelte';
	import ChatPane, { type ChatPaneApi, type ProviderOption } from '$lib/ChatPane.svelte';
	import SettingsPage from '$lib/settings/SettingsPage.svelte';
	import type { SectionKey } from '$lib/settings/nav';
	import { folderName } from '$lib/agentImport';
	import Welcome from '$lib/welcome/Welcome.svelte';
	import { SETUP_DONE_KEY, firstRunStart } from '$lib/welcome/flow';
	import { afterWelcomeSignIn } from '$lib/welcome/firstRun';
	import { account } from '$lib/accountSession.svelte';
	import Sidebar from '$lib/Sidebar.svelte';
	import Button from '$lib/ui/Button.svelte';
	import CommandPalette from '$lib/CommandPalette.svelte';
	import ShortcutsDialog from '$lib/ShortcutsDialog.svelte';
	import { matches } from '$lib/shortcuts';
	import { readSidebarCollapsed, writeSidebarCollapsed, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_RAIL_WIDTH } from '$lib/shell/sidebarState';
	import TaskDialog from '$lib/TaskDialog.svelte';
	import DeskPage from '$lib/DeskPage.svelte';
	import ProjectPage from '$lib/ProjectPage.svelte';
	import FeedbackDialog from '$lib/FeedbackDialog.svelte';
	import { telemetry } from '$lib/telemetry.svelte';
	import { sendTelemetry } from '$lib/protocol';
	import { Requirements, provideRequirements, type Requirement } from '$lib/requirements.svelte';
	import type { StartHow } from '$lib/requirements/StartButton.svelte';
	import { normalizeBackendId, BACKEND_LABELS, type BackendId } from '$lib/backends';
	import Modal from '$lib/ui/Modal.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import { agentDirectory } from '$lib/agents.svelte';
	import type { Project, WorktreeMeta } from '$lib/types';
	import PlanPanel from '$lib/PlanPanel.svelte';
	import ProposalPane from '$lib/ProposalPane.svelte';
	import { planPages, proposalOf, proposalPanel } from '$lib/planPages.svelte';
	import { agentChanges, agentChangesOf, agentChangesPanel } from '$lib/agents/agentChanges.svelte';
	import { subagentPages, subagentOf, subagentPanel, type SubagentPlace } from '$lib/agents/subagentPages.svelte';
	import SubagentPane from '$lib/agents/SubagentPane.svelte';
	import FilePreview from '$lib/preview/FilePreview.svelte';
	import { filePreviews } from '$lib/preview/store.svelte';
	import { dropPreviewTabs, previewOf, previewPanel } from '$lib/preview/kinds';
	import { fileName } from '$lib/attachments';
	import StateIcon from '$lib/agents/StateIcon.svelte';
	import { runState } from '$lib/agentTrace';
	import { shortPath, type AgentRow } from '$lib/agentProgress';
	import type { ApprovalMode } from '$lib/approval';
	import GoalPanel from '$lib/GoalPanel.svelte';
	import ChangesPanel from '$lib/ChangesPanel.svelte';
	import TurnsPanel from '$lib/TurnsPanel.svelte';
	import FilesPanel from '$lib/FilesPanel.svelte';
	import GitPanel from '$lib/GitPanel.svelte';
	import TerminalPanel from '$lib/TerminalPanel.svelte';
	import { terminalRequests } from '$lib/sandbox/terminal.svelte';
	import BrowserPanel from '$lib/BrowserPanel.svelte';
	import DiagnosticsPanel from '$lib/DiagnosticsPanel.svelte';
	import AgentRunsPanel from '$lib/AgentRunsPanel.svelte';
	import TeamPanel from '$lib/agents/TeamPanel.svelte';
	import TuiPanel from '$lib/TuiPanel.svelte';
	import EditorPane from '$lib/editor/EditorPane.svelte';
	import QuickOpen from '$lib/editor/QuickOpen.svelte';
	import { editorStore } from '$lib/editor/editorStore.svelte';

	// Project/session tree + lifecycle lives in the store; the page keeps thin
	// reactive aliases so templates and handlers read it naturally.
	const store = new SessionStore();
	// Aliases read the store on every use. Page-level $derived copies of the
	// tree stopped following it after a workspace swap (a new chat then
	// showed 该对话已关闭); the tree is small, so a scan per lookup is cheap.
	const active = $derived(store.active);
	const chat = $derived(store.chat);
	const activeProject = $derived(store.activeProject);
	const activeId = $derived(store.activeId);
	const sessionMap = {
		get: (id: string) => store.allSessions.find((s) => s.id === id),
		has: (id: string) => store.allSessions.some((s) => s.id === id),
		*[Symbol.iterator]() {
			for (const s of store.allSessions) yield [s.id, s] as const;
		}
	};
	// The requirements on this computer (the daemon's list).
	const requirements = new Requirements(daemon);
	provideRequirements(requirements);
	// A session at a requirement's start gate is held read-only by the daemon:
	// it shows the engine's mode, and this client's mode is neither pushed
	// over it nor saved from it (also when it was started elsewhere).
	$effect(() => {
		for (const s of store.allSessions) {
			const sid = s.chat.sessionId;
			if (sid && requirements.bySession.get(sid)?.gate?.session === sid) s.chat.followEngineMode = true;
		}
	});

	let providers = $state<string[]>([]);
	// The sign-in has been read from auth.json at this start. Before that the
	// account kept from the last run stands in (no 未登录 flash at start).
	let authKnown = $state(false);
	const signedInNow = $derived(authKnown ? providers.includes('monoize') || providers.includes('lynshen') : !!account.user);

	async function notify(title: string, body: string) {
		try {
			let granted = await isPermissionGranted();
			if (!granted) granted = (await requestPermission()) === 'granted';
			if (granted) sendNotification({ title, body });
		} catch {
			/* ignore */
		}
	}
	const notifyDone = (title: string) =>
		notify('Aogiri', t('shell.notifyDone', { title: shownTitle(title) }));
	// An agent's question, pending action or report while the window is in
	// the background.
	agentDirectory.onArrival = (kind, agent, text, agentId) => {
		const message = t(`shell.notify.${kind}`, { text });
		if (!document.hasFocus()) void notify(agent, message);
		// In front: a notice that leads to the agent on the workbench.
		else
			toast.info(`${agent} · ${message}`, {
				action: { label: t('shell.desk.title'), run: () => openDesk(agentId ?? null) }
			});
	};
	let showSettings = $state(false);
	let settingsSection = $state<SectionKey>('general');
	function openSettings(section: SectionKey = 'general') {
		settingsSection = section;
		showDesk = false;
		projectPageId = null;
		showHome = false;
		showSettings = true;
	}
	// The home page over the canvas (Agent / 项目 / 最近 and a box to start a
	// conversation); a session shown on the canvas closes it.
	let showHome = $state(false);
	function openHome() {
		showSettings = false;
		showDesk = false;
		crossfade(() => {
			projectPageId = null;
			showHome = true;
		});
	}
	/** A new conversation outside any project (~/Documents/LynShen), as the
	 *  sidebar's 新对话 and the home page start it. */
	async function startChat(firstMessage?: string, model?: string) {
		try {
			await store.newChat(firstMessage, model);
			showHome = false;
			projectPageId = null;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}
	function closeSettings() {
		showSettings = false;
		loadProviders();
	}
	let showSetup = $state(false);
	// The welcome page's first view: the sign-in (a first run, after logging
	// out) or the walkthrough (the palette).
	let setupView = $state<'login' | 'guide'>('login');
	// No first run finished yet (SETUP_DONE_KEY): its 跳过 opens the agent page.
	let firstRun = $state(false);
	function setupDone() {
		try {
			localStorage.setItem(SETUP_DONE_KEY, '1');
		} catch {
			/* no storage */
		}
		firstRun = false;
		showSetup = false;
	}
	let showPalette = $state(false);
	let showShortcuts = $state(false);
	let showFeedback = $state(false);
	// 「新建并行任务」对话框：为哪个（主仓库）项目开任务。
	let taskDialogFor = $state<Project | null>(null);
	// The workbench page, on the overview, one agent, or one of its sessions
	// (agent sessions open only there, never on the canvas).
	let showDesk = $state(false);
	let deskAgent = $state<string | null>(null);
	let deskSession = $state<string | null>(null);
	let deskPage = $state<'overview' | 'requirements' | 'schedules'>('overview');
	let deskRequirement = $state<string | null>(null);
	let captureSignal = $state(0);
	function openDesk(agent: string | null) {
		deskAgent = agent;
		deskSession = null;
		showSettings = false;
		projectPageId = null;
		showHome = false;
		showDesk = true;
	}
	// A project's page over the canvas (the sidebar stays); any session
	// shown there closes it.
	let projectPageId = $state<string | null>(null);
	const pageProject = $derived(projectPageId ? store.userProjects.find((p) => p.id === projectPageId) : undefined);
	// The home page covers the canvas when asked for, and when nothing is open.
	const homeShown = $derived(showHome || (store.loaded && !store.active && !pageProject));
	function openProjectPage(p: Project) {
		showDesk = false;
		showSettings = false;
		crossfade(() => {
			showHome = false;
			projectPageId = p.id;
		});
	}
	$effect(() => {
		void store.activeId;
		projectPageId = null;
		showHome = false;
	});
	/** The project a new agent is created in ('' for none). */
	/** The workbench's requirements page: one requirement, or the list. */
	function openRequirements(id: string | null = null) {
		openDesk(null);
		deskPage = 'requirements';
		deskRequirement = id;
	}

	/** Starts a session on requirement `r`: a new draft in its project (or
	 *  a parallel task's) that shows the start card; once the user starts
	 *  it, the daemon has the agent explain its understanding first and wait
	 *  for confirmation (see Requirements.begin). */
	let taskRequirement = $state<{ id: string; name: string } | null>(null);
	async function startRequirement(r: Requirement, how: StartHow) {
		try {
			telemetry.track('requirement_start');
			const path = how.project ?? workspaceProjects.find((p) => p.id === r.project)?.path;
			const project = path ? await openProjectPath(path, false) : null;
			if (!project) return toast.warn(t('shell.requirement.pickProject'));
			if (!r.project) await requirements.update(r.id, { project: project.id });
			if (how.mode === 'worktree') {
				// The id keeps the branch name readable whatever the title's script.
				taskRequirement = { id: r.id, name: `${r.id} ${r.title}` };
				newTask(project);
				return;
			}
			// An empty new session there (one a new project starts with) is used
			// rather than a second one.
			const backend = how.backend ? normalizeBackendId(how.backend) : undefined;
			const empty = project.sessions.find(
				(s) => s.draft && !s.requirement && !s.chat.messages.length && (!backend || s.backendId === backend)
			);
			const id = empty?.id ?? store.addSession(project, undefined, backend);
			store.activeId = id;
			const session = store.allSessions.find((s) => s.id === id);
			if (session) {
				session.requirement = r.id;
				session.requirementStart = { plan: session.chat.approvalMode === 'plan' };
			}
			showDesk = false;
			projectPageId = null;
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}
	/** What a running daemon session shown here is doing now (its plan's
	 *  current step). */
	function currentStep(session: string): string | undefined {
		const chat = store.allSessions.find((s) => s.chat.sessionId === session)?.chat;
		return chat?.plan.find((p) => p.status === 'in_progress')?.step;
	}
	const workspaceProjects = $derived(
		store.userProjects.filter((p) => !p.worktree && !p.chats).map((p) => ({ id: p.id, path: p.path, name: p.name }))
	);

	/** Show a daemon session: an agent's on the workbench, a plain hosted one
	 *  in a tab. */
	function openDaemonSession(session: string, agentId?: string) {
		const agent =
			agentDirectory.agentOfSession(session) ?? agentDirectory.agents.find((a) => a.id === agentId);
		const listed = agentDirectory.sessions.find((s) => s.session === session);
		if (agent) {
			deskSession = store.openAgentSession(agent, session, listed?.title);
			deskAgent = agent.id;
			showSettings = false;
			showDesk = true;
			return;
		}
		const cwd = listed?.cwd ?? '';
		store.openAgentSession({ id: '', name: base(cwd), cwd }, session, listed?.title);
		showDesk = false;
		projectPageId = null;
	}
	/** Show a conversation another one's message came from: its tab when it
	 *  is listed here, else the daemon's record of it (opened in its
	 *  project), read again once when this client has not heard of it. */
	async function openSessionById(session: string) {
		const known = () =>
			store.allSessions.some((s) => s.chat.sessionId === session) || agentDirectory.sessions.some((s) => s.session === session);
		if (!known()) await agentDirectory.refreshSessions();
		if (!known()) {
			toast.error(t('chat.delivery.sourceGone'));
			return;
		}
		openDaemonSession(session);
	}
	let showQuickOpen = $state(false);

	/** Logged out of the LynShen account (Settings → Account or the account
	 *  card): back to the welcome page's sign-in. */
	function afterAccountLogout() {
		showSettings = false;
		showDesk = false;
		modelSetup.open = false;
		account.signedOut();
		setupView = 'login';
		showSetup = true;
	}

	function refreshAuth() {
		loadProviders();
		readAuthProviders()
			.then(async (p) => {
				if (p.includes('lynshen') && !providers.includes('lynshen')) {
					try {
						await refreshLynShenModels();
						loadProviders();
					} catch (e) {
						toast.error(t('settings.page.saveFailed', { msg: String(e) }));
					}
				}
				providers = p;
				syncTrial(p);
			})
			.catch(() => {});
	}

	/** The first-use trial plan follows the LynShen sign-in (its device key):
	 *  claimed once per installation and account (trial.svelte.ts). */
	function syncTrial(p: string[]) {
		if (p.includes('monoize')) void trial.signedIn();
		else trial.signedOut();
	}

	// All configured providers (builtin + custom) with their models, so the in-chat
	// model picker can list every provider's models — not just the active one's.
	let providersList = $state<ProviderOption[]>([]);
	let providerLoad = 0;
	function loadProviders() {
		const generation = ++providerLoad;
		listProviders()
			.then(async (bs) => {
				const auth = await readAuthProviders();
				if (auth.includes('monoize')) await refreshMonoizeCatalog().catch(e => console.error('Model route refresh failed', e));
				if (generation !== providerLoad) return;
				let custom: ProviderOption[] = [];
				try {
					custom = JSON.parse(localStorage.getItem('lynshen-custom-providers') || '[]');
				} catch (e) {
					console.error('failed to restore lynshen-custom-providers', e);
					custom = [];
				}
				// A built-in provider with the user's settings (Settings → 提供商 →
				// 编辑): @switch writes these to config.json for the engine.
				const overrides = readOverrides(localStorage);
				providersList = [
					...bs.map((b) =>
						applyOverride(
							{
								id: b.id,
								name: PROVIDER_CATALOG.providers.find((p) => p.id === b.id)?.name ?? b.id,
								base_url: b.base_url,
								format: b.protocol,
								models: b.models
							},
							overrides[b.id]
						)
					),
					...custom
				];
			})
			.catch(() => {});
	}
	// Target endpoint for one-shot AI text (commit / PR). Prefer the active
	// session's provider; fall back to the default lynshen gateway or the first
	// configured provider. Strip any `[1m]`-style alias suffix from the model id.
	const llmTarget = $derived.by(() => {
		const pick =
			providersList.find((p) => p.id === chat?.provider) ??
			providersList.find((p) => p.id === 'lynshen') ??
			providersList[0];
		if (!pick) return null;
		const model =
			chat?.provider === pick.id && chat?.model
				? chat.model.replace(/\[.*?\]$/, '')
				: (pick.models[0]?.name ?? '');
		if (!model) return null;
		return { provider: pick.id, baseUrl: pick.base_url, format: pick.format, model };
	});

	const savedSidebarWidth = Number(localStorage.getItem('lynshen-sidebar-width'));
	/** The expanded navigator's width (the user drags it, 240–460px). */
	let sidebarWidth = $state(savedSidebarWidth >= 240 && savedSidebarWidth <= 460 ? savedSidebarWidth : SIDEBAR_DEFAULT_WIDTH);
	/** Width left of the sidebar (none since the workspace rail is gone); the
	 *  title bar aligns the title past it. */
	const RAIL_WIDTH = 0;
	/** The navigator is the narrow icon rail (⌘B, the title bar's toggle).
	 *  Read before the first render so a collapsed navigator does not
	 *  animate closed on launch. */
	let sidebarCollapsed = $state(readSidebarCollapsed(localStorage));
	let sbResizing = $state(false);
	/** What the navigator takes up: the rail, or its expanded width. Settings
	 *  and the workbench page lay out their own nav at the expanded width. */
	const navShown = $derived(showSettings || showDesk || !sidebarCollapsed ? sidebarWidth : SIDEBAR_RAIL_WIDTH);

	function toggleSidebar() {
		sidebarCollapsed = !sidebarCollapsed;
		writeSidebarCollapsed(localStorage, sidebarCollapsed);
	}

	function startSidebarResize(e: PointerEvent) {
		e.preventDefault();
		const startX = e.clientX;
		const startW = sidebarWidth;
		sbResizing = true;
		const move = (ev: PointerEvent) => {
			sidebarWidth = Math.min(460, Math.max(240, startW + (ev.clientX - startX)));
		};
		const up = () => {
			sbResizing = false;
			localStorage.setItem('lynshen-sidebar-width', String(sidebarWidth));
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	// ---------- the canvas: ONE mosaic for chats + tool panels ----------
	// Everything right of the navigator is a single tile tree. Tabs are chat
	// sessions (`chat:<sessionId>`), the former dock panels, `tui:<backend>`
	// terminals and the audit pane. The layout is workspace state: it loads
	// from and persists to the active workspace's app-data entry.
	let tiles = $state<TileLayout>(emptyLayout());
	let tilesReady = $state(false);
	let focusedLeaf = $state<string | null>(null);

	const ALL_PANELS = ['plan', 'goal', 'agents', 'team', 'changes', 'turns', 'files', 'git', 'term', 'browser', 'diag'] as const;
	// Plan/Goal are engine features. Goal stays gated by the backend cap; the plan
	// tab also appears whenever there's an actual plan (e.g. claude's TodoWrite),
	// even on backends that don't advertise goals.
	const panelKeys = $derived(
		ALL_PANELS.filter((k) => {
			if (k === 'goal') return caps(chat).goals;
			if (k === 'agents') return caps(chat).agentTrace;
			// The agent team is LynShen's (or a session that already has one).
			if (k === 'team') return !!chat && (chat.backendId === 'lynshen' || chat.taskBoard !== null || chat.agentMessages.length > 0);
			if (k === 'plan') return caps(chat).goals || (chat?.plan ?? []).length > 0;
			return true;
		})
	);
	// One agent-session type only: the coding agent is picked INSIDE the
	// session (model popup), never at tab creation. Persisted `tui:*` tabs
	// still render, but TUI tabs are no longer offered as new options.
	const PANEL_ICONS: Record<(typeof ALL_PANELS)[number], typeof PlusIcon> = {
		plan: ListChecksIcon, goal: TargetIcon, agents: TreeStructureIcon, team: UsersThreeIcon, changes: GitDiffIcon, turns: ClockCounterClockwiseIcon,
		files: FilesIcon, git: GitBranchIcon, term: TerminalWindowIcon, browser: GlobeIcon, diag: PulseIcon
	};
	/** The + menu's sections: the conversation's own views, the code, then tools. */
	const PANEL_GROUP: Record<(typeof ALL_PANELS)[number], 'session' | 'code' | 'tools'> = {
		plan: 'session', goal: 'session', agents: 'session', team: 'session', turns: 'session',
		changes: 'code', files: 'code', git: 'code',
		term: 'tools', browser: 'tools', diag: 'tools'
	};
	const GROUP_ORDER = ['session', 'code', 'tools'] as const;
	const addOptions = $derived([
		{ key: 'chat', label: t('shell.agentSession'), icon: PlusIcon, primary: true },
		...GROUP_ORDER.flatMap((group) =>
			panelKeys
				.filter((k) => PANEL_GROUP[k] === group)
				.map((k) => ({ key: k, label: t(`dock.tabs.${k}`), icon: PANEL_ICONS[k], group: t(`shell.panelGroup.${group}`) }))
		)
	]);

	function tileLabel(tab: TileTab): string {
		const sid = chatSessionOf(tab.panel);
		if (sid) return shownTitle(sessionMap.get(sid)?.chat.title ?? '');
		const tui = tuiBackendOf(tab.panel);
		if (tui) return tuiTabTitle(tui);
		if (tab.panel === 'audit') return t('editor.title');
		const proposal = proposalOf(tab.panel);
		if (proposal) return planOf(proposal.sessionId, proposal.planId)?.title || t('chat.planCard.label');
		const changes = agentChangesOf(tab.panel);
		if (changes) return t('chat.team.changesTab', { name: shortPath(changes.agent) });
		const sub = subagentOf(tab.panel);
		if (sub) return subagentInfo(sub.sessionId, sub.agentId).label;
		const previewed = previewOf(tab.panel);
		if (previewed) return fileName(previewed);
		return (ALL_PANELS as readonly string[]).includes(tab.panel) ? t(`dock.tabs.${tab.panel}`) : tab.panel;
	}
	function tuiReady(sid: string): boolean {
		const session = sessionMap.get(sid);
		return !!session &&
			isValidResumeSessionId(session.chat.sessionId) &&
			(session.chat.resumable || !!session.restored) &&
			!session.chat.switching;
	}
	/** A new conversation: in the chat, or (the TUI by default) in the TUI of
	 *  the backend the user picks. */
	let tuiPick = $state<Project | null>(null);
	/** The TUIs that can run here: LynShen's always, Claude Code / Codex once
	 *  installed and signed in. */
	let tuiBackends = $state<BackendId[]>(['lynshen']);
	function newSession(p: Project) {
		if (prefs.defaultSurface !== 'tui' || p.chats) {
			const id = store.addSession(p);
			// It may be the new conversation already waiting there, and shown.
			showHome = false;
			projectPageId = null;
			return id;
		}
		tuiPick = p;
		const paths = loadBackendSettings().paths;
		for (const id of ['claude', 'codex'] as const)
			checkBackend(id, paths[id])
				.then((s) => {
					if (s.found && s.signed_in !== false && !tuiBackends.includes(id)) tuiBackends = [id, ...tuiBackends];
				})
				.catch(() => {});
	}
	function pickTuiBackend(backend: BackendId) {
		const p = tuiPick;
		tuiPick = null;
		if (p) store.addTuiSession(p, backend);
	}
	// The TUI panel of each conversation in its TUI, for the title bar's way back.
	const tuiPanels: Record<string, TuiPanel | undefined> = $state({});
	/** Into the TUI. A running reply or background task ends with the engine,
	 *  so the user confirms that first. */
	async function continueInTui(sid: string) {
		const chat = sessionMap.get(sid)?.chat;
		if (!chat) return;
		if (chat.busy || chat.bgTasks.length) {
			const ok = await confirm({
				title: t('chat.tuiInterruptTitle'),
				message: t('chat.tuiInterruptMessage'),
				confirmLabel: t('chat.tuiContinue'),
				danger: true
			});
			if (!ok) return;
		}
		store.openInTui(sid);
	}
	// "Open in the TUI" by default: an existing conversation moves there once,
	// when it first can; back in the chat, it stays.
	const openedInTui = new Set<string>();
	$effect(() => {
		if (prefs.defaultSurface !== 'tui') return;
		for (const [sid, session] of sessionMap) {
			if (openedInTui.has(sid) || !session.restored || !canHandOffToTui(session.backendId)) continue;
			if (!tuiReady(sid) || !daemon.sessionOf(sid)) continue;
			openedInTui.add(sid);
			if (!session.chat.busy && !session.chat.bgTasks.length) store.openInTui(sid);
		}
	});

	// A tool tab is an *instance* of a panel kind (two terminals are two tabs);
	// chat tabs derive their id from the session instead.
	let tabSeq = 0;
	const newTabId = () => `p${Date.now().toString(36)}-${(tabSeq++).toString(36)}`;

	const findPanelTab = (kind: string) =>
		leavesOf(tiles.root)
			.flatMap((l) => l.tabs)
			.find((tb) => tb.panel === kind);

	/** Apply + persist a layout change; keep editorStore in sync when the user
	 *  closed the audit tab directly (so a later ⌘E can re-create it). */
	function applyTiles(next: TileLayout) {
		if (next === tiles) return;
		tiles = next;
		if (tilesReady) workspaces.updateLayout(serializeLayout(next));
		if (editorStore.visible && !findPanelTab('audit')) editorStore.visible = false;
	}

	/** Build the canvas for the current workspace: reconcile the persisted
	 *  layout with this run's sessions (migrating old dock-only layouts by
	 *  grafting a chat leaf) and focus the active session's tile. */
	function initTiles() {
		// A saved layout's file previews are not read again: no click asked
		// for them in this run (preview/kinds.ts).
		tiles = dropPreviewTabs(
			reconcileLayout(workspaces.active?.layout ?? null, store.shownSessions.map((s) => s.id), store.activeId || null)
		);
		const activeLeaf = store.activeId ? leafOfTab(tiles.root, chatPanel(store.activeId)) : null;
		focusedLeaf = activeLeaf?.id ?? leavesOf(tiles.root)[0]?.id ?? null;
		tilesReady = true;
		// Persist the reconciled result so migrated layouts land on disk too.
		workspaces.updateLayout(serializeLayout(tiles));
	}

	/** The focused leaf's chat session (if its active tab is one) becomes the
	 *  workbench-active session — engine actions and tool panels target it. */
	function syncActiveFromFocus() {
		const leaf = focusedLeaf ? findLeaf(tiles.root, focusedLeaf) : null;
		const tab = leaf?.tabs.find((tb) => tb.id === leaf.active);
		const sid = tab ? chatSessionOf(tab.panel) : null;
		if (sid && sid !== store.activeId && sessionMap.has(sid)) store.activeId = sid;
	}
	function onMosaicChange(next: TileLayout) {
		applyTiles(next);
		syncActiveFromFocus();
	}
	function onLeafFocus(leafId: string) {
		focusedLeaf = leafId;
		syncActiveFromFocus();
	}

	/** Per-leaf “+” menu (and the empty-canvas buttons). */
	function mosaicAdd(leafId: string | null, key: string) {
		if (key === 'chat') {
			if (leafId) focusedLeaf = leafId;
			// In the current project; with none open, a conversation of its own.
			// The activeId effect opens its tile in the focused leaf.
			if (activeProject && !activeProject.home) newSession(activeProject);
			else void startChat();
			return;
		}
		// The embedded browser is a singleton native webview — a second tab
		// would fight over it, so re-activate the existing one instead.
		if (key === 'browser') {
			const existing = findPanelTab('browser');
			if (existing) {
				applyTiles(activateTab(tiles, existing.id));
				return;
			}
		}
		applyTiles(openElsewhere({ id: newTabId(), panel: key }, { leafId }));
	}

	/** A subagent or tool window, where settings say (canvas.openElsewhere).
	 *  A conversation is split for it only while the chat keeps a usable
	 *  width; below that the window stacks on it. */
	function openElsewhere(
		tab: TileTab,
		{ leafId = null, place = prefs.openElsewhere, sessionId = store.activeId }: { leafId?: string | null; place?: 'side' | 'tab'; sessionId?: string | null } = {}
	): TileLayout {
		const chatLeaf = sessionId ? (leafOfTab(tiles.root, chatPanel(sessionId))?.id ?? null) : null;
		const at = chatLeaf ?? leafId ?? focusedLeaf;
		const el = at ? document.querySelector<HTMLElement>(`[data-leaf="${at}"]`) : null;
		const split = !el || el.clientWidth * (1 - TOOL_SIDE_RATIO) >= TOOL_SPLIT_MIN_CHAT;
		return placeElsewhere(tiles, tab, { place, chatLeaf, leafId, focused: focusedLeaf, split });
	}

	/** Palette / signals: re-activate an existing tab of this panel kind (a
	 *  second instance shouldn't spawn by accident — the + menu does that),
	 *  otherwise open one in the focused leaf. */
	function openPanelTile(kind: string) {
		const existing = findPanelTab(kind);
		if (existing) applyTiles(activateTab(tiles, existing.id));
		else applyTiles(openElsewhere({ id: newTabId(), panel: kind }));
	}

	/** The approval mode a plan runs in once approved: the one before plan mode. */
	function planModeOf(sessionId: string): ApprovalMode {
		const before = sessionMap.get(sessionId)?.chat.modeBeforePlan;
		return before && before !== 'plan' ? before : 'auto';
	}
		/** A plan message of a session, for its page. */
	function planOf(sessionId: string, planId: string) {
		const m = sessionMap.get(sessionId)?.chat.messages.find((x) => x.kind === 'plan' && x.id === planId);
		return m?.kind === 'plan' ? m : undefined;
	}
	/** A plan's page in the side column beside its session's chat: shown
	 *  again if open, else a new tab (one per plan, closed one by one). */
	function openPlanPage(sessionId: string, planId: string) {
		const panel = proposalPanel(sessionId, planId);
		const existing = findPanelTab(panel);
		if (existing) return applyTiles(activateTab(tiles, existing.id));
		applyTiles(openElsewhere({ id: newTabId(), panel }, { place: 'side', sessionId }));
	}
	$effect(() => {
		const request = planPages.request;
		if (!request || !tilesReady) return;
		untrack(() => openPlanPage(request.sessionId, request.planId));
	});
	/** A file a sent message names, previewed beside its session's chat (a
	 *  chip's click, preview/store.svelte.ts): shown again if open, else a
	 *  new tab in the side column. */
	function openFilePreview(sessionId: string, path: string) {
		const panel = previewPanel(path);
		const existing = findPanelTab(panel);
		if (existing) return applyTiles(activateTab(tiles, existing.id));
		applyTiles(openElsewhere({ id: newTabId(), panel }, { place: 'side', sessionId }));
	}
	$effect(() => {
		const request = filePreviews.request;
		if (!request || !tilesReady) return;
		untrack(() => {
			openFilePreview(request.sessionId, request.path);
			filePreviews.request = null;
		});
	});
	// 在终端里运行 (a sandbox request needing admin rights): a new terminal
	// beside the conversation, the command typed there but not run.
	let terminalSeen = 0;
	$effect(() => {
		const request = terminalRequests.request;
		if (!request || !tilesReady || request.n === terminalSeen) return;
		terminalSeen = request.n;
		untrack(() => {
			const tab = { id: newTabId(), panel: 'term' };
			terminalRequests.assign(tab.id, { cwd: request.cwd, command: request.command, run: request.run });
			applyTiles(openElsewhere(tab, { place: 'side', sessionId: request.sessionId || store.activeId }));
		});
	});
	/** A worktree subagent's changes beside its session's chat: the Changes
	 *  panel at the agent's workdir, one tab per agent. */
	function openAgentChanges(sessionId: string, agent: string) {
		const panel = agentChangesPanel(sessionId, agent);
		const existing = findPanelTab(panel);
		if (existing) return applyTiles(activateTab(tiles, existing.id));
		applyTiles(openElsewhere({ id: newTabId(), panel }, { place: 'side', sessionId }));
	}
	$effect(() => {
		const request = agentChanges.request;
		if (!request || !tilesReady) return;
		untrack(() => openAgentChanges(request.sessionId, request.agent));
	});

	/** A subagent of a session, for its tab: its name and state. */
	function subagentInfo(sessionId: string, agentId: string): { label: string; state: ReturnType<typeof runState> | 'unknown' } {
		const chat = sessionMap.get(sessionId)?.chat;
		const run =
			chat?.agentRuns.agents.find((a) => a.id === agentId) ??
			chat?.agentRuns.workflows.flatMap((w) => w.agents).find((a) => a.id === agentId);
		const life = chat?.subagents[agentId];
		const status = run?.state || life?.status;
		return {
			label: run?.label || shortPath(life?.label || agentId),
			state: status ? runState(status) : 'unknown'
		};
	}
	/** A subagent's page: shown again if open; else beside the chat (one
	 *  column, a tab per subagent) or as a tab next to the chat. */
	function openSubagentPage(sessionId: string, agentId: string, place: SubagentPlace) {
		const panel = subagentPanel(sessionId, agentId);
		const existing = findPanelTab(panel);
		if (existing) return applyTiles(activateTab(tiles, existing.id));
		applyTiles(openElsewhere({ id: newTabId(), panel }, { place, sessionId }));
	}
	$effect(() => {
		const request = subagentPages.request;
		if (!request || !tilesReady) return;
		untrack(() => openSubagentPage(request.sessionId, request.agentId, request.place));
	});
	/** A sub-agent clicked in the navigator (under its conversation): its
	 *  conversation in front, then its page beside it, where settings say
	 *  (a Workflow: the conversation's agent trace). */
	async function openNavSubagent(sessionId: string, agent: AgentRow) {
		store.activeId = sessionId;
		projectPageId = null;
		showHome = false;
		await tick();
		if (!agent.workflow) return subagentPages.open(sessionId, agent.id, prefs.openElsewhere);
		const chat = sessionMap.get(sessionId)?.chat;
		if (chat) chat.agentFocus = null;
		openPanelTile('agents');
	}

	// The workbench-active session always has a chat tile: activating a session
	// (sidebar click, ⌘N, resume, deep link…) opens or focuses it.
	$effect(() => {
		const id = store.activeId;
		if (!tilesReady || !id) return;
		untrack(() => {
			// An agent's session shows on the workbench only.
			if (!store.shownSessions.some((s) => s.id === id)) return;
			if (chatSessionsIn(tiles).includes(id)) applyTiles(activateTab(tiles, chatPanel(id)));
			else applyTiles(openChatTab(tiles, focusedLeaf, id));
			const leaf = leafOfTab(tiles.root, chatPanel(id));
			if (leaf) focusedLeaf = leaf.id;
		});
	});

	// Chat tiles of closed (or hidden) sessions disappear with them, whenever
	// either side changes (a tile can also arrive with a restored or dragged
	// layout), and the active session moves to one that is still there.
	$effect(() => {
		const ids = new Set(store.shownSessions.map((s) => s.id));
		const shownTiles = chatSessionsIn(tiles);
		if (!tilesReady) return;
		untrack(() => {
			let next = tiles;
			for (const sid of shownTiles) if (!ids.has(sid)) next = closeTab(next, chatPanel(sid));
			// A closed session's subagent pages go with it.
			for (const tab of leavesOf(next.root).flatMap((l) => l.tabs)) {
				const sub = subagentOf(tab.panel);
				if (sub && !ids.has(sub.sessionId)) next = closeTab(next, tab.id);
			}
			applyTiles(next);
			if (store.activeId && !store.allSessions.some((s) => s.id === store.activeId))
				store.activeId = store.shownSessions.find((s) => !s.archived)?.id ?? '';
		});
	});

	// Opening a page in the embedded browser (agent tool / element pick / typed
	// URL) must reveal the browser tile, or the webview has nowhere to render.
	$effect(() => {
		if (browser.openSignal === 0) return;
		untrack(() => {
			if (tilesReady) openPanelTile('browser');
		});
	});

	// The audit pane (CodeMirror diff review) is a singleton tile driven by
	// editorStore.visible: ⌘E / chat file links / quick-open reveal it, its own
	// close button (and closing the tab, via applyTiles) hides it.
	$effect(() => {
		const want = editorStore.visible;
		if (!tilesReady) return;
		untrack(() => {
			const existing = findPanelTab('audit');
			if (want && !existing) applyTiles(openElsewhere({ id: newTabId(), panel: 'audit' }));
			else if (want && existing) applyTiles(activateTab(tiles, existing.id));
			else if (!want && existing) applyTiles(closeTab(tiles, existing.id));
		});
	});

	// ---------- pane registry ----------
	// Global flows always target the active session's pane: palette commands,
	// ⌘F find, file drops and browser element picks.
	const panes = new Map<string, ChatPaneApi>();
	function registerPane(id: string, api: ChatPaneApi) {
		panes.set(id, api);
	}
	function unregisterPane(id: string, api: ChatPaneApi) {
		if (panes.get(id) === api) panes.delete(id);
	}
	// Palette command → the active pane (claude /resume etc. live there); with
	// no tile open the op still reaches the engine directly.
	function runCommand(cmd: string) {
		const pane = panes.get(store.activeId);
		if (pane) pane.runCommand(cmd);
		else if (store.activeId) dispatch(store.activeId, { op: 'command', input: cmd });
	}

	// Native child webviews always paint above the DOM, so any modal overlay
	// would appear underneath the browser — collapse it while a modal is open.
	$effect(() => {
		const modalOpen =
			showSettings ||
			showSetup ||
			showPalette ||
			showQuickOpen ||
			!!taskDialogFor ||
			// The model picker is an in-composer popover (like effort/approval),
			// not a centered overlay, so it needn't collapse the browser webview.
			(!!chat?.picker && chat.picker.kind !== 'model') ||
			!!chat?.trustPrompt ||
			!!chat?.pendingRewind;
		browser.setSuspended(modalOpen);
	});

	// The editor confines opens / resolves relative engine paths against the
	// active project's root.
	$effect(() => {
		if (activeProject) editorStore.root = activeProject.path;
	});

	// ⌘E audits the current change instead of opening a blank IDE: it reveals
	// the audit tile on the session's most recently changed file (or re-shows /
	// hides files already under review). With nothing changed and nothing open
	// it does nothing — the pane has no empty-editor mode.
	function toggleAudit() {
		if (editorStore.visible) {
			editorStore.visible = false;
			return;
		}
		if (editorStore.tabs.length) {
			editorStore.visible = true;
			return;
		}
		const cwd = activeProject?.path;
		const changed = chat?.changedFiles ?? [];
		if (!cwd || !changed.length) return;
		editorStore.open(changed[changed.length - 1], cwd).catch((e) => console.error('open audit', e));
	}

	// ⌘K in the editor: forward the structured instruction to the active session
	// engine. Returns false when there's no live session to receive it.
	function sendAiEdit(content: string): boolean {
		const c = chat;
		if (!c || c.engineState === 'exited') return false;
		if (!c.busy) {
			// Snapshot the working tree before the turn (codex/claude rewinds
			// restore files from it; lynshen checkpoints engine-side).
			const cwd = activeProject?.path;
			if (cwd && (c.backendId === 'codex' || c.backendId === 'claude')) {
				const idx = c.userTurns;
				gitCheckpointCapture(cwd)
					.then((sha) => {
						if (sha) c.fileCheckpoints[idx] = sha;
					})
					.catch(() => {});
			}
			c.optimisticUser(content);
		}
		if (active?.archived) store.unarchiveSession(activeId);
		return dispatch(activeId, { op: 'user_message', content });
	}

	const loggedIn = $derived(!!chat?.provider && providers.includes(chat.provider));

	// Persist the project layout + open tabs (engine session id + title) into the
	// active workspace (app-data file, not localStorage) whenever they change.
	// Gated on `loaded` so it can't clobber the saved data before the initial
	// restore has run; untracked write so the effect only follows the session tree.
	$effect(() => {
		if (!store.loaded) return;
		const saved = store.serialize();
		untrack(() => workspaces.updateProjects(saved));
	});

	// One list of projects and sessions with the daemon (and so with paired
	// devices): the desktop's edits go to it, other clients' come back.
	const sync = new DaemonSync(store, workspaces, () => store.loaded);
	$effect(() => {
		if (!store.loaded) return;
		// A list that came while the tree was being restored or swapped.
		untrack(() => sync.flush());
		void sync.local();
		// Coalesce bursts of edits (a restore, a drag) into one save.
		const timer = setTimeout(() => sync.push(), 600);
		return () => clearTimeout(timer);
	});
	$effect(() => {
		const list = agentDirectory.sessions;
		void workspaces.activeId;
		if (!store.loaded) return;
		untrack(() => sync.reconcile(list));
	});
	// Tabs of an agent's sessions (restored ones too) keep the agent's
	// approval mode: see ChatState.agent. One still in a user project (opened
	// before agent sessions moved to the workbench) moves to its agent's host.
	$effect(() => {
		for (const s of store.allSessions) {
			if (!s.chat.agent && s.chat.sessionId) {
				const agent = agentDirectory.sessions.find((d) => d.session === s.chat.sessionId)?.agent;
				if (agent) s.chat.agent = agent;
			}
			const cwd = s.chat.agent && agentDirectory.agents.find((a) => a.id === s.chat.agent)?.cwd;
			if (cwd) untrack(() => store.adoptAgentSession(s.id, cwd));
		}
	});
	// Off the workbench, the active session is always one the canvas shows:
	// leaving it from an agent's session goes back to the last shown one.
	let lastShown = '';
	$effect(() => {
		const id = store.activeId;
		const shown = store.shownSessions.some((s) => s.id === id);
		if (shown) lastShown = id;
		else if (id && !showDesk)
			untrack(() => {
				const back = store.shownSessions.find((s) => s.id === lastShown) ?? store.shownSessions[0];
				store.activeId = back?.id ?? '';
			});
	});
	// The sessions on screen: the active one, every chat tile (a tile behind
	// another tab stays mounted) and the one the agent page shows.
	function shownSessionIds(): string[] {
		return [store.activeId, ...(tilesReady ? chatSessionsIn(tiles) : []), ...(showDesk && deskSession ? [deskSession] : [])];
	}
	// A session listed from the daemon, or let go of while hidden, opens
	// when it is shown. One leaving the screen counts as shown until then.
	$effect(() => {
		const ids = shownSessionIds();
		untrack(() => store.noteShown(ids));
		for (const id of ids) {
			const s = sessionMap.get(id);
			if (s?.dormant) untrack(() => store.wake(id));
		}
	});
	// Conversations out of view for a while let go of what the engine can
	// send again (SessionStore.releaseHidden).
	$effect(() => {
		if (!store.loaded) return;
		const timer = setInterval(() => store.releaseHidden(shownSessionIds()), 60_000);
		return () => clearInterval(timer);
	});

	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;

	// The engine announced its startup approval mode and it diverges from the
	// desktop's persisted mode (fresh start, crash auto-restart or provider
	// switch): push ours. Runs off the agent-event stream, per session.
	function flushModeSync(c: ChatState, sid: string) {
		if (!c.pendingModeSync) return;
		const mode = c.pendingModeSync;
		c.pendingModeSync = null;
		// A persisted claude yolo mode can't be pushed over the wire (runtime
		// bypassPermissions is ignored) — respawn with the flag instead.
		if (needsClaudeYoloRespawn(c.backendId, mode)) {
			// Spawned with the bypass flag and still not in bypass: the CLI
			// refused it (e.g. a managed policy). Respawning again would kill
			// every first turn in a loop; follow the engine's mode instead.
			if (store.allSessions.find((x) => x.id === sid)?.spawnedMode === 'bypassPermissions') {
				c.messages.push({ kind: 'error', text: t('shell.claudeYoloRefused') });
				return;
			}
			store.respawnClaudeYolo(sid);
			return;
		}
		dispatch(sid, { op: 'set_approval_mode', mode });
	}

	// ---------- session tab chrome (color / icon / rename) ----------
	// One shared popover serves the mosaic tabs and the sidebar rows.
	let sessionChromeFor = $state<{ sid: string; x: number; y: number } | null>(null);
	const chromeSession = $derived(sessionChromeFor ? (sessionMap.get(sessionChromeFor.sid) ?? null) : null);

	function tileChrome(tab: TileTab): { color?: string; icon?: TabIcon } | null {
		const sid = chatSessionOf(tab.panel);
		const s = sid ? sessionMap.get(sid) : null;
		if (!s || (!s.color && !s.icon)) return null;
		return { color: s.color, icon: s.icon };
	}
	/** Open the chrome popover for a chat tab (context menu / dblclick).
	 *  Tool/TUI/audit tabs have no chrome and keep their default behavior. */
	function openTileChrome(tab: TileTab, ev: MouseEvent) {
		const sid = chatSessionOf(tab.panel);
		if (!sid || !sessionMap.has(sid)) return;
		ev.preventDefault();
		sessionChromeFor = { sid, x: ev.clientX, y: ev.clientY };
	}
	function openSessionMenu(sid: string, ev: MouseEvent) {
		if (!sessionMap.has(sid)) return;
		ev.preventDefault();
		sessionChromeFor = { sid, x: ev.clientX, y: ev.clientY };
	}
	// The same popover colours a sidebar project folder and sets its icon.
	let projectChromeFor = $state<{ id: string; x: number; y: number } | null>(null);
	const chromeProject = $derived(projectChromeFor ? (store.userProjects.find((p) => p.id === projectChromeFor!.id) ?? null) : null);
	function openProjectMenu(p: Project, ev: MouseEvent) {
		ev.preventDefault();
		projectChromeFor = { id: p.id, x: ev.clientX, y: ev.clientY };
	}

	/** Settings → 导入: the folders of imported conversations become projects
	 *  (without a chat; their conversations are in the project's 历史). */
	function addImportedFolders(paths: string[]): number {
		let added = 0;
		for (const path of paths) {
			if (store.userProjects.some((p) => normPath(p.path) === normPath(path))) continue;
			store.addProjectShell({ id: store.uid(), name: folderName(path), path });
			added++;
		}
		return added;
	}
	async function addProject() {
		const path = await open({ directory: true, title: t('shell.pickDirTitle') });
		if (!path || Array.isArray(path)) return;
		store.createProject(path);
	}
	async function removeProject(p: Project) {
		const ok = await confirm({
			title: t('shell.closeProjectTitle'),
			message: p.sessions.length
				? t('shell.closeProjectConfirm', { name: p.name, count: p.sessions.length })
				: t('shell.closeProjectEmptyConfirm', { name: p.name }),
			confirmLabel: t('shell.closeProjectTitle'),
			danger: true,
			dontAskKey: 'remove-project'
		});
		if (!ok) return;
		// Best-effort dirty-tab guard: closing a project with unsaved editor
		// buffers under its root discards them — confirm first.
		const projRoot = p.path.replace(/\/+$/, '');
		const dirtyTabs = editorStore.tabs.filter((tb) => tb.dirty && tb.path.startsWith(projRoot + '/'));
		if (dirtyTabs.length) {
			const ok = await confirm({
				title: t('editor.unsavedTitle'),
				message: t('editor.dirtyProjectConfirm'),
				danger: true
			});
			if (!ok) return;
			for (const tb of dirtyTabs) editorStore.close(tb.path, true);
		}
		store.removeProject(p);
	}

	/** A pane's render error: logged with the session for the logs folder. */
	function reportUiError(error: unknown, sid: string) {
		telemetry.track('error:pane');
		const text = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
		invoke('log_ui_error', { message: `pane ${sid}: ${text}` }).catch(() => {});
	}

	async function removeSession(id: string) {
		const s = sessionMap.get(id);
		// A draft that never started has nothing to lose.
		if (s && !s.draft) {
			const ok = await confirm({
				title: t('shell.removeSessionTitle'),
				message: t('shell.removeSessionConfirm', { title: shownTitle(s.chat.title) }),
				confirmLabel: t('shell.removeSessionTitle'),
				danger: true,
				dontAskKey: 'remove-session'
			});
			if (!ok) return;
		}
		store.removeSession(id);
	}

	// ---------- 并行任务（git worktree） ----------
	/** 把任务 worktree 作为项目打开（已在列表中则聚焦），可携带首条消息（任务描述）。 */
	function openTaskProject(path: string, meta: WorktreeMeta, description = '') {
		taskDialogFor = null;
		const requirement = taskRequirement?.id;
		taskRequirement = null;
		const existing = store.userProjects.find((p) => normPath(p.path) === normPath(path));
		if (existing) {
			store.activeId = existing.sessions[0]?.id ?? store.addSession(existing);
			return;
		}
		// Started on a requirement: the description goes with its start (the
		// start card), not as a first message.
		const project = store.createProject(path, meta, (!requirement && description) || undefined);
		const first = project.sessions[0];
		if (requirement && first) {
			first.requirement = requirement;
			first.requirementStart = { plan: first.chat.approvalMode === 'plan', ...(description ? { text: description } : {}) };
		}
		if (requirement) showDesk = false;
	}
	/** 任务清理完成（worktree 已删除）后，把对应项目从侧边栏移除。 */
	function closeTaskProject(path: string) {
		const p = store.userProjects.find((x) => normPath(x.path) === normPath(path));
		if (p) store.removeProject(p);
	}
	/** 打开「新建并行任务」对话框；worktree 项目上则回落到其主仓库项目。 */
	function newTask(p: Project | undefined) {
		if (!p) return;
		if (p.worktree) {
			const main = store.userProjects.find((x) => normPath(x.path) === normPath(p.worktree!.mainRepoPath));
			taskDialogFor = main ?? { ...p, path: p.worktree.mainRepoPath, name: base(p.worktree.mainRepoPath) };
			return;
		}
		taskDialogFor = p;
	}

	// ---------- 深链（lynshen://） ----------
	const normPath = (p: string) => p.replace(/\/+$/, '');
	/** 打开（或聚焦）路径对应的项目；不存在则在目录有效时创建。 */
	async function openProjectPath(path: string, focusSession = true): Promise<Project | null> {
		const existing = store.userProjects.find((p) => normPath(p.path) === normPath(path));
		if (existing) {
			if (focusSession) store.activeId = existing.sessions[0]?.id ?? store.addSession(existing);
			return existing;
		}
		// 目录存在才创建项目（listDir 失败说明路径无效/不可访问）。
		try {
			await listDir(path, path); // confine to itself: just an existence check
		} catch {
			toast.error(t('shell.deepLinkBadPath', { path }));
			return null;
		}
		return store.createProject(path);
	}
	/**
	 * 深链路由：
	 *   lynshen://open?project=<绝对路径(urlencoded)>          打开/聚焦该项目（目录存在则创建）
	 *   lynshen://session/<会话id>?project=<绝对路径>          打开项目并恢复该会话
	 *   lynshen://auth/approved                               官网授权页批准后打开：进行中的浏览器登录立即查询一次；
	 *                                                         没有进行中的登录则什么也不做（窗口已由原生侧带到前台）
	 */
	async function handleDeepLink(raw: string) {
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			return;
		}
		if (url.protocol !== 'lynshen:') return;
		const route = url.host || url.pathname.replace(/^\/+/, '').split('/')[0];
		const projectPath = url.searchParams.get('project') ?? '';
		if (route === 'auth') {
			authLinkOpened();
		} else if (route === 'open') {
			if (projectPath) await openProjectPath(projectPath);
		} else if (route === 'session') {
			const sid = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
			if (!sid) return;
			const proj = projectPath ? await openProjectPath(projectPath, false) : (activeProject ?? store.shownProjects[0]);
			if (!proj) return;
			// 恢复的会话开在新标签里，不覆盖当前会话。
			store.activeId = store.restoreSession(proj, sid, '');
		}
	}

	// Open a workspace file referenced by a tool panel (e.g. the turns list).
	// HTML opens in the built-in browser (rendered) or the editor (source) per
	// preference; everything else opens in the editor. Paths resolve relative
	// to the active project root (chat links resolve inside their own pane).
	function openActiveFile(href: string) {
		const cwd = activeProject?.path;
		if (!cwd) return;
		const rel = parseFileHref(href).path;
		if (!rel) return;
		const abs = joinPath(cwd, rel);
		const ext = pathExt(abs);
		if ((ext === 'html' || ext === 'htm') && prefs.htmlOpenInBrowser) {
			// The embedded browser loads http(s) only (a file:// URL was refused
			// and left it on its empty page): serve the file from the loopback
			// preview server, as chat links do, so its relative assets load too.
			invoke<string>('preview_url', { path: abs })
				.then((url) => browser.open(url))
				.catch((e) => toast.error(t('chat.fileOpenFailed', { path: rel, error: String(e) })));
		} else {
			editorStore.open(abs, cwd).catch((e) => console.error('open file', e));
		}
	}

	function onWindowKey(e: KeyboardEvent) {
		// Something closer to the target already claimed this key (e.g. the code
		// editor's own ⌘K / ⌘S keymap, or a pane's picker) — never double-fire.
		if (e.defaultPrevented) return;
		// The setup wizard is a blocking first-run modal — don't fire app shortcuts
		// under it (e.g. Cmd+K opening the palette behind it).
		if (showSetup) return;
		const act = (fn: () => void) => {
			e.preventDefault();
			fn();
		};
		const pane = panes.get(activeId);
		if (matches(e, 'palette')) return act(() => (showPalette = !showPalette));
		if (matches(e, 'shortcuts')) return act(() => (showShortcuts = !showShortcuts));
		if (matches(e, 'captureRequirement'))
			return act(() => {
				openRequirements();
				captureSignal += 1;
			});
		if (matches(e, 'find') && chat) return act(() => pane?.toggleFind());
		if (matches(e, 'newSession'))
			return act(() => (activeProject && !activeProject.home ? newSession(activeProject) : void startChat()));
		if (matches(e, 'settings')) return act(() => !showSettings && openSettings());
		if (matches(e, 'sidebar')) return act(toggleSidebar);
		if (matches(e, 'audit')) return act(toggleAudit);
		if (matches(e, 'quickOpen')) return act(() => activeProject && (showQuickOpen = !showQuickOpen));
		if (matches(e, 'terminal')) return act(() => openPanelTile('term'));
		if (matches(e, 'history')) return act(() => activeProject && store.openHistory(activeProject));
		if (matches(e, 'focusComposer') && pane) return act(pane.focusComposer);
		if (matches(e, 'stop') && pane) return act(pane.stop);
		if (matches(e, 'model') && pane) return act(pane.openModelMenu);
		// Sessions as the sidebar lists them under the current project.
		const listed = activeProject ?? store.shownProjects[0];
		const list = listed ? listedSessions(listed) : [];
		const n = matches(e, 'sessionN');
		if (typeof n === 'number' && n > 0) return act(() => list[n - 1] && (store.activeId = list[n - 1].id));
		const step = matches(e, 'nextSession') ? 1 : matches(e, 'prevSession') ? -1 : 0;
		if (step && list.length) {
			const i = list.findIndex((s) => s.id === activeId);
			act(() => (store.activeId = list[(i + step + list.length) % list.length].id));
		}
	}

	onMount(() => {
		cloudSync.start();
		// Anonymous usage counts; told once, off in Settings → General.
		if (telemetry.start(sendTelemetry))
			toast.info(t('settings.help.notice'), {
				duration: 15000,
				action: { label: t('settings.help.noticeAction'), run: () => openSettings('general') }
			});
		const onUiError = (e: Event) => {
			// (window-level errors; a pane's own are caught by its boundary)
			telemetry.track('error:ui');
			const err = e instanceof ErrorEvent ? e.error ?? e.message : (e as PromiseRejectionEvent).reason;
			const text = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err);
			invoke('log_ui_error', { message: text }).catch(() => {});
		};
		window.addEventListener('error', onUiError);
		window.addEventListener('unhandledrejection', onUiError);
		const cleanups: Array<() => void> = [];
		let disposed = false;
		(async () => {
			// Load the workspaces file first (migrating a pre-workspace
			// localStorage layout on first run): it has no dependency on the
			// event listeners below, and the sidebar switcher can show early.
			const wsEntry = await workspaces.load(t('shell.workspace.default'));
			// One engine frame from the daemon into its session's adapter and
			// ChatState.
			const deliver = (sessionId: string, data: string, parsed: unknown) => {
				const s = sessionMap.get(sessionId);
				if (!s) return;
				const wasBusy = s.chat.busy;
				const hadApproval = s.chat.pendingApproval?.callId ?? null;
				const hadPlan = s.chat.messages.findLast((m) => m.kind === 'plan' && m.status === 'pending');
				const lastPlan = s.chat.messages.findLast((m) => m.kind === 'plan');
				// Capture the raw frame for the diagnostics trace so a mis-parsed or
				// dropped tool frame is inspectable after the fact.
				s.chat.captureFrame(data, parsed);
				// Route the frame through the session's adapter (the daemon already
				// speaks the lynshen dialect for every engine); the client parsed it
				// to route it, so a long transcript is not parsed again. Translate
				// and each handle() are isolated so one bad frame or event
				// can't silently drop the sibling events that follow it (e.g. a tool's
				// completion riding in the same frame as something that threw).
				const frame = parsed;
				let translated: ReturnType<typeof s.adapter.translate>;
				try {
					translated = s.adapter.translate(frame);
				} catch (err) {
					console.error('[agent-event] adapter.translate threw', err, frame);
					return;
				}
				for (const ev of translated) {
					try {
						s.chat.handle(ev);
					} catch (err) {
						console.error('[agent-event] chat.handle threw', (ev as { type?: string })?.type, err);
					}
				}
				flushModeSync(s.chat, s.id);
				// Let go of while hidden and starting something: watched again.
				store.rouse(s);
				const miss = s.chat.cacheMiss;
				if (miss) {
					s.chat.cacheMiss = null;
					if (prefs.cacheMissAlert) {
						toast.warn(
							t('shell.cacheMiss.message', {
								title: shownTitle(s.chat.title),
								input: fmtTokens(miss.input),
								cached: fmtTokens(miss.cached)
							}),
							{ duration: 5000, action: { label: t('shell.cacheMiss.stop'), run: () => dispatch(s.id, { op: 'interrupt' }) } }
						);
					}
				}
				// Read the current active session at call time (store.activeId is
				// reactive) — not a value snapshotted when the listener was mounted —
				// so unseen/notification target the right session after tab switches.
				const curActive = store.activeId;
				if (wasBusy && !s.chat.busy && s.id !== curActive) {
					s.chat.unseen = true;
					notifyDone(s.chat.title);
				}
				// Something waits on the user while the window is in the
				// background: an action to allow, or a plan to approve.
				if (!document.hasFocus()) {
					const ask = s.chat.pendingApproval;
					if (ask && ask.callId !== hadApproval && !ask.questions?.length)
						void notify(shownTitle(s.chat.title), t('shell.notifyApproval', { what: ask.summary.slice(0, 120) }));
					const plan = s.chat.messages.findLast((m) => m.kind === 'plan' && m.status === 'pending');
					if (plan && plan !== hadPlan && plan.kind === 'plan')
						void notify(shownTitle(s.chat.title), t('shell.notifyPlan', { title: plan.title }));
				}
				// A plan the model starts writing (or proposes whole) opens in its
				// page beside this session's chat.
				const newPlan = s.chat.messages.findLast((m) => m.kind === 'plan');
				if (newPlan && newPlan !== lastPlan && newPlan.kind === 'plan' && (newPlan.status === 'drafting' || newPlan.status === 'pending') && tilesReady && chatSessionsIn(tiles).includes(s.id))
					openPlanPage(s.id, newPlan.id);
								// This session's tile (if any) sticks to the bottom while streaming.
				panes.get(s.id)?.scrollToEnd();
			};
			daemon.onFrame = deliver;
			daemon.onExit = (id) => store.handleExit(id);
			daemon.onEvent = (frame) => {
				agentDirectory.handle(frame);
				sync.handle(frame);
				requirements.handle(frame);
			};
			daemon.onDisconnect = () => {
				agentDirectory.disconnected();
				sync.reset();
			};
			daemon.onHello = (version) => {
				engine.version = version;
				// The terminal shell the settings name, ready for the first terminal.
				void shells.load();
				checkDaemonVersion(version).then((outcome) => {
					if (outcome.kind === 'restart-when-idle')
						toast.info(t('shell.daemonUpdate.idle', { version: outcome.version }));
					else if (outcome.kind === 'failed') toast.error(t('shell.daemonUpdate.failed', { error: outcome.error }));
				});
			};
			// The client outlives this page: release the sessions it claimed for
			// this page's tabs when the page goes (see detachAll).
			cleanups.push(() => daemon.detachAll());
			agentDirectory.start();
			const undrop = await getCurrentWebview().onDragDropEvent((e) => {
				if (e.payload.type === 'drop')
					for (const p of e.payload.paths) panes.get(store.activeId)?.addAttachment(p);
			});
			// Embedded-browser events: element picks become composer chips in the
			// active chat pane; nav/state updates flow into the browser store.
			const unbrowser = await listen<Record<string, unknown>>('browser-event', (e) => {
				const p = e.payload;
				if (p.kind === 'element') {
					browser.picking = false;
					const ref: WebRef = {
						url: typeof p.url === 'string' ? p.url : '',
						title: typeof p.title === 'string' ? p.title : '',
						selector: typeof p.selector === 'string' ? p.selector : '',
						tag: typeof p.tag === 'string' ? p.tag : '',
						text: typeof p.text === 'string' ? p.text : '',
						html: typeof p.html === 'string' ? p.html : ''
					};
					panes.get(store.activeId)?.insertWebRef(ref);
				} else {
					browser.handleEvent(p);
				}
			});
			// 托盘菜单「新建会话」：在当前项目里开新会话；没有项目时开一个独立对话。
			const untray = await listen('tray-new-session', () => {
				const p = store.activeProject;
				if (p && !p.home) newSession(p);
				else void startChat();
			});
			// Quitting (tray menu, Cmd+Q): save the workspaces first; the app
			// waits for this (see begin_quit in src-tauri).
			const unquit = await listen('app-quit', async () => {
				await workspaces.flush();
				await invoke('quit_app');
			});
			cleanups.push(undrop, unbrowser, untray, unquit);
			// The agent's browser_open tool navigates the embedded browser.
			ChatState.onBrowserOpen = (url) => browser.open(url);
			cleanups.push(() => (ChatState.onBrowserOpen = null));
			// Successful edit-tool completions auto-reload matching editor tabs
			// (and resolve pending ⌘K AI edits).
			ChatState.onFilesEdited = (paths) => editorStore.handleEngineEdit(paths);
			cleanups.push(() => (ChatState.onFilesEdited = null));
			// A turn that failed on the connection is picked back up (autoRetry.ts).
			autoRetry.store = store;
			ChatState.onTurnFailed = (c, message, started) => autoRetry.failed(c, message, started);
			cleanups.push(() => (ChatState.onTurnFailed = null));
			if (disposed) {
				cleanups.forEach((f) => f());
				return;
			}
			// Restore the active workspace's projects + their open conversations
			// (resume by id), or seed a default project on first run — then build
			// the canvas from the persisted layout.
			await store.restore(wsEntry.projects);
			initTiles();
			// 深链在项目恢复完成后再注册，冷启动携带的链接（onOpenUrl 会补发当前
			// 深链）才能作用于已恢复的项目列表。
			const undeep = await onOpenUrl((urls) => {
				for (const u of urls) handleDeepLink(u);
			});
			cleanups.push(undeep);
			// On launch a newer version asks to update now or later (UpdatePrompt);
			// every 10 minutes after that one found later downloads in the
			// background. The relaunch is the user's unless the server requires
			// the version. LynShen's Beta switches (features.json next to the
			// feed) are read at the same times.
			void teamSwitch.refresh();
			const updateTimer = setTimeout(() => updater.checkOnLaunch(), 3000);
			const updateEvery = setInterval(() => {
				void updater.check(true, true);
				void teamSwitch.refresh();
			}, 10 * 60 * 1000);
			cleanups.push(() => clearTimeout(updateTimer), () => clearInterval(updateEvery));
			loadProviders();
			readAuthProviders()
				.then(async (p) => {
					if (p.includes('lynshen')) {
						try {
							if (await refreshLynShenModels()) loadProviders();
						} catch (e) {
							toast.error(t('settings.page.saveFailed', { msg: String(e) }));
						}
					}
					providers = p;
					authKnown = true;
					syncTrial(p);
					// A first run starts at the sign-in. A signed-in account is
					// ready (and one signed in before this version never sees the
					// welcome page again); any other provider is not proof of a
					// finished first run.
					const start = firstRunStart(!!localStorage.getItem(SETUP_DONE_KEY), p.includes('monoize') || p.includes('lynshen'));
					if (start === 'done') setupDone();
					else if (start === 'login') {
						firstRun = true;
						setupView = 'login';
						showSetup = true;
					}
				})
				.catch(() => {
					// Unread sign-in: a first run still starts at the sign-in.
					authKnown = true;
					if (!localStorage.getItem(SETUP_DONE_KEY)) {
						firstRun = true;
						setupView = 'login';
						showSetup = true;
					}
				});
		})();
		return () => {
			disposed = true;
			window.removeEventListener('error', onUiError);
			window.removeEventListener('unhandledrejection', onUiError);
			cleanups.forEach((f) => f());
		};
	});
</script>

<svelte:window onkeydown={onWindowKey} />

<!-- A chat tab's status, the same marks as its sidebar row. -->
{#snippet tabMark(tab: TileTab)}
	{@const sid = chatSessionOf(tab.panel)}
	{@const s = sid ? sessionMap.get(sid) : undefined}
	{#if s}<SessionMark status={sessionStatus(s.chat)} compact />{/if}
	{@const sub = subagentOf(tab.panel)}
	{#if sub}<StateIcon state={subagentInfo(sub.sessionId, sub.agentId).state} size={12} />{/if}
{/snippet}

<Toaster />
<ConfirmHost />

<div class="app">
	<!-- TOP: one title bar across the window (traffic lights, sidebar toggle,
	     the title of what is in front aligned with the canvas, panel actions). -->
	<TitleBar
		leftWidth={RAIL_WIDTH + navShown}
		resizing={sbResizing}
		sidebarOpen={!sidebarCollapsed}
		onToggleSidebar={toggleSidebar}
		showToggle={!showSetup}
		heading={!showSettings && !showDesk && !showSetup && !homeShown && !pageProject && !!active}
		title={showSettings ? t('settings.title') : showDesk ? t('shell.desk.title') : showSetup ? 'Aogiri' : pageProject ? pageProject.name : showHome || !active ? t('shell.home.title') : shownTitle(active.chat.title)}
		subtitle={showSettings || showDesk || showSetup || showHome || pageProject || !activeProject || activeProject.home ? '' : activeProject.name}
		addOptions={showSettings || showDesk || showSetup ? [] : addOptions}
		onAdd={(key) => mosaicAdd(focusedLeaf, key)}
	>
		{#snippet actions()}
			{#if !showSettings && !showDesk && !showSetup && active && active.surface === 'tui'}
				<button class="tile-action" title={t('dock.tui.backToGui')} aria-label={t('dock.tui.backToGui')} onclick={() => active && tuiPanels[active.id]?.backToGui()}>
					<ChatCircleTextIcon size={16} />
				</button>
			{:else if !showSettings && !showDesk && !showSetup && active && canHandOffToTui(active.backendId)}
				<button
					class="tile-action"
					disabled={!tuiReady(active.id)}
					title={tuiReady(active.id) ? t('chat.tuiContinueTitle') : t('chat.tuiContinueUnavailable')}
					aria-label={t('chat.tuiContinue')}
					onclick={() => active && continueInTui(active.id)}
				>
					<TerminalWindowIcon size={16} />
				</button>
			{/if}
		{/snippet}
	</TitleBar>
	<div class="body">
		<!-- The content panel: session list + canvas, inset in the window chrome
		     flush with the window edge. Settings covers it as a page; the
		     session list and canvas stay mounted (hidden) underneath so chats,
		     terminals and TUI tiles keep their state. -->
		<div class="panel" class:covered={showSettings || showDesk}>
			<!-- LEFT: the navigator — workspace / projects / sessions. Clicking a session
			     opens or focuses its chat tile on the canvas. -->
			<Sidebar
				projects={store.userProjects}
				activeId={showHome ? '' : activeId}
				width={sidebarWidth}
				collapsed={sidebarCollapsed}
				onToggleCollapsed={toggleSidebar}
				resizing={sbResizing}
				onSelect={(id) => crossfade(() => ((store.activeId = id), (projectPageId = null), (showHome = false)))}
				onOpenProject={openProjectPage}
				openProject={projectPageId}
				onNewProject={addProject}
				onNewTask={newTask}
				onNewSession={(p) => newSession(p)}
				onNewChat={startChat}
				onCloseSession={removeSession}
				onCloseProject={removeProject}
				onArchiveSession={(id) => store.archiveSession(id)}
				onUnarchiveSession={(id) => store.unarchiveSession(id)}
				onPinSession={(id, pinned) => store.setPinned(id, pinned)}
				onMoveSession={(id, target, after) => store.moveSession(id, target, after)}
				onMoveProject={(id, target, after) => store.moveProject(id, target, after)}
				onRenameSession={(id, title) => store.renameSession(id, title)}
				onSessionMenu={openSessionMenu}
				onProjectMenu={openProjectMenu}
				holdOpen={!!sessionChromeFor || !!projectChromeFor}
				onOpenSubagent={openNavSubagent}
				onHistory={(p) => store.openHistory(p)}
				agents={agentDirectory.agents}
				agentsStatus={agentDirectory.status}
				onOpenAgent={(a) => openDesk(a.id)}
				onAgentSession={(a) => store.openAgentSession(a, agentDirectory.latestSession(a.id)?.session)}
				agentPending={(id) => agentDirectory.pendingFor(id)}
				pendingCount={agentDirectory.pending}
				onDesk={() => openDesk(null)}
				onHome={openHome}
				homeOpen={showHome}
				footer={{
					loggedIn: signedInNow,
					updateAvailable: updater.available,
					onManageAccount: () => openSettings('account'),
					onSettings: () => showSettings || openSettings(),
					onUpdate: () => openSettings('updates'),
					onLoggedOut: () => {
						refreshAuth();
						afterAccountLogout();
					}
				}}
			/>
			<div class="resizer side" class:hidden={sidebarCollapsed} role="separator" aria-label={t('shell.remote.resizeSidebar')} onpointerdown={startSidebarResize}></div>

			<!-- THE CANVAS: workspace tabs on top, one mosaic for chats, tool panels,
			     TUI and audit tiles below. -->
			<div class="canvas">
				{#if homeShown}
					<HomePage
						projects={store.userProjects}
						agents={agentDirectory.agents}
						agentsOn={agentDirectory.status === 'on'}
						onStart={(text, model) => startChat(text, model)}
						modelPicker={defaultBackendFor(store.home?.lastBackend) === 'lynshen'}
						onOpenSession={(id) => crossfade(() => ((store.activeId = id), (showHome = false)))}
						onOpenProject={openProjectPage}
						onAddProject={addProject}
						onOpenAgent={(a) => openDesk(a.id)}
					/>
				{/if}
				{#if pageProject}
					{#key pageProject.id}
						<ProjectPage
							project={pageProject}
							projects={workspaceProjects}
							{currentStep}
							onClose={() => (projectPageId = null)}
							onDirs={(dirs) => store.setProjectDirs(pageProject, dirs)}
							onStartRequirement={startRequirement}
							onOpenSession={(s) => openDaemonSession(s)}
							onOpenAgent={(id) => openDesk(id)}
						/>
					{/key}
				{/if}

				<div class="stage" class:covered={homeShown || !!pageProject}>
					{#if store.loaded && store.shownSessions.length === 0}
						<!-- The home page covers an empty canvas. -->
					{:else}
						<Mosaic
							hideSoloBar
							layout={tiles}
							onchange={onMosaicChange}
							label={tileLabel}
							{addOptions}
							onAdd={mosaicAdd}
							emptyText={t('dock.dock.empty')}
							emptyHint={t('dock.dock.hint')}
							focused={focusedLeaf}
							onFocus={onLeafFocus}
							decorate={tileChrome}
							{tabMark}
							onTabContext={openTileChrome}
							onTabRename={openTileChrome}
						>
								{#snippet actions(tab)}
									{@const sid = chatSessionOf(tab.panel)}
									{@const session = sid ? sessionMap.get(sid) : undefined}
									{#if sid && session?.surface === 'tui'}
										<button class="tile-action" title={t('dock.tui.backToGui')} aria-label={t('dock.tui.backToGui')} onclick={() => tuiPanels[sid]?.backToGui()}>
											<ChatCircleTextIcon size={13} />
										</button>
									{:else if sid && session && canHandOffToTui(session.backendId)}
										<button
											class="tile-action"
											disabled={!tuiReady(sid)}
											title={tuiReady(sid) ? t('chat.tuiContinueTitle') : t('chat.tuiContinueUnavailable')}
											aria-label={t('chat.tuiContinue')}
											onclick={() => continueInTui(sid)}
										>
											<TerminalWindowIcon size={13} />
										</button>
									{/if}
								{/snippet}
								{#snippet panel(tab)}
								{@const sid = chatSessionOf(tab.panel)}
								{@const tui = tuiBackendOf(tab.panel)}
								{#if sid}
									{@const sess = sessionMap.get(sid)}
									{#if sess}
										{#if sess.surface === 'tui'}
											<!-- Session handoff: the same chat tile renders the native TUI
											     resuming this conversation by id (never a standalone tui:* tab),
											     once the engine has its daemon session (a new one is starting). -->
											{#if sess.chat.sessionId && daemon.sessionOf(sid)}
											<TuiPanel
												bind:this={tuiPanels[sid]}
												backend={sess.backendId}
												cwd={store.projectPathOf(sid) ?? ''}
												session={daemon.sessionOf(sid)}
												onBackToGui={() => store.returnToGui(sid)}
												onOpenSettings={() => openSettings('agents')}
											/>
											{/if}
										{:else}
											<!-- A render error in one conversation must not blank the
											     pane silently: it shows, is logged, and can be retried. -->
											<svelte:boundary onerror={(e) => reportUiError(e, sid)}>
												<ChatPane
													session={sess}
													{store}
													{providers}
													{providersList}
													isActive={sid === activeId}
													onRegister={registerPane}
													onUnregister={unregisterPane}
													onOpenSettings={openSettings}
													onOpenAgent={openDesk}
													onOpenRequirement={openRequirements}
													onOpenTrace={() => openPanelTile('agents')}
													onOpenTeam={() => openPanelTile('team')}
													onOpenChanges={() => openPanelTile('changes')}
													onOpenSession={openSessionById}
												/>
												{#snippet failed(error, reset)}
													<div class="pane-error">
														<p>{t('shell.paneError')}</p>
														<code>{String((error as Error)?.message ?? error).slice(0, 300)}</code>
														<button onclick={reset}>{t('shell.paneErrorRetry')}</button>
													</div>
												{/snippet}
											</svelte:boundary>
										{/if}
									{:else}
										<!-- A tile whose session went away is closed by the effect
										     above on the next tick; nothing to show meanwhile. -->
										<div class="gone" aria-hidden="true"></div>
									{/if}
								{:else if tab.panel === 'plan'}<PlanPanel plan={chat?.plan ?? []} />
								{:else if proposalOf(tab.panel)}
									{@const p = proposalOf(tab.panel)!}
									{@const plan = planOf(p.sessionId, p.planId)}
									{@const lastPlan = sessionMap.get(p.sessionId)?.chat.messages.findLast((m) => m.kind === 'plan')}
									<ProposalPane
										{plan}
										actionable={!!plan && plan === lastPlan}
										defaultMode={planModeOf(p.sessionId)}
										onAction={(id, action) => {
											panes.get(p.sessionId)?.planAction(id, action);
											if (action.decision === 'revise') panes.get(p.sessionId)?.focusComposer();
										}}
									/>
								{:else if agentChangesOf(tab.panel)}
									{@const c = agentChangesOf(tab.panel)!}
									{@const member = sessionMap.get(c.sessionId)?.chat.team[c.agent]}
									{#if member?.workdir && !member.merge?.ok}
										<ChangesPanel cwd={member.workdir} files={member.files} readonly title={t('chat.team.changesTab', { name: shortPath(c.agent) })} />
									{:else}
										<p class="panel-gone">{t('chat.team.changesGone')}</p>
									{/if}
								{:else if subagentOf(tab.panel)}
									{@const sub = subagentOf(tab.panel)!}
									{#key tab.panel}
										<SubagentPane chat={sessionMap.get(sub.sessionId)?.chat} agentId={sub.agentId} onOp={(op) => dispatch(sub.sessionId, op)} />
									{/key}
								{:else if previewOf(tab.panel)}
									<FilePreview path={previewOf(tab.panel)!} root={activeProject?.path ?? ''} />
								{:else if tab.panel === 'goal'}<GoalPanel goal={chat?.goal ?? null} />
								{:else if tab.panel === 'agents'}{#if chat && activeId}{#key activeId}<AgentRunsPanel {chat} onOp={(op) => activeId && dispatch(activeId, op)} />{/key}{/if}
								{:else if tab.panel === 'team'}{#if chat && activeId}{#key activeId}<TeamPanel
											{chat}
											onOp={(op) => activeId && dispatch(activeId, op)}
											onOpenAgent={caps(chat).agentTrace
												? (id) => {
														chat.agentFocus = id;
														openPanelTile('agents');
													}
												: undefined}
										/>{/key}{/if}
								{:else if tab.panel === 'changes'}<ChangesPanel cwd={activeProject?.path ?? ''} files={chat?.changedFiles ?? []} agentDiffs={chat?.agentDiffs ?? {}} onRevert={(p) => chat && (chat.changedFiles = chat.changedFiles.filter((x) => x !== p))} />
								{:else if tab.panel === 'turns'}<TurnsPanel turns={chat?.turnTimeline ?? []} onOpenFile={openActiveFile} />
								{:else if tab.panel === 'files'}<FilesPanel rootDir={activeProject?.path ?? ''} />
								{:else if tab.panel === 'git'}<GitPanel cwd={activeProject?.path ?? ''} worktree={activeProject?.worktree ?? null} llm={llmTarget} onOpenTask={(path, meta) => openTaskProject(path, meta)} onTaskRemoved={closeTaskProject} />
								{:else if tab.panel === 'term'}<TerminalPanel cwd={terminalRequests.cwdOf(tab.id) ?? activeProject?.path ?? ''} tabId={tab.id} />
								{:else if tab.panel === 'browser'}<BrowserPanel />
								{:else if tab.panel === 'diag'}<DiagnosticsPanel chat={chat ?? null} />
								{:else if tab.panel === 'audit'}<EditorPane onAiSend={sendAiEdit} />
								{:else if tui}<TuiPanel backend={tui} cwd={activeProject?.path ?? ''} onOpenSettings={() => openSettings('agents')} />
								{/if}
							{/snippet}
						</Mosaic>
					{/if}
				</div>
			</div>
			{#if showSettings}
				<SettingsPage
					sessionId={activeId}
					{chat}
					bind:section={settingsSection}
					navWidth={sidebarWidth}
					onAuthChange={refreshAuth}
					onAccountLogout={afterAccountLogout}
					onFeedback={() => (showFeedback = true)}
					onAddFolders={addImportedFolders}
					project={activeProject && !activeProject.chats ? activeProject.path : ''}
					sessions={store.allSessions}
					onClose={closeSettings}
				/>
			{/if}
			{#if showDesk}
				<DeskPage
					bind:agentId={deskAgent}
					bind:sessionId={deskSession}
					bind:page={deskPage}
					bind:requirementId={deskRequirement}
					projects={workspaceProjects}
					currentProject={activeProject?.id}
					{captureSignal}
					{currentStep}
					onStartRequirement={startRequirement}
					openSid={deskSession ? (sessionMap.get(deskSession)?.chat.sessionId ?? null) : null}
					navWidth={sidebarWidth}
					onClose={() => (showDesk = false)}
					onOpenSession={openDaemonSession}
					onNewSession={(agent) => {
						deskSession = store.openAgentSession(agent);
						deskAgent = agent.id;
					}}
				>
					{#snippet chatView(id)}
						{@const sess = sessionMap.get(id)}
						{#if sess}
							<ChatPane
								session={sess}
								{store}
								{providers}
								{providersList}
								isActive={id === activeId}
								onRegister={registerPane}
								onUnregister={unregisterPane}
								onOpenSettings={openSettings}
								onOpenAgent={openDesk}
								onOpenRequirement={openRequirements}
								onOpenSession={openSessionById}
							/>
						{:else}
							<div class="gone">{t('shell.chatGone')}</div>
						{/if}
					{/snippet}
				</DeskPage>
			{/if}
		</div>
	</div>


	<UpdatePrompt />
	<!-- Over the workbench, not over the first-run pages. -->
	{#if !showSetup}<TrialGrantCard />{/if}
	{#if showSetup}
		<Welcome
			sessionId={activeId}
			startAt={setupView}
			{firstRun}
			hidden={showSettings}
			{chat}
			loggedIn={providers.includes('monoize') || providers.includes('lynshen')}
			configured={providers.length > 0}
			onRefreshAuth={refreshAuth}
			onOpenSettings={openSettings}
			onSignedIn={async () => {
				// Signed in: the app is ready on the account. The first run is
				// over, the trial is claimed now, the engine uses the account
				// where its provider cannot run.
				await afterWelcomeSignIn();
				firstRun = false;
				showSetup = false;
				setupView = 'login';
				refreshAuth();
			}}
			onDismiss={setupDone}
			onClose={async (choice) => {
				// The agent picked, and an explicit model choice, on the initial
				// draft, not just in its menus.
				if (activeId) {
					await store.switchBackend(activeId, choice.backend);
					if (choice.backend === 'claude' || choice.backend === 'codex') {
						await store.applyToolProfile(activeId, choice.gateway ? 'lynshen' : 'system', choice.model || undefined);
					} else if (choice.model && active?.draft) {
						active.chat.model = choice.model;
						active.chat.effort = choice.effort;
						active.draftPick = { model: choice.model, effort: choice.effort };
					} else if (choice.model) {
						dispatch(activeId, { op: 'command', input: `/model ${choice.model}${choice.effort ? ` ${choice.effort}` : ''}` });
					}
				}
				setupDone();
			}}
		/>
	{/if}

	{#if modelSetup.open}
		<ModelSetup
			onClose={() => {
				modelSetup.open = false;
				loadProviders();
				// Running LynShen sessions re-read config.json's list (their /model
				// reload): the menu shows what was just checked, on every platform.
				for (const s of store.allSessions)
					if (s.backendId === 'lynshen' && !s.draft && !s.dormant) {
						s.chat.silentModelView++;
						dispatch(s.id, { op: 'command', input: '/model' });
					}
			}}
		/>
	{/if}

	{#if showQuickOpen && activeProject}
		{@const qoRoot = activeProject.path}
		<QuickOpen
			root={qoRoot}
			onClose={() => (showQuickOpen = false)}
			onOpen={(rel) => {
				showQuickOpen = false;
				editorStore.open(rel, qoRoot).catch((e) => toast.error(String(e)));
			}}
		/>
	{/if}

	{#if showFeedback}
		<FeedbackDialog onClose={() => (showFeedback = false)} />
	{/if}

	{#if taskDialogFor}
		<TaskDialog
			project={taskDialogFor}
			name={taskRequirement?.name}
			onClose={() => ((taskDialogFor = null), (taskRequirement = null))}
			onCreated={openTaskProject}
		/>
	{/if}


	{#if sessionChromeFor && chromeSession}
		<TabChromePopover
			x={sessionChromeFor.x}
			y={sessionChromeFor.y}
			name={chromeSession.chat.title}
			color={chromeSession.color ?? null}
			icon={chromeSession.icon ?? null}
			onRename={(n) => store.renameSession(chromeSession.id, n)}
			onColor={(c) => store.setSessionChrome(chromeSession.id, { color: c })}
			onIcon={(i) => store.setSessionChrome(chromeSession.id, { icon: i })}
			pinned={!!chromeSession.pinned}
			onPin={(v) => store.setPinned(chromeSession.id, v)}
			onClose={() => (sessionChromeFor = null)}
		/>
	{/if}

	{#if projectChromeFor && chromeProject}
		<TabChromePopover
			x={projectChromeFor.x}
			y={projectChromeFor.y}
			name={chromeProject.name}
			color={chromeProject.color ?? null}
			icon={chromeProject.icon ?? null}
			onColor={(c) => store.setProjectChrome(chromeProject, { color: c })}
			onIcon={(i) => store.setProjectChrome(chromeProject, { icon: i })}
			onClose={() => (projectChromeFor = null)}
		>
			{#snippet defaultIcon()}
				{#if chromeProject.worktree}<GitBranchIcon size={14} />{:else}<FolderIcon size={14} />{/if}
			{/snippet}
		</TabChromePopover>
	{/if}

	{#if tuiPick}
		<Modal title={t('chat.tuiNewTitle')} width={380} onClose={() => (tuiPick = null)}>
			<p class="tui-pick-hint">{t('chat.tuiNewHint')}</p>
			<div class="tui-pick">
				{#each tuiBackends as backend (backend)}
					<button class="tui-pick-item" onclick={() => pickTuiBackend(backend)}>
						<BackendIcon {backend} size={18} />
						<span>{BACKEND_LABELS[backend]}</span>
					</button>
				{/each}
			</div>
		</Modal>
	{/if}

	{#if showPalette}
		<CommandPalette
			{chat}
			hasProject={!!activeProject}
			canNewTask={!!activeProject && !activeProject.stale}
			panelOptions={panelKeys.map((k) => ({ key: k, label: t(`dock.tabs.${k}`) }))}
			onClose={() => (showPalette = false)}
			onRun={runCommand}
			onNewSession={() => activeProject && newSession(activeProject)}
			onNewProject={addProject}
			onNewTask={() => newTask(activeProject)}
			onSettings={() => openSettings()}
			onMarket={() => openSettings('market')}
			onOpenPanel={openPanelTile}
			onToggleSidebar={toggleSidebar}
			onToggleTheme={cycleTheme}
			onSetup={(view) => {
				setupView = view ?? 'guide';
				showSetup = true;
			}}
			onHistory={() => activeProject && store.openHistory(activeProject)}
			onShortcuts={() => (showShortcuts = true)}
			onFeedback={() => (showFeedback = true)}
			canOpenTui={!!active && active.surface !== 'tui' && canHandOffToTui(active.backendId) && tuiReady(active.id)}
			onOpenTui={() => active && continueInTui(active.id)}
		/>
	{/if}
	{#if showShortcuts}
		<ShortcutsDialog
			onClose={() => (showShortcuts = false)}
			onCustomize={() => {
				showShortcuts = false;
				openSettings('shortcuts');
			}}
		/>
	{/if}
</div>

<style>
	/* The window is the app, not a page: the document never scrolls, by a
	   trackpad (WebKit chains a scroll an inner list cannot take up to the
	   root) or by scrollIntoView, which `hidden` still allows and `clip`
	   does not; nor does it rubber-band. Lists scroll inside their panes. */
	:global(html),
	:global(body) {
		overflow: clip;
		overscroll-behavior: none;
	}
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
		background: var(--rail);
	}
	/* Round the frame to the macOS window corners (the transparent window does
	   not clip them); frosted chrome when vibrancy is on. */
	:global(:root[data-os='macos']) .app {
		border-radius: 12px;
	}
	:global(:root[data-vibrancy='on']) .app {
		background: var(--vibrancy-chrome);
	}
	/* A custom background covers the whole window, under the title bar and
	   the sidebar too; they lay their tints over it (app.css). */
	:global(:root[data-canvas-bg]) .app {
		background: var(--rail) var(--canvas-image) center / cover no-repeat;
	}
	/* Under the title bar, across the full width: the first region boundary
	   (design.md, "Window frame"). */
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
		border-top: 1px solid var(--divider);
	}
	.panel {
		flex: 1;
		display: flex;
		min-width: 0;
		/* Flush with the window's left edge (no rail beside it): a rounded
		   corner there cut a sliver out of the sidebar's top, which showed
		   the title bar's fill (bright over a background image). */
		overflow: hidden;
		position: relative;
		/* No fill of its own: the sidebar (frosted under vibrancy) and the
		   canvas paint their parts. */
	}
	/* Under the settings page: hidden but mounted. The frosted settings nav is
	   translucent, so the session list must not show through it. */
	.panel.covered > :global(:not(.settings, .desk-page)) {
		visibility: hidden;
	}

	/* ---------- the canvas ---------- */
	/* Edge to edge: no inset, radius or shadow; a 1px divider at the
	   navigator's edge. */
	.canvas {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		border-left: 1px solid var(--divider);
		background: var(--bg);
		position: relative;
		/* Switching conversations and pages crossfades it (ui/viewTransition.ts). */
		view-transition-name: canvas;
	}
	.stage {
		flex: 1;
		display: flex;
		min-width: 0;
		min-height: 0;
	}
	.stage > :global(.mosaic) {
		flex: 1;
	}
	/* Under the home and project pages: hidden but mounted, so chats keep
	   their state. Over a custom background those pages are transparent
	   (app.css), and the open chat must not show through them. */
	.stage.covered {
		visibility: hidden;
	}
	.tile-action {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		padding: 4px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.tile-action:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.tile-action:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.gone {
		height: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}
	.panel-gone {
		margin: 0;
		padding: 18px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	/* ---------- sidebar resizer ---------- */
	.resizer {
		width: 5px;
		flex-shrink: 0;
		cursor: col-resize;
		background: transparent;
		z-index: 5;
		transition: background var(--t-med) var(--ease-out);
	}
	.resizer:hover {
		background: var(--accent-soft);
	}
	.resizer.side {
		margin-left: -3px;
		margin-right: -2px;
	}
	.resizer.hidden {
		display: none;
	}
	.tui-pick-hint {
		margin: 0 0 12px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.tui-pick {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.tui-pick-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--text);
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition: border-color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out);
	}
	.tui-pick-item:hover {
		border-color: var(--accent);
		background: var(--surface2);
	}
	.pane-error {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 10px;
		height: 100%;
		padding: 24px;
		color: var(--dim);
		text-align: center;
	}
	.pane-error code {
		max-width: 560px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		word-break: break-word;
	}
	.pane-error button {
		padding: 6px 14px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--panel);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
</style>
