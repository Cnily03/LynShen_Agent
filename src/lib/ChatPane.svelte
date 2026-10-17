<script lang="ts" module>
	import type { WebRef } from '$lib/browser.svelte';
	import type { ProviderModel } from '$lib/settings/providerFields';
	import type { PlanAction as PaneAction } from '$lib/PlanCard.svelte';

	/** Configured provider (builtin or custom) with its model list — the page
	 *  loads these once and every pane shares them for the model picker. */
	export interface ProviderOption {
		id: string;
		/** Shown as the provider's heading in the model menu. */
		name?: string;
		base_url: string;
		format: string;
		models: ProviderModel[];
	}

	/** Imperative surface the page reaches through its pane registry: global
	 *  flows (palette commands, file drops, browser element picks, ⌘F) always
	 *  target the workbench-active session's pane. */
	export interface ChatPaneApi {
		runCommand: (cmd: string) => void;
		addAttachment: (path: string) => void;
		insertWebRef: (ref: WebRef) => void;
		toggleFind: () => void;
		scrollToEnd: () => void;
		focusComposer: () => void;
		stop: () => void;
		openModelMenu: () => void;
		/** Approve or revise a plan of this session (from its page). */
		planAction: (id: string, action: PaneAction) => void;
	}
</script>

<script lang="ts">
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import { agentDirectory } from '$lib/agents.svelte';
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { open } from '@tauri-apps/plugin-dialog';
	import { treeRows } from '$lib/tree';
	import { buildSetApprovalModeOp, needsClaudeYoloRespawn, toEngineMode, type ApprovalMode, type ApproveOp } from '$lib/approval';
	import type { PlanAction } from '$lib/PlanCard.svelte';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import ClipboardTextIcon from 'phosphor-svelte/lib/ClipboardTextIcon';
	import {
		processVideo,
		sessionHistory,
		nativeSessions,
		importNativeSession,
		git,
		gitCheckpointCapture,
		gitCheckpointRestore,
		resolveFileRef,
		readConfig,
		writeConfig,
		type ImportSkipKind,
		type Op
	} from '$lib/protocol';
	import { buildModelRows, splitRoute, stripGroupSuffix, toolModels, type ToolModel } from '$lib/composer/modelRows';
	import { displayNameOf } from '$lib/models/items';
	import { gatewayCatalog } from '$lib/models/catalogStore.svelte';
	import { configModelList } from '$lib/configModels';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { BACKEND_LABELS, caps } from '$lib/backends';
	import { defaultEffort } from '$lib/composer/effort';
	import { dispatch } from '$lib/backends/router';
	import { browser } from '$lib/browser.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { CHAT_PAD, CHAT_PAD_RAIL, CHAT_W_STANDARD, chatColumnPad, chatColumnWidth } from '$lib/chatWidth';
	import { followTop, shortOfEnd } from '$lib/chatFollow';
	import { t } from '$lib/i18n';
	import type { SessionStore } from '$lib/session.svelte';
	import type { Session } from '$lib/types';
	import { editorStore } from '$lib/editor/editorStore.svelte';
	import Composer, { type StyleMenu } from '$lib/Composer.svelte';
	import { replyStyles } from '$lib/styles.svelte';
	import { currentStyle } from '$lib/styles';
	import MessageList from '$lib/MessageList.svelte';
	import TurnRail from '$lib/TurnRail.svelte';
	import StatusStrip from '$lib/composer/StatusStrip.svelte';
	import ApprovalCard from '$lib/ApprovalCard.svelte';
	import RecapCard from '$lib/RecapCard.svelte';
	import { markStopped, recapOf, type Recap } from '$lib/recap';
	import { collapse } from '$lib/ui/motion';
	import RateLimitBanner from '$lib/RateLimitBanner.svelte';
	import Button from '$lib/ui/Button.svelte';
	import TaskStrip from '$lib/TaskStrip.svelte';
	import ProgressCards from '$lib/agents/ProgressCards.svelte';
	import { anyCard, cardsLayout, cardsShown } from '$lib/agents/progressCards';
	import NewSessionPicker from '$lib/NewSessionPicker.svelte';
	import { placeFor, subagentPages, type OpenHow } from '$lib/agents/subagentPages.svelte';
	import { agentRows, isLive, numstatTotals, planSummary, porcelainFiles, type AgentRow } from '$lib/agentProgress';
	import { agentChanges } from '$lib/agents/agentChanges.svelte';
	import { confirmStop } from '$lib/agents/confirmStop';
	import { parseToolOutput, toolTarget, toolVerb } from '$lib/toolSummary';
	import { dirHints, joinPath, parseFileHref, pathExt } from '$lib/fileRefs';
	import type { Msg, ModelOption } from '$lib/chat.svelte';
	import type { SessionSwitch } from '$lib/composer/SessionSwitches.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { isImageModel } from '$lib/providers/monoize';
	import { acceptsImages } from '$lib/settings/providerFields';
	import { planPages } from '$lib/planPages.svelte';
	import { terminalRequests } from '$lib/sandbox/terminal.svelte';
	import Picker from '$lib/shell/Picker.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import type { SectionKey } from '$lib/settings/nav';
	import type { ErrorAction } from '$lib/errorInfo';
	import FindBar from '$lib/shell/FindBar.svelte';
	import { autoRetry } from '$lib/autoRetry.svelte';
	import { parseDelivery } from '$lib/delivery';
	import { sentLabel, splitAttachments, withFiles, withVideo } from '$lib/attachments';
	import { filePreviews } from '$lib/preview/store.svelte';
	import { loadComposerText, saveComposerText } from '$lib/composerText';
	import RequirementTag from '$lib/requirements/RequirementTag.svelte';
	import { statusLabel } from '$lib/requirements/labels';
	import { gateNext, gateOf, useRequirements } from '$lib/requirements.svelte';
	import RequirementStart, { beginRequirement } from '$lib/requirements/RequirementStart.svelte';
	import { telemetry } from '$lib/telemetry.svelte';
	import { teamSwitch } from '$lib/agents/teamSwitch.svelte';

	// One full conversation (transcript + composer + approvals + pickers) for a
	// single session, extracted from the page so several chats can tile side by
	// side on the canvas. Everything session-scoped lives here; the page keeps
	// only cross-pane glue (event routing, notifications, global modals).
	let {
		session,
		store,
		providers = [],
		providersList = [],
		isActive = false,
		onRegister,
		onUnregister,
		onOpenSettings,
		onOpenAgent,
		onOpenRequirement,
		onOpenTrace,
		onOpenTeam,
		onOpenChanges,
		onOpenSession
	}: {
		session: Session;
		store: SessionStore;
		/** Providers with configured auth (for "not configured" hints). */
		providers?: string[];
		providersList?: ProviderOption[];
		/** This pane's session is `store.activeId` — overlays and window keys
		 *  only run on the active pane, so two panes never fight over them. */
		isActive?: boolean;
		onRegister?: (id: string, api: ChatPaneApi) => void;
		/** Passes the api back so a remount (tile drag) can't drop the fresh one. */
		onUnregister?: (id: string, api: ChatPaneApi) => void;
		onOpenSettings?: (section: SectionKey) => void;
		/** Show an agent on the workbench. */
		onOpenAgent?: (agent: string) => void;
		/** Show a requirement on the workbench. */
		onOpenRequirement?: (id: string) => void;
		/** Opens the agent trace panel (it shows `chat.agentFocus`). */
		onOpenTrace?: () => void;
		/** Opens the agent team's panel (task board, messages). */
		onOpenTeam?: () => void;
		/** Opens the Changes panel (a turn's change pill). */
		onOpenChanges?: () => void;
		/** Opens a conversation by its session id (where another
		 *  conversation's message came from). */
		onOpenSession?: (session: string) => void;
	} = $props();

	const chat = $derived(session.chat);
	/** The long-lived agent this session belongs to. */
	const owner = $derived(chat.agent ? agentDirectory.agents.find((a) => a.id === chat.agent) : undefined);
	const project = $derived(store.projects.find((p) => p.sessions.some((s) => s.id === session.id)));

	// Reply styles (LynShen): the "+" menu lists them once the engine has
	// said which one this conversation uses (an older engine never does); a
	// draft has no engine yet and shows the default, or its own pick. A chat
	// has no project styles.
	const styleCwd = $derived(chat.isChatMode ? '' : project?.path || chat.cwd || '');
	const stylesOn = $derived(caps(chat).replyStyles && (!!session.draft || chat.replyStyle !== null));
	$effect(() => {
		const cwd = styleCwd;
		if (stylesOn) untrack(() => replyStyles.ensure(cwd));
	});
	const styleMenu = $derived.by((): StyleMenu | undefined => {
		const list = stylesOn ? replyStyles.list(styleCwd) : null;
		const current = list && currentStyle(!!session.draft, session.draftStyle, chat.replyStyle, list);
		return list && current ? { styles: list.styles, current, onSelect: setStyle } : undefined;
	});
	// A draft only records the pick: it goes to the engine before the first
	// message (SessionStore #startDraft).
	function setStyle(id: string) {
		if (session.draft) session.draftStyle = id;
		else send({ op: 'set_style', style: id });
	}
	// The requirement this session works on (or, a draft, will once it starts).
	const reqs = useRequirements();
	const linked = $derived(chat.sessionId ? reqs.bySession.get(chat.sessionId) : undefined);
	const willLink = $derived(!linked && session.requirement ? reqs.get(session.requirement) : undefined);
	/** A draft made for a requirement shows its start card until started. */
	const starting = $derived(session.draft && session.requirementStart ? willLink : undefined);
	/** No message yet, nothing starting: the greeting over a centred composer. */
	const fresh = $derived(chat.messages.length === 0 && !chat.busy && !(chat.booting && chat.engineState !== 'exited') && !starting);
	/** The start's confirmation, once this session's turn has ended. */
	const gate = $derived(linked?.status === 'confirm' && !chat.busy ? gateOf(linked, chat.sessionId) : undefined);
	let confirming = $state(false);
	/** Confirms the gate's stage, with the composer's words. */
	async function confirmGate() {
		if (!linked || confirming) return;
		confirming = true;
		try {
			await reqs.confirm(linked.id, input.trim());
			input = '';
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			confirming = false;
		}
	}
	/** A passage of a reply, noted as a requirement about this session's project. */
	async function noteRequirement(text: string) {
		try {
			const r = await reqs.create({
				text,
				...(chat.sessionId ? { session: chat.sessionId } : project ? { project: project.id } : {})
			});
			telemetry.track('requirement_create');
			toast.success(t('shell.requirement.noted', { id: r.id }), {
				action: { label: t('shell.requirement.undo'), run: () => void reqs.remove(r.id).catch(() => {}) }
			});
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}

	// Unsent text is kept per session: it survives switching away and restarts.
	// svelte-ignore state_referenced_locally
	let input = $state(loadComposerText(session.id));
	$effect(() => saveComposerText(session.id, input));
	let attachments = $state<{ path: string; image: boolean }[]>([]);
	// Videos attach as extracted keyframes (images) + a text description — the
	// engine protocol only understands image paths.
	let videos = $state<{ path: string; frames: string[]; duration: number }[]>([]);
	// Page elements picked in the embedded browser. Each pick inserts an inline
	// token ([网页元素#N:…]) into the composer text at the cursor, so the user can
	// position/reorder/delete it inline; on submit the token expands in place into
	// the full reference. Refs whose token was deleted are dropped.
	type PickedRef = WebRef & { id: number };
	let webRefs = $state<PickedRef[]>([]);
	let refSeq = 0;
	// Passages quoted from replies: a chip in the composer, the quote on send.
	let quotes: { id: number; text: string }[] = [];
	let quoteSeq = 0;
	// Images sit in the text as [图片 #N] tokens where they were added; on submit
	// the images whose token is still there are sent, in token order.
	let images = $state<{ n: number; path: string }[]>([]);
	let imageSeq = 0;
	let scroller = $state<HTMLElement | null>(null);
	let composerEl = $state<HTMLElement | null>(null);
	let composerRef = $state<{ insertToken: (t: string) => void; openModelMenu: () => void } | undefined>();
	let bottomH = $state(120);
	let atBottom = $state(true);
	let messageList = $state<MessageList | null>(null);
	let mark = $state(-1);
	const marks = $derived(chat.messages.flatMap((m) => (m.kind === 'user' && !parseDelivery(m.text) ? [m.text] : [])));

	// The conversation column follows the pane and the 对话宽度 setting
	// (chatWidth.ts): the messages, the composer and the trays share it.
	// `wrapW` is the pane's width; until it is measured the column is the
	// standard one, which the styles shrink to a narrow pane.
	let wrapW = $state(0);
	// The room the pane wants beside the column (more with the rail at the
	// left edge), and what the column leaves of it.
	const sidePad = $derived(marks.length > 1 ? CHAT_PAD_RAIL : CHAT_PAD);
	const columnW = $derived(wrapW > 0 ? chatColumnWidth(wrapW, prefs.chatWidth, sidePad) : CHAT_W_STANDARD);
	const chatPad = $derived(wrapW > 0 ? chatColumnPad(wrapW, columnW, sidePad) : sidePad);

	// In-conversation find (⌘F). The raw input updates per keystroke; the actual
	// scan (findHits) keys off the debounced `findQuery` so the O(n) message scan
	// doesn't run on every keystroke (or every stream chunk while typing).
	let showFind = $state(false);
	let findInput = $state('');
	let findQuery = $state('');
	let findDebounce: ReturnType<typeof setTimeout> | null = null;
	function onFindInput() {
		if (findDebounce != null) clearTimeout(findDebounce);
		findDebounce = setTimeout(() => {
			findQuery = findInput;
			findDebounce = null;
		}, 220);
	}
	let findIdx = $state(0);
	let findInputEl = $state<HTMLInputElement | null>(null);
	// Picker filter (history / long lists)
	let pickerQuery = $state('');
	let selIdx = $state(0);
	let pendingModel = $state('');
	// Whether this Claude Code / Codex session runs through the LynShen gateway.
	const toolMode = $derived<'system' | 'lynshen'>(session.gateway ? 'lynshen' : 'system');

	// Ops flow through this session's backend adapter; an unsupported op
	// (non-lynshen stub backends) surfaces as an inline system notice.
	function send(op: Op) {
		// A typed /model on a draft is a pick like the menu's, not a reason to
		// start the engine.
		if (session.draft && op.op === 'command' && /^\/model(\s|$)/.test(op.input.trim())) {
			const line = op.input.trim();
			if (line === '/model') openModelPicker();
			else selectRow(line);
			return;
		}
		// claude's /resume can't go over the wire: stream-json mode has no session
		// listing protocol, the history lives in files under ~/.claude/projects.
		// Bare /resume builds the picker from the daemon's history of the
		// directory; a typed `/resume <id>` opens that session in a fresh tab
		// (same flow as a picker pick — the current chat is never replaced).
		if (op.op === 'command' && chat.backendId === 'claude') {
			const line = op.input.trim();
			if (line === '/resume') {
				openClaudeHistory();
				return;
			}
			if (line.startsWith('/resume ') && project) {
				const sid = line.slice('/resume '.length).trim();
				chat.closePicker();
				store.activeId = store.restoreSession(project, sid, '', 'claude');
				return;
			}
		}
		// Writing in an archived thread brings it back to the list.
		if (op.op === 'user_message' && session.archived) store.unarchiveSession(session.id);
		if (!dispatch(session.id, op)) {
			chat.messages.push({ kind: 'system', text: t('shell.backend.opUnsupported', { op: op.op }) });
		}
	}

	// An error notice's fix button.
	function fixError(action: ErrorAction) {
		if (action === 'restart') store.restartSession(session.id, true);
		else if (action === 'login' || action === 'account') onOpenSettings?.('account');
		else if (action === 'providers') onOpenSettings?.('providers');
		else if (action === 'compact') send({ op: 'command', input: '/compact' });
		else if (action === 'model') openModelPicker();
	}

	// The project history picker's sources: LynShen's own conversations, or the
	// ones Claude Code / Codex saved in their own apps (picking one imports it).
	// OpenCode's, once an OpenCode agent is registered: picking one continues
	// it in OpenCode, on a copy. DSH's (DeepSeek Harness), when it has some for
	// this project: picking one converts it into a LynShen conversation once.
	let opencodeListed = $state(false);
	let dshListed = $state(false);
	const historySources = $derived([
		{ value: 'lynshen', label: 'LynShen' },
		{ value: 'claude', label: 'Claude Code' },
		{ value: 'codex', label: 'Codex' },
		...(opencodeListed ? [{ value: 'opencode', label: 'OpenCode' }] : []),
		...(dshListed ? [{ value: 'dsh', label: 'DSH' }] : [])
	]);
	/** OpenCode conversation → the daemon session its copy continues in. */
	const opencodeCopies = new Map<string, string>();
	/** DSH conversation → why it cannot be imported. */
	const dshUnreadable = new Map<string, ImportSkipKind>();
	$effect(() => {
		if (chat.picker?.kind !== 'resume' || !chat.picker.history) return;
		untrack(() => {
			store.opencodeAgent().then((agent) => (opencodeListed = !!agent));
			const path = project?.path;
			if (path)
				nativeSessions('dsh', path)
					.then((list) => (dshListed = list.length > 0))
					.catch(() => (dshListed = false));
		});
	});
	// The selected tab follows the list shown (each opening starts on LynShen);
	// a switch applies only if it is still the latest and the picker is open.
	let historyTab = $state('lynshen');
	let historyReq = 0;
	$effect(() => {
		if (chat.picker?.kind === 'resume' && chat.picker.history) historyTab = chat.picker.source ?? 'lynshen';
	});
	async function showHistorySource(source: string) {
		const proj = project;
		if (!proj) return;
		const req = ++historyReq;
		const current = () => req === historyReq && chat.picker?.kind === 'resume' && !!chat.picker.history;
		const from =
			source === 'claude' || source === 'codex' || source === 'opencode' || source === 'dsh' ? source : 'lynshen';
		try {
			const items =
				from === 'lynshen'
					? await store.historyItems(proj, chat)
					: (await nativeSessions(from, proj.path)).map((s) => {
							if (from === 'opencode' && s.imported) opencodeCopies.set(s.id, s.imported);
							if (from === 'dsh' && s.unreadable) dshUnreadable.set(s.id, s.unreadable);
							return s;
						}).map((s) => ({
							id: s.id,
							label: s.title || s.id.slice(0, 8),
							detail: [
								s.origin,
								new Date(s.mtime_ms).toLocaleString(),
								s.imported ? t('shell.historySource.imported') : '',
								s.unreadable ? t(`settings.import.skip.${s.unreadable}`) : ''
							]
								.filter(Boolean)
								.join(' · '),
							active: false
						}));
			if (current())
				chat.picker = {
					kind: 'resume',
					history: true,
					source: from,
					backend: from === 'opencode' ? 'acp' : from === 'dsh' ? 'lynshen' : from,
					items
				};
		} catch (e) {
			if (!current()) return;
			toast.error(t('shell.historyFail', { msg: String(e) }));
			historyTab = chat.picker?.kind === 'resume' ? (chat.picker.source ?? 'lynshen') : 'lynshen';
		}
	}

	// Builds the claude /resume picker from the Claude Code conversations the
	// daemon lists for this project (synthesized resume_view).
	async function openClaudeHistory() {
		const c = chat;
		const proj = project;
		if (!proj) return;
		try {
			const sessions = (await sessionHistory(proj.path)).filter((s) => s.engine === 'claude');
			c.handle({
				type: 'resume_view',
				items: sessions.map((s) => ({
					id: s.session,
					label: s.title || t('shell.untitled'),
					detail: new Date(s.updated_at).toLocaleString(),
					active: s.session === c.sessionId
				}))
			});
		} catch (e) {
			c.messages.push({ kind: 'system', text: t('shell.backend.claudeHistoryFail', { msg: String(e) }) });
		}
	}

	// The backend is only switchable while the session is virgin: no user turn
	// yet (an optimistic push counts) and not a resumed conversation.
	const backendLocked = $derived(!!session.restored || chat.userTurns > 0);

	// Current git branch for the composer's footer strip. A detached HEAD reads
	// "detached"; a failed probe (not a git repo) hides the chip.
	let gitBranch = $state('');
	function refreshGitBranch() {
		const cwd = project?.path || chat.cwd;
		if (!cwd) {
			gitBranch = '';
			return;
		}
		git(['branch', '--show-current'], cwd)
			.then((out) => {
				if (cwd === (project?.path || chat.cwd)) gitBranch = out.trim() || 'detached';
			})
			.catch(() => {});
	}
	// Refetched when the working directory changes (chip resets immediately)…
	$effect(() => {
		const cwd = project?.path || chat.cwd;
		gitBranch = '';
		if (!cwd) return;
		refreshGitBranch();
	});
	// …and refreshed in place on window focus + a slow poll, so a checkout made
	// in GitPanel or an external terminal doesn't leave the footer stale.
	$effect(() => {
		const iv = setInterval(refreshGitBranch, 12_000);
		return () => clearInterval(iv);
	});

	/** config.json's model list as the picker shows it (what the native
	 *  engine reports for /model), keeping what the last report knew. */
	function configCatalog(cfg: Record<string, unknown>, known: ModelOption[]): ModelOption[] {
		const current = typeof cfg.model === 'string' ? cfg.model : '';
		return configModelList(cfg)
			.map((m) => {
				const name = m.name as string;
				const prev = known.find((k) => k.model === name);
				return {
					...prev,
					model: name,
					...(typeof m.display_name === 'string' && m.display_name ? { label: m.display_name } : {}),
					active: name === current,
					context_window: typeof m.context_window === 'number' ? m.context_window : (prev?.context_window ?? 0),
					max_output_tokens: typeof m.max_output_tokens === 'number' ? m.max_output_tokens : (prev?.max_output_tokens ?? 0),
					// A model configured not to think offers no tiers.
					reasoning_efforts:
						m.reasoning === false
							? []
							: Array.isArray(m.reasoning_efforts)
								? (m.reasoning_efforts as string[])
								: (prev?.reasoning_efforts ?? []),
					...(m.reasoning === false ? { reasoning: false } : {}),
					...(Array.isArray(m.input_modalities) ? { input_modalities: m.input_modalities as string[] } : {})
				};
			});
	}

	// Open the model picker as a popover. If we already have a cached catalog,
	// show it instantly and refresh in the background; otherwise fetch first.
	function openModelPicker() {
		// A draft has no engine to ask: the list is the one its backend
		// reported last time, marked with the draft's own pick.
		if (session.draft) {
			const pick = session.draftPick?.model;
			const show = (catalog: ModelOption[]) => {
				const models = catalog.map((m) => ({ ...m, active: pick ? m.model === pick : m.active }));
				chat.picker = { kind: 'model', models, activeEffort: chat.effort };
				const act = models.findIndex((m) => m.active);
				selIdx = act >= 0 ? act : 0;
			};
			show(chat.modelCatalog);
			// The native engine lists config.json's models: read them now, so a
			// model checked in 管理模型 (or newly on sale) shows before any
			// engine has run, not only after one reported its list.
			if (chat.backendId === 'lynshen')
				readConfig()
					.then((cfg) => {
						const catalog = configCatalog(cfg, chat.modelCatalog);
						if (catalog.length && chat.picker?.kind === 'model' && session.draft) {
							chat.modelCatalog = catalog;
							show(catalog);
						}
					})
					.catch(() => {});
			return;
		}
		// Opened at once, from the last list the engine reported or (none yet:
		// the engine is starting, stopped or unreachable) the provider's
		// catalog; the engine's answer to /model replaces it.
		chat.picker = {
			kind: 'model',
			models: chat.modelCatalog,
			activeEffort: chat.modelCatalogEffort || chat.effort
		};
		const act = chat.modelCatalog.findIndex((m) => m.active);
		selIdx = act >= 0 ? act : 0;
		send({ op: 'command', input: '/model' });
	}

	// The assistant message that's still streaming: render it as plain text and
	// only run markdown/highlight once the turn finishes (avoids reparsing the
	// whole message on every token).
	// The streaming block is the LAST message (deltas append to the tail). Scanning
	// backwards would wrongly latch onto a previous turn's reply before this turn's
	// message exists, re-animating it on send.
	const streamingMsg = $derived.by(() => {
		if (!chat.busy) return null;
		const last = chat.messages[chat.messages.length - 1];
		return last?.kind === 'assistant' && !last.interrupted ? last : null;
	});
	// The reasoning block currently receiving deltas — rendered with the
	// line-by-line streaming animation (others render as static markdown).
	const streamingReasoning = $derived.by(() => {
		if (!chat.busy) return null;
		const last = chat.messages[chat.messages.length - 1];
		return last?.kind === 'reasoning' && last.live ? last : null;
	});

	// Message indices in this chat matching the find query, and the current one.
	const findHits = $derived.by(() => {
		if (!showFind) return [];
		const q = findQuery.trim().toLowerCase();
		if (!q) return [];
		const hits: number[] = [];
		chat.messages.forEach((m, i) => {
			const text = m.kind === 'tool' ? `${m.name} ${m.output}` : m.kind === 'agent_message' ? m.summary : 'text' in m ? m.text : '';
			if (text.toLowerCase().includes(q)) hits.push(i);
		});
		return hits;
	});
	const findActive = $derived(findHits.length ? findHits[Math.min(findIdx, findHits.length - 1)] : null);
	$effect(() => {
		findQuery;
		findIdx = 0;
	});

	const isImage = (p: string) => /\.(png|jpe?g|gif|webp|bmp)$/i.test(p);
	// Whether the model takes images: what the engine reports for the running
	// model, else (a draft, an older engine) its catalog or provider entry.
	const takesImages = $derived.by(() => {
		if (!session.draft && chat.inputModalities) return chat.inputModalities.includes('image');
		const listed =
			chat.modelCatalog.find((m) => m.model === chat.model)?.input_modalities ??
			providersList.find((p) => p.id === chat.provider)?.models.find((m) => m.name === chat.model)?.input_modalities;
		return acceptsImages({ input_modalities: listed });
	});
	/** Refuses an image for a model that takes none; true when it may attach. */
	function imageAllowed(path: string): boolean {
		if (takesImages) return true;
		toast.error(t('chat.imageNotAccepted', { model: chat.modelLabel || chat.model, name: base(path) }));
		return false;
	}
	const base = (p: string) => p.replace(/\/+$/, '').split('/').pop() || p;
	// The agent trace (AgentRunsPanel, a workbench panel) of this session.
	const traceable = $derived(caps(chat).agentTrace && !!onOpenTrace);
	function openTrace(agentId: string | null) {
		chat.agentFocus = agentId;
		store.activeId = session.id;
		onOpenTrace?.();
	}
	function traceOf(m: Msg): { label: string; run: () => void } | null {
		if (m.kind !== 'tool' || !m.callId) return null;
		const agent = chat.agentRuns.agents.find((a) => a.toolUseId === m.callId);
		if (agent) return { label: t('dock.agents.openAgent'), run: () => openTrace(agent.id) };
		if (chat.agentRuns.workflows.some((w) => w.toolUseId === m.callId)) return { label: t('dock.agents.open'), run: () => openTrace(null) };
		return null;
	}
	// The subagents of this conversation: every run (the message list's cards
	// find theirs), and the current turn's (the subagents card). Derived from
	// the trace and lifecycle state, never from the streaming text.
	const lastTool = (label: string) => {
		const m = chat.subagentLastTool[label];
		return m ? `${toolVerb(m.name)} ${toolTarget(m.name, parseToolOutput(m.output))}`.trim() : '';
	};
	const allAgents = $derived(agentRows({ runs: chat.agentRuns, subagents: chat.subagents, lastTool, team: chat.team, stopping: chat.stopRequested }));
	const turnAgents = $derived(
		agentRows({
			runs: chat.agentRuns,
			subagents: chat.subagents,
			lastTool,
			team: chat.team,
			stopping: chat.stopRequested,
			since: chat.turnStartedAt || Number.MAX_SAFE_INTEGER
		})
	);
	// The plan card and the subagents card (agents/ProgressCards.svelte), at
	// the top right of the pane while the turn has a plan or subagents. Where
	// the pane leaves room right of the column they sit beside it, and the
	// column moves left to make that room (progressCards.ts, cardsLayout);
	// the composer and the cards above it move with the column.
	const turnPlan = $derived(planSummary(chat.plan, chat.team));
	const planFresh = $derived(chat.turnStartedAt > 0 && chat.planAt >= chat.turnStartedAt);
	const cards = $derived(cardsShown(turnPlan, turnAgents, chat.busy, planFresh));
	const cardsAt = $derived(wrapW > 0 && anyCard(cards) ? cardsLayout(wrapW, columnW, chatPad) : null);
	const beside = $derived(!!cardsAt?.beside);
	const chatW = $derived(beside ? cardsAt!.width : columnW);
	/** A subagent's conversation in a page of its own (see OpenHow); a
	 *  Workflow opens the trace's run list. */
	function openAgent(row: AgentRow, how: OpenHow = 'default') {
		if (row.workflow) return openTrace(null);
		subagentPages.open(session.id, row.id, placeFor(how, prefs.openElsewhere));
	}
	// The agent team: a worktree agent's changes open in the Changes panel at
	// its workdir; merging or dropping them is the engine's (merge_agent).
	function viewAgentChanges(row: AgentRow) {
		agentChanges.open(session.id, row.id);
	}
	function mergeAgent(row: AgentRow, action: 'apply' | 'discard') {
		send(chat.mergeAgent(row.id, action));
	}
	// One subagent stops (close_agent); it asks first when its worktree has
	// changes not merged yet.
	async function stopAgent(row: AgentRow) {
		if (await confirmStop(row)) send(chat.closeAgent(row.id));
	}
	// Best-of-N: the picked attempt merges, the others are discarded.
	function pickAttempt(group: string, row: AgentRow) {
		send(chat.pickAttempt(group, row.id));
	}
	// Stopping one agent and picking an attempt are agent team v2: with v2
	// off what came in still shows, without those actions.
	const teamOps = $derived(chat.backendId === 'lynshen' && teamSwitch.on);
	// The agent team's panel, for this session (LynShen's engine has the team).
	const teamPanel = $derived(chat.backendId === 'lynshen' && !!onOpenTeam);
	function openTeam() {
		store.activeId = session.id;
		onOpenTeam?.();
	}
	function openChanges() {
		store.activeId = session.id;
		onOpenChanges?.();
	}
	// The end of a turn hands control back (recap.ts): a card above the
	// composer with the next step as its button, while nothing else waits
	// for the reader there (an approval, the requirement gate, a plan being
	// revised, the engine down) and no turn is about to start.
	const recap = $derived(
		recapOf(chat.messages, {
			busy:
				chat.busy ||
				!!chat.pendingApproval ||
				chat.pendingMessages.length > 0 ||
				!!chat.autoRetry ||
				chat.restarting ||
				chat.engineState === 'exited' ||
				!!gate ||
				!!chat.planRevising,
			failed: !!chat.lastError,
			suggestion: chat.suggestion,
			review: !!onOpenChanges
		})
	);
	let recapEl = $state<HTMLElement | null>(null);
	/** The reader chose: the outcome stays with the turn (its receipt), and
	 *  focus that was on the card goes back to the composer. Nothing once
	 *  the card is going (a second click while it collapses). */
	function settleRecap(choice: 'picked' | 'skipped' | 'closed'): Recap | null {
		const r = recap;
		if (!r) return null;
		const refocus = !!recapEl?.contains(document.activeElement);
		r.reply.recap = { choice, what: choice === 'closed' ? '' : r.suggestion, at: Date.now() };
		if (refocus) composerEl?.focus();
		return r;
	}
	/** The primary: send the suggestion as the next message, as the composer
	 *  would (its draft stays), or open the changes. */
	function pickRecap() {
		const r = settleRecap('picked');
		if (!r) return;
		if (!r.suggestion) return openChanges();
		chat.suggestion = '';
		if (r.suggestion.startsWith('/')) send({ op: 'command', input: r.suggestion });
		else {
			if (!chat.busy || chat.restarting) {
				captureCheckpoint();
				chat.optimisticUser(r.suggestion);
			}
			send({ op: 'user_message', content: r.suggestion });
		}
		if (prefs.scrollOnSend) jumpToBottom();
	}
	// A finished attempt's worktree: the lines it adds and removes, read once
	// (git diff there; files it created are not counted).
	const measuredWorktrees = new Set<string>();
	$effect(() => {
		for (const r of allAgents) {
			const a = r.team;
			if (!a?.attemptGroup || !a.worktree || !a.workdir || a.diff || a.merge?.ok || isLive(r) || measuredWorktrees.has(a.workdir)) continue;
			measuredWorktrees.add(a.workdir);
			const id = r.id;
			git(['diff', '--numstat', 'HEAD'], a.workdir)
				.then((out) => {
					const entry = chat.team[id];
					if (entry && !entry.diff) entry.diff = numstatTotals(out);
				})
				.catch(() => {
					/* the worktree is gone or not a repository */
				});
		}
	});
	// A finished worktree agent whose changed files the engine did not name:
	// read them from its worktree once (git status there).
	const scannedWorktrees = new Set<string>();
	$effect(() => {
		for (const r of allAgents) {
			const a = r.team;
			if (!a?.worktree || !a.workdir || a.files.length || a.merge || a.pending) continue;
			if (r.state === 'running' || r.state === 'queued' || scannedWorktrees.has(a.workdir)) continue;
			scannedWorktrees.add(a.workdir);
			const id = r.id;
			git(['status', '--porcelain'], a.workdir)
				.then((out) => {
					const files = porcelainFiles(out);
					const entry = chat.team[id];
					if (files.length && entry && !entry.files.length) entry.files = files;
				})
				.catch(() => {
					/* the worktree is gone or not a repository */
				});
		}
	});

	// Plan mode: a proposed plan runs once approved, in the mode picked on its
	// card; revising it sends the next message as the user's feedback.
	const planMode = $derived<ApprovalMode>(
		chat.modeBeforePlan && chat.modeBeforePlan !== 'plan' ? chat.modeBeforePlan : 'auto'
	);
	function planAction(id: string, action: PlanAction) {
		const plan = chat.messages.find((m) => m.kind === 'plan' && m.id === id);
		if (action.decision === 'approve') {
			const mode = toEngineMode(action.mode) as Exclude<ReturnType<typeof toEngineMode>, 'plan'>;
			send({ op: 'approve_plan', id, decision: 'approve', mode });
			chat.setApprovalMode(action.mode);
			if (plan?.kind === 'plan') plan.status = 'approved';
			chat.planRevising = null;
			return;
		}
		chat.planRevising = id;
		composerEl?.focus();
	}

	// pickers (tree / model / resume) — this pane's session
	const pickerTitle = $derived(
		chat.picker?.kind === 'tree'
			? t('shell.picker.tree')
			: chat.picker?.kind === 'model'
				? t('shell.picker.model')
				: chat.picker?.kind === 'resume'
					? t('shell.picker.resume')
					: chat.picker?.kind === 'checkpoint'
						? t('shell.picker.checkpoint')
						: ''
	);
	const activeModel = $derived(
		chat.picker?.kind === 'model' ? chat.picker.models.find((m) => m.active) : undefined
	);
	const pickerRows = $derived.by(() => {
		const p = chat.picker;
		const nil = undefined as number | undefined;
		if (!p) return [];
		if (p.kind === 'tree')
			return treeRows(p.nodes).map((r) => ({ id: r.node.id, label: r.node.label, detail: r.node.id.slice(0, 8), active: r.node.active, command: `/checkout ${r.node.id}`, depth: r.depth as number | undefined }));
		if (p.kind === 'resume')
			return p.items.map((it) => ({ id: it.id, label: it.label, detail: it.detail, active: it.active, command: `/resume ${it.id}`, depth: nil }));
		if (p.kind === 'checkpoint')
			return p.items.map((it) => ({ id: it.id, label: it.label, detail: it.detail, active: it.active, command: `/rewind ${it.id}`, depth: nil }));
		// Model picker rows (pure packing in $lib/composer/modelRows): the active
		// provider's models from the engine's model_view plus, for lynshen
		// sessions, the catalog of every other provider with credentials.
		return buildModelRows({
			models: p.models,
			backendId: chat.backendId,
			provider: chat.provider ?? '',
			providersList,
			configured: providers,
			groups: {
				lynshen: t('shell.modelGroup.lynshen'),
				byok: t('shell.modelGroup.byok'),
				ofTotal: (total) => t('chat.windowOfTotal', { total }),
				routeGroup: (group) => t('chat.routeGroup', { group }),
				routeChannel: (channel) => t('chat.routeChannel', { channel }),
				accountClass: (accountClass) => t(`chat.accountClass.${accountClass}`)
			},
			toolMode,
			localLabel: t('chat.providerLocal'),
			unsetWindow: t('chat.windowUnset'),
			current: chat.model,
			routes
		});
	});

	// The model button's name: the catalog's, or one read from the id, as the
	// model pickers show it (src/lib/models). Claude Code / Codex keep theirs.
	const shownModelName = $derived.by(() => {
		const stored = stripGroupSuffix(providersList.find((p) => p.id === chat.provider)?.models.find((m) => m.name === chat.model)?.display_name || '');
		if (chat.backendId !== 'lynshen' || !chat.model) return stored || undefined;
		return displayNameOf(chat.provider ?? '', chat.model, stored || stripGroupSuffix(chat.modelLabel || ''), gatewayCatalog.lookup);
	});

	// Claude Code / Codex: the current model and where it can run, for the
	// menu's provider row.
	const toolModel = $derived.by((): ToolModel | undefined => {
		if ((chat.backendId !== 'claude' && chat.backendId !== 'codex') || !chat.model) return undefined;
		const served = providers.includes('lynshen')
			? (providersList.find((p) => p.id === 'lynshen')?.models ?? [])
			: [];
		const id = chat.model;
		const found = toolModels(chat.modelCatalog, served, toolMode === 'lynshen').find(
			(m) => m.key === id || m.local === id || m.lynshen === id
		);
		return (
			found ?? {
				key: id,
				label: id,
				vendor: id,
				active: true,
				...(toolMode === 'lynshen' ? { lynshen: id } : { local: id })
			}
		);
	});

	/** Moves this Claude Code / Codex session between this machine and the
	 *  gateway. A conversation under way may not carry over (its thinking is
	 *  signed for the account that wrote it): asked first. */
	async function switchTool(mode: 'system' | 'lynshen', model?: string): Promise<boolean> {
		if (!session.draft && chat.messages.some((m) => m.kind === 'user')) {
			const ok = await confirm({
				title: t(mode === 'lynshen' ? 'shell.toolSwitch.confirmLynShen' : 'shell.toolSwitch.confirmSystem'),
				message: t('shell.toolSwitch.confirmBody'),
				confirmLabel: t('shell.toolSwitch.confirm')
			});
			if (!ok) return false;
		}
		void store.applyToolProfile(session.id, mode, model);
		return true;
	}

	async function pickProvider(m: ToolModel, choice: { local: true } | { group: string }) {
		if (toolMode === 'lynshen' && !('local' in choice)) {
			store.setSessionGroup(session.id, choice.group);
			return;
		}
		chat.closePicker();
		if ('local' in choice) {
			if (toolMode === 'lynshen' && m.local) await switchTool('system', m.local);
			return;
		}
		// Set once the switch is confirmed; the gateway reads it per request.
		if (m.lynshen && (await switchTool('lynshen', m.lynshen))) store.setSessionGroup(session.id, choice.group);
	}

	// Whether to offer a filter box (history and other long lists).
	const showPickerSearch = $derived(
		pickerRows.length > 8 || chat.picker?.kind === 'resume' || chat.picker?.kind === 'checkpoint'
	);
	const filteredRows = $derived.by(() => {
		const q = pickerQuery.trim().toLowerCase();
		if (!q) return pickerRows;
		return pickerRows.filter((r) => `${r.label} ${r.detail}`.toLowerCase().includes(q));
	});
	$effect(() => {
		chat.picker;
		pickerQuery = '';
	});
	$effect(() => {
		if (pendingModel && chat.model === pendingModel) pendingModel = '';
		if (chat.picker) {
			const i = filteredRows.findIndex((r) => r.active);
			selIdx = i >= 0 ? i : 0;
		}
	});
	$effect(() => {
		if (chat.pendingFill != null) {
			input = chat.pendingFill;
			chat.pendingFill = null;
		}
	});
	$effect(() => {
		if (!chat.pendingAttach.length) return;
		const paths = chat.pendingAttach;
		chat.pendingAttach = [];
		for (const path of paths) addAttachment(path);
	});
	// This pane became the workbench-active one: its unread marker clears.
	$effect(() => {
		if (isActive) untrack(() => (chat.unseen = false));
	});

	const isVideo = (p: string) => /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(p);

	function addAttachment(path: string) {
		if (!path) return;
		if (isVideo(path)) {
			attachVideo(path);
			return;
		}
		if (isImage(path)) addImage(path);
		else if (!attachments.some((a) => a.path === path)) attachments.push({ path, image: false });
	}
	function addImage(path: string) {
		if (images.some((i) => i.path === path) || !imageAllowed(path)) return;
		const n = ++imageSeq;
		images.push({ n, path });
		const token = `[图片 #${n}]`;
		if (composerRef) composerRef.insertToken(token);
		else input = input && !/\s$/.test(input) ? `${input} ${token} ` : `${input}${token} `;
	}
	async function pickFiles() {
		const sel = await open({ multiple: true, title: t('shell.attachTitle') });
		if (!sel) return;
		for (const p of Array.isArray(sel) ? sel : [sel]) addAttachment(p);
	}

	// Video → keyframes: extraction happens on attach (not send) so the chip can
	// show the result and errors surface immediately. 重试 looks for ffmpeg
	// again (process_video): installed meanwhile, it is found without a restart.
	async function attachVideo(path: string) {
		// A video goes to the model as keyframe images.
		if (videos.some((v) => v.path === path) || !imageAllowed(path)) return;
		try {
			const info = await processVideo(path);
			videos.push({ path: info.path, frames: info.frames, duration: info.duration });
		} catch (e) {
			toast.error(String(e), { action: { label: t('common.retry'), run: () => void attachVideo(path) } });
		}
	}

	// Serialize a picked element into model-readable context. Inserted in place of
	// its inline token on submit.
	function formatWebRef(r: PickedRef): string {
		const lines = [
			`[网页元素引用 #${r.id}] ${r.title || r.url}`,
			`页面: ${r.url}`,
			`选择器: ${r.selector}`
		];
		if (r.text) lines.push(`文本: ${r.text}`);
		if (r.html) lines.push(`HTML:\n${r.html}`);
		return lines.join('\n');
	}

	// Builds a reference token and inserts it as an atomic chip at the composer
	// caret (via the rich editor). Falls back to appending to the text if the
	// editor isn't mounted.
	function insertRefToken(id: number, label: string) {
		const clean = label.replace(/[\]\n\r]+/g, ' ').trim().slice(0, 24);
		const token = clean ? `[网页元素#${id}:${clean}]` : `[网页元素#${id}]`;
		if (composerRef) composerRef.insertToken(token);
		else input = input && !/\s$/.test(input) ? `${input} ${token} ` : `${input}${token} `;
	}

	// A browser element pick routed here by the page (always the active pane).
	function insertWebRef(ref: WebRef) {
		const picked: PickedRef = { ...ref, id: ++refSeq };
		webRefs.push(picked);
		insertRefToken(picked.id, picked.text || picked.tag || 'element');
	}

	function submit() {
		const text = input.trim();
		if (!text && attachments.length === 0 && videos.length === 0) return;
		// A draft made for a requirement starts from it; the words go with it.
		if (starting && !text.startsWith('/')) {
			beginRequirement(session, text);
			input = '';
			return;
		}
		if (text.startsWith('/')) {
			const btw = caps(chat).sideQuestions ? text.match(/^\/btw\s+([\s\S]+)/) : null;
			if (btw) chat.sideAnswers.push({ question: btw[1].trim(), answer: '', error: '', pending: true });
			send({ op: 'command', input: text });
		} else {
			const sent = [...new Set(
				[...text.matchAll(/\[图片 #(\d+)\]/g)]
					.map((m) => images.find((i) => i.n === Number(m[1]))?.path)
					.filter((p): p is string => !!p)
			)];
			const imagePaths = [...sent];
			const files = attachments.filter((a) => !a.image).map((a) => a.path);
			let content = text;
			// Expand each web-element token in place (order = its position in the
			// text). Match by id so an edited descriptor still resolves; refs whose
			// token was deleted are simply never expanded.
			for (const ref of webRefs) {
				const re = new RegExp(`\\[网页元素#${ref.id}(?::[^\\]]*)?\\]`, 'g');
				if (re.test(content)) content = content.replace(re, `\n\n${formatWebRef(ref)}\n`);
			}
			// Each quote token becomes the passage as a markdown quote.
			for (const q of quotes) {
				const re = new RegExp(`\\[引用#${q.id}(?::[^\\]]*)?\\]`, 'g');
				const block = q.text
					.split('\n')
					.map((line) => `> ${line}`.trimEnd())
					.join('\n');
				content = content.replace(re, () => `\n\n${block}\n\n`);
			}
			content = content.replace(/\n{3,}/g, '\n\n').trim();
			// Revising a proposed plan: the message is the user's feedback on it.
			const revising = chat.planRevising;
			if (revising && !files.length && !videos.length && !imagePaths.length) {
				const plan = chat.messages.find((m) => m.kind === 'plan' && m.id === revising);
				if (plan?.kind === 'plan') plan.status = 'revising';
				chat.planRevising = null;
				if (!chat.busy || chat.restarting) chat.optimisticUser(content);
				send({ op: 'approve_plan', id: revising, decision: 'revise', feedback: content });
				input = '';
				webRefs = [];
				quotes = [];
				return;
			}
			// The engine reads the files and videos from a list after the text;
			// the conversation shows them as chips (attachments.ts).
			content = withFiles(content, files);
			for (const v of videos) {
				imagePaths.push(...v.frames);
				content = withVideo(content, base(v.path), v.duration, v.frames.length);
			}
			// Echo the message instantly when it starts a turn now (a busy session
			// queues it instead, shown in the composer's queue strip).
			// A restarting engine holds the message and starts the turn once up.
			if (!chat.busy || chat.restarting) {
				captureCheckpoint(); // snapshot files before this turn (for rewind)
				chat.optimisticUser(content, sent);
			}
			send({ op: 'user_message', content, images: imagePaths.length ? imagePaths : undefined });
		}
		input = '';
		attachments = [];
		videos = [];
		webRefs = [];
		quotes = [];
		images = [];
		imageSeq = 0;
		if (prefs.scrollOnSend) jumpToBottom();
	}
	/** Takes a queued message back before it runs. Its text returns to the
	 *  message box once the engine says it took it (`unqueued`): a message
	 *  that started meanwhile, or an engine that cannot, changes nothing. */
	function unqueue(index: number, text: string) {
		send({ op: 'unqueue', index, text });
	}
	// Only takes from now on count (the chat may hold an older one).
	let unqueuedSeen = untrack(() => chat.unqueued?.seq ?? 0);
	$effect(() => {
		const taken = chat.unqueued;
		if (!taken || taken.seq === unqueuedSeen) return;
		unqueuedSeen = taken.seq;
		untrack(() => {
			const typed = takeBack(taken.text);
			input = input.trim() ? `${input.replace(/\s+$/, '')}\n${typed}` : typed;
			composerEl?.focus();
		});
	});
	function stop() {
		if (chat.busy) markStopped(chat.messages);
		autoRetry.cancel(chat);
		send({ op: 'interrupt' });
	}
	function respondApproval(op: ApproveOp) {
		if (!chat.pendingApproval) return;
		send(op);
		chat.approvalAnswered();
	}
	// User changed the approval-mode picker: persist locally and push it to this
	// session's engine (which enforces it and acks with an approval_mode event).
	function setApprovalMode(m: ApprovalMode) {
		chat.setApprovalMode(m);
		// A draft starts in the recorded mode (see SessionStore #spawn).
		if (session.draft) return;
		// Switching claude INTO yolo (bypassPermissions) isn't honored at runtime —
		// respawn the engine with the flag (resumes the conversation) instead of
		// sending a live control frame that would silently no-op.
		if (needsClaudeYoloRespawn(chat.backendId, buildSetApprovalModeOp(m).mode)) {
			// Not mid-turn: the respawn would cut the turn off, and one claude
			// has not saved yet cannot be resumed. Switch once it ends.
			if (chat.busy) yoloAfterTurn = true;
			else store.respawnClaudeYolo(session.id);
			return;
		}
		yoloAfterTurn = false;
		send(buildSetApprovalModeOp(m));
	}

	let yoloAfterTurn = $state(false);
	$effect(() => {
		if (yoloAfterTurn && !chat.busy && chat.approvalMode === 'all') {
			yoloAfterTurn = false;
			store.respawnClaudeYolo(session.id);
		}
	});

	function selectRow(picked: string) {
		// A Provider row: pin the model to it (`monoize_providers`, sent as
		// X-Monoize-Provider from the next request), then pick the model.
		const { command, route } = splitRoute(picked);
		// An image model cannot chat: picking one makes it the model the agent
		// draws with (generate_image), and the chat keeps its model.
		const drawWith = command.startsWith('/model ') ? command.slice('/model '.length).trim().split(/\s+/)[0] : '';
		if (drawWith && isImageModel(drawWith)) {
			chat.closePicker();
			writeConfig({ image_model: drawWith })
				.then(() => toast.success(t('chat.imageModelSet', { name: drawWith })))
				.catch((e) => toast.error(String(e)));
			return;
		}
		if (route) void pinRoute(command, route);
		// A draft only records the model; it is applied when the first message
		// starts the engine.
		if (session.draft && command.startsWith('/model ')) {
			const [name, effort] = command.slice('/model '.length).trim().split(/\s+/);
			const entry = chat.modelCatalog.find((m) => m.model === name);
			chat.model = name;
			chat.modelLabel = entry?.label ?? '';
			if (entry?.reasoning === false) chat.efforts = [];
			else if (entry?.reasoning_efforts?.length) {
				chat.efforts = entry.reasoning_efforts;
				if (!chat.efforts.includes(chat.effort)) chat.effort = defaultEffort(chat.efforts);
			}
			if (effort) chat.effort = effort;
			session.draftPick = { model: name, effort: chat.effort || undefined };
			chat.closePicker();
			return;
		}
		if (command.startsWith('/model ')) {
			const target = command.slice('/model '.length).trim().split(/\s+/)[0] || '';
			if (target && target !== chat.model) pendingModel = target;
		}
		// Cross-provider model pick: rewrite config + restart this session (resumes
		// the conversation) since the engine can't change provider at runtime.
		// `@switch <provider> <model> [effort]` — the effort chip appends its value.
		if (command.startsWith('@switch ')) {
			const [pid, name, effort] = command.slice('@switch '.length).split(/\s+/);
			const pv = providersList.find((x) => x.id === pid);
			chat.closePicker();
			if (pv && name) store.switchProvider(session.id, pv, name, effort);
			return;
		}
		if (command.startsWith('@tool ')) {
			const [mode, name] = command.slice('@tool '.length).trim().split(/\s+/);
			chat.closePicker();
			if (mode === 'system' || mode === 'lynshen') void switchTool(mode, name);
			return;
		}
		// Resuming a history item opens it in a fresh session so the current chat
		// isn't replaced; everything else acts on this session.
		if (command.startsWith('/resume ') && project) {
			const sid = command.slice('/resume '.length).trim();
			// A history item opens in a new tab so the current chat isn't
			// replaced: codex via thread/resume, claude via --resume + transcript
			// replay, lynshen via session_open (hosted) or /resume after spawn.
			const picker = chat.picker?.kind === 'resume' ? chat.picker : undefined;
			const backend = picker?.backend ?? chat.backendId;
			const item = picker?.items.find((i) => i.id === sid);
			chat.closePicker();
			// A Claude Code / Codex conversation continues from a cleaned copy.
			const source = picker?.source;
			// An OpenCode one in OpenCode, on a copy OpenCode makes (opened
			// again once there is one).
			if (source === 'opencode') {
				const proj = project;
				const title = item?.label ?? '';
				void store.opencodeAgent().then((entry) => {
					if (!entry) {
						toast.error(t('shell.historySource.opencodeMissing'));
						return;
					}
					const agent = { id: entry.id, name: entry.name, opencode: true };
					const copy = opencodeCopies.get(sid);
					if (copy) store.openSaved(proj, copy, title, 'acp', agent);
					else store.openForked(proj, sid, title, agent);
				});
				return;
			}
			if (source === 'claude' || source === 'codex' || source === 'dsh') {
				const proj = project;
				const title = item?.label ?? '';
				// A DSH conversation this version cannot read says why instead.
				const why = source === 'dsh' ? dshUnreadable.get(sid) : undefined;
				if (why) {
					toast.error(t(`settings.import.skip.${why}`));
					return;
				}
				const notice = toast.info(t('shell.historySource.importing', { title }), { duration: 0 });
				importNativeSession(source, proj.path, sid)
					.then((copy) => store.openSaved(proj, copy.id, copy.title || title, source === 'dsh' ? 'lynshen' : source))
					.catch((e) => toast.error(t('shell.historySource.importFail', { msg: String(e) })))
					.finally(() => toast.dismiss(notice));
				return;
			}
			if (backend === 'codex' || backend === 'claude' || backend === 'lynshen') {
				store.openSaved(project, sid, item?.label ?? '', backend);
				return;
			}
		}
		send({ op: 'command', input: command });
		chat.closePicker();
	}
	/** Records the Provider chosen for a gateway model; the engine reads it per request. */
	let routes = $state<Record<string, string>>({});
	async function pinRoute(command: string, route: string) {
		const model = command.startsWith('@switch ') ? command.split(/\s+/)[2] : command.slice('/model '.length).trim().split(/\s+/)[0];
		if (!model) return;
		routes = { ...routes, [model]: route };
		try {
			const cfg = await readConfig();
			const map = { ...((cfg.monoize_providers ?? {}) as Record<string, string>), [model]: route };
			await writeConfig({ monoize_providers: map });
		} catch (e) {
			toast.error(t('chat.groupSaveFailed', { error: String(e) }));
		}
	}
	$effect(() => {
		if (chat.picker?.kind !== 'model') return;
		readConfig()
			.then((cfg) => (routes = { ...((cfg.monoize_providers ?? {}) as Record<string, string>) }))
			.catch(() => {});
	});

	// Not through selectRow: that closes the model list, and the menu stays
	// open while the effort changes.
	function setEffort(effort: string) {
		if (session.draft) {
			chat.effort = effort;
			session.draftPick = { ...session.draftPick, effort };
			return;
		}
		if (chat.model && !pendingModel && !chat.switching) send({ op: 'command', input: `/model ${chat.model} ${effort}` });
	}
	// Thinking summaries follow settings: a running engine that reports the
	// other way is switched (between turns; a start already gets the setting).
	// Asked once per value: an engine that doesn't take it isn't asked again.
	let thinkingAsked: boolean | null = null;
	$effect(() => {
		const want = prefs.thinkingSummaries;
		if (chat.thinkingSummaries === null || chat.thinkingSummaries === want || thinkingAsked === want) return;
		if (chat.busy || chat.restarting || chat.engineState === 'exited') return;
		thinkingAsked = want;
		untrack(() => send({ op: 'command', input: `/thinking ${want ? 'on' : 'off'}` }));
	});
	// Claude Code's session switches (SessionSwitches); an OpenCode session's
	// gateway switch starts it again on the other provider.
	function setSwitch(name: SessionSwitch, on: boolean) {
		if (name === 'gateway') {
			void store.applyToolProfile(session.id, on ? 'lynshen' : 'system');
			return;
		}
		const command = name === 'ultracode' ? '/effort ultracode' : `/${name}`;
		send({ op: 'command', input: `${command} ${on ? 'on' : 'off'}` });
	}
	function pickerKey(e: KeyboardEvent) {
		if (!chat.picker) return;
		if (e.key === 'Escape') {
			e.preventDefault();
			chat.closePicker();
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			selIdx = Math.min(selIdx + 1, filteredRows.length - 1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			selIdx = Math.max(selIdx - 1, 0);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			const r = filteredRows[selIdx];
			if (r) selectRow(r.command);
		}
	}
	function respondTrust(answer: 'yes' | 'no' | 'repo') {
		send({ op: 'command', input: `/trust ${answer}` });
		chat.trustPrompt = null;
	}
	// Picker navigation only runs on the active pane (the picker overlay itself
	// is gated the same way), so two visible chats never fight over the keys.
	function onWindowKey(e: KeyboardEvent) {
		if (!isActive || e.defaultPrevented) return;
		pickerKey(e);
	}

	// The position this pane last pinned to the end, and the last one seen.
	let pinnedTop = -1;
	let lastTop = 0;
	function onScroll() {
		if (!scroller) return;
		const top = scroller.scrollTop;
		// The scroll event of our own pin says nothing about the reader.
		// Otherwise follow again once they scroll down near the end, never
		// while they scroll up. Nothing left to scroll (the content shrank
		// under it): at the end.
		if (scroller.scrollHeight <= scroller.clientHeight) atBottom = true;
		else if (top !== pinnedTop) atBottom = top >= lastTop && scroller.scrollHeight - top - scroller.clientHeight < 60;
		lastTop = top;
	}
	/** Wheel up leaves the end. Caught at the input: WebKit applies the
	 *  scroll a frame later, and while a reply streams the next pin would
	 *  undo it before any scroll event shows it. Not over a menu, which keeps
	 *  the wheel (ui/PopMenu.svelte), nor with nothing to scroll (a new
	 *  conversation): the jump-to-end button came up there. */
	function onWheel(e: WheelEvent) {
		if (e.deltaY >= 0 || !scroller || scroller.scrollHeight <= scroller.clientHeight) return;
		if ((e.target as Element | null)?.closest?.('.pop')) return;
		atBottom = false;
	}
	/** A wheel over the cards beside the column that they cannot take. */
	function wheelFromCards(e: WheelEvent) {
		if (!scroller) return;
		onWheel(e);
		scroller.scrollTop += e.deltaMode === 1 ? e.deltaY * 18 : e.deltaY;
	}
	function pin() {
		if (!scroller) return;
		scroller.scrollTop = scroller.scrollHeight;
		pinnedTop = scroller.scrollTop;
	}
	// Follow the content as it grows. The smoothed reveal changes height every
	// frame, which a scroll-event listener can't see, so observe the content's
	// size directly. Idle (a conversation loading): stick to the bottom.
	// While a reply streams: reveal it only until the latest message reaches
	// the top, then hold still, so the text being read never moves.
	let contentEl = $state<HTMLElement | null>(null);
	$effect(() => {
		if (!contentEl || !scroller) return;
		const ro = new ResizeObserver(() => {
			if (!scroller || !contentEl || !atBottom) return;
			const top = followTop(scroller, contentEl, chat.busy);
			scroller.scrollTop = top;
			pinnedTop = scroller.scrollTop;
			if (shortOfEnd(scroller, top)) atBottom = false;
		});
		ro.observe(contentEl);
		return () => ro.disconnect();
	});
	async function scrollToEnd(force = false) {
		await tick();
		if (scroller && (atBottom || force)) {
			pin();
			atBottom = true;
		}
	}
	function jumpToBottom() {
		atBottom = true;
		scrollToEnd(true);
	}
	/** A sent message back in the composer (quote, rewind, a queued one taken
	 *  back): its files attach again and the typed text is returned for the
	 *  box, without the list the engine reads (attachments.ts). A video comes
	 *  back as its name only, which cannot attach it again. */
	function takeBack(text: string): string {
		const sent = splitAttachments(text);
		for (const path of sent.files) if (!attachments.some((a) => a.path === path)) attachments.push({ path, image: false });
		return sent.text;
	}
	function editMessage(text: string) {
		input = takeBack(text);
		composerEl?.focus();
	}
	// A file a message sent: previewed in a tab beside the conversation
	// (preview/FilePreview.svelte), whatever it is and wherever it lies; the
	// tab says when it is gone and offers its folder and its default app.
	// Only a file in that message's list (`files`) is previewed.
	function openAttachment(path: string, files: string[]) {
		filePreviews.open(session.id, path, files);
	}
	// A quoted passage drops in at the caret as a chip naming its opening words.
	function citeText(text: string) {
		const id = ++quoteSeq;
		quotes.push({ id, text });
		const words = text.replace(/[\]\s]+/g, ' ').trim();
		const token = `[引用#${id}:${words.length > 24 ? `${words.slice(0, 24)}…` : words}]`;
		if (composerRef) composerRef.insertToken(token);
		else input = input && !/\s$/.test(input) ? `${input} ${token} ` : `${input}${token} `;
	}
	function openFind() {
		showFind = true;
		tick().then(() => findInputEl?.focus());
	}
	function closeFind() {
		showFind = false;
		if (findDebounce != null) {
			clearTimeout(findDebounce);
			findDebounce = null;
		}
		findInput = '';
		findQuery = '';
	}
	const findNext = () => findHits.length && (findIdx = (findIdx + 1) % findHits.length);
	const findPrev = () => findHits.length && (findIdx = (findIdx - 1 + findHits.length) % findHits.length);
	function findKey(e: KeyboardEvent) {
		if (e.key === 'Escape') {
			e.preventDefault();
			closeFind();
		} else if (e.key === 'Enter') {
			e.preventDefault();
			e.shiftKey ? findPrev() : findNext();
		}
	}
	// Real edit-and-resend: rewind the conversation (and files) to the turn that
	// produced this user message, then drop its text back into the composer. The
	// engine lists user turns in order, so the i-th turn matches the i-th message.
	// Before each codex/claude turn, snapshot the working tree so a later rewind
	// can restore files to this turn's starting state (the engines rewind only the
	// conversation). Fire-and-forget; the sha lands under its turn index.
	function captureCheckpoint() {
		const c = chat;
		const cwd = project?.path;
		if (!cwd || (c.backendId !== 'codex' && c.backendId !== 'claude')) return;
		const idx = c.userTurns;
		gitCheckpointCapture(cwd)
			.then((sha) => {
				if (sha) c.fileCheckpoints[idx] = sha;
			})
			.catch(() => {});
	}
	// Restore the working tree to the checkpoint captured before the target turn.
	function restoreCheckpoint(userIndex: number) {
		const cwd = project?.path;
		const sha = chat.fileCheckpoints[userIndex];
		if (cwd && sha) gitCheckpointRestore(cwd, sha).catch((e) => console.error('checkpoint restore failed', e));
	}

	// Open a workspace file referenced by a chat link. HTML opens in the built-in
	// browser (rendered) or the editor (source) per preference; everything else
	// opens in the editor. Paths resolve relative to this session's project root.
	async function openChatFile(href: string, context?: string) {
		const cwd = project?.path;
		if (!cwd) return;
		// A file a reply names, maybe at a line (`src/a.ts#L12:4`).
		const ref = parseFileHref(href);
		const rel = ref.path;
		if (!rel) return;
		// Absolute, from the home directory (`~/`) or relative to the project
		// (or a repo inside it). A bare name (`index.html`) is looked for first
		// in the folders the same reply named (`…/starcore/`).
		const hints = context ? dirHints(context) : undefined;
		const abs = (await resolveFileRef(cwd, rel, hints).catch(() => null)) ?? joinPath(cwd, rel);
		const ext = pathExt(abs);
		if ((ext === 'html' || ext === 'htm') && prefs.htmlOpenInBrowser) {
			// The embedded browser loads http(s) only; a loopback URL also lets the
			// page load its own relative scripts and styles.
			invoke<string>('preview_url', { path: abs })
				.then((url) => browser.open(url))
				.catch((e) => toast.error(t('chat.fileOpenFailed', { path: ref.path, error: String(e) })));
		} else {
			const at = ref.line ? { line: ref.line, col: ref.col } : undefined;
			editorStore.open(abs, cwd, at).catch((e) => toast.error(t('chat.fileOpenFailed', { path: ref.path, error: String(e) })));
		}
	}

	function rewindToMessage(text: string, userIndex: number) {
		// codex (thread/rollback) and claude (resume-at-uuid respawn) rewind without
		// the lynshen checkpoint_view round-trip — confirm directly from the index.
		if (chat.backendId === 'codex' || chat.backendId === 'claude') {
			chat.pendingRewind = { id: `${chat.backendId}:${userIndex}`, text };
			return;
		}
		chat.rewindIntent = { userIndex, text };
		send({ op: 'command', input: '/rewind' });
	}
	function confirmRewind() {
		const pr = chat.pendingRewind;
		if (!pr) return;
		if (pr.id.startsWith('codex:')) {
			const userIndex = Number(pr.id.slice('codex:'.length));
			const numTurns = chat.userTurns - userIndex;
			if (numTurns > 0) send({ op: 'command', input: `/rewind ${numTurns}` });
			// codex rolls back its own history; mirror it in our projected transcript.
			chat.truncateToUserTurn(userIndex);
			restoreCheckpoint(userIndex); // …and the files it changed
		} else if (pr.id.startsWith('claude:')) {
			const userIndex = Number(pr.id.slice('claude:'.length));
			// Respawn resuming at the previous turn's assistant uuid (or fresh at 0).
			store.rewindClaudeSession(session.id, chat.claudeRewindTarget(userIndex), userIndex);
			restoreCheckpoint(userIndex);
		} else {
			send({ op: 'command', input: `/rewind ${pr.id}` });
		}
		input = takeBack(pr.text);
		chat.pendingRewind = null;
		composerEl?.focus();
	}

	// The page's pane registry: global flows (palette commands, ⌘F, file drops,
	// element picks) reach the active pane through this surface.
	const api: ChatPaneApi = {
		runCommand: (cmd) => send({ op: 'command', input: cmd }),
		addAttachment,
		insertWebRef,
		toggleFind: () => (showFind ? closeFind() : openFind()),
		scrollToEnd: () => void scrollToEnd(),
		focusComposer: () => composerEl?.focus(),
		stop: () => {
			if (chat.busy) stop();
		},
		openModelMenu: () => composerRef?.openModelMenu(),
		planAction
	};
	$effect(() => {
		onRegister?.(session.id, api);
		return () => onUnregister?.(session.id, api);
	});

	onMount(() => {
		scrollToEnd(true);
	});
	onDestroy(() => {
		if (findDebounce != null) clearTimeout(findDebounce);
		// Moving the tile to another leaf remounts the pane — stash the draft so
		// the composer text survives the drag (pendingFill restores it).
		if (input.trim()) chat.pendingFill = input;
	});
</script>

<svelte:window onkeydown={onWindowKey} onfocus={refreshGitBranch} />

<div
	class="chatpane"
	class:fresh
	class:beside
	style:--chat-w="{chatW}px"
	style:--chat-pad="{chatPad}px"
	style:--col-l={beside ? `${cardsAt!.left}px` : undefined}
	style:--col-r={beside ? `${cardsAt!.right}px` : undefined}
>
	{#if owner}
		<div class="owner">
			<AgentAvatar agent={owner} size={16} />
			<span class="owner-name">{t('chat.agentSession', { name: owner.name })}</span>
			{#if owner.summary}<span class="owner-role">{owner.summary}</span>{/if}
			{#if onOpenAgent}<button class="owner-link" onclick={() => onOpenAgent(owner.id)}>{t('chat.agentOnDesk')}</button>{/if}
		</div>
	{/if}
	{#if linked}
		<div class="owner">
			<RequirementTag id={linked.id} />
			<span class="owner-name">{linked.title}</span>
			<span class="owner-role">{statusLabel(linked.status)}</span>
			{#if onOpenRequirement}<button class="owner-link" onclick={() => onOpenRequirement(linked.id)}>{t('shell.requirement.viewRequirement')}</button>{/if}
		</div>
	{:else if willLink}
		<div class="owner">
			<RequirementTag id={willLink.id} />
			<span class="owner-name">{t('shell.requirement.willLink', { id: willLink.id })}</span>
			<span class="owner-role">{willLink.title}</span>
			<button class="owner-link" onclick={() => ((session.requirement = undefined), (session.requirementStart = undefined))}>{t('shell.requirement.unlink')}</button>
		</div>
	{/if}
	<TaskStrip
		{chat}
		onStop={(id) => send({ op: 'stop_task', task_id: id })}
		onOutput={(id) => send({ op: 'task_output', task_id: id })}
		onTrace={traceable ? openTrace : undefined}
		agents={false}
	/>

	{#if showFind}
		<FindBar
			bind:value={findInput}
			bind:inputEl={findInputEl}
			hitCount={findHits.length}
			activeIndex={findIdx}
			onInput={onFindInput}
			onKey={findKey}
			onPrev={findPrev}
			onNext={findNext}
			onClose={closeFind}
		/>
	{/if}

	<div class="mainwrap" bind:clientWidth={wrapW}>
	<ProgressCards
		{chat}
		sessionId={session.id}
		plan={turnPlan}
		rows={turnAgents}
		shown={cards}
		{beside}
		lane={cardsAt?.right ?? 0}
		onOpen={traceable ? openAgent : undefined}
		onStop={(id) => send({ op: 'stop_task', task_id: id })}
		onStopAgent={teamOps ? stopAgent : undefined}
		onOpenTeam={teamPanel ? openTeam : undefined}
		onWheel={wheelFromCards}
	/>
	<main bind:this={scroller} onscroll={onScroll} onwheel={onWheel}>
		<div bind:this={contentEl}>
			<MessageList bind:this={messageList} bind:mark messages={chat.messages} {streamingMsg} {streamingReasoning} phase={chat.phase} call={chat.call} compactionTokens={chat.compactionTokens} retry={chat.retry} autoRetry={chat.autoRetry} onAutoRetryNow={() => autoRetry.now(chat)} onAutoRetryCancel={() => autoRetry.cancel(chat)} {findActive} {scroller} onEdit={editMessage} onCite={citeText} onNote={noteRequirement} onRewind={rewindToMessage} onFile={openChatFile} onAttachment={openAttachment} onDismiss={(m) => (chat.messages = chat.messages.filter((x) => x !== m))} backend={chat.backendId} provider={chat.provider ?? ''} onErrorAction={fixError} traceOf={traceable ? traceOf : undefined} agents={allAgents} onOpenAgent={traceable ? openAgent : undefined} onAgentChanges={viewAgentChanges} onMergeAgent={mergeAgent} onStopAgent={chat.backendId === 'lynshen' ? stopAgent : undefined} onPickAttempt={pickAttempt} attemptPicks={chat.attemptPicks} sendOf={(id) => chat.sendOf(id)} {onOpenSession} onPlan={planAction} onOpenPlan={(id) => planPages.open(session.id, id)} {planMode} onChanges={onOpenChanges ? openChanges : undefined} />
		</div>
		{#if chat.booting && chat.engineState !== 'exited'}
			<div class="welcome spawning">
				<span class="spawn-spin"><CircleNotchIcon size={26} class="spin" /></span>
				<p class="welcome-tip">{t('shell.spawning')}</p>
			</div>
		{:else if starting && chat.messages.length === 0}
			<div class="welcome">
				<RequirementStart requirement={starting} {session} />
			</div>
		{:else if fresh}
			<!-- A conversation with no messages: the greeting one line above
			     the composer, which sits in the middle of the pane. -->
			<div class="welcome fresh">
				<p class="greeting">{t('shell.home.greeting')}</p>
				{#if session.draft && !project?.chats}<NewSessionPicker {store} {session} />{/if}
			</div>
		{/if}
	</main>
	<!-- Progressive edge blur: the transcript dissolves at the top and bottom
	     of the scroller instead of a hard cut. Six bands, each blurring twice
	     the last; glass only (app.css), never on the rows themselves. -->
	{#if marks.length > 1}
		<TurnRail {marks} current={mark} onJump={(n) => messageList?.jumpToMark(n)} />
	{/if}
	</div>
	{#if !atBottom}
		<button class="jump" style:bottom="{bottomH + 14}px" onclick={jumpToBottom} aria-label={t('chat.jumpToBottom')}><CaretDownIcon size={18} /></button>
	{/if}

	<div class="bottom" bind:clientHeight={bottomH}>
		{#if chat.engineState === 'exited'}
			<div class="approval-wrap">
				<div class="enginedown">
					<span class="ed-text">{t('shell.engineDown')}</span>
					<Button variant="primary" size="sm" onclick={() => store.restartSession(session.id, true)}>{t('shell.restartEngine')}</Button>
				</div>
			</div>
		{/if}
		<!-- Agent questions render in the composer tray; the card keeps plain
		     tool approvals (commands, edits, plans). -->
		{#if chat.pendingApproval && !chat.pendingApproval.questions?.length}
			<div class="approval-wrap">
				{#key chat.pendingApproval.callId}
					<ApprovalCard approval={chat.pendingApproval} onRespond={respondApproval} ruleScopes={caps(chat).ruleScopes} keys={isActive} onTerminal={(command, cwd) => terminalRequests.open(command, cwd || chat.cwd, session.id)} />
				{/key}
			</div>
		{/if}

		{#if chat.inTerminal}
			<p class="interm">{t('chat.inTerminal')}</p>
		{/if}
		{#if chat.rateLimit}
			<RateLimitBanner rateLimit={chat.rateLimit} onDismiss={() => (chat.rateLimit = null)} />
		{/if}

		{#if chat.planRevising}
			<div class="approval-wrap">
				<div class="revising">
					<ClipboardTextIcon size={14} />
					<span class="rv-label">{t('chat.planCard.revising')}</span>
					<span class="rv-hint">{t('chat.planCard.revisingHint')}</span>
					<button class="rv-x" onclick={() => (chat.planRevising = null)} aria-label={t('chat.planCard.cancelRevise')} title={t('chat.planCard.cancelRevise')}><XIcon size={13} /></button>
				</div>
			</div>
		{/if}

		{#if gate && !chat.pendingApproval}
			<div class="approval-wrap">
				<div class="gate">
					<span class="gate-hint">{t('shell.requirement.confirmHint')}</span>
					<Button size="sm" variant="primary" disabled={confirming} onclick={confirmGate}>{t(`shell.requirement.${gateNext(gate)}`)}</Button>
				</div>
			</div>
		{/if}

		{#if recap}
			<div class="approval-wrap" bind:this={recapEl} out:collapse>
				{#key recap.reply}
					<RecapCard
						{recap}
						keys={isActive && !input.trim() && !attachments.length && !videos.length && !images.length && !chat.picker && !chat.trustPrompt && !chat.pendingRewind && !showFind}
						composer={composerEl}
						onPick={pickRecap}
						onSkip={() => settleRecap('skipped')}
						onClose={() => settleRecap('closed')}
					/>
				{/key}
			</div>
		{/if}

		<Composer
			{chat}
			foot={statusBell}
			onContextBreakdown={session.draft || chat.engineState === 'exited' ? undefined : () => send({ op: 'context_usage' })}
			bind:this={composerRef}
			bind:input
			bind:attachments
			{images}
			onImage={addImage}
			onAttach={addAttachment}
			bind:videos
			bind:el={composerEl}
			onSubmit={submit}
			onStop={stop}
			onSteer={() => send({ op: 'steer' })}
			onUnqueue={unqueue}
			onPick={pickFiles}
			onModel={openModelPicker}
			onModelSelect={selectRow}
			onModelClose={() => chat.closePicker()}
			modelRows={filteredRows}
			modelDisplayName={shownModelName}
			modelSearch={showPickerSearch}
			{backendLocked}
			toolProvider={toolModel
				? {
						model: toolModel.lynshen ?? toolModel.key,
						name: BACKEND_LABELS[chat.backendId],
						local: toolModel.local !== undefined,
						lynshen: toolModel.lynshen !== undefined,
						onLynShen: toolMode === 'lynshen',
						group: session.group ?? '',
						groups: store.takesSessionGroup(session),
						onPick: (choice) => pickProvider(toolModel, choice)
					}
				: undefined}
			{gitBranch}
			gitCwd={project?.path || chat.cwd}
			repoName={project?.name ?? ''}
			onBranchChanged={refreshGitBranch}
			onBackend={(b, acpAgent) => store.switchBackend(session.id, b, acpAgent)}
			bind:pickerQuery
		bind:pickerSelIdx={selIdx}
			onEffort={setEffort}
			onSwitch={setSwitch}
			gateway={chat.backendId === 'acp' && chat.acpOpencode ? !!session.gateway : null}
			effortDisabled={!!pendingModel || chat.switching}
			onApproval={setApprovalMode}
			{styleMenu}
			suggest={!recap}
			onRespond={respondApproval}
		/>
	</div>
</div>

{#if isActive && chat.trustPrompt}
	<!-- The engine waits for an answer: no close button, Escape or scrim close. -->
	<Modal label={t('shell.trustLabel')} dismissible={false} onClose={() => {}}>
		<div class="trust-body">
			<h2 class="trust-q">{t('shell.trustQuestion')}</h2>
			<p>{t('shell.trustBody')}</p>
			<code class="trust-path">{chat.trustPrompt.repoRoot ?? chat.trustPrompt.cwd}</code>
		</div>
		{#snippet footer()}
			<Button variant="ghost" onclick={() => respondTrust('no')}>{t('shell.distrust')}</Button>
			{#if chat.trustPrompt?.repoRoot}<Button onclick={() => respondTrust('repo')}>{t('shell.trustRepo')}</Button>{/if}
			<Button variant="primary" onclick={() => respondTrust('yes')}>{t('shell.trust')}</Button>
		{/snippet}
	</Modal>
{/if}

{#if isActive && chat.picker && chat.picker.kind !== 'model'}
	<Picker
		{chat}
		title={pickerTitle}
		{activeModel}
		rows={filteredRows}
		showSearch={showPickerSearch}
		bind:query={pickerQuery}
		bind:selIdx
		onClose={() => chat.closePicker()}
		onSelect={selectRow}
		onEffort={setEffort}
		header={chat.picker.kind === 'resume' && chat.picker.history ? historyTabs : undefined}
	/>
{/if}

{#snippet historyTabs()}
	<Segmented bind:value={historyTab} options={historySources} onChange={showHistorySource} />
{/snippet}

{#if isActive && chat.pendingRewind}
	<Modal title={t('shell.rewindQuestion')} onClose={() => (chat.pendingRewind = null)}>
		<div class="trust-body">
			<p>{@html t('shell.rewindBody')}</p>
			<code class="trust-path">{sentLabel(chat.pendingRewind.text).slice(0, 120)}</code>
		</div>
		{#snippet footer()}
			<Button variant="ghost" onclick={() => (chat.pendingRewind = null)}>{t('common.cancel')}</Button>
			<Button variant="primary" onclick={confirmRewind}>{t('shell.rewindConfirm')}</Button>
		{/snippet}
	</Modal>
{/if}

{#snippet statusBell()}<StatusStrip {chat} />{/snippet}

<style>
	/* Whose session this is: a quiet line above the transcript. */
	.owner {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
		padding: 7px 16px;
		border-bottom: 1px solid var(--hairline);
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.owner-name {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-weight: 500;
	}
	.owner-role {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim2);
	}
	.owner-link {
		flex: none;
		margin-left: auto;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		cursor: pointer;
	}
	.owner-link:hover {
		color: var(--text);
		text-decoration: underline;
	}
	.chatpane {
		position: relative;
		height: 100%;
		display: flex;
		flex-direction: column;
		min-width: 0;
		min-height: 0;
		background: var(--bg);
		--plate-feather: 72px;
	}
	/* Over a custom background the column the text reads in sits on a calm
	   plate: a blurred copy of the image under the canvas veil (worked out
	   to keep the text readable, prefs.svelte.ts), feathered into the sharp
	   image either side. The copy is made once; nothing here animates. */
	:global(:root[data-canvas-bg]) .chatpane {
		isolation: isolate;
	}
	:global(:root[data-canvas-bg]) .chatpane::before {
		content: '';
		position: absolute;
		inset-block: 0;
		inset-inline: max(0px, calc(50% - var(--chat-w) / 2 - var(--chat-pad) - var(--plate-feather)));
		z-index: -1;
		pointer-events: none;
		background:
			linear-gradient(
				color-mix(in oklab, var(--bg) var(--canvas-veil, 80%), transparent),
				color-mix(in oklab, var(--bg) var(--canvas-veil, 80%), transparent)
			),
			var(--canvas-image-soft, none) center / cover fixed no-repeat;
		-webkit-mask-image: linear-gradient(to right, transparent, #000 var(--plate-feather), #000 calc(100% - var(--plate-feather)), transparent);
		mask-image: linear-gradient(to right, transparent, #000 var(--plate-feather), #000 calc(100% - var(--plate-feather)), transparent);
	}
	:global(:root[data-canvas-bg]) .chatpane.beside::before {
		inset-inline: max(0px, calc(var(--col-l, 0px) - var(--chat-pad) - var(--plate-feather))) max(0px, calc(var(--col-r, 0px) - var(--chat-pad) - var(--plate-feather)));
	}
	.jump {
		position: absolute;
		left: 50%;
		bottom: 132px; /* overridden inline to sit just above the composer */
		transform: translateX(-50%);
		width: 32px;
		height: 32px;
		padding: 0;
		border-radius: var(--r-full);
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: var(--panel);
		border: none;
		color: var(--text);
		box-shadow: var(--shadow-pop);
		cursor: pointer;
		z-index: 10;
		animation: jump-in var(--t-med) var(--ease-out);
		transition:
			background var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-spring),
			box-shadow var(--t-med) var(--ease-out);
	}
	/* pop-in variant that keeps the horizontal centering transform */
	@keyframes jump-in {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(4px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%);
		}
	}
	.jump:hover {
		background: color-mix(in oklab, var(--panel) 94%, var(--text));
		transform: translateX(-50%) translateY(-1px);
	}
	.jump:active {
		transform: translateX(-50%) scale(0.92);
	}
	/* With the cards beside it the column is off the pane's centre: the
	   button, the composer and what sits above it follow the column. */
	.chatpane.beside .jump {
		left: calc(var(--col-l, 0px) + var(--chat-w) / 2);
	}
	.chatpane.beside .bottom {
		padding-inline: calc(var(--col-l, 0px) - var(--chat-pad)) calc(var(--col-r, 0px) - var(--chat-pad));
	}
	/* Match the composer's outer frame (the column plus --chat-pad a side) so
	   the approval box lines up flush with the input box. */
	.approval-wrap {
		max-width: calc(var(--chat-w) + 2 * var(--chat-pad));
		width: 100%;
		margin: 0 auto;
		padding: 0 var(--chat-pad) 10px;
	}
	/* Waiting for the reader, like the approval card: a fade only. */
	.gate,
	.revising {
		animation: fade var(--t-wait) var(--ease-enter) backwards;
	}
	.gate {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 12px;
	}
	.gate-hint {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.enginedown {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 10px 14px;
		background: color-mix(in oklab, var(--err) 10%, var(--panel));
		border: 1px solid color-mix(in oklab, var(--err) 38%, transparent);
		border-radius: var(--r-md);
	}
	.ed-text {
		font-size: var(--fs-sm);
		color: var(--err);
		font-weight: 500;
	}

	.revising {
		display: flex;
		align-items: center;
		gap: 8px;
		width: fit-content;
		max-width: 100%;
		padding: 5px 6px 5px 12px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--text);
		font-size: var(--fs-xs);
	}
	.rv-label {
		flex: none;
		font-weight: 500;
	}
	.rv-hint {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim);
	}
	.rv-x {
		display: inline-flex;
		flex: none;
		padding: 3px;
		border: none;
		border-radius: var(--r-full);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.rv-x:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.interm {
		margin: 0 0 8px;
		font-size: var(--fs-xs);
		color: var(--dim);
		text-align: center;
	}

	/* Under glass the transcript dissolves at its top and bottom edges: the
	   text fades out, the background behind it stays as it is (a blur band
	   there blurred the background too and ended in a hard line above the
	   composer). Scrolled to the bottom (or top) the last (first) line rests
	   clear of the fade; only text passing under it dissolves. */
	:global(:root[data-glass]) main {
		padding-top: calc(22px + var(--edge-fade));
		padding-bottom: calc(26px + var(--edge-fade));
		-webkit-mask-image: linear-gradient(to bottom, transparent, #000 var(--edge-fade), #000 calc(100% - var(--edge-fade)), transparent);
		mask-image: linear-gradient(to bottom, transparent, #000 var(--edge-fade), #000 calc(100% - var(--edge-fade)), transparent);
	}
	.mainwrap {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
	main {
		--edge-fade: 28px;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 22px 18px 26px;
		display: flex;
		flex-direction: column;
		gap: 16px;
		/* Full width, so the scrollbar sits at the pane's edge; the padding
		   centres the column (or, with the cards beside it, leaves their
		   room at its right). */
		padding-inline: max(var(--chat-pad), calc((100% - var(--chat-w)) / 2));
	}
	.chatpane.beside main {
		padding-inline: var(--col-l, 0px) var(--col-r, 0px);
	}
	/* Fill backwards only: a fill that held the end left the block transformed
	   for good, so the new-conversation picker's menus (fixed click-away
	   backdrops) closed only on a click inside it. */
	.welcome {
		margin: auto;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 10px;
		padding: 24px;
		text-align: center;
		animation: rise var(--t-slow) var(--ease-out) backwards;
	}
	.spawn-spin {
		display: inline-flex;
		color: var(--accent);
	}
	.welcome-tip {
		margin: 0;
		font-size: var(--fs-md);
		color: var(--dim);
	}
	/* A conversation with no messages (design.md, "Workbench canvas"): the
	   transcript and the composer's area split the pane, so the composer's
	   top sits on its middle and the greeting one line above it. After the
	   first message the composer goes back to the bottom. */
	.chatpane.fresh .mainwrap,
	.chatpane.fresh .bottom {
		flex: 1 1 0;
	}
	.welcome.fresh {
		margin: auto 0 0;
		padding: 0 24px 4px;
		gap: 12px;
	}
	/* The empty-conversation greeting, a display moment (design.md, "Type"). */
	.greeting {
		margin: 0;
		color: var(--text);
		font-family: var(--font-display);
		font-size: var(--fs-2xl);
		font-weight: 500;
		line-height: 36px;
	}

	/* ---------- modals (trust / rewind) ---------- */
	.trust-body {
		font-size: var(--fs-md);
		line-height: 1.55;
	}
	.trust-q {
		margin: 6px 0 12px;
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.trust-body p {
		margin: 0 0 12px;
	}
	.trust-path {
		display: block;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 8px 10px;
		word-break: break-all;
	}
</style>
