<script lang="ts">
	import { tick, untrack } from 'svelte';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import ClockCounterClockwiseIcon from 'phosphor-svelte/lib/ClockCounterClockwiseIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import GitForkIcon from 'phosphor-svelte/lib/GitForkIcon';
	import ArchiveIcon from 'phosphor-svelte/lib/ArchiveIcon';
	import BoxArrowUpIcon from 'phosphor-svelte/lib/BoxArrowUpIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import TrayIcon from 'phosphor-svelte/lib/TrayIcon';
	import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import ChatsIcon from 'phosphor-svelte/lib/ChatsIcon';
	import HouseIcon from 'phosphor-svelte/lib/HouseIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import PushPinIcon from 'phosphor-svelte/lib/PushPinIcon';
	import PushPinSlashIcon from 'phosphor-svelte/lib/PushPinSlashIcon';
	import SidebarSimpleIcon from 'phosphor-svelte/lib/SidebarSimpleIcon';
	import EnvelopeSimpleIcon from 'phosphor-svelte/lib/EnvelopeSimpleIcon';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import ArrowsInLineVerticalIcon from 'phosphor-svelte/lib/ArrowsInLineVerticalIcon';
	import ArrowsOutLineVerticalIcon from 'phosphor-svelte/lib/ArrowsOutLineVerticalIcon';
	import { allFolded, foldAll, readSidebarFold, toggleFolder, toggleSection, writeSidebarFold, type SidebarFold } from '$lib/shell/sidebarFold';
	import mark from '$lib/aogiri-mark.svg?raw';
	import { SIDEBAR_RAIL_WIDTH } from '$lib/shell/sidebarState';
	import { T_ENTER, listIn, listOut, motionMs, moveRow, rowIn } from '$lib/ui/motion';
	import { GroupPlaces, changedGroup, heldList, isUnder, orderedList, readListOrder, sameList, writeListOrder, type ListItem, type ListOrder } from '$lib/shell/sidebarGroups';
	import { NO_SUBAGENTS, SUBAGENT_STAY_MS, arrivals, nextFold, subagentsOf, withSubagents, type Subagents } from '$lib/shell/sidebarSubagents';
	import type { AgentRow } from '$lib/agentProgress';
	import StackSimpleIcon from 'phosphor-svelte/lib/StackSimpleIcon';
	import { shimmer } from '$lib/ui/shimmer';
	import Collapse from '$lib/ui/Collapse.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { t } from '$lib/i18n';
	import { shownTitle } from '$lib/chat.svelte';
	import { withShortcut } from '$lib/shortcuts';
	import { BACKEND_LABELS } from '$lib/backends';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import TabGlyph from '$lib/workbench/TabGlyph.svelte';
	import SessionMark from '$lib/SessionMark.svelte';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import { sessionStatus } from '$lib/sessionStatus';
	import { queuedLabel, sessionInbox } from '$lib/sessions/inbox.svelte';
	import { isBlank, listedSessions } from '$lib/session.svelte';
	import { lastActive, type Project, type Session } from '$lib/types';
	import type { AgentView } from '$lib/agents.svelte';
	import RequirementTag from '$lib/requirements/RequirementTag.svelte';
	import SidebarFooter from '$lib/workbench/SidebarFooter.svelte';
	import type { ComponentProps } from 'svelte';
	import { useRequirements } from '$lib/requirements.svelte';

	let {
		projects,
		activeId,
		width,
		collapsed: railed = false,
		onToggleCollapsed = () => {},
		resizing = false,
		onSelect,
		onOpenProject = () => {},
		openProject = null,
		onNewProject,
		onNewSession,
		onNewChat,
		onNewTask,
		onCloseSession,
		onCloseProject,
		onArchiveSession,
		onUnarchiveSession,
		onPinSession,
		onMoveSession,
		onMoveProject,
		onRenameSession,
		onSessionMenu,
		onProjectMenu,
		onHistory,
		agents = [],
		agentsStatus = 'off',
		onOpenAgent = () => {},
		onAgentSession = () => {},
		agentPending = () => 0,
		pendingCount = 0,
		onDesk = () => {},
		onHome = () => {},
		homeOpen = false,
		holdOpen = false,
		onOpenSubagent = () => {},
		subagentStay = SUBAGENT_STAY_MS,
		footer
	}: {
		projects: Project[];
		activeId: string;
		/** The expanded width (the user's, 240–460px). */
		width: number;
		/** The narrow icon rail instead: logo, primary nav as icons, avatar. */
		collapsed?: boolean;
		onToggleCollapsed?: () => void;
		/** True while the user drags the resizer — disables the width transition. */
		resizing?: boolean;
		onSelect: (id: string) => void;
		/** A project row clicked: its page. */
		onOpenProject?: (p: Project) => void;
		/** The project whose page is shown. */
		openProject?: string | null;
		onNewProject: () => void;
		onNewSession: (p: Project) => void;
		onNewChat: () => void;
		onNewTask: (p: Project) => void;
		onCloseSession: (id: string) => void;
		onCloseProject: (p: Project) => void;
		onArchiveSession: (id: string) => void;
		onUnarchiveSession: (id: string) => void;
		onPinSession: (id: string, pinned: boolean) => void;
		/** A dragged row dropped before or after `target` (same project and pinned group). */
		onMoveSession: (id: string, target: string, after: boolean) => void;
		/** A project and its sessions dropped before or after another project. */
		onMoveProject: (id: string, target: string, after: boolean) => void;
		/** Inline rename committed on a session row (dblclick the title). */
		onRenameSession: (id: string, title: string) => void;
		/** Right-click on a session row: the page opens the chrome popover. */
		onSessionMenu: (id: string, ev: MouseEvent) => void;
		/** Right-click on a project folder: the page opens the chrome popover. */
		onProjectMenu: (p: Project, ev: MouseEvent) => void;
		onHistory: (p: Project) => void;
		/** Long-lived agents of the local lynshen daemon. */
		agents?: AgentView[];
		agentsStatus?: 'off' | 'connecting' | 'on' | 'unreachable';
		/** Show the agent on the workbench. */
		onOpenAgent?: (agent: AgentView) => void;
		/** Open the agent's latest session. */
		onAgentSession?: (agent: AgentView) => void;
		/** Questions and pending actions of one agent. */
		agentPending?: (agent: string) => number;
		/** Questions and pending actions waiting for the user. */
		pendingCount?: number;
		onDesk?: () => void;
		/** The home page (Agent / 项目 / 对话 / 最近). */
		onHome?: () => void;
		/** The home page is in front. */
		homeOpen?: boolean;
		/** A popover opened from the sidebar is showing (a row's right-click menu):
		 *  a peeking rail stays open under it. */
		holdOpen?: boolean;
		/** A sub-agent listed under its conversation clicked: its page (a
		 *  Workflow: the conversation's agent trace). */
		onOpenSubagent?: (sessionId: string, agent: AgentRow) => void;
		/** How long a conversation's sub-agents stay once its turn is over, ms
		 *  (the browser fixture shortens it). */
		subagentStay?: number;
		/** The account row at the bottom. */
		footer: Omit<ComponentProps<typeof SidebarFooter>, 'collapsed' | 'onCardOpenChange'>;
	} = $props();
	const reqs = useRequirements();

	// 已归档: the toolbar's archive button shows the archived conversations
	// of every project in place of the list. Bulk restore: selection mode and
	// the picked session ids.
	let archiveOpen = $state(false);
	let selecting = $state(false);
	let picked = $state<string[]>([]);
	function toggleArchive() {
		archiveOpen = !archiveOpen;
		selecting = false;
		picked = [];
	}
	function toggleSelecting() {
		selecting = !selecting;
		picked = [];
	}
	function togglePick(id: string) {
		picked = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
	}
	function restorePicked() {
		for (const id of picked) onUnarchiveSession(id);
		selecting = false;
		picked = [];
	}
	// Folded sections (对话, 项目) and project folders, kept across restarts;
	// folders showing all of their sessions instead of the first SHOW_LIMIT.
	let fold = $state<SidebarFold>(readSidebarFold(localStorage));
	function saveFold(next: SidebarFold) {
		fold = next;
		writeSidebarFold(localStorage, next, projects.map((p) => p.id));
	}
	let showAll = $state<Record<string, boolean>>({});
	const SHOW_LIMIT = 6;
	/** A project's first sessions, and the active one wherever it is. */
	function firstSessions(list: Session[]): Session[] {
		const top = list.slice(0, SHOW_LIMIT);
		const current = list.find((s) => s.id === activeId);
		return current && !top.includes(current) ? [...top, current] : top;
	}
	// Conversations outside any project (`Project.home`, ~/Documents/LynShen)
	// list under 对话 with the latest of every project, newest first; the
	// projects list their own below.
	const home = $derived(projects.find((p) => p.home));
	// Each conversation outside a project has a folder (and group) of its own.
	const homes = $derived(projects.filter((p) => p.home));
	const codeProjects = $derived(projects.filter((p) => !p.chats && !p.home));
	const RECENT_LIMIT = 8;
	const recent = $derived.by(() => {
		const listed = projects
			.filter((p) => !p.chats && !p.stale)
			.flatMap((p) => listedSessions(p).map((s) => ({ s, p })));
		return listed
			.map((x, i) => ({ ...x, i, at: lastActive(x.s) }))
			.sort((a, b) => b.at - a.at || a.i - b.i);
	});
	// The toolbar's 全部折叠 covers the 对话 section (when it lists any) and every project.
	const everyFolded = $derived(allFolded(fold, codeProjects.map((p) => p.id), recent.length > 0));
	let showAllRecent = $state(false);

	// Session filter: case-insensitive substring over session title + project
	// name; empty project groups are hidden while a query is set.
	let searchOpen = $state(false);
	let searchQuery = $state('');
	let searchEl = $state<HTMLInputElement | null>(null);
	const query = $derived(searchQuery.trim().toLowerCase());
	function toggleSearch() {
		searchOpen = !searchOpen;
		if (searchOpen) tick().then(() => searchEl?.focus());
		else searchQuery = '';
	}
	function searchKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			searchQuery = '';
			searchOpen = false;
		}
	}
	const sessionMatches = (p: Project, s: Project['sessions'][number]) =>
		!query || s.chat.title.toLowerCase().includes(query) || p.name.toLowerCase().includes(query);
	const shownRecent = $derived(recent.filter((x) => sessionMatches(x.p, x.s)));

	// 对话 by state (等你处理 / 进行中 / 已完成) or by time (sidebarGroups.ts).
	// A row's look changes at once; its place changes only while the pointer
	// is out of the list and no row menu is open, and then it moves there
	// (animate:moveRow) while the others make room.
	let listOrder = $state<ListOrder>(readListOrder(localStorage));
	function toggleListOrder() {
		listOrder = listOrder === 'state' ? 'time' : 'state';
		writeListOrder(localStorage, listOrder);
	}
	const places = new GroupPlaces();
	type Recent = (typeof recent)[number];
	// Under a conversation whose turn runs sub-agents, its running and just
	// finished ones (sidebarSubagents.ts): items of the same list, so they
	// move with it. Not on the rail. `clock` moves on when the next of them
	// folds.
	let clock = $state(Date.now());
	const subagents = $derived(new Map<string, Subagents>(railed ? [] : shownRecent.map((x) => [x.s.id, subagentsOf(x.s.chat, clock, subagentStay)])));
	$effect(() => {
		const at = nextFold(subagents.values());
		if (!at) return;
		const timer = setTimeout(() => (clock = Date.now()), Math.max(0, at - Date.now()) + 16);
		return () => clearTimeout(timer);
	});
	const nextChats = $derived.by(() => {
		const { items, hidden } = orderedList(
			shownRecent.map((x) => ({ id: x.s.id, status: sessionStatus(x.s.chat), at: x.at, item: x })),
			listOrder,
			places,
			{ limit: showAllRecent || query ? Infinity : RECENT_LIMIT, active: activeId, listed: recent.map((x) => x.s.id) }
		);
		return { items: withSubagents(items, (row) => subagents.get(row.key) ?? NO_SUBAGENTS), hidden };
	});
	/** A sub-agent as it is now (its look), or as it was listed (folding). */
	const agentNow = (it: { parent: string; agent: AgentRow }) => subagents.get(it.parent)?.rows.find((a) => a.id === it.agent.id) ?? it.agent;
	let pointerIn = $state(false);
	const orderHeld = $derived(pointerIn || holdOpen);
	let chatItems = $state<ListItem<Recent, AgentRow>[]>(untrack(() => nextChats.items));
	// When each sub-agent that arrives fades in (arrivals): one after the
	// other under its conversation; at once when the list fills in (more
	// than two rows arrive with them) or the navigator opens from the rail.
	const arriving = new Map<string, number>();
	const fadeStarts = new Map<string, number>();
	let wasRailed = untrack(() => railed);
	// The rows that just changed group, until they land: they pass over the
	// others (moveRow reads it when the list moves; nothing else depends on it).
	const crossing = new Map<string, number>();
	const crosses = (key: string) => (crossing.get(key) ?? 0) > performance.now();
	$effect.pre(() => {
		const next = nextChats.items;
		const hold = orderHeld;
		untrack(() => {
			const reopened = wasRailed !== railed;
			wasRailed = railed;
			const shown = hold && chatItems.length ? heldList(chatItems, next) : next;
			// Nothing to move or show anew (a running conversation's activity, a
			// hold starting): the rows in flight keep going.
			if (sameList(chatItems, shown)) return;
			const until = performance.now() + motionMs(T_ENTER);
			for (const key of changedGroup(chatItems, shown)) crossing.set(key, until);
			for (const [key, t] of crossing) if (t < performance.now()) crossing.delete(key);
			const had = new Set(chatItems.map((it) => it.key));
			const filling = reopened || shown.filter((it) => !isUnder(it) && !had.has(it.key)).length > 2;
			arriving.clear();
			for (const [key, delay] of arrivals(chatItems, shown, performance.now(), fadeStarts)) arriving.set(key, filling ? -1 : delay);
			chatItems = shown;
		});
	});
	// The archived conversations per place (对话 first, then each project) the
	// filter matches, and how many there are in all (blank ones are not
	// conversations yet: see isBlank).
	const archived = (s: Session) => s.archived && !isBlank(s);
	const archivedGroups = $derived.by(() => {
		const groups: { id: string; name: string; sessions: Session[] }[] = [];
		const chats = homes.flatMap((h) => h.sessions.filter((s) => archived(s) && sessionMatches(h, s)));
		if (chats.length) groups.push({ id: 'chats', name: t('shell.chats'), sessions: chats });
		for (const p of codeProjects) {
			const list = p.sessions.filter((s) => archived(s) && sessionMatches(p, s));
			if (list.length) groups.push({ id: p.id, name: p.name, sessions: list });
		}
		return groups;
	});
	const archivedShown = $derived(archivedGroups.flatMap((g) => g.sessions));
	const archivedTotal = $derived(
		[...homes, ...codeProjects].reduce((n, p) => n + p.sessions.filter(archived).length, 0)
	);

	// Inline rename (dblclick a session title).
	let renaming = $state<string | null>(null);
	let renameVal = $state('');
	let renameEl = $state<HTMLInputElement | null>(null);
	function startRename(s: Project['sessions'][number]) {
		renaming = s.id;
		renameVal = s.chat.title;
		tick().then(() => renameEl?.select());
	}
	function commitRename() {
		if (renaming && renameVal.trim()) onRenameSession(renaming, renameVal);
		renaming = null;
	}
	function renameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			commitRename();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			renaming = null;
		}
	}

	// "New chat" is a conversation of its own, in no project (as in Codex or
	// ChatGPT); a project's own + starts one there.
	function newHere() {
		onNewChat();
	}

	// Drag projects, or session rows within their project and pinned group.
	// Pointer events, as the workbench tabs do (HTML drag and drop is not
	// reliable in the macOS webview): a press stays a click until the
	// pointer travels, then a line marks where the row lands.
	let listEl = $state<HTMLElement | null>(null);
	let drag = $state<{ id: string; group: string; live: boolean } | null>(null);
	let drop = $state<{ id: string; after: boolean } | null>(null);
	function rowDown(e: PointerEvent, p: Project, s?: Session) {
		if (e.button !== 0 || (s && renaming === s.id) || !listEl) return;
		const list = listEl;
		const id = s?.id ?? p.id;
		const group = s ? `${p.id}:${s.pinned ? 'pin' : ''}` : 'projects';
		const startX = e.clientX;
		const startY = e.clientY;
		let y = startY;
		let frame = 0;
		drag = { id, group, live: false };
		/** Where the row would land among the rows of its group (null: where it is). */
		const target = () => {
			const rows = [...list.querySelectorAll<HTMLElement>('[data-group]')].filter((el) => el.dataset.group === group);
			let at = rows.findIndex((el) => {
				const r = el.getBoundingClientRect();
				return y < r.top + r.height / 2;
			});
			if (at < 0) at = rows.length;
			const from = rows.findIndex((el) => el.dataset.rowId === id);
			if (at === from || at === from + 1) return null;
			return at < rows.length ? { id: rows[at].dataset.rowId!, after: false } : { id: rows[at - 1].dataset.rowId!, after: true };
		};
		// Held near the top or bottom edge, the list scrolls.
		const scroll = () => {
			const r = list.getBoundingClientRect();
			const step = y < r.top + 32 ? -8 : y > r.bottom - 32 ? 8 : 0;
			if (step) {
				list.scrollTop += step;
				drop = target();
			}
			frame = requestAnimationFrame(scroll);
		};
		const noSelect = (ev: Event) => ev.preventDefault();
		const move = (ev: PointerEvent) => {
			y = ev.clientY;
			if (!drag?.live) {
				if (!drag || Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
				drag.live = true;
				frame = requestAnimationFrame(scroll);
			}
			drop = target();
		};
		const end = (ev: PointerEvent) => {
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', end);
			window.removeEventListener('pointercancel', end);
			window.removeEventListener('selectstart', noSelect);
			cancelAnimationFrame(frame);
			const live = drag?.live;
			const to = drop;
			drag = null;
			drop = null;
			if (!live) return;
			// The release ends the drag; it does not open the row.
			const swallow = (c: Event) => c.stopPropagation();
			window.addEventListener('click', swallow, { capture: true, once: true });
			setTimeout(() => window.removeEventListener('click', swallow, { capture: true }));
			if (ev.type === 'pointerup' && to) (s ? onMoveSession : onMoveProject)(id, to.id, to.after);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', end);
		window.addEventListener('pointercancel', end);
		window.addEventListener('selectstart', noSelect);
	}
	// Collapsed, the rail opens the whole sidebar over the canvas while the
	// pointer rests on it (or focus is in it), so the conversations stay in
	// reach without expanding the layout; it folds back once the pointer
	// leaves or a conversation is picked. A popover opened from it (the
	// account card, a row's right-click menu) lies outside the panel: while
	// one shows, the panel stays open, and it folds once the popover closes
	// with the pointer elsewhere.
	const PEEK_OPEN_MS = 160;
	const PEEK_CLOSE_MS = 280;
	/** Longer than the clip's --t-base close, so the panel keeps its surface
	 *  until it has slid shut even if no transitionend arrives. */
	const FOLD_MS = 420;
	let aside = $state<HTMLElement | null>(null);
	let peek = $state(false);
	let closing = $state(false);
	let cardOpen = $state(false);
	const held = $derived(holdOpen || cardOpen);
	let peekTimer: ReturnType<typeof setTimeout> | undefined;
	let foldTimer: ReturnType<typeof setTimeout> | undefined;
	let pointer: { x: number; y: number } | null = null;
	function setPeek(open: boolean) {
		if (open === peek) return;
		clearTimeout(foldTimer);
		closing = !open;
		if (closing) foldTimer = setTimeout(() => (closing = false), FOLD_MS);
		peek = open;
	}
	function peekLater(open: boolean) {
		clearTimeout(peekTimer);
		if (!railed || resizing || open === peek || (!open && held)) return;
		peekTimer = setTimeout(() => setPeek(open), open ? PEEK_OPEN_MS : PEEK_CLOSE_MS);
	}
	function endPeek() {
		clearTimeout(peekTimer);
		setPeek(false);
	}
	$effect(() => {
		if (!railed) {
			clearTimeout(peekTimer);
			clearTimeout(foldTimer);
			peek = false;
			closing = false;
		}
	});
	// The popover closed: fold unless the pointer is back on the panel.
	let wasHeld = false;
	$effect(() => {
		const now = held;
		if (wasHeld && !now && untrack(() => peek)) {
			const under = pointer && document.elementFromPoint(pointer.x, pointer.y);
			if (!under || !aside?.contains(under)) peekLater(false);
		}
		wasHeld = now;
	});
	/** The labels and lists are hidden: collapsed and not peeking. */
	const folded = $derived(railed && !peek);

	// Folding closes the session filter (the rail has no room for it).
	$effect(() => {
		if (folded && searchOpen) {
			searchQuery = '';
			searchOpen = false;
		}
	});
</script>

<!-- One layout for both states: the content keeps the expanded width and the
     panel clips it, so the icons stay on the rail's centre line while the
     width animates and the labels fade instead of re-wrapping. -->
<aside
	bind:this={aside}
	class="sidebar"
	class:resizing
	class:railed
	class:peek
	class:closing
	class:collapsed={folded}
	style:width="{railed ? SIDEBAR_RAIL_WIDTH : width}px"
	style:--rail-w="{SIDEBAR_RAIL_WIDTH}px"
	onpointerenter={() => peekLater(true)}
	onpointerleave={() => peekLater(false)}
	onfocusin={() => peekLater(true)}
	onfocusout={(e) => {
		if (!e.currentTarget.contains(e.relatedTarget as Node | null)) peekLater(false);
	}}
>
<div
	class="sb-inner"
	style:width="{width}px"
	ontransitionend={(e) => {
		if (e.target === e.currentTarget && e.propertyName === 'clip-path' && !peek) closing = false;
	}}
>
	<!-- Header: the logo and wordmark. Collapsed, the logo expands the sidebar. -->
	<div class="brand" data-tauri-drag-region>
		{#if railed}
			<button
				class="logo expand"
				onclick={onToggleCollapsed}
				aria-label={t('shell.sidebarExpand')}
				data-tip={withShortcut(t('shell.sidebarExpand'), 'sidebar')}
				data-tip-side="right"
			>
				<span class="mark" aria-hidden="true">{@html mark}</span>
				<span class="mark-alt" aria-hidden="true"><SidebarSimpleIcon size={16} /></span>
			</button>
		{:else}
			<span class="logo" aria-hidden="true"><span class="mark">{@html mark}</span></span>
		{/if}
		<div class="brand-rest" inert={folded}>
			<span class="word">Aogiri</span>
		</div>
	</div>

	<nav class="primary">
		<button class="row" onclick={() => (newHere(), endPeek())} aria-label={t('shell.newChat')} data-tip={folded ? t('shell.newChat') : undefined} data-tip-side="right">
			<NotePencilIcon size={16} /><span class="label">{t('shell.newChat')}</span>
		</button>
		<button class="row" class:on={homeOpen} onclick={() => (onHome(), endPeek())} aria-label={t('shell.home.title')} data-tip={folded ? t('shell.home.title') : undefined} data-tip-side="right">
			<HouseIcon size={16} weight={homeOpen ? 'fill' : 'regular'} /><span class="label">{t('shell.home.title')}</span>
		</button>
		{#if agentsStatus !== 'off'}
			<button
				class="row"
				onclick={() => (onDesk(), endPeek())}
				aria-label={pendingCount > 0 ? `${t('shell.desk.title')} · ${pendingCount}` : t('shell.desk.title')}
				data-tip={folded ? (pendingCount > 0 ? `${t('shell.desk.title')} · ${pendingCount}` : t('shell.desk.title')) : undefined}
				data-tip-side="right"
			>
				<TrayIcon size={16} /><span class="label">{t('shell.desk.title')}</span>
				{#if pendingCount > 0}<span class="count">{pendingCount}</span><span class="count-dot" aria-hidden="true"></span>{/if}
			</button>
		{/if}
	</nav>


	<!-- A conversation at work: the light sweeping its title (ui/shimmer.ts).
	     It is the row's only "running" mark, also for screen readers. -->
	{#snippet veil()}<i class="veil" role="img" aria-label={t('shell.status.running')} use:shimmer></i>{/snippet}

	<!-- A sub-agent under its conversation (26px, 14px in, on the tree line):
	     at work, its name reads as --dim and the light sweeps it like a
	     running title; done, it is --text at 500; failed, the --err dot. A
	     click opens its page. -->
	{#snippet subRow(s: Session, a: AgentRow)}
		{@const ended = a.state === 'done' || a.state === 'failed'}
		{@const state = t(`dock.agents.state.${a.state}`)}
		<button
			class="sub"
			class:working={a.state === 'running'}
			class:ended
			class:stopped={a.state === 'stopped'}
			data-agent={a.id}
			onclick={() => (onOpenSubagent(s.id, a), endPeek())}
			aria-label={t('shell.subagents.open', { name: a.label, state, parent: shownTitle(s.chat.title) })}
			title={[a.label, a.activity].filter(Boolean).join('\n')}
		>
			<span class="st">{#if a.state === 'failed'}<SessionMark status={{ kind: 'failed', message: a.error }} />{/if}</span>
			<span class="sess-title sub-title" class:running={a.state === 'running'}>{a.label}{#if a.state === 'running'}{@render veil()}{/if}</span>
		</button>
	{/snippet}

	{#snippet sessRow(s: Session, nested = false, selectable = false, p?: Project, where?: string)}
		{@const status = sessionStatus(s.chat)}
		{@const req = s.chat.sessionId ? reqs.bySession.get(s.chat.sessionId) : undefined}
		{@const waiting = queuedLabel(sessionInbox.queuedFor(s.chat.sessionId))}
		<!-- Listed rows (`p` given) drag within their project and pinned group. -->
		<button
			in:rowIn
			class="sess"
			class:nested
			class:waits={status?.kind === 'input' && !selectable}
			class:on={!selectable && s.id === activeId}
			class:arch={s.archived}
			class:selectable
			class:lifted={drag?.live && drag.group !== 'projects' && drag.id === s.id}
			class:drop-before={drag?.group !== 'projects' && drop?.id === s.id && !drop.after}
			class:drop-after={drag?.group !== 'projects' && drop?.id === s.id && drop.after}
			data-sid={s.id}
			data-row-id={s.id}
			data-group={p ? `${p.id}:${s.pinned ? 'pin' : ''}` : undefined}
			aria-pressed={selectable ? picked.includes(s.id) : undefined}
			onpointerdown={(e) => p && rowDown(e, p, s)}
			onclick={() => (selectable ? togglePick(s.id) : (onSelect(s.id), endPeek()))}
			oncontextmenu={(e) => onSessionMenu(s.id, e)}
		>
			{#if selectable}
				<span class="pick" class:on={picked.includes(s.id)} aria-hidden="true">
					{#if picked.includes(s.id)}<CheckIcon size={12} weight="bold" />{/if}
				</span>
			{:else}
				<!-- The status dot sits before the title; every row keeps its slot,
				     so the titles line up. -->
				<span class="st">{#if status && status.kind !== 'running'}<SessionMark {status} />{/if}</span>
			{/if}
			{#if s.icon}
				<TabGlyph icon={s.icon} color={s.color} size={14} />
			{:else if s.chat.agent}
				{@const owner = agents.find((a) => a.id === s.chat.agent)}
				{#if owner}<AgentAvatar agent={owner} size={14} />{/if}
			{:else if s.color}
				<!-- The tab colour the user picked, without an icon to carry it. -->
				<span class="tag-dot" style:background={s.color}></span>
			{/if}
			{#if renaming === s.id}
				<!-- svelte-ignore a11y_no_static_element_interactions (keep row clicks out of the editor) -->
				<input
					class="sess-edit"
					bind:this={renameEl}
					bind:value={renameVal}
					onblur={commitRename}
					onkeydown={renameKey}
					onclick={(e) => e.stopPropagation()}
					ondblclick={(e) => e.stopPropagation()}
				/>
			{:else}
				<span
					class="sess-title"
					class:running={status?.kind === 'running'}
					class:unread={status?.kind === 'unread'}
					ondblclick={(e) => { e.stopPropagation(); startRename(s); }}
					role="presentation">{shownTitle(s.chat.title)}{#if status?.kind === 'running'}{@render veil()}{/if}</span
				>
			{/if}
			{#if where}<span class="where" title={where}>{where}</span>{/if}
			{#if req}<RequirementTag id={req.id} title={req.title} />{/if}
			<!-- A draft belongs to no backend until its first message. -->
			{#if s.backendId && s.backendId !== 'lynshen' && !s.draft}
				<span class="backend-chip" title={BACKEND_LABELS[s.backendId]}><BackendIcon backend={s.backendId} size={12} /></span>
			{/if}
			{#if s.pinned && !s.archived}<span class="pin-mark" title={t('shell.pin')}><PushPinIcon size={12} weight="fill" /></span>{/if}
			<!-- Another conversation's message waits for this one to be free. -->
			{#if waiting}<span class="queued-mark" title={waiting} aria-label={waiting}><EnvelopeSimpleIcon size={12} /></span>{/if}
			{#if !selectable}
			{#if !s.archived}
				<span
					class="act"
					role="button"
					tabindex="0"
					onclick={(e) => {
						e.stopPropagation();
						onPinSession(s.id, !s.pinned);
					}}
					onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), onPinSession(s.id, !s.pinned))}
					aria-label={s.pinned ? t('shell.unpin') : t('shell.pin')}
					title={s.pinned ? t('shell.unpin') : t('shell.pin')}
				>
					{#if s.pinned}<PushPinSlashIcon size={16} />{:else}<PushPinIcon size={16} />{/if}
				</span>
			{/if}
			<span
				class="act"
				role="button"
				tabindex="0"
				onclick={(e) => {
					e.stopPropagation();
					s.archived ? onUnarchiveSession(s.id) : onArchiveSession(s.id);
				}}
				onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), s.archived ? onUnarchiveSession(s.id) : onArchiveSession(s.id))}
				aria-label={s.archived ? t('shell.unarchive') : t('shell.archive')}
				title={s.archived ? t('shell.unarchive') : t('shell.archive')}
			>
				{#if s.archived}<BoxArrowUpIcon size={16} />{:else}<ArchiveIcon size={16} />{/if}
			</span>
			<span
				class="act"
				role="button"
				tabindex="0"
				onclick={(e) => {
					e.stopPropagation();
					onCloseSession(s.id);
				}}
				onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), onCloseSession(s.id))}
				aria-label={t('shell.removeSessionTitle')}><XIcon size={16} /></span
			>
			{/if}
			<!-- Waiting for the reader: what it waits on, on the line below. -->
			{#if status?.kind === 'input' && !selectable}
				<span class="why">{status.what ? t(status.ask === 'answer' ? 'shell.status.answerWhat' : 'shell.status.approveWhat', { what: status.what }) : t(status.ask === 'answer' ? 'shell.status.answer' : 'shell.status.approve')}</span>
			{/if}
		</button>
	{/snippet}

	<!-- The list's toolbar: fold every project, filter, and the archive. -->
	<div class="tools" role="toolbar" aria-label={t('shell.listTools')} inert={folded}>
		{#if archiveOpen}
			<button class="tool" onclick={toggleArchive} aria-label={t('shell.archiveBack')} title={t('shell.archiveBack')}><ArrowLeftIcon size={16} /></button>
			<span class="tools-title">{t('shell.archived')}<span class="tools-count">{archivedTotal}</span></span>
			{#if archivedShown.length > 1}
				<button class="more-act" aria-pressed={selecting} onclick={toggleSelecting}>{selecting ? t('shell.archiveSelectCancel') : t('shell.archiveSelect')}</button>
			{/if}
		{:else}
			<span class="grow"></span>
			<button
				class="tool"
				class:on={listOrder === 'state'}
				aria-pressed={listOrder === 'state'}
				onclick={toggleListOrder}
				aria-label={t('shell.groupByState')}
				title={t('shell.groupByState')}><StackSimpleIcon size={16} /></button
			>
			<button
				class="tool"
				disabled={!codeProjects.length && !recent.length}
				onclick={() => saveFold(foldAll(fold, codeProjects.map((p) => p.id), !everyFolded))}
				aria-label={everyFolded ? t('shell.unfoldAll') : t('shell.foldAll')}
				title={everyFolded ? t('shell.unfoldAll') : t('shell.foldAll')}
			>
				{#if everyFolded}<ArrowsOutLineVerticalIcon size={16} />{:else}<ArrowsInLineVerticalIcon size={16} />{/if}
			</button>
		{/if}
		<!-- Pressing a toggle keeps the filter's focus (its blur would close it first). -->
		<button class="tool" class:on={searchOpen} aria-pressed={searchOpen} onpointerdown={(e) => searchOpen && e.preventDefault()} onclick={toggleSearch} aria-label={t('shell.searchSessions')} title={t('shell.searchSessions')}><MagnifyingGlassIcon size={16} /></button>
		<button class="tool" class:on={archiveOpen} aria-pressed={archiveOpen} onclick={toggleArchive} aria-label={t('shell.archiveOpen')} title={t('shell.archiveOpen')}><ArchiveIcon size={16} /></button>
	</div>
	{#if searchOpen}
		<div class="search-row" inert={folded}>
			<MagnifyingGlassIcon size={14} />
			<input
				class="filter"
				bind:this={searchEl}
				bind:value={searchQuery}
				placeholder={t('shell.searchSessions')}
				aria-label={t('shell.searchSessions')}
				onkeydown={searchKey}
				onblur={() => !searchQuery && toggleSearch()}
			/>
			<button class="tool" onpointerdown={(e) => e.preventDefault()} onclick={toggleSearch} aria-label={t('shell.closeSearch')} title={t('shell.closeSearch')}><XIcon size={14} /></button>
		</div>
	{/if}

	<!-- svelte-ignore a11y_no_static_element_interactions (the pointer only holds the order) -->
	<div class="list" class:dragging={drag?.live} bind:this={listEl} inert={folded} onpointerenter={() => (pointerIn = true)} onpointerleave={() => (pointerIn = false)}>
		{#if archiveOpen}
			<!-- 已归档: every archived conversation, by place, with bulk restore. -->
			<section class="archive">
				{#each archivedGroups as g (g.id)}
					<div class="group-name" title={g.name}>{g.name}</div>
					{#each g.sessions as s (s.id)}{@render sessRow(s, false, selecting)}{/each}
				{:else}
					<div class="note">{query ? t('shell.archiveNoMatch') : t('shell.archiveEmpty')}</div>
				{/each}
				{#if selecting}
					{@const all = archivedShown.every((s) => picked.includes(s.id))}
					<div class="bulk">
						<button class="more-act" onclick={() => (picked = all ? [] : archivedShown.map((s) => s.id))}>
							{all ? t('shell.archiveSelectNone') : t('shell.archiveSelectAll')}
						</button>
						<span class="grow"></span>
						<Button size="sm" variant="primary" disabled={!picked.length} onclick={restorePicked}>
							{t('shell.archiveRestore', { n: picked.length })}
						</Button>
					</div>
				{/if}
			</section>
		{:else}
		<!-- Agents: long-lived workers of the local daemon. -->
		<!-- Shown only while there are agents: they are no longer created here. -->
		{#if agents.length}
		<section>
			<div class="head">
				<span>{t('shell.agents.title')}</span>
			</div>
			{#if agentsStatus === 'unreachable'}
				<div class="note">{t('shell.agents.unreachable')}</div>
			{/if}
			{#each agents as a (a.id)}
				{@const waiting = agentPending(a.id)}
				<button
					class="sess agent"
					class:off={!a.enabled}
					onclick={() => onOpenAgent(a)}
					title={t('shell.agents.view', { name: a.name })}
				>
					<AgentAvatar agent={a} size={16} />
					<span class="agent-text">
						<span class="sess-title" class:running={a.busy && !waiting}>{a.name}{#if a.busy && !waiting}{@render veil()}{/if}</span>
						{#if a.summary}<span class="agent-summary">{a.summary}</span>{/if}
					</span>
					{#if waiting}<span class="count">{waiting}</span>{/if}
					{#if !a.enabled}<span class="tag">{t('shell.agents.disabled')}</span>
					{:else}
						<span
							class="act"
							role="button"
							tabindex="0"
							onclick={(e) => {
								e.stopPropagation();
								onAgentSession(a);
							}}
							onkeydown={(e) => e.key === 'Enter' && (e.stopPropagation(), onAgentSession(a))}
							aria-label={t('shell.agents.open', { name: a.name })}
							title={t('shell.agents.open', { name: a.name })}><ChatsIcon size={16} /></span
						>
					{/if}
				</button>
			{/each}
		</section>
		{/if}

		<!-- 对话: the latest conversations, in a project or not, newest first. -->
		{#if shownRecent.length || !query}
			{@const chatsOpen = !fold.sections.chats || !!query}
			<section>
				<div class="head">
					<button class="head-toggle" aria-expanded={chatsOpen} onclick={() => saveFold(toggleSection(fold, 'chats'))}>
						<span>{t('shell.chats')}</span>
						<span class="head-caret" class:open={chatsOpen} class:hidden={!!query} aria-hidden="true"><CaretRightIcon size={12} /></span>
					</button>
					{#if home}
						<button class="head-act" onclick={() => onHistory(home)} aria-label={t('shell.history')} title={t('shell.history')}><ClockCounterClockwiseIcon size={16} /></button>
					{/if}
					<button class="head-act" onclick={() => onNewChat()} aria-label={t('shell.newChat')} title={t('shell.newChat')}><PlusIcon size={16} /></button>
				</div>
				<Collapse open={chatsOpen}>
					<!-- One flat keyed list, headings and sub-agents included, so every item can move. -->
					{#each chatItems as it (it.key)}
						<div
							class="item"
							class:under={isUnder(it)}
							animate:moveRow={{ over: crosses(it.key), fill: 'var(--list-fill)' }}
							in:listIn={{ head: it.kind === 'head', child: isUnder(it), delay: arriving.get(it.key) }}
							out:listOut={{ child: isUnder(it) }}
						>
							{#if it.kind === 'head'}
								<div class="ghead">{t(`shell.group.${it.group}`)}<span class="gcount">{it.n}</span></div>
							{:else if it.kind === 'child'}
								{@render subRow(it.item.s, agentNow(it))}
							{:else if it.kind === 'more'}
								<button class="sub more-subs" onclick={() => (onSelect(it.item.s.id), endPeek())} aria-label={t('shell.subagents.moreLabel', { n: it.n, parent: shownTitle(it.item.s.chat.title) })}
									><span class="st"></span><span class="sub-title">{t('shell.subagents.more', { n: it.n })}</span></button
								>
							{:else}
								{@render sessRow(it.item.s, false, false, it.item.p.home ? it.item.p : undefined, it.item.p.home ? undefined : it.item.p.name)}
							{/if}
						</div>
					{:else}
						<div class="note">{t('shell.home.noChats')}</div>
					{/each}
					{#if (nextChats.hidden > 0 || showAllRecent) && !query}
						<button class="more" onclick={() => (showAllRecent = !showAllRecent)}>{showAllRecent ? t('shell.showLess') : t('shell.showMore')}</button>
					{/if}
				</Collapse>
			</section>
		{/if}

		<!-- Projects: folders with their coding sessions nested. -->
		{@const projectsOpen = !fold.sections.projects || !!query}
		<section>
			<div class="head">
				<button class="head-toggle" aria-expanded={projectsOpen} onclick={() => saveFold(toggleSection(fold, 'projects'))}>
					<span>{t('shell.projects')}</span>
					<span class="head-caret" class:open={projectsOpen} class:hidden={!!query} aria-hidden="true"><CaretRightIcon size={12} /></span>
				</button>
				<button class="head-act" onclick={onNewProject} aria-label={t('shell.newProjectTitle')} title={t('shell.newProjectTitle')}><PlusIcon size={16} /></button>
			</div>
			<Collapse open={projectsOpen}>
			{#if !codeProjects.length && !query}
				<button class="sess ghost" onclick={onNewProject}><PlusIcon size={16} /><span class="sess-title">{t('shell.home.addProject')}</span></button>
			{/if}
			{#each codeProjects as p (p.id)}
				{@const active = listedSessions(p).filter((s) => sessionMatches(p, s))}
				{@const open = !fold.folders[p.id] || !!query}
				{@const w = p.sessions.some((s) => s.id === activeId) ? 'fill' : 'regular'}
				{#if !query || active.length}
					<div
						class="project"
						class:lifted={drag?.live && drag.group === 'projects' && drag.id === p.id}
						class:drop-before={drag?.group === 'projects' && drop?.id === p.id && !drop.after}
						class:drop-after={drag?.group === 'projects' && drop?.id === p.id && drop.after}
						data-group="projects"
						data-row-id={p.id}
					>
						<div class="folder" class:stale={p.stale} class:on={openProject === p.id}>
							<button
								class="caret"
								class:open
								aria-expanded={open}
								aria-label={t('shell.projectPage.toggle')}
								title={t('shell.projectPage.toggle')}
								onclick={() => saveFold(toggleFolder(fold, p.id))}><CaretRightIcon size={11} /></button
							>
							<button class="folder-row" onpointerdown={(e) => rowDown(e, p)} onclick={() => onOpenProject(p)} oncontextmenu={(e) => onProjectMenu(p, e)} title={p.worktree ? t('shell.task.worktreeTip', { branch: p.worktree.branch, base: p.worktree.baseBranch || '?' }) : p.path}>
								{#if p.icon}<TabGlyph icon={p.icon} color={p.color ?? 'var(--dim)'} active={w === 'fill'} size={16} />{:else if p.worktree}<GitBranchIcon size={16} weight={w} color={p.color} />{:else if open}<FolderOpenIcon size={16} weight={w} color={p.color} />{:else}<FolderIcon size={16} weight={w} color={p.color} />{/if}
								<span class="folder-name">{p.name}</span>
							</button>
							{#if p.stale}
								<span class="tag" title={p.path}>{t('shell.task.stale')}</span>
							{:else}
								<button class="act" onclick={() => onHistory(p)} aria-label={t('shell.history')} title={withShortcut(t('shell.history'), 'history')}><ClockCounterClockwiseIcon size={16} /></button>
								{#if !p.worktree}
									<button class="act" onclick={() => onNewTask(p)} aria-label={t('shell.newTask')} title={t('shell.newTask')}><GitForkIcon size={16} /></button>
								{/if}
								<button class="act" onclick={() => onNewSession(p)} aria-label={t('shell.newSessionInProject')} title={withShortcut(t('shell.newSessionInProject'), 'newSession')}><PlusIcon size={16} /></button>
							{/if}
							<button class="act" class:always={p.stale} onclick={() => onCloseProject(p)} aria-label={p.stale ? t('shell.task.staleRemove') : t('shell.closeProject')} title={p.stale ? t('shell.task.staleRemove') : t('shell.closeProject')}><XIcon size={16} /></button>
						</div>
						<Collapse {open}>
							{#each showAll[p.id] || query ? active : firstSessions(active) as s (s.id)}{@render sessRow(s, true, false, p)}{/each}
							{#if active.length > SHOW_LIMIT && !query}
								<button class="more nested" onclick={() => (showAll[p.id] = !showAll[p.id])}>{showAll[p.id] ? t('shell.showLess') : t('shell.showMore')}</button>
							{/if}
							{#if active.length === 0 && !p.stale && !query}
								<button class="sess ghost nested" onclick={() => onNewSession(p)}><span class="sess-title">{t('shell.newChat')}</span></button>
							{/if}
						</Collapse>
					</div>
				{/if}
			{/each}
			</Collapse>
		</section>
		<!-- Searching: archived matches are one click away. -->
		{#if query && archivedShown.length}
			<button class="more" onclick={toggleArchive}><ArchiveIcon size={14} />{t('shell.archiveMatches', { n: archivedShown.length })}</button>
		{/if}
		{/if}
	</div>
	<SidebarFooter {...footer} collapsed={folded} onCardOpenChange={(open) => (cardOpen = open)} />

</div>
</aside>


<svelte:window onpointermove={(e) => railed && (pointer = { x: e.clientX, y: e.clientY })} />
<style>
	/* Only the panel's width moves (one property, one container); its content
	   keeps the expanded width, so nothing inside re-lays out while it moves.
	   Containment keeps the content's layout and paint to itself; the account
	   card, which is fixed to the window, is portalled out (SidebarFooter). */
	.sidebar {
		flex-shrink: 0;
		display: flex;
		background: var(--sidebar);
		min-width: 0;
		overflow: hidden;
		contain: layout paint;
		transition: width var(--t-base) var(--ease-base);
	}
	.sb-inner {
		display: flex;
		flex-direction: column;
		flex-shrink: 0;
		min-height: 0;
	}
	/* Collapsed, the panel stays the rail's width and the content clips
	   itself to the rail; peeking opens the clip, so the whole sidebar floats
	   over the canvas (which does not move) and slides open from the rail. */
	.sidebar.railed {
		position: relative;
		z-index: 40;
		overflow: visible;
		contain: none;
	}
	.sidebar.railed .sb-inner {
		clip-path: inset(0 calc(100% - var(--rail-w)) 0 0);
		transition:
			clip-path var(--t-base) var(--ease-out),
			box-shadow var(--t-base) var(--ease-out);
	}
	.sidebar.peek .sb-inner {
		/* Past the right edge, so the shadow shows. */
		clip-path: inset(0 -48px 0 0);
		box-shadow: var(--shadow-pop);
	}
	/* The surface stays while the panel slides shut (closing), so the fading
	   labels never show over a bare canvas. */
	.sidebar.peek .sb-inner,
	.sidebar.closing .sb-inner {
		background: var(--sidebar);
		border-right: 1px solid var(--divider);
	}
	:global(:root[data-glass]) .sidebar.peek .sb-inner,
	:global(:root[data-glass]) .sidebar.closing .sb-inner {
		background: color-mix(in oklab, var(--sidebar) 86%, transparent);
		-webkit-backdrop-filter: var(--glass-filter);
		backdrop-filter: var(--glass-filter);
	}
	.sidebar.resizing {
		transition: none;
	}
	/* What the rail has no room for fades out; it fades back in once the
	   panel is most of the way open. */
	.brand-rest,
	.tools,
	.search-row,
	.list,
	.primary .label,
	.primary .count {
		transition: opacity var(--t-med) var(--ease-base) 40ms;
	}
	.collapsed .brand-rest,
	.collapsed .tools,
	.collapsed .search-row,
	.collapsed .list,
	.collapsed .primary .label,
	.collapsed .primary .count {
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-base);
	}
	.collapsed .tools,
	.collapsed .search-row,
	.collapsed .list {
		pointer-events: none;
	}
	/* With the window frost on (off by default) the sidebar lets a little of
	 * the native layer through (--vibrancy-tint, app.css); otherwise it is
	 * opaque. */
	:global(:root[data-vibrancy='on']) .sidebar {
		background: var(--vibrancy-tint);
	}
	/* Over a custom background the image shows through, at --chrome-tint,
	   blurred when glass is on (app.css, prefs.svelte.ts). */
	:global(:root[data-canvas-bg]) .sidebar {
		background: color-mix(in oklab, var(--sidebar) var(--chrome-tint), transparent);
	}
	:global(:root[data-canvas-bg][data-glass]) .sidebar {
		-webkit-backdrop-filter: var(--glass-filter);
		backdrop-filter: var(--glass-filter);
	}
	/* The logo, the nav icons and the avatar sit on the rail's centre line
	   (--rail-w / 2 = 24px). */
	.brand {
		display: flex;
		align-items: center;
		gap: 10px;
		height: 48px;
		padding: 0 9px;
		flex-shrink: 0;
	}
	.logo {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		flex-shrink: 0;
		padding: 0;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
	}
	.logo.expand:focus-visible {
		outline-offset: 2px;
	}
	.mark,
	.mark-alt {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		border-radius: var(--r-md);
		line-height: 0;
	}
	.mark {
		background: var(--text);
		color: var(--bg);
	}
	.mark :global(svg) {
		width: 100%;
		height: 100%;
	}
	/* Collapsed, the logo is the expand button: the panel icon on hover. */
	.logo.expand {
		cursor: pointer;
	}
	.mark-alt {
		position: absolute;
		inset: 0;
		background: var(--surface2);
		color: var(--text);
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.logo.expand:hover .mark-alt,
	.logo.expand:focus-visible .mark-alt {
		opacity: 1;
	}
	.brand-rest {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 2px;
	}
	/* The list's toolbar, between the primary nav and the list: quiet 28px
	   icon buttons (fold every project, filter, archive) that stay put while
	   the list scrolls. */
	.tools {
		display: flex;
		align-items: center;
		gap: 2px;
		flex-shrink: 0;
		height: 36px;
		margin: 4px 8px 0;
		padding: 0;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex-shrink: 0;
		padding: 0;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.tool:hover:not(:disabled),
	.tool.on {
		background: var(--surface2);
		color: var(--text);
	}
	.tool:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.tools-title {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: baseline;
		gap: 6px;
		padding-left: 4px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 600;
		white-space: nowrap;
	}
	.tools-count {
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}
	.search-row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-shrink: 0;
		height: 28px;
		margin: 0 8px 4px;
		padding: 0 2px 0 8px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--bg);
		color: var(--dim2);
		animation: rise var(--t-fast) var(--ease-out);
	}
	.search-row:focus-within {
		border-color: var(--border-strong);
	}
	.search-row .tool {
		width: 22px;
		height: 22px;
	}
	.filter {
		flex: 1;
		min-width: 0;
		height: 24px;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		outline: none;
	}
	.word {
		flex: 1;
		min-width: 0;
		font-family: var(--font-sans);
		font-size: var(--fs-lg);
		font-weight: 700;
		line-height: 24px;
		color: var(--text);
		white-space: nowrap;
	}
	.primary {
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 0 8px;
	}
	/* Primary rows paint their fill from a layer that shrinks to the icon
	   when the panel collapses, so the row itself never changes size. */
	.primary .row {
		position: relative;
		isolation: isolate;
		white-space: nowrap;
	}
	.primary .row::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: var(--r-sm);
		transition: background var(--t-fast) var(--ease-base);
	}
	.primary .row:hover,
	.primary .row.on {
		background: none;
		color: var(--text);
	}
	.primary .row:hover::before,
	.primary .row.on::before {
		background: var(--surface2);
	}
	.primary .row :global(svg) {
		width: 16px;
		height: 16px;
		transition:
			width var(--t-base) var(--ease-base),
			height var(--t-base) var(--ease-base),
			color var(--t-fast) var(--ease-base);
	}
	.primary .row:hover :global(svg),
	.primary .row.on :global(svg) {
		color: var(--text);
	}
	/* The rail (design.md, "Navigator"): 44px items with 20px icons on the
	   rail's centre line; the current item has a 2px bar on the rail's left
	   edge and a --text icon, the others are --dim. */
	.primary .row {
		transition:
			min-height var(--t-base) var(--ease-base),
			padding var(--t-base) var(--ease-base),
			color var(--t-fast) var(--ease-base);
	}
	.collapsed .primary .row {
		min-height: 44px;
		padding: 0 6px;
	}
	.collapsed .primary .row :global(svg) {
		width: 20px;
		height: 20px;
	}
	.collapsed .primary .row:hover::before,
	.collapsed .primary .row.on::before {
		background: none;
	}
	.primary .row::after {
		content: '';
		position: absolute;
		top: 10px;
		bottom: 10px;
		left: -8px;
		width: 2px;
		background: var(--text);
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-base);
	}
	.collapsed .primary .row.on::after {
		opacity: 1;
	}
	.primary .row:focus-visible {
		outline: none;
	}
	.primary .row:focus-visible::before {
		outline: 2px solid var(--brand-bright);
		outline-offset: -2px;
	}
	/* Collapsed, the pending count becomes a 6px --warn dot on the icon:
	   something waits for the reader. */
	.count-dot {
		position: absolute;
		top: 10px;
		left: 25px;
		width: 6px;
		height: 6px;
		border-radius: var(--r-full);
		background: var(--warn);
		box-shadow: 0 0 0 2px var(--sidebar);
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.collapsed .count-dot {
		opacity: 1;
	}
	/* Rows (design.md, "Navigator"): 28px, 8px side padding, a 16px icon,
	   --r-sm; the selected row has a --surface2 fill and --text. */
	.row,
	.sess,
	.sub,
	.more,
	.folder-row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 28px;
		padding: 0 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		line-height: 18px;
		text-align: left;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-base),
			color var(--t-fast) var(--ease-base);
	}
	/* Unselected nav items are --dim until hover. */
	.row {
		color: var(--dim);
	}
	/* Keyboard focus is drawn inside the row, not over its neighbours. */
	.row:focus-visible,
	.sess:focus-visible,
	.sub:focus-visible,
	.more:focus-visible,
	.folder-row:focus-visible {
		outline-offset: -2px;
	}
	.row :global(svg),
	.sess > :global(svg),
	.folder-row > :global(svg) {
		color: var(--dim);
		flex-shrink: 0;
	}
	.row:hover,
	.sess:hover,
	.sub:hover,
	.more:hover,
	.folder-row:hover {
		background: var(--surface2);
	}
	.row.on {
		background: var(--surface2);
	}
	.row span:first-of-type {
		flex: 1;
	}
	.tag-dot {
		flex: none;
		width: 7px;
		height: 7px;
		border-radius: var(--r-full);
	}
	.count {
		flex: none !important;
		min-width: 18px;
		padding: 0 6px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
		line-height: 16px;
		text-align: center;
	}

	.list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 0 8px 8px;
	}
	section + section {
		margin-top: 12px;
	}
	/* Group heads: plain --fs-xs 600 --dim2, no fill, border or colour. */
	.head {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 28px;
		padding: 0 2px 0 8px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 600;
		line-height: 16px;
	}
	.head > span {
		flex: 1;
	}
	/* A section head folds its section: the label, then a caret that shows
	   when folded (and on hover or focus when open). */
	.head-toggle {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		height: 24px;
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.head-toggle:hover {
		color: var(--dim);
	}
	.head-caret {
		display: inline-flex;
		transition:
			transform var(--t-fast) var(--ease-out),
			opacity var(--t-fast) var(--ease-out);
	}
	.head-caret.open {
		transform: rotate(90deg);
		opacity: 0;
	}
	.head-toggle:hover .head-caret.open,
	.head-toggle:focus-visible .head-caret.open {
		opacity: 1;
	}
	.head-caret.hidden {
		visibility: hidden;
	}
	/* 已归档: the place each archived conversation is from. */
	.group-name {
		padding: 12px 8px 4px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 600;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.archive .group-name:first-child {
		padding-top: 4px;
	}
	.head-act,
	.act {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		padding: 0;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.head-act:hover,
	.act:hover {
		background: var(--surface2);
		color: var(--text);
	}
	/* Row actions appear on hover / keyboard focus only. */
	.sess .act,
	.folder .act {
		display: none;
	}
	.sess:hover .act,
	.sess:focus-within .act,
	.folder:hover .act,
	.folder .act.always {
		display: inline-flex;
	}

	.sess.on {
		background: var(--surface2);
	}
	.sess,
	.project {
		position: relative;
	}
	/* Dragging a row: it fades where it was and a line marks where it lands. */
	.list.dragging {
		cursor: grabbing;
		user-select: none;
	}
	.list.dragging .sess,
	.list.dragging .project {
		pointer-events: none;
	}
	.sess.lifted,
	.project.lifted {
		opacity: 0.45;
	}
	.sess.drop-before::before,
	.sess.drop-after::after,
	.project.drop-before::before,
	.project.drop-after::after {
		content: '';
		position: absolute;
		left: 8px;
		right: 8px;
		height: 2px;
		border-radius: var(--r-full);
		background: var(--accent);
		pointer-events: none;
	}
	.sess.nested.drop-before::before,
	.sess.nested.drop-after::after {
		left: 34px;
	}
	.sess.drop-before::before,
	.project.drop-before::before {
		top: -1px;
	}
	.sess.drop-after::after,
	.project.drop-after::after {
		bottom: -1px;
	}
	.pin-mark {
		display: inline-flex;
		color: var(--dim2);
		flex-shrink: 0;
	}
	.queued-mark {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}
	/* Under a project: the title lines up with the project's name. */
	.sess.nested {
		padding-left: 34px;
	}
	/* The status slot: a 6px dot (SessionMark) or nothing. */
	.st {
		display: inline-flex;
		align-items: center;
		width: 6px;
		flex-shrink: 0;
	}
	/* Waiting for the reader: the reason on a second line, under the title. */
	.sess.waits {
		flex-wrap: wrap;
		row-gap: 0;
		padding-block: 5px;
	}
	.why {
		flex-basis: 100%;
		min-width: 0;
		order: 99;
		padding-left: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 16px;
	}
	.more-act {
		flex-shrink: 0;
		padding: 4px 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.more-act:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.bulk {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 4px 8px 12px;
		animation: rise var(--t-fast) var(--ease-out);
	}
	.grow {
		flex: 1;
	}
	.pick {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 16px;
		flex-shrink: 0;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-xs);
		background: var(--surface);
		color: var(--on-accent);
		transition:
			background var(--t-fast) var(--ease-out),
			border-color var(--t-fast) var(--ease-out);
	}
	.pick.on {
		border-color: var(--accent);
		background: var(--accent);
	}
	.sess.arch .sess-title {
		color: var(--dim2);
	}
	.sess.ghost {
		color: var(--dim2);
	}
	.sess-title {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sess-edit {
		flex: 1;
		min-width: 0;
		height: 22px;
		padding: 0 6px;
		border: 1px solid var(--border-strong);
		border-radius: var(--r-xs);
		background: var(--bg);
		color: var(--text);
		font: inherit;
	}
	.tag {
		flex-shrink: 0;
		padding: 1px 7px;
		border: 1px solid var(--border);
		border-radius: var(--r-full);
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
	/* A reply not seen yet: the title stands out with the dot. */
	.sess-title.unread {
		color: var(--text);
		font-weight: 600;
	}
	/* A conversation at work: a light sweeps across its title, every running
	   title on one clock (ui/shimmer.ts). The title hugs its text, so the
	   light crosses the words, not the empty row. */
	.sess-title.running {
		position: relative;
		flex: 0 1 auto;
		max-width: 100%;
		margin-right: auto;
	}
	/* The veil: the row's own colour over the title (30% dark, 22% light: the
	   title reads as --dim), with a clear window that the sweep moves across.
	   It must match the row's fill exactly, so it follows hover and
	   selection with an opaque copy of --surface2 over --sidebar. */
	.sess,
	.sub {
		--row-bg: var(--sidebar);
		--veil: 30%;
	}
	:global([data-theme='light']) .sess,
	:global([data-theme='light']) .sub {
		--veil: 22%;
	}
	.sess:hover,
	.sub:hover,
	.sess.on {
		--row-bg: color-mix(in srgb, var(--text) 6%, var(--sidebar));
	}
	.veil {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 300%;
		pointer-events: none;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--row-bg) var(--veil), transparent) 0%,
			color-mix(in srgb, var(--row-bg) var(--veil), transparent) 42%,
			transparent 50%,
			color-mix(in srgb, var(--row-bg) var(--veil), transparent) 58%,
			color-mix(in srgb, var(--row-bg) var(--veil), transparent) 100%
		);
		/* At rest (reduced motion): the whole title under the veil. */
		transform: translateX(-60%);
	}
	/* With the window frost or a background image behind the navigator the
	   row has no one colour to match, so the title breathes instead.
	   Opacity only: the compositor runs it too. */
	:global(:root[data-vibrancy]) .veil,
	:global(:root[data-canvas-bg]) .veil {
		display: none;
	}
	:global(:root[data-vibrancy]) .sess-title.running,
	:global(:root[data-canvas-bg]) .sess-title.running {
		animation: title-breathe 1.8s var(--ease-in-out) infinite;
	}
	@keyframes title-breathe {
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		:global(:root[data-vibrancy]) .sess-title.running,
		:global(:root[data-canvas-bg]) .sess-title.running {
			animation: none;
			color: var(--dim);
		}
	}
	/* Under 对话: the project a conversation belongs to. */
	.where {
		flex-shrink: 0;
		max-width: 40%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	/* Hovered or focused, the row's actions take the project label's place. */
	.sess:hover .where,
	.sess:focus-within .where {
		display: none;
	}
	.backend-chip {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
	}

	.agent-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.agent-summary {
		color: var(--dim2);
		font-size: var(--fs-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sess.agent.off .sess-title,
	.sess.agent.off > :global(svg) {
		color: var(--dim2);
	}
	.sess.agent.off > :global(.avatar) {
		opacity: 0.5;
	}
	.note {
		padding: 6px 10px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	/* An item of the 对话 list: positioned, so a row that passes over others
	   while it moves (moveRow) stays above them, on the list's own fill
	   (--list-fill, as the panel paints it). */
	.item {
		position: relative;
		border-radius: var(--r-sm);
	}
	.list {
		--list-fill: var(--sidebar);
	}
	:global(:root[data-vibrancy='on']) .list {
		--list-fill: var(--vibrancy-tint);
	}
	:global(:root[data-canvas-bg]) .list {
		--list-fill: color-mix(in oklab, var(--sidebar) var(--chrome-tint), transparent);
	}
	/* A sub-agent under its conversation (sidebarSubagents.ts): 26px, 14px
	   in, on a 1px --border-strong tree line that hangs from the
	   conversation's status slot. At work its name sweeps like a running
	   title (--text under the veil); queued, --dim; done or failed, --text
	   at 500; stopped, --dim2. The look changes at once: no colour
	   transition. */
	.sub {
		min-height: 26px;
		margin-left: 14px;
		width: calc(100% - 14px);
		color: var(--dim);
		transition: background var(--t-fast) var(--ease-base);
	}
	.sub.working,
	.sub.ended {
		color: var(--text);
	}
	.sub.ended .sub-title {
		font-weight: 500;
	}
	.sub.stopped {
		color: var(--dim2);
	}
	.more-subs {
		font-size: var(--fs-xs);
	}
	/* (1px up: over the edge of the item above, when they move together.) */
	.item.under::before {
		content: '';
		position: absolute;
		top: -1px;
		bottom: 0;
		left: 11px;
		width: 1px;
		background: var(--border-strong);
		pointer-events: none;
	}
	/* A group of 对话 (by state): a plain heading with its count. */
	.ghead {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 28px;
		padding: 6px 8px 0;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 600;
		line-height: 16px;
	}
	.gcount {
		font-family: var(--font-mono);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}

	.folder {
		display: flex;
		align-items: center;
		gap: 2px;
		padding-right: 4px;
		border-radius: var(--r-sm);
	}
	.folder:hover {
		background: var(--surface2);
	}
	.folder-row {
		flex: 1;
		min-width: 0;
		padding-left: 2px;
	}
	.folder.on {
		background: var(--surface2);
	}
	.caret {
		flex: none;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 16px;
		height: 20px;
		margin-left: 4px;
		padding: 0;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.caret:hover {
		color: var(--text);
	}
	.caret :global(svg) {
		transition: transform var(--t-base) var(--ease-base);
	}
	.caret.open :global(svg) {
		transform: rotate(90deg);
	}
	.folder-row:hover {
		background: none;
	}
	.folder.stale .folder-name {
		color: var(--dim2);
	}
	.folder-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.more {
		color: var(--dim);
		font-size: var(--fs-xs);
	}

</style>
