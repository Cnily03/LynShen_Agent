<script lang="ts" module>
	import type { ReplyStyle as Style } from '$lib/styles';

	/** The "+" menu's reply styles (see `styleMenu`). */
	export interface StyleMenu {
		styles: Style[];
		/** The id this conversation uses. */
		current: string;
		onSelect: (id: string) => void;
	}
</script>

<script lang="ts">
	import type { Snippet } from 'svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { costText } from '$lib/sessionCost';
	import { sentLabel } from '$lib/attachments';
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import ArrowUUpLeftIcon from 'phosphor-svelte/lib/ArrowUUpLeftIcon';
	import { engineAtLeast, UNQUEUE_SINCE } from '$lib/engineVersion.svelte';
	import SquareIcon from 'phosphor-svelte/lib/SquareIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import PaperclipIcon from 'phosphor-svelte/lib/PaperclipIcon';
	import TargetIcon from 'phosphor-svelte/lib/TargetIcon';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import FastForwardIcon from 'phosphor-svelte/lib/FastForwardIcon';
	import StopCircleIcon from 'phosphor-svelte/lib/StopCircleIcon';
	import MicrophoneIcon from 'phosphor-svelte/lib/MicrophoneIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import GitBranchIcon from 'phosphor-svelte/lib/GitBranchIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import BranchMenu from '$lib/composer/BranchMenu.svelte';
	import CommandIcon from 'phosphor-svelte/lib/CommandIcon';
	import { toast } from '$lib/ui/toast.svelte';
	import ModeMenu, { type ModeItem } from '$lib/composer/ModeMenu.svelte';
	import EffortMenu from '$lib/composer/EffortMenu.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import { clipboardFilePaths, listFiles, saveTempFile, saveTempImage, transcribeAudio } from '$lib/protocol';
	import { fileUris, imageExt, MAX_PASTE_BYTES, pasteRoute, type PasteData } from '$lib/composer/paste';
	import { VoiceRecorder } from '$lib/audio';
	import VoiceWave from '$lib/composer/VoiceWave.svelte';
	import { buildEntries, mentionMatches, type AtEntry } from '$lib/mention';
	import { t } from '$lib/i18n';
	import { matches, withShortcut } from '$lib/shortcuts';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import MentionMenu from '$lib/composer/MentionMenu.svelte';
	import AttachmentChips from '$lib/composer/AttachmentChips.svelte';
	import ContextIndicator from '$lib/composer/ContextIndicator.svelte';
	import ModelMenu from '$lib/composer/ModelMenu.svelte';
	import type { SessionSwitch } from '$lib/composer/SessionSwitches.svelte';
	import type { ToolProvider } from '$lib/composer/GroupPicker.svelte';
	import { modelColor, isTopEffort } from '$lib/modelColor';
	import { planQuota } from '$lib/composer/quota';
	import ComposerTray, { type TrayItem, type TraySection } from '$lib/composer/ComposerTray.svelte';
	import { answerStep, startFlow, togglePick, type QuestionFlow } from '$lib/composer/tray';
	import { effortLabel } from '$lib/composer/effort';
	import { stripGroupSuffix, type ModelRow } from '$lib/composer/modelRows';
	import type { ChatState } from '$lib/chat.svelte';
	import { imageViewer } from '$lib/ui/imageViewer.svelte';
	import { approvalModeKeys, buildApproveOp, nextApprovalMode, type ApprovalMode, type ApproveOp } from '$lib/approval';
	import { commandsIsolated, onWindows } from '$lib/sandbox/request';
	import ShieldSlashIcon from 'phosphor-svelte/lib/ShieldSlashIcon';
	import { caps, BACKEND_LABELS, type AcpAgentRef, type BackendId } from '$lib/backends';
	import { styleDescription, styleName } from '$lib/styles';

	let {
		chat,
		input = $bindable(),
		attachments = $bindable(),
		videos = $bindable([]),
		el = $bindable(),
		pickerQuery = $bindable(''),
		pickerSelIdx = $bindable(0),
		modelRows = [],
		modelDisplayName,
		modelSearch = false,
		backendLocked = true,
		toolProvider,
		gateway = null,
		gitBranch = '',
		gitCwd = '',
		repoName = '',
		onBranchChanged,
		onBackend,
		onSubmit,
		onStop,
		onSteer,
		onUnqueue,
		onPick,
		images = [],
		onImage,
		onAttach,
		onModel,
		onModelSelect,
		onModelClose,
		onEffort,
		onSwitch,
		effortDisabled = false,
		onApproval,
		onRespond,
		foot,
		onContextBreakdown,
		styleMenu,
		suggest = true
	}: {
		/** The reply styles in the "+" menu (LynShen): every style, the one
		 *  this conversation uses (marked), and what picking one does.
		 *  Undefined hides the section. */
		styleMenu?: StyleMenu;
		/** Offers the engine's suggested next prompt (the placeholder, Tab);
		 *  off while the recap card above offers it as a button. */
		suggest?: boolean;
		/** Extra controls on the strip under the card (right side). */
		foot?: Snippet;
		/** Asks the engine what its context holds, by category (engines that can say). */
		onContextBreakdown?: () => void;
		chat: ChatState;
		input: string;
		attachments: { path: string; image: boolean }[];
		videos?: { path: string; frames: string[]; duration: number }[];
		el: HTMLElement | null;
		pickerQuery?: string;
		pickerSelIdx?: number;
		modelRows?: ModelRow[];
		modelDisplayName?: string;
		modelSearch?: boolean;
		/** False only while the session is still virgin (no user turn) — the
		 *  agent rail in the model popover shows then and disappears afterwards. */
		backendLocked?: boolean;
		/** A gateway session's group (see ModelMenu). */
		toolProvider?: ToolProvider & { model: string };
		/** An OpenCode session: whether it runs on the LynShen gateway (the
		 *  model menu's switch; null: not offered). */
		gateway?: boolean | null;
		/** Current git branch for the footer strip ('' hides the chip). */
		gitBranch?: string;
		/** Where the branch chip's picker runs git; '' leaves the chip read-only. */
		gitCwd?: string;
		repoName?: string;
		/** A branch was switched to or created from the chip. */
		onBranchChanged?: () => void;
		onBackend?: (b: BackendId, acpAgent?: AcpAgentRef) => void | Promise<void>;
		onSubmit: () => void;
		onStop: () => void;
		onSteer: () => void;
		/** Takes the queued message at `index` back into the message box. */
		onUnqueue?: (index: number, text: string) => void;
		onPick: () => void;
		/** Images placed in the text as [图片 #N] tokens (N → file). */
		images?: { n: number; path: string }[];
		/** A pasted image, saved to a temp file: the pane adds it and its token. */
		onImage: (path: string) => void;
		/** A pasted file (its path on disk, or the copy written of it): the pane
		 *  attaches it as a picked or dropped one. */
		onAttach?: (path: string) => void;
		onModel: () => void;
		onModelSelect?: (command: string) => void;
		onModelClose?: () => void;
		onEffort: (effort: string) => void;
		onSwitch: (name: SessionSwitch, on: boolean) => void;
		effortDisabled?: boolean;
		onApproval: (mode: ApprovalMode) => void;
		/** Answers a pending agent question (AskUserQuestion) shown in the tray. */
		onRespond?: (op: ApproveOp) => void;
	} = $props();

	let showApproval = $state(false);
	let showAdd = $state(false);
	let branchOpen = $state(false);
	let effortOpen = $state(false);
	let modelButton = $state<HTMLButtonElement>();

	// The model popover holds its own open flag so it can outlive an agent
	// switch (the new session ChatState starts with no picker) and open for
	// agents without a model catalog (ACP) — the rail inside it is the only
	// way to pick a coding agent.
	let modelOpen = $state(false);
	const modelPopoverVisible = $derived(modelOpen);
	function toggleModelPopover() {
		if (modelPopoverVisible) {
			closeModelPopover();
			return;
		}
		showAdd = false;
		showApproval = false;
		effortOpen = false;
		modelOpen = true;
		if (bcaps.modelPicker) onModel();
	}
	function closeModelPopover() {
		modelOpen = false;
		if (chat.picker?.kind === 'model') onModelClose?.();
	}
	// Escape closes the popover even when the session has no model picker view
	// (ACP agents — `modelOpen` is ours, not chat.picker). Capture phase so the
	// key never reaches the pane's window handler or the editor.
	function onWindowKeyCapture(e: KeyboardEvent) {
		if (e.key === 'Escape' && (modelPopoverVisible || showAdd || effortOpen)) {
			e.preventDefault();
			e.stopPropagation();
			if (modelPopoverVisible) closeModelPopover();
			showAdd = false;
			effortOpen = false;
		}
	}
	function selectFromPopover(command: string) {
		modelOpen = false;
		onModelSelect?.(command);
	}
	function setEffort(effort: string) {
		if (effortDisabled) return;
		onEffort(effort);
	}
	function toggleEffort() {
		if (!effortOpen) {
			if (modelPopoverVisible) closeModelPopover();
			showAdd = false;
			showApproval = false;
		}
		effortOpen = !effortOpen;
	}

	// The fallback label on the model button before the engine reports a model:
	// the ACP agent's registered name, else the engine's brand name.
	const backendLabel = $derived(
		chat.backendId === 'acp' ? chat.acpAgentName || BACKEND_LABELS.acp : BACKEND_LABELS[chat.backendId]
	);

	// Capability gating for the session's engine backend (lynshen = everything).
	const bcaps = $derived(caps(chat));

	// --- rich contenteditable editing surface ------------------------------
	// `input` (bindable) stays the plain-text source of truth: a web-element chip
	// serializes to its [网页元素#N:label] token, so all downstream logic (submit,
	// slash, @-mention) keeps operating on a string. The DOM is the live editor;
	// we sync OUT of it on input, and rebuild it only when `input` is changed
	// programmatically (completion / refill / cleared on send) — never mid-typing.
	let composing = $state(false);
	let lastSync = '';
	const TOKEN_RE = /\[网页元素#(\d+)(?::([^\]]*))?\]|\[引用#(\d+)(?::([^\]]*))?\]|\[图片 #(\d+)\]/g;

	const tokenLabel = (token: string) => {
		const m = /^\[(?:网页元素|引用)#(\d+)(?::([^\]]*))?\]$/.exec(token);
		return m ? (m[2]?.trim() || `#${m[1]}`) : token;
	};
	function makeChip(token: string): HTMLElement {
		const span = document.createElement('span');
		span.className = 'refchip';
		span.contentEditable = 'false';
		span.dataset.token = token;
		const img = /^\[图片 #(\d+)\]$/.exec(token);
		const path = img ? images.find((i) => i.n === Number(img[1]))?.path : undefined;
		if (img) {
			span.classList.add('imgchip');
			if (path) {
				const thumb = document.createElement('img');
				thumb.src = convertFileSrc(path);
				thumb.alt = '';
				thumb.title = t('common.image.open');
				// Full size, with the message's other images a step away. The
				// mousedown would otherwise move the caret around the chip.
				thumb.addEventListener('mousedown', (e) => e.preventDefault());
				thumb.addEventListener('click', (e) => {
					e.preventDefault();
					e.stopPropagation();
					const all = [...images].sort((a, b) => a.n - b.n).map((i) => ({ path: i.path }));
					imageViewer.open(all, all.findIndex((i) => i.path === path));
				});
				span.appendChild(thumb);
			}
			span.appendChild(document.createTextNode(t('chat.imageToken', { n: img[1]! })));
		} else span.textContent = tokenLabel(token);
		if (token.startsWith('[引用#')) span.classList.add('quotechip');
		return span;
	}
	// DOM → plain text: chips become their token, <br> becomes a newline.
	function serialize(root: Node): string {
		let out = '';
		root.childNodes.forEach((n) => {
			if (n.nodeType === Node.TEXT_NODE) out += n.nodeValue ?? '';
			else if (n.nodeType === Node.ELEMENT_NODE) {
				const e = n as HTMLElement;
				if (e.dataset?.token) out += e.dataset.token;
				else if (e.tagName === 'BR') out += e.dataset.tail === undefined ? '\n' : '';
				else out += serialize(e);
			}
		});
		return out;
	}
	// Plain text → DOM: split out tokens into chip spans, the rest into text.
	function renderInput(str: string) {
		if (!el) return;
		el.textContent = '';
		const frag = document.createDocumentFragment();
		let last = 0;
		TOKEN_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = TOKEN_RE.exec(str))) {
			if (m.index > last) frag.appendChild(document.createTextNode(str.slice(last, m.index)));
			frag.appendChild(makeChip(m[0]));
			last = m.index + m[0].length;
		}
		if (last < str.length) frag.appendChild(document.createTextNode(str.slice(last)));
		el.appendChild(frag);
		syncTail(str);
	}
	// pre-wrap renders no line for a trailing "\n", so a Shift+Enter at the end
	// showed nothing until pressed twice. A trailing <br data-tail> gives the empty
	// last line a box; serialize skips it.
	function syncTail(str: string) {
		if (!el) return;
		const last = el.lastChild;
		el.querySelectorAll('br[data-tail]').forEach((b) => b !== last && b.remove());
		const has = last instanceof HTMLBRElement && last.dataset.tail !== undefined;
		if (str.endsWith('\n') && !has) {
			const br = document.createElement('br');
			br.dataset.tail = '';
			el.appendChild(br);
		} else if (!str.endsWith('\n') && has) last.remove();
	}
	function caretToEnd() {
		if (!el) return;
		const r = document.createRange();
		r.selectNodeContents(el);
		r.collapse(false);
		// Before the tail <br>, or typed text would land one line too low.
		if (el.lastChild instanceof HTMLBRElement && el.lastChild.dataset.tail !== undefined) r.setStartBefore(el.lastChild);
		const sel = window.getSelection();
		sel?.removeAllRanges();
		sel?.addRange(r);
	}
	function syncFromDom() {
		if (!el) return;
		let s = serialize(el);
		// Normalize a WebKit-left empty state so the placeholder shows: deleting
		// everything can leave a lone <br> (or <div><br></div>), which reads as
		// "\n". A real line break typed into an empty box leaves two.
		if (s === '\n' && el.textContent === '') s = '';
		if (s === '' && el.childNodes.length) el.textContent = '';
		else syncTail(s);
		lastSync = s;
		input = s;
		// Typing dismisses the "+" tray so Enter sends instead of picking a row.
		showAdd = false;
	}
	function insertNodesAtCaret(nodes: Node[]) {
		if (!el || !nodes.length) return;
		el.focus();
		const sel = window.getSelection();
		let range: Range;
		if (sel && sel.rangeCount && el.contains(sel.anchorNode)) range = sel.getRangeAt(0);
		else {
			range = document.createRange();
			range.selectNodeContents(el);
			range.collapse(false);
		}
		range.deleteContents();
		const frag = document.createDocumentFragment();
		nodes.forEach((n) => frag.appendChild(n));
		const lastNode = nodes[nodes.length - 1];
		range.insertNode(frag);
		// Sync (adding the tail <br>) before placing the caret: WebKit moves a caret
		// after an unrendered trailing "\n" back before it, onto the line above.
		syncFromDom();
		const after = document.createRange();
		after.setStartAfter(lastNode);
		after.collapse(true);
		sel?.removeAllRanges();
		sel?.addRange(after);
	}
	function insertTextAtCaret(text: string) {
		insertNodesAtCaret([document.createTextNode(text)]);
	}
	// Exposed to the page (⇧⌘M): opens the model menu when the session has one.
	export function openModelMenu() {
		if ((chat.efforts.length || bcaps.modelPicker || !backendLocked) && !modelPopoverVisible) toggleModelPopover();
	}
	// Exposed to the page: drop a web-element reference chip at the caret.
	export function insertToken(token: string) {
		insertNodesAtCaret([makeChip(token), document.createTextNode(' ')]);
	}

	// Rebuild the editor DOM on external `input` changes only (slash/@ completion,
	// edit/rewind refill, voice append, cleared on send). During typing input ===
	// lastSync so this is a no-op; skipped mid-IME-composition to protect the caret.
	$effect(() => {
		const v = input;
		if (!el || composing) return;
		if (v === lastSync) return;
		renderInput(v);
		lastSync = v;
		if (document.activeElement === el) caretToEnd();
	});

	// The modes in Claude Code's order, numbered 1–5 in the menu (MODE_ORDER):
	// 谨慎 / 自动改文件 / 计划 / 自动 / 全自动. A LynShen session has all five
	// over its sandbox (approvalModeKeys), described as they work there: with
	// the sandbox's boundary, or, where commands run without isolation
	// (Windows, full access), without it. Claude and Codex have their own
	// plan and auto modes.
	const sandboxed = $derived(bcaps.sandbox && !chat.agent);
	const isolated = $derived(commandsIsolated(chat.sandbox, onWindows()));
	const modeDesc = (key: 'Ask' | 'Edits' | 'Auto' | 'All') =>
		sandboxed ? t(`chat.approval${key}Desc${isolated ? 'Sandbox' : 'Open'}`) : t(`chat.approval${key}Desc`);
	// OpenCode's modes are agents the daemon defines: 计划 cannot edit files
	// and asks before commands, and 全自动 is OpenCode as the user configured it.
	const opencode = $derived(chat.backendId === 'acp' && chat.acpOpencode);
	const APPROVAL_MODES = $derived<Record<string, ModeItem>>({
		ask: { key: 'ask', label: t('chat.approvalAsk'), desc: modeDesc('Ask') },
		edits: { key: 'edits', label: t('chat.approvalEdits'), desc: modeDesc('Edits') },
		plan: { key: 'plan', label: t('chat.approvalPlan'), desc: t(opencode ? 'chat.approvalPlanDescOpencode' : 'chat.approvalPlanDesc') },
		auto: { key: 'auto', label: t('chat.approvalAuto'), desc: modeDesc('Auto') },
		all: { key: 'all', label: t('chat.approvalAll'), desc: opencode ? t('chat.approvalAllDescOpencode') : modeDesc('All'), tone: 'warn' }
	});
	// An agent's session shows the agent's four modes, read-only: they are
	// changed on its Agent page. The recommended mode: auto where the engine
	// has it, else auto-edit. A mode this engine refused as unknown (an older
	// engine) stays listed, disabled.
	const APPROVAL = $derived.by(() => {
		const keys = approvalModeKeys(bcaps, !!chat.agent);
		const recommended = keys.includes('auto') ? 'auto' : 'edits';
		return keys.map((k) => {
			const old = chat.unsupportedModes.includes(k) && k !== chat.approvalMode;
			return { ...APPROVAL_MODES[k], recommended: k === recommended && !old, ...(old ? { disabled: true, desc: t('chat.modeOld') } : {}) };
		});
	});
	// A LynShen session whose commands run without isolation says so beside
	// the mode, with the engine's fix when its sandbox cannot start.
	const isolationNote = $derived(
		bcaps.sandbox && !isolated
			? [t('chat.sandbox.openHint'), chat.sandbox?.unavailable ?? ''].filter(Boolean).join('\n')
			: ''
	);
	const modeNote = $derived(
		chat.agent ? t('chat.approvalAgent') : bcaps.sandbox && chat.sandbox?.mode === 'full-access' ? t('chat.sandbox.fullAccessNote') : ''
	);
	// A mode the picker does not list (自动改文件 reported by a LynShen engine)
	// still shows under its own name.
	const approvalCurrent = $derived(APPROVAL.find((a) => a.key === chat.approvalMode) ?? APPROVAL_MODES[chat.approvalMode] ?? APPROVAL_MODES.ask);
	function toggleApproval() {
		if (!showApproval) {
			if (modelPopoverVisible) closeModelPopover();
			showAdd = false;
			effortOpen = false;
		}
		showApproval = !showApproval;
	}

	// "+" menu: only capabilities the session already has. Files go through the
	// page's picker (images / videos are detected from the picked paths); goal
	// seeds the engine's /goal command; plan toggles claude's plan approval mode.
	const addSections = $derived.by(() => {
		const add: TraySection = {
			label: t('chat.addSection'),
			items: [{ id: 'files', icon: PaperclipIcon, title: t('chat.addFiles'), desc: t('chat.addFilesDesc'), onSelect: onPick }]
		};
		if (chat.commands.some((c) => c.command === '/goal')) {
			add.items.push({
				id: 'goal',
				icon: TargetIcon,
				title: t('chat.addGoal'),
				desc: t('chat.addGoalDesc'),
				onSelect: () => {
					el?.focus();
					if (!input.startsWith('/goal ')) input = `/goal ${input.trimStart()}`;
				}
			});
		}
		const sections = [add];
		const styles = styleMenu ? styleSection(styleMenu) : null;
		if (bcaps.approvalModes && bcaps.planMode && !chat.agent) {
			sections.push({
				label: t('chat.modeSection'),
				items: [
					{
						id: 'plan',
						icon: ListChecksIcon,
						title: t('chat.addPlan'),
						desc: t('chat.addPlanDesc'),
						checked: chat.approvalMode === 'plan',
						// Leaving plan mode goes back to the mode before it.
						onSelect: () =>
							onApproval(chat.approvalMode !== 'plan' ? 'plan' : chat.modeBeforePlan && chat.modeBeforePlan !== 'plan' ? chat.modeBeforePlan : 'ask')
					}
				]
			});
		}
		if (styles) sections.push(styles);
		// Picking any row closes the tray first.
		return sections.map((sec) => ({
			...sec,
			items: sec.items.map((it) => ({
				...it,
				onSelect: () => {
					showAdd = false;
					it.onSelect();
				}
			}))
		}));
	});
	// The reply styles, the current one checked. A style that is gone shows
	// under its id, checked and not pickable: the conversation runs with none.
	function styleSection(menu: StyleMenu): TraySection {
		const items: TrayItem[] = menu.styles.map((style) => ({
			id: `style:${style.id}`,
			title: styleName(style, t),
			desc: styleDescription(style, t),
			checked: style.id === menu.current,
			onSelect: () => {
				el?.focus();
				if (style.id !== menu.current) menu.onSelect(style.id);
			}
		}));
		if (!menu.styles.some((style) => style.id === menu.current))
			items.push({ id: `style:${menu.current}`, title: menu.current, desc: t('chat.styleMissing'), checked: true, disabled: true, onSelect: () => {} });
		return { label: t('chat.styleSection'), items };
	}
	// Shift+Tab (in the editor or the open menu): the next mode, as in Claude
	// Code, skipping one the engine refused.
	function cycleApproval() {
		const next = nextApprovalMode(APPROVAL.map((a) => a.key as ApprovalMode), chat.approvalMode, chat.unsupportedModes);
		if (next !== chat.approvalMode) onApproval(next);
	}
	// Persisting + pushing the mode to the engine lives with the page (it owns
	// the session id); the picker only reports the choice.
	function setApproval(m: string) {
		showApproval = false;
		el?.focus();
		if (m !== chat.approvalMode) onApproval(m as ApprovalMode);
	}


	// Every command the engine reported (the tray scrolls): names starting
	// with what was typed first, then names containing it.
	const slashMatches = $derived.by(() => {
		const t = input.trim().toLowerCase();
		if (!t.startsWith('/') || t.includes(' ')) return [];
		const all = chat.commands.filter((c) => c.command.toLowerCase() !== t);
		const head = all.filter((c) => c.command.toLowerCase().startsWith(t));
		const q = t.slice(1);
		return q ? [...head, ...all.filter((c) => !head.includes(c) && c.command.toLowerCase().includes(q))] : head;
	});

	// --- composer tray -------------------------------------------------------
	// One in-box list (ComposerTray) serves three modes: a pending agent
	// question, "/" command completion and the "+" menu. A question owns the
	// tray while it's pending; otherwise slash completion wins over "+".
	let tray = $state<ReturnType<typeof ComposerTray>>();
	let trayIdx = $state(0);
	// Escape hides slash completion until the typed command changes.
	let slashDismissed = $state(false);
	$effect(() => {
		slashMatches;
		slashDismissed = false;
	});

	const question = $derived(onRespond && chat.pendingApproval?.questions?.length ? chat.pendingApproval : null);
	let flow = $state<QuestionFlow>(startFlow());
	let picks = $state<string[]>([]);
	let seenQuestionId: string | null = null;
	$effect.pre(() => {
		const id = question?.callId ?? null;
		if (id === seenQuestionId) return;
		seenQuestionId = id;
		flow = startFlow();
		picks = [];
	});
	const currentQ = $derived(question?.questions?.[flow.step] ?? null);

	// Record an answer (picked option(s) or free-form text) for the current
	// question; the last one sends the whole map, same shape as before.
	function answerQuestion(value: string) {
		if (!question?.questions) return;
		const r = answerStep(question.questions, flow, value);
		picks = [];
		trayIdx = 0;
		if (r.done) onRespond?.({ op: 'approve', call_id: question.callId, decision: 'allow', answers: r.flow.answers });
		else flow = r.flow;
	}
	function cancelQuestion() {
		if (question) onRespond?.(buildApproveOp(question.callId, 'deny'));
	}

	const trayMode = $derived<'question' | 'slash' | 'add' | null>(
		currentQ ? 'question' : slashMatches.length && !slashDismissed ? 'slash' : showAdd ? 'add' : null
	);
	$effect(() => {
		trayMode;
		slashMatches;
		trayIdx = 0;
	});

	const traySections = $derived.by((): TraySection[] => {
		if (trayMode === 'question' && currentQ) {
			const multi = currentQ.multiSelect;
			// An MCP form's yes/no field answers "true"/"false".
			const elicit = question?.name === 'mcp_elicitation';
			const optionTitle = (label: string) =>
				elicit && (label === 'true' || label === 'false') ? t(label === 'true' ? 'chat.yes' : 'chat.no') : label;
			const options: TrayItem[] = currentQ.options.map((o, i) => ({
				id: `opt-${i}`,
				title: optionTitle(o.label),
				desc: o.description,
				box: multi,
				checked: multi ? picks.includes(o.label) : undefined,
				onSelect: () => (multi ? (picks = togglePick(picks, o.label)) : answerQuestion(o.label))
			}));
			const actions: TrayItem[] = [];
			if (multi)
				actions.push({
					id: 'submit',
					title: t('chat.questionSubmit'),
					desc: picks.length ? picks.join(', ') : t('chat.questionSubmitHint'),
					disabled: !picks.length,
					onSelect: () => answerQuestion(picks.join(', '))
				});
			actions.push({ id: 'cancel', title: t('chat.questionCancel'), desc: t('chat.questionCancelDesc'), onSelect: cancelQuestion });
			return [{ items: options }, { items: actions }];
		}
		if (trayMode === 'slash')
			return [
				{
					items: slashMatches.map((c) => ({
						id: c.command,
						icon: CommandIcon,
						title: c.command,
						mono: true,
						hint: c.args,
						desc: c.description,
						marker: c.marker,
						onSelect: () => (input = c.command + ' ')
					}))
				}
			];
		if (trayMode === 'add') return addSections;
		return [];
	});
	const trayLabel = $derived(
		trayMode === 'question' ? t('chat.questionLabel') : trayMode === 'slash' ? t('chat.slashMenuLabel') : t('chat.addTitle')
	);
	const trayMeta = $derived.by(() => {
		if (trayMode !== 'question' || !question?.questions) return '';
		const n = question.questions.length;
		return [
			// What the MCP server asks, over its form's fields.
			question.name === 'mcp_elicitation' && flow.step === 0 ? question.summary : '',
			currentQ?.header,
			n > 1 ? t('chat.questionProgress', { n: flow.step + 1, m: n }) : '',
			question.subagentId ? t('chat.subagentChip', { id: question.subagentId }) : ''
		]
			.filter(Boolean)
			.join(' · ');
	});
	function closeTray() {
		if (trayMode === 'question') cancelQuestion();
		else if (trayMode === 'slash') slashDismissed = true;
		else showAdd = false;
	}
	function toggleAdd() {
		showAdd = !showAdd;
		if (showAdd) {
			if (modelPopoverVisible) closeModelPopover();
			showApproval = false;
			effortOpen = false;
			el?.focus();
		}
	}
	// Outside clicks close the "+" tray (rows and the "+" button keep focus in
	// the editor via mousedown preventDefault, so they don't count).
	function onComposerFocusOut(e: FocusEvent) {
		if (showAdd && !(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node | null)) showAdd = false;
	}
	// A pending question turns a typed message into its free-form answer.
	function submit() {
		if (!currentQ) return onSubmit();
		const text = input.trim();
		if (!text) return;
		answerQuestion(text);
		input = '';
	}

	// @-mention completion (files + folders). Lazily loads the project file list
	// (cached per cwd) the first time an @-token is typed. Matching logic lives in
	// $lib/mention (pure + unit-tested).
	let atFiles = $state<string[]>([]);
	let atCwd = $state('');
	let atIdx = $state(0);

	const atQuery = $derived.by(() => {
		const m = input.match(/(?:^|\s)@([^\s@]*)$/);
		return m ? m[1] : null;
	});
	$effect(() => {
		if (atQuery === null) return;
		if (atCwd !== chat.cwd) {
			atCwd = chat.cwd;
			atFiles = [];
			listFiles(chat.cwd || undefined)
				.then((f) => {
					if (atCwd === chat.cwd) atFiles = f;
				})
				.catch(() => {});
		}
	});

	const atEntries = $derived(buildEntries(atFiles));

	// Matches are debounced only for large entry sets, so small repos stay instant
	// while big monorepos coalesce rapid keystrokes. Top-K selection in
	// mentionMatches bounds the per-keystroke cost regardless.
	let atMatches = $state<AtEntry[]>([]);
	$effect(() => {
		const q = atQuery;
		const entries = atEntries;
		if (q === null) {
			atMatches = [];
			return;
		}
		if (entries.length > 3000) {
			const t = setTimeout(() => (atMatches = mentionMatches(entries, q)), 40);
			return () => clearTimeout(t);
		}
		atMatches = mentionMatches(entries, q);
	});
	$effect(() => {
		atMatches;
		atIdx = 0;
	});

	// Files complete the token (trailing space); folders append `/` so the menu
	// keeps drilling into their contents. Refocus the textarea so clicks don't
	// strand focus on the menu button.
	function applyAt(entry: AtEntry) {
		const suffix = entry.dir ? '/' : ' ';
		input = input.replace(/(?:^|\s)@([^\s@]*)$/, (full) => {
			const lead = /^\s/.test(full) ? full[0] : '';
			return `${lead}@${entry.path}${suffix}`;
		});
		el?.focus();
	}

	// Active option id for the combobox (aria-activedescendant).
	const activeOptionId = $derived(
		atMatches.length ? `cmp-opt-${atIdx}` : trayMode ? `cmp-tray-opt-${trayIdx}` : undefined
	);
	const menuOpen = $derived(!!trayMode || atMatches.length > 0 || atQuery !== null);

	// Gauge against the auto-compaction limit, so a full ring means "about to
	// compact" (falls back to the window if the engine didn't send a limit).
	// Only lynshen reports a real compaction threshold; claude/codex send limit 0,
	// so we gauge against the raw window. The used side is the whole request
	// when the engine breaks it down (lynshen compacts on that total), else
	// the conversation.
	const ctxAtThreshold = $derived(chat.contextLimit > 0);
	const ctxLimit = $derived(chat.contextLimit || chat.contextWindow);
	const ctxPct = $derived(ctxLimit > 0 ? Math.min(100, Math.round((chat.contextUsed / ctxLimit) * 100)) : 0);
	// Context use shows when settings say so, and in any case once it gets
	// close to the limit, when it becomes something to act on.
	const CTX_SHOW_PCT = 70;
	const showCtx = $derived(bcaps.contextUsage && ctxLimit > 0 && (prefs.footContext || ctxPct >= CTX_SHOW_PCT));
	const showCost = $derived(prefs.footCost && (chat.cost > 0 || !!chat.billing));
	const quota = $derived(planQuota(chat.planUsage));

	function onKey(e: KeyboardEvent) {
		// While an IME is composing (e.g. selecting a Chinese candidate with Enter),
		// don't treat keys as commands — Enter here confirms the candidate, not send.
		if (e.isComposing || e.keyCode === 229) return;
		if (atMatches.length) {
			if (e.key === 'ArrowDown') {
				e.preventDefault();
				atIdx = (atIdx + 1) % atMatches.length;
				return;
			}
			if (e.key === 'ArrowUp') {
				e.preventDefault();
				atIdx = (atIdx - 1 + atMatches.length) % atMatches.length;
				return;
			}
			if (e.key === 'Tab' || e.key === 'Enter') {
				e.preventDefault();
				applyAt(atMatches[atIdx]);
				return;
			}
			if (e.key === 'Escape') {
				e.preventDefault();
				input += ' ';
				return;
			}
		}
		// Tab in an empty editor takes the engine's suggested next prompt.
		if (e.key === 'Tab' && !e.shiftKey && input === '' && chat.suggestion && suggest && !trayMode) {
			e.preventDefault();
			input = chat.suggestion;
			chat.suggestion = '';
			return;
		}
		// The tray owns navigation keys; for a question only while the editor is
		// empty, so a typed answer keeps normal caret keys and Enter sends it.
		if (trayMode && (trayMode !== 'question' || input.trim() === '') && tray?.handleKey(e)) {
			e.stopPropagation();
			return;
		}
		if (bcaps.approvalModes && !chat.agent && matches(e, 'approvalMode')) {
			e.preventDefault();
			cycleApproval();
			return;
		}
		if (e.key === 'Enter') {
			// contenteditable would otherwise insert a <div>/<br>; we control both:
			// plain Enter submits, Shift+Enter inserts a newline (rendered via pre-wrap).
			e.preventDefault();
			if (e.shiftKey) insertTextAtCaret('\n');
			else submit();
		}
	}

	// Pasting (composer/paste.ts). Files copied in Explorer, Finder or a
	// file manager attach by their paths, which only the system clipboard
	// knows; files the page gets only as bytes (an image, a screenshot, a
	// file copied in another app) are written to disk and attach from there.
	// Plain text goes in as text, so no rich HTML lands in the editor.
	function onPaste(e: ClipboardEvent) {
		const dt = e.clipboardData;
		if (!dt) return;
		// Everything is read now: the event's data is gone once it returns.
		const files = [...dt.items].flatMap((it) => (it.kind === 'file' ? [it.getAsFile()].filter((f): f is File => !!f) : []));
		const paste: PasteData = { text: dt.getData('text/plain'), uriList: dt.getData('text/uri-list'), files };
		const route = pasteRoute(paste);
		e.preventDefault();
		if (route === 'text') insertTextAtCaret(paste.text);
		else void pasteFiles(files, paste.uriList);
	}
	async function pasteFiles(files: File[], uriList: string) {
		let paths = await clipboardFilePaths().catch((): string[] => []);
		if (!paths.length) paths = fileUris(uriList);
		if (paths.length) {
			for (const path of paths) onAttach?.(path);
			return;
		}
		for (const file of files) {
			try {
				if (file.size > MAX_PASTE_BYTES) {
					toast.error(t('chat.pasteTooBig', { name: file.name || file.type }));
					continue;
				}
				const bytes = new Uint8Array(await file.arrayBuffer());
				if (file.type.startsWith('image/')) onImage(await saveTempImage(bytes, imageExt(file.type)));
				else onAttach?.(await saveTempFile(bytes, file.name));
			} catch (err) {
				toast.error(t('chat.pasteFailed', { error: String(err) }));
			}
		}
	}

	// Voice input: mic → utterances split at pauses → 16 kHz WAV → ASR (Tauri
	// backend). Each utterance is transcribed while the user keeps talking and
	// appended in order, so text shows up during recording. Auto-stops at 3 min
	// in case the mic is left on.
	let voice = $state<'idle' | 'rec' | 'busy'>('idle');
	let recorder: VoiceRecorder | null = null;
	let voiceLevels = $state<AnalyserNode | null>(null);
	let voiceTimer: ReturnType<typeof setTimeout> | undefined;
	let voiceQueue: Promise<void> = Promise.resolve();
	let voiceFailed = false;

	// Utterances join with a space only between non-CJK text.
	const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/;
	function appendVoice(text: string) {
		if (!text) return;
		const sep = input && !/\s$/.test(input) && !CJK.test(input.slice(-1)) && !CJK.test(text[0]) ? ' ' : '';
		input = input + sep + text;
		el?.focus();
	}

	function transcribeSegment(base64: string) {
		voiceQueue = voiceQueue.then(async () => {
			try {
				appendVoice((await transcribeAudio(base64)).trim());
			} catch (e) {
				// One toast per recording: a bad key fails every utterance.
				if (!voiceFailed) toast.error(String(e));
				voiceFailed = true;
			}
		});
	}

	async function toggleVoice() {
		if (voice === 'busy') return;
		if (voice === 'rec') return stopVoice();
		try {
			const r = new VoiceRecorder(transcribeSegment);
			await r.start();
			recorder = r;
			voiceLevels = r.analyser;
			voiceFailed = false;
			voice = 'rec';
			voiceTimer = setTimeout(stopVoice, 180_000);
		} catch (e) {
			recorder = null;
			toast.error(t('chat.voiceMicError', { error: String(e) }));
		}
	}

	async function stopVoice() {
		if (!recorder) return;
		clearTimeout(voiceTimer);
		recorder.stop();
		recorder = null;
		voiceLevels = null;
		voice = 'busy';
		await voiceQueue;
		voice = 'idle';
	}

</script>

<svelte:window onkeydowncapture={onWindowKeyCapture} />

<div class="composer-wrap" onfocusout={onComposerFocusOut}>
	{#if atQuery !== null}
		<MentionMenu matches={atMatches} query={atQuery} selected={atIdx} onSelect={applyAt} onHover={(i) => (atIdx = i)} />
	{/if}
	{#if attachments.length || videos.length}
		<AttachmentChips
			{attachments}
			{videos}
			onRemove={(i) => attachments.splice(i, 1)}
			onRemoveVideo={(i) => videos.splice(i, 1)}
		/>
	{/if}
	{#if chat.approvalPending && chat.busy}
		<!-- The engine applies the picked mode only from the next turn. -->
		<div class="queued">
			<span class="queued-label">{t('chat.modePending', { mode: APPROVAL_MODES[chat.approvalPending]?.label ?? chat.approvalPending })}</span>
			<button class="qsteer" onclick={onStop}>{t('chat.modeApplyNow')}</button>
		</div>
	{/if}
	{#if chat.steering && chat.busy}
		<!-- Taken from the queue into the running turn: it shows in the
		     conversation once the engine reads it, after a running tool. -->
		<div class="queued">
			<span class="queued-label">{t(chat.phase === 'tool' ? 'chat.steeringWait' : 'chat.steeringNow')}</span>
			<span class="qchip" title={sentLabel(chat.steering)}><span class="qtext">{sentLabel(chat.steering)}</span></span>
		</div>
	{/if}
	{#if chat.pendingMessages.length}
		<div class="queued">
			<span class="queued-label">{t('chat.queuedLabel', { n: chat.pendingMessages.length })}</span>
			{#each chat.pendingMessages as q, i (i)}
				<span class="qchip" title={sentLabel(q)}
					><span class="qtext">{sentLabel(q)}</span
					>{#if bcaps.unqueue && onUnqueue && engineAtLeast(UNQUEUE_SINCE)}<button
							class="qtake"
							onclick={() => onUnqueue(i, q)}
							title={t('chat.unqueueTitle')}
							aria-label={t('chat.unqueueTitle')}><ArrowUUpLeftIcon size={11} /></button
						>{/if}</span
				>
			{/each}
			{#if bcaps.steer}
				<button class="qsteer" onclick={onSteer} title={t('chat.steerTitle')}><FastForwardIcon size={12} />{t('chat.steerAction')}</button>
			{/if}
		</div>
	{/if}
	<div class="composer">
		{#if trayMode}
			<ComposerTray
				bind:this={tray}
				bind:selected={trayIdx}
				label={trayLabel}
				heading={trayMode === 'question' ? (currentQ?.question ?? '') : ''}
				meta={trayMeta}
				sections={traySections}
				tab={trayMode === 'slash' ? 'pick' : trayMode === 'add' ? 'close' : 'none'}
				onClose={closeTray}
			/>
		{/if}
		<!-- The box holds only the text and, at its right end, voice and send. -->
		<div class="inrow">
			<div
				class="rich"
				class:empty={input === ''}
				bind:this={el}
				contenteditable="true"
				role="combobox"
				tabindex="0"
				aria-label={t(currentQ ? 'chat.questionPlaceholder' : chat.isChatMode ? 'chat.chatPlaceholder' : 'chat.composerPlaceholder')}
				data-placeholder={chat.suggestion && suggest && !currentQ
					? t('chat.suggestionPlaceholder', { text: chat.suggestion })
					: t(currentQ ? 'chat.questionPlaceholder' : chat.isChatMode ? 'chat.chatPlaceholder' : 'chat.composerPlaceholder')}
				oninput={syncFromDom}
				onkeydown={onKey}
				onpaste={onPaste}
				oncompositionstart={() => (composing = true)}
				oncompositionend={() => {
					composing = false;
					syncFromDom();
				}}
				aria-expanded={menuOpen}
				aria-controls={atQuery !== null ? 'composer-menu' : 'cmp-tray'}
				aria-autocomplete="list"
				aria-activedescendant={activeOptionId}
			></div>
			<div class="box-acts">
				{#if voiceLevels}<VoiceWave analyser={voiceLevels} />{/if}
				<button
					class="cact voice"
					class:on={voice === 'rec'}
					class:pulse={voice === 'rec'}
					onclick={toggleVoice}
					disabled={voice === 'busy'}
					aria-label={t('chat.voiceTitle')}
					title={voice === 'rec' ? t('chat.voiceStopTitle') : voice === 'busy' ? t('chat.voiceBusyTitle') : t('chat.voiceTitle')}
				>
					{#if voice === 'busy'}<CircleNotchIcon size={14} class="spin" />{:else if voice === 'rec'}<StopCircleIcon size={16} />{:else}<MicrophoneIcon size={16} />{/if}
				</button>
				{#if chat.busy && !currentQ}
					<button class="cact stop" onclick={onStop} aria-label={t('chat.stopTitle')} title={withShortcut(t('chat.stopTitle'), 'stop')}><SquareIcon size={12} weight="fill" /></button>
				{:else}
					<button class="cact send" onclick={submit} disabled={!input.trim() && !attachments.length && !videos.length} aria-label={t('chat.sendTitle')} title={t('chat.sendTitle')}><ArrowUpIcon size={14} weight="bold" /></button>
				{/if}
			</div>
		</div>
	</div>
	<!-- One slim row under the box: add · mode · branch | model · effort · context. -->
	<div class="composer-foot">
		<button
			class="fbtn add"
			class:on={showAdd}
			disabled={!!currentQ}
			onmousedown={(e) => e.preventDefault()}
			onclick={toggleAdd}
			aria-label={t('chat.addTitle')}
			title={t('chat.addTitle')}
			aria-expanded={showAdd}
		>
			<PlusIcon size={16} />
		</button>
		{#if bcaps.approvalModes}
			<span class="anchor">
				<button
					class="fbtn mode"
					class:on={showApproval}
					class:warn={approvalCurrent.tone === 'warn'}
					onclick={toggleApproval}
					title={withShortcut(t('chat.approvalModeTitle'), 'approvalMode')}
					aria-haspopup="menu"
					aria-expanded={showApproval}
				>{approvalCurrent.label}<CaretDownIcon size={12} class="car" /></button>
				{#if showApproval}
					<ModeMenu
						items={APPROVAL}
						current={chat.approvalMode}
						note={modeNote}
						disabled={!!chat.agent}
						onSelect={setApproval}
						onCycle={cycleApproval}
						onClose={() => (showApproval = false)}
					/>
				{/if}
			</span>
		{/if}
		{#if isolationNote}
			<span class="fbtn static isolation" role="note" title={isolationNote} aria-label={isolationNote}>
				<ShieldSlashIcon size={13} aria-hidden="true" /><span class="iso-label">{t('chat.sandbox.open')}</span>
			</span>
		{/if}
		{#if gitBranch}
			<!-- Switching under a running turn would change its files mid-edit. -->
			<span class="anchor branch-anchor">
				<button
					class="fbtn branch"
					class:on={branchOpen}
					disabled={!gitCwd || chat.busy}
					title={chat.busy ? t('chat.branchMenu.busy') : t('chat.gitBranch')}
					onclick={() => (branchOpen = !branchOpen)}
				><GitBranchIcon size={13} /><span class="branch-name">{gitBranch}</span></button>
				{#if branchOpen && gitCwd}
					<BranchMenu
						cwd={gitCwd}
						repo={repoName}
						current={gitBranch}
						onChanged={() => onBranchChanged?.()}
						onClose={() => (branchOpen = false)}
					/>
				{/if}
			</span>
		{/if}
		<div class="fspace"></div>
		{#if chat.efforts.length || bcaps.modelPicker || !backendLocked || gateway !== null}
			<!-- The model button opens the model menu (agent, model, effort, provider). -->
			<button
				class="fbtn model"
				class:on={modelPopoverVisible}
				class:pending={effortDisabled}
				bind:this={modelButton}
				onclick={toggleModelPopover}
				title={withShortcut(t('chat.switchModel'), 'model')}
				aria-haspopup="dialog"
				aria-expanded={modelPopoverVisible}
			>
				{#key chat.model}
					<span class="mswap">
						{#if chat.backendId !== 'lynshen'}<BackendIcon backend={chat.backendId} size={14} />{/if}
						<span class="m">{modelDisplayName || stripGroupSuffix(chat.modelLabel || '') || chat.model || backendLabel}</span>
					</span>
				{/key}
				{#if chat.ultracode}<span class="u">Ultracode</span>{/if}
				<CaretDownIcon size={12} class="car" />
			</button>
		{:else if chat.model}
			<span class="fbtn model static"
				><BackendIcon backend={chat.backendId} size={14} /><span class="m">{modelDisplayName || stripGroupSuffix(chat.modelLabel || '') || chat.model}</span></span
			>
		{/if}
		{#if modelPopoverVisible}
			<ModelMenu
				{chat}
				canPickModel={bcaps.modelPicker}
				rows={bcaps.modelPicker ? modelRows : []}
				{backendLocked}
				{toolProvider}
				{gateway}
				{effortDisabled}
				anchor={modelButton}
				onClose={closeModelPopover}
				onSelect={selectFromPopover}
				onEffort={setEffort}
				{onSwitch}
				{onBackend}
				onRefreshModels={() => onModel()}
			/>
		{/if}
		{#if chat.efforts.length}
			<span class="anchor">
				<button
					class="fbtn effort"
					class:on={effortOpen}
					class:pending={effortDisabled}
					onclick={toggleEffort}
					title={t('chat.effortTitle')}
					aria-haspopup="dialog"
					aria-expanded={effortOpen}
				>
					{#key chat.effort}<span
							class="e"
							class:effort-max={isTopEffort(chat.effort, chat.efforts)}
							style:--effort-accent={modelColor(chat.model) || 'var(--text)'}>{effortLabel(chat.effort) || t('chat.effortTitle')}</span
						>{/key}<CaretDownIcon size={12} class="car" />
				</button>
				{#if effortOpen}
					<EffortMenu
						efforts={chat.efforts}
						effort={chat.effort}
						disabled={effortDisabled}
						accent={modelColor(chat.model)}
						onEffort={setEffort}
						onClose={() => (effortOpen = false)}
					/>
				{/if}
			</span>
		{/if}
		{#if foot}{@render foot()}{/if}
		{#if showCost}<span class="foot-cost" title={t('chat.cost')}>{costText(chat.cost, chat.billing)}</span>{/if}
		{#if showCtx}
			<ContextIndicator
				used={chat.contextUsed}
				window={chat.contextWindow}
				limit={ctxLimit}
				pct={ctxPct}
				atThreshold={ctxAtThreshold}
				parts={chat.requestParts}
				breakdown={chat.contextBreakdown}
				onBreakdown={bcaps.contextBreakdown ? onContextBreakdown : undefined}
				cacheHitRate={chat.cacheHitRate}
				{quota}
				totalIn={chat.totalIn}
				totalOut={chat.totalOut}
				runMs={chat.runMs}
				cost={chat.cost}
				billing={chat.billing}
				billingError={chat.billingError}
			/>
		{/if}
	</div>
</div>

<style>
	/* Lines up with the conversation column (ChatPane's --chat-w). */
	.composer-wrap {
		padding: 0 var(--chat-pad, 32px) 12px;
		max-width: calc(var(--chat-w, 844px) + 2 * var(--chat-pad, 32px));
		width: 100%;
		margin: 0 auto;
	}
	/* The box (design.md, "Workbench canvas"): --panel, a 1px --border,
	   --r-2xl and --shadow-float. Focus turns the border --border-strong: no
	   glow, no larger shadow. */
	.composer {
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-2xl);
		padding: 0 10px 0 0;
		box-shadow: var(--shadow-float);
		transition: border-color var(--t-fast) var(--ease-base);
	}
	.composer:focus-within {
		border-color: var(--border-strong);
	}
	/* Text on the left, voice and send at the right end, bottom-aligned so
	   they stay put while a long message grows the box. */
	.inrow {
		display: flex;
		align-items: flex-end;
		gap: 8px;
	}
	.rich {
		position: relative;
		flex: 1;
		min-width: 0;
		align-self: center;
		min-height: 48px;
		max-height: 240px;
		overflow-y: auto;
		border: none;
		outline: none;
		background: transparent;
		color: var(--text);
		font-family: var(--font-sans);
		font-size: var(--fs-md);
		line-height: 24px;
		padding: 12px 14px;
		white-space: pre-wrap;
		overflow-wrap: break-word;
		word-break: break-word;
		cursor: text;
	}
	/* One line, cut short in a narrow box; laid over the caret's line. */
	.rich.empty::before {
		content: attr(data-placeholder);
		position: absolute;
		left: 14px;
		right: 14px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--dim2);
		pointer-events: none;
	}
	/* Web-element reference chip: atomic (contenteditable=false), deletes as a unit.
	   Chips are created in JS, so Svelte's scoped hash never lands on them — style
	   them via :global, kept namespaced under the scoped .rich. */
	.rich :global(.refchip) {
		display: inline;
		white-space: normal;
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-radius: var(--r-xs);
		padding: 1px 6px 1px 5px;
		margin: 0 1px;
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--accent) 35%, transparent);
		font-size: var(--fs-sm);
		-webkit-user-select: none;
		user-select: none;
		cursor: default;
	}
	.rich :global(.refchip.imgchip) {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 1px 6px 1px 2px;
		vertical-align: -3px;
		color: var(--text);
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border-strong);
	}
	.rich :global(.refchip.imgchip img) {
		width: 18px;
		height: 18px;
		border-radius: 3px;
		object-fit: cover;
		cursor: zoom-in;
	}
	/* A quoted passage: the opening words after a quote mark. */
	.rich :global(.refchip.quotechip) {
		color: var(--dim);
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
		padding: 1px 7px 1px 6px;
	}
	.rich :global(.refchip.quotechip)::before {
		content: '';
		display: inline-block;
		width: 11px;
		height: 11px;
		margin-right: 5px;
		vertical-align: -1px;
		background: var(--dim2);
		mask: var(--quote-mask) center / contain no-repeat;
	}
	.rich :global(.refchip:not(.imgchip):not(.quotechip))::before {
		content: '🌐';
		margin-right: 3px;
		font-size: var(--fs-2xs);
	}
	/* Voice and send: 28px, round, on the first line's centre. */
	.box-acts {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
		margin-bottom: 10px;
	}
	.cact {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		padding: 0;
		border-radius: var(--r-full);
		border: none;
		cursor: pointer;
		flex-shrink: 0;
		transition:
			transform var(--t-fast) var(--ease-spring),
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			opacity var(--t-med) var(--ease-out);
	}
	.cact:active:not(:disabled) {
		transform: scale(0.9);
	}
	/* Flat send: the accent when ready, quiet gray when there's nothing to send. */
	.cact.send {
		background: var(--accent);
		color: var(--on-accent);
	}
	.cact.send:hover:not(:disabled) {
		background: var(--accent-bright);
	}
	.cact.send:disabled {
		background: color-mix(in oklab, var(--text) 18%, var(--panel));
		color: var(--panel);
		cursor: default;
	}
	/* Stop while a turn runs: same place and size as send. */
	.cact.stop {
		background: var(--accent);
		color: var(--on-accent);
	}
	.cact.stop:hover {
		background: var(--accent-bright);
	}
	/* Voice: a plain icon until it records. */
	.cact.voice {
		background: none;
		color: var(--dim);
	}
	.cact.voice:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.cact.voice.on {
		color: var(--err);
		background: color-mix(in oklab, var(--err) 12%, transparent);
	}
	.cact.voice:disabled {
		cursor: default;
		color: var(--dim2);
	}

	/* ---------- footer row (outside the box, edges aligned with it) ---------- */
	.composer-foot {
		display: flex;
		align-items: center;
		gap: 2px;
		min-width: 0;
		margin-top: 6px;
		white-space: nowrap;
	}
	.anchor {
		position: relative;
		display: inline-flex;
		min-width: 0;
	}
	/* Every footer control is a text dropdown: 28px, --fs-xs, --dim, a
	   --surface2 fill on hover, no border. */
	.fbtn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		height: 28px;
		padding: 0 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font-family: var(--font-sans);
		font-size: var(--fs-xs);
		line-height: 16px;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-base),
			color var(--t-fast) var(--ease-base);
	}
	.fbtn :global(.car) {
		flex-shrink: 0;
		color: var(--dim2);
	}
	.fbtn:hover:not(:disabled):not(.static),
	.fbtn.on {
		background: var(--surface2);
		color: var(--text);
	}
	.fbtn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.fbtn.static {
		cursor: default;
	}
	/* The first and last controls sit on the box's edges. */
	.fbtn.add {
		width: 28px;
		padding: 0;
		justify-content: center;
	}
	.fbtn.mode.warn {
		color: var(--warn);
	}
	/* Commands without isolation: quiet, the icon in the caution colour. */
	.fbtn.isolation {
		flex-shrink: 1;
		gap: 4px;
		padding: 0 4px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.fbtn.isolation > :global(svg) {
		flex: none;
		color: var(--warn);
	}
	.iso-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fbtn.branch {
		gap: 4px;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.fbtn.branch:disabled {
		opacity: 1;
	}
	.branch-name {
		max-width: 160px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.foot-cost {
		flex: none;
		padding: 0 8px;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}
	.branch-anchor {
		flex-shrink: 1;
	}
	.fspace {
		flex: 1;
		min-width: 8px;
	}
	.fbtn.model {
		flex-shrink: 1;
	}
	.fbtn.model .m {
		min-width: 0;
		max-width: 240px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.fbtn.model .u {
		flex-shrink: 0;
		color: var(--dim2);
	}
	.mswap {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		animation: model-in var(--t-med) var(--ease-out);
	}
	@keyframes model-in {
		from {
			opacity: 0;
			transform: translateY(4px);
		}
	}
	.fbtn.pending {
		opacity: 0.6;
	}
	.fbtn.effort .e {
		animation: rise var(--t-fast) var(--ease-out);
	}

	.queued {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.queued-label {
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-radius: var(--r-full);
		padding: 2px 9px;
		flex-shrink: 0;
	}
	.qchip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: var(--fs-xs);
		max-width: 260px;
		color: var(--dim);
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		padding: 3px 9px;
		animation: rise var(--t-med) var(--ease-out);
	}
	.qtext {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.qtake {
		display: inline-flex;
		flex-shrink: 0;
		margin: -2px -5px -2px 0;
		padding: 2px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out), background var(--t-fast) var(--ease-out);
	}
	.qtake:hover {
		color: var(--text);
		background: var(--surface2);
	}
	.qsteer {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin-left: auto;
		font-size: var(--fs-xs);
		color: var(--accent-bright);
		background: none;
		border: 1px solid color-mix(in oklab, var(--accent) 40%, transparent);
		border-radius: var(--r-sm);
		padding: 3px 9px;
		cursor: pointer;
		flex-shrink: 0;
		transition: background var(--t-fast) var(--ease-out), transform var(--t-fast) var(--ease-out);
	}
	.qsteer:hover {
		background: var(--accent-soft);
	}
	.qsteer:active {
		transform: scale(0.97);
	}
</style>
