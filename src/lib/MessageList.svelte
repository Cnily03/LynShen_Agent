<script lang="ts">
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import FileTextIcon from 'phosphor-svelte/lib/FileTextIcon';
	import { fade } from 'svelte/transition';
	import Markdown from '$lib/Markdown.svelte';
	import ReasoningBody from '$lib/ReasoningBody.svelte';
	import Collapse from '$lib/ui/Collapse.svelte';
	import ToolCard from '$lib/ToolCard.svelte';
	import SubagentCard from '$lib/agents/SubagentCard.svelte';
	import AttemptGroupCard from '$lib/agents/AttemptGroupCard.svelte';
	import AgentMessageLine from '$lib/agents/AgentMessageLine.svelte';
	import EscalationLine from '$lib/sandbox/EscalationLine.svelte';
	import PlanCard, { type PlanAction } from '$lib/PlanCard.svelte';
	import CompactionCard from '$lib/CompactionCard.svelte';
	import RecapReceipt from '$lib/RecapReceipt.svelte';
	import type { ApprovalMode } from '$lib/approval';
	import { attemptGroups, SPAWN_TOOLS, spawnAgentRow, WAIT_TOOLS, type AgentRow } from '$lib/agentProgress';
	import type { OpenHow } from '$lib/agents/subagentPages.svelte';
	import DeliveryNotice from '$lib/DeliveryNotice.svelte';
	import { parseDelivery } from '$lib/delivery';
	import { sendCardProps, sendCardView, type SessionMessageView } from '$lib/sessions/sessionMessage';
	import { ReplyStream, finishedBlocks, type Block } from '$lib/streamBlocks';
	import { parseToolOutput, toolIcon, toolTarget, toolVerb } from '$lib/toolSummary';
	import Indicator from '$lib/Indicator.svelte';
	import CallTimer from '$lib/CallTimer.svelte';
	import RetryNotice from '$lib/RetryNotice.svelte';
	import ErrorNotice from '$lib/ErrorNotice.svelte';
	import type { ErrorAction } from '$lib/errorInfo';
	import { t } from '$lib/i18n';
	import type { CallTiming, Msg, RetryState } from '$lib/chat.svelte';
	import { prefs } from '$lib/prefs.svelte';
	import { fmtDur, turnParts } from '$lib/turnStats';
	import { SvelteSet } from 'svelte/reactivity';
	import UserImage from '$lib/UserImage.svelte';
	import SentFiles from '$lib/SentFiles.svelte';
	import { copyableText, splitAttachments } from '$lib/attachments';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import QuotesIcon from 'phosphor-svelte/lib/QuotesIcon';
	import ListPlusIcon from 'phosphor-svelte/lib/ListPlusIcon';
	import { copyText } from '$lib/clipboard';
	import { lastTurnStart, turnEnds, turnText } from '$lib/turnText';
	import { contextItems, type ContextItem } from '$lib/ui/contextMenu';
	import { streamText } from '$lib/streamText';
	import type { PlainSource } from '$lib/streamPlain';
	import { hasText, liveRead } from '$lib/liveText';

	let {
		messages,
		streamingMsg,
		streamingReasoning,
		phase,
		call = null,
		compactionTokens = 0,
		retry = null,
		autoRetry = null,
		onAutoRetryNow,
		onAutoRetryCancel,
		findActive = null,
		scroller = null,
		onEdit,
		onCite,
		onNote,
		onRewind,
		onFile,
		onAttachment,
		onDismiss,
		backend = '',
		provider = '',
		onErrorAction,
		traceOf,
		agents,
		onOpenAgent,
		onAgentChanges,
		onChanges,
		onMergeAgent,
		onStopAgent,
		onPickAttempt,
		attemptPicks = {},
		onPlan,
		onOpenPlan,
		planMode = 'edits',
		loadImage,
		sendOf,
		onOpenSession,
		mark = $bindable(-1)
	}: {
		messages: Msg[];
		streamingMsg: Msg | null;
		streamingReasoning: Msg | null;
		phase: string | null;
		/** The model request in flight, timed live (see CallTiming). */
		call?: CallTiming | null;
		compactionTokens?: number;
		/** A failed model request being re-sent: shown instead of the phase. */
		retry?: RetryState | null;
		/** The app's retry of a failed turn, waiting (autoRetry.ts). */
		autoRetry?: RetryState | null;
		onAutoRetryNow?: () => void;
		onAutoRetryCancel?: () => void;
		findActive?: number | null;
		// The scroll viewport (owned by +page). When provided and the history is
		// long, rows outside the viewport are windowed out.
		scroller?: HTMLElement | null;
		onEdit: (text: string) => void;
		/** Quote text selected in a reply into the composer. */
		onCite?: (text: string) => void;
		/** Notes the selected passage as a requirement (offered beside quoting). */
		onNote?: (text: string) => void;
		onRewind: (text: string, userIndex: number) => void;
		/** Open a workspace file referenced by a chat link (editor / browser). */
		/** A file link in a message; `context` is that message's text. */
		onFile?: (href: string, context?: string) => void;
		/** Opens a file a user message sent (absent: its chip only shows it). */
		onAttachment?: (path: string, files: string[]) => void;
		/** Remove a message the user closed (error notices). */
		onDismiss?: (m: Msg) => void;
		/** The session's engine, for reading its errors. */
		backend?: string;
		/** The LynShen engine's provider (see ErrorNotice). */
		provider?: string;
		/** An error notice's fix (restart, sign in, compact …). */
		onErrorAction?: (action: ErrorAction) => void;
		/** A tool call whose run the agent trace shows (claude's Agent / Workflow). */
		traceOf?: (m: Msg) => { label: string; run: () => void } | null;
		/** The conversation's subagents: spawn and wait calls render as their
		 *  cards (absent: plain tool rows). */
		agents?: AgentRow[];
		/** Shows a subagent's own conversation. */
		onOpenAgent?: (row: AgentRow, how: OpenHow) => void;
		/** Shows a worktree subagent's changes. */
		onAgentChanges?: (row: AgentRow) => void;
		/** Merges a worktree subagent's changes into the project, or drops them. */
		onMergeAgent?: (row: AgentRow, action: 'apply' | 'discard') => void;
		/** Stops a subagent still at work (close_agent). */
		onStopAgent?: (row: AgentRow) => void;
		/** Best-of-N: merges the attempt picked, discards the others. */
		onPickAttempt?: (group: string, row: AgentRow) => void;
		/** The attempt picked in each group (ChatState.attemptPicks). */
		attemptPicks?: Record<string, string>;
		/** Approves or revises a proposed plan (absent: plans have no actions). */
		onPlan?: (id: string, action: PlanAction) => void;
		/** The mode a plan's approval offers first. */
		/** Shows a plan in its page beside the chat. */
		onOpenPlan?: (id: string) => void;
		planMode?: ApprovalMode;
		/** Reads a sent image where the desktop can't open its path (the remote page). */
		loadImage?: (path: string) => Promise<string>;
		/** The message a send_to_session call sent (ChatState.sendOf). */
		sendOf?: (callId: string) => SessionMessageView | undefined;
		/** Opens a conversation by its session id (another conversation's
		 *  message opens the one it came from). */
		onOpenSession?: (session: string) => void;
		/** Ordinal of the user message in view: at or above the upper third. */
		mark?: number;
		/** Opens the Changes panel: a turn's change pill (absent: the files
		 *  it changed show as text). */
		onChanges?: () => void;
	} = $props();

	// ── Virtual list (dynamic-height windowing) ─────────────────────────────
	// Only long histories are windowed; short conversations render in full so the
	// streaming/auto-scroll path is completely untouched. Heights are measured per
	// message (cached by object identity) with an estimate for not-yet-seen rows.
	const VIRTUAL_MIN = 40; // messages before windowing engages
	const EST_ROW = 120; // px estimate for an unmeasured row
	const GAP = 16; // px, matches .list gap
	const OVERSCAN = 800; // px rendered beyond the viewport on each side

	// Weak: a replaced transcript's messages are not kept alive by their heights.
	const heights = new WeakMap<Msg, number>();
	let measureVersion = $state(0);
	let scrollTop = $state(0);
	let viewH = $state(0);
	let atEnd = $state(true);
	// The list's top within the scroller's content (the scroller's padding).
	let listTop = $state(0);
	let listEl: HTMLElement;
	let raf = 0;

	// Track the viewport's scroll position + height.
	$effect(() => {
		const el = scroller;
		if (!el) return;
		const sync = () => {
			scrollTop = el.scrollTop;
			viewH = el.clientHeight;
			atEnd = el.scrollHeight - el.scrollTop - el.clientHeight < 8;
			cite = null;
			listTop = listEl.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
		};
		sync();
		el.addEventListener('scroll', sync, { passive: true });
		const ro = new ResizeObserver(sync);
		ro.observe(el);
		return () => {
			el.removeEventListener('scroll', sync);
			ro.disconnect();
		};
	});

	const virtual = $derived(!!scroller && messages.length >= VIRTUAL_MIN);

	// Cumulative top offset of each row (offsets[i] = top of row i, offsets[n] = end).
	const offsets = $derived.by(() => {
		measureVersion; // recompute when a measurement lands
		const offs = new Array(messages.length + 1);
		offs[0] = 0;
		for (let i = 0; i < messages.length; i++) {
			const m = messages[i];
			// Unshown placeholders occupy no row (and no gap).
			const h = shown(m) ? (heights.get(m) ?? EST_ROW) + GAP : 0;
			offs[i + 1] = offs[i] + h;
		}
		return offs;
	});
	const totalH = $derived(offsets[messages.length] ?? 0);

	// [first, last] inclusive window of rows to render.
	const range = $derived.by(() => {
		if (!virtual) return { first: 0, last: messages.length - 1 };
		const top = scrollTop - OVERSCAN;
		const bottom = scrollTop + viewH + OVERSCAN;
		let first = 0;
		while (first < messages.length && offsets[first + 1] < top) first++;
		let last = first;
		while (last < messages.length - 1 && offsets[last] < bottom) last++;
		return { first, last };
	});
	const windowRows = $derived(messages.slice(range.first, range.last + 1));
	const padTop = $derived(virtual ? offsets[range.first] : 0);
	const padBottom = $derived(virtual ? Math.max(0, totalH - offsets[range.last + 1]) : 0);

	// Measure a rendered row and cache its height, coalescing recomputes into one rAF.
	function measure(node: HTMLElement, msg: Msg) {
		const record = () => {
			const h = node.offsetHeight;
			if (h > 0 && heights.get(msg) !== h) {
				heights.set(msg, h);
				if (!raf)
					raf = requestAnimationFrame(() => {
						raf = 0;
						measureVersion++;
					});
			}
		};
		record();
		const ro = new ResizeObserver(record);
		ro.observe(node);
		return {
			update(next: Msg) {
				msg = next;
				record();
			},
			destroy() {
				ro.disconnect();
			}
		};
	}

	// Scroll the current find hit into view. Under windowing the row may be unrendered,
	// so scroll the viewport to the row's computed offset (which brings it into range).
	$effect(() => {
		if (findActive == null) return;
		if (virtual && scroller) {
			scroller.scrollTo({ top: Math.max(0, offsets[findActive] - viewH / 2), behavior: 'smooth' });
		} else {
			rowEls[findActive]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
	});
	let rowEls: (HTMLElement | null)[] = [];

	// Index in `messages` of each message the user wrote, in order: the rail's marks.
	const markRows = $derived(messages.flatMap((m, i) => (m.kind === 'user' && !parseDelivery(m.text) ? [i] : [])));
	$effect(() => {
		const rows = markRows;
		if (atEnd) {
			mark = rows.length - 1;
			return;
		}
		const line = scrollTop + viewH / 3 - listTop;
		let n = 0;
		while (n + 1 < rows.length && offsets[rows[n + 1]!]! <= line) n++;
		mark = rows.length ? n : -1;
	});

	/** Scroll mark `n`'s message to the top of the viewport. */
	export function jumpToMark(n: number) {
		const i = markRows[n];
		if (i === undefined || !scroller) return;
		const el = scroller;
		const alignRow = (behavior: ScrollBehavior) => {
			const row = rowEls[i];
			if (!row?.isConnected) return false;
			const top = el.scrollTop + row.getBoundingClientRect().top - el.getBoundingClientRect().top - 16;
			el.scrollTo({ top, behavior });
			return true;
		};
		if (alignRow('smooth')) return;
		// Windowed out: go to its estimated offset, which renders it, then align
		// on the real row once it has been measured.
		el.scrollTo({ top: listTop + offsets[i]! - 16 });
		requestAnimationFrame(() => requestAnimationFrame(() => alignRow('auto')));
	}

	// Map each user message to its 0-based ordinal so a rewind can target the
	// matching engine turn (the engine lists user turns in the same order).
	const userOrdinal = $derived.by(() => {
		const map = new Map<Msg, number>();
		let n = 0;
		for (const m of messages) if (m.kind === 'user') map.set(m, n++);
		return map;
	});

	// Selecting text in the replies (or their reasoning) offers to quote it;
	// a selection may run across several replies.
	let cite = $state<{ text: string; x: number; top: number; bottom: number } | null>(null);
	const replyOf = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest('.answer, .reason-body');
	function offerCite() {
		const sel = window.getSelection();
		const text = sel?.toString().trim();
		if (!onCite || !sel || sel.isCollapsed || !text) return;
		const range = sel.getRangeAt(0);
		const from = replyOf(range.startContainer);
		const to = replyOf(range.endContainer);
		if (!from || !to || !listEl.contains(from) || !listEl.contains(to)) return;
		const r = range.getBoundingClientRect();
		cite = { text, x: r.left + r.width / 2, top: r.top, bottom: r.bottom };
	}
	function takeCite(to: ((text: string) => void) | undefined = onCite) {
		if (!cite) return;
		to?.(cite.text);
		window.getSelection()?.removeAllRanges();
		cite = null;
	}

	// Copying: a user message's text, or a whole turn's replies (every
	// assistant message since the user's, as Markdown) from the button on the
	// turn's last reply or the reply's context menu. The turn still running
	// offers neither.
	const liveFrom = $derived(streamingMsg || streamingReasoning || phase ? lastTurnStart(messages) : messages.length);
	// Up to the running turn only (it offers no copy): its reply's text is
	// not read on every delta.
	const ends = $derived(turnEnds(messages, liveFrom));
	let copied = $state<Msg | null>(null);
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;
	async function copy(text: string, mark: Msg | undefined) {
		if (!text || !(await copyText(text)) || !mark) return;
		copied = mark;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = null), 1400);
	}
	function copyTurn(i: number) {
		let end: Msg | undefined;
		for (let j = i; j < messages.length && messages[j]!.kind !== 'user'; j++) if (ends.has(messages[j]!)) end = messages[j];
		return copy(turnText(messages, i), end);
	}
	function turnMenu(i: number): ContextItem[] {
		if (i >= liveFrom || !turnText(messages, i)) return [];
		return [{ key: 'copy-turn', label: t('chat.copyTurn'), run: () => copyTurn(i) }];
	}

	// A sent message's state shows on its bubble; the bottom indicator would
	// say the same thing ("connecting"), so it stays quiet meanwhile.
	const sendingShown = $derived.by(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const m = messages[i]!;
			if (m.kind === 'user') return !!m.state && m.state !== 'failed';
		}
		return false;
	});
	// A running compaction card says it all; the line below it would repeat it.
	const compactionCard = $derived(messages.findLast((m) => m.kind !== 'system')?.kind === 'compaction');
	const shownPhase = $derived(
		(sendingShown && (phase === 'connecting' || phase === 'waiting')) || (phase === 'compacting' && compactionCard) ? null : phase
	);

	// Smoothing buffer: SSE deltas arrive in big bursts every few seconds, which
	// reads as jerky chunk-by-chunk output. Reveal the received text at an adaptive
	// pace so it flows continuously. `shown` chases the active message's length with
	// a proportional controller (speed grows with backlog, floored so it never
	// stalls while content is pending), integrated over real time.
	const REVEAL_TAU = 0.5; // s — backlog time constant (higher = smoother, more lag)
	const MIN_CPS = 60; // chars/s floor while streaming
	let shownChars = $state(0);
	let smoothing: Msg | null = null;
	const active = $derived<Msg | null>(streamingMsg ?? streamingReasoning);
	const textOf = (m: Msg | null) => (m && 'text' in m ? m.text : '');

	$effect(() => {
		if (!active) {
			shownChars = 0;
			smoothing = null;
			reply = null;
			return;
		}
		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const cur = streamingMsg ?? streamingReasoning;
			if (!cur) return;
			if (cur !== smoothing) {
				smoothing = cur;
				shownChars = 0;
				last = now;
			}
			const len = textOf(cur).length;
			const dt = Math.min(0.1, (now - last) / 1000);
			last = now;
			const pending = len - shownChars;
			if (pending > 0) {
				const cps = Math.max(MIN_CPS, pending / REVEAL_TAU);
				shownChars = Math.min(len, shownChars + cps * dt);
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	});

	/** Text to show for a message — the smoothed reveal of the one currently
	 *  streaming — as a length and a reader for part of it, which reads the
	 *  streaming message from its deltas (liveText.ts): slicing its text would
	 *  copy all of it on every delta. */
	function shownText(m: Msg): PlainSource {
		const text = textOf(m);
		return { length: m === active ? Math.min(text.length, Math.floor(shownChars)) : text.length, read: liveRead(m, text) };
	}

	/** The end of streaming reasoning as one line: enough to overflow the
	 *  widest pane, so the line always ends at the newest word. */
	function reasoningTail(m: Msg): string {
		const { length, read } = shownText(m);
		return read(Math.max(0, length - 240), length).replace(/\s+/g, ' ').trimStart();
	}

	// Incremental streaming markdown: render completed blocks as markdown (each
	// chunk once, keyed) and the in-progress tail block as plain text. Per-frame
	// cost tracks what the frame reveals and the current block, not the whole
	// message (ReplyStream). The split never lands inside an open code fence.
	let reply: { m: Msg; stream: ReplyStream } | null = null;
	function streamingReply(m: Msg) {
		if (reply?.m !== m) reply = { m, stream: new ReplyStream() };
		const { length, read } = shownText(m);
		return reply.stream.update(length, read);
	}

	// A finished reply renders as the chunks it streamed in (finishedBlocks),
	// not as one document: the chunks rendered while it streamed stay as they
	// are, and only its tail renders as it finishes. Rendering it whole again
	// then cost time and memory that grew with the reply.
	const finished = new WeakMap<Msg, { text: string; blocks: Block[] }>();
	function replyBlocks(m: Msg & { text: string }): Block[] {
		const text = m.text;
		const done = finished.get(m);
		if (done?.text === text) return done.blocks;
		const blocks = finishedBlocks(text);
		finished.set(m, { text, blocks });
		return blocks;
	}

	// A user message's text split into runs of "> " quote lines (quoted
	// passages, shown as quotes) and the text between.
	function userBlocks(text: string): { text: string; quote: boolean }[] {
		const out: { text: string; quote: boolean }[] = [];
		for (const line of text.split('\n')) {
			const quote = /^>( |$)/.test(line);
			const last = out[out.length - 1];
			const body = quote ? line.replace(/^> ?/, '') : line;
			if (last?.quote === quote) last.text += `\n${body}`;
			else out.push({ text: body, quote });
		}
		// The blank lines around a quote are its spacing, not text.
		return out.map((b) => (b.quote ? b : { ...b, text: b.text.replace(/^\n+|\n+$/g, '') })).filter((b) => b.text);
	}

	// A user message's text with its [图片 #N] placeholders split out.
	function userSegments(text: string): { text: string; image?: string }[] {
		const out: { text: string; image?: string }[] = [];
		let last = 0;
		for (const m of text.matchAll(/\[图片 #(\d+)\]/g)) {
			if (m.index > last) out.push({ text: text.slice(last, m.index) });
			out.push({ text: m[0], image: m[1] });
			last = m.index + m[0].length;
		}
		if (last < text.length) out.push({ text: text.slice(last) });
		return out;
	}

	// Skip empty placeholders (e.g. an assistant message before its first delta).
	function hasContent(m: Msg): boolean {
		// Meta/status notices render in the collapsible status strip, not inline.
		if (m.kind === 'system') return false;
		if (m.kind === 'tool') return !!(m.name || m.output);
		if (m.kind === 'plan') return !!(m.title || m.text);
		if (m.kind === 'agent_message') return !!m.summary;
		if (m.kind === 'compaction' || m.kind === 'escalation') return true;
		return !!m.text && hasText(m, m.text);
	}

	// A run of consecutive tool calls (rows that show nothing don't break it)
	// renders as one row on its first call: a header naming the count and the
	// latest call, then — expanded — the calls in a tight list. The other calls
	// of the run render no row of their own.
	const GROUP_MIN = 2;
	const toolGroups = $derived.by(() => {
		const members = new Map<Msg, Msg[]>(); // first call → the run
		const headOf = new Map<Msg, Msg>();
		let run: Msg[] = [];
		const flush = () => {
			if (run.length >= GROUP_MIN) {
				members.set(run[0]!, run);
				for (const x of run) headOf.set(x, run[0]!);
			}
			run = [];
		};
		for (const m of messages) {
			if (!hasContent(m)) continue;
			// A message to another conversation keeps a row of its own: its
			// state changes after the run.
			if (m.kind === 'tool' && !isAgentCall(m) && m.name !== 'send_to_session') run.push(m);
			else flush();
		}
		flush();
		return { members, headOf };
	});
	const openGroups = new SvelteSet<Msg>();
	// The last message with something to show (a plan's actions show there only).
	const lastShown = $derived(messages.findLast((m) => hasContent(m)));
	/** A spawn or wait call that renders as a subagent card. */
	function isAgentCall(m: Msg): boolean {
		return !!agents && m.kind === 'tool' && (SPAWN_TOOLS.has(m.name) || WAIT_TOOLS.has(m.name));
	}
	function shown(m: Msg): boolean {
		return hasContent(m) && (!toolGroups.headOf.has(m) || toolGroups.members.has(m)) && !attempts.hidden.has(m);
	}
	// Best-of-N: the spawns of one attempt group render as one card, on the
	// group's first spawn; the others render nothing.
	const attempts = $derived.by(() => {
		const lead = new Map<Msg, { group: string; rows: AgentRow[] }>();
		const hidden = new Set<Msg>();
		if (!agents) return { lead, hidden };
		const groups = attemptGroups(agents);
		if (!groups.size) return { lead, hidden };
		const seen = new Set<string>();
		for (const m of messages) {
			if (m.kind !== 'tool' || !SPAWN_TOOLS.has(m.name)) continue;
			const group = spawnAgentRow(agents, m.callId, m.args ?? '', m.output)?.attemptGroup;
			if (!group) continue;
			if (seen.has(group)) hidden.add(m);
			else {
				seen.add(group);
				lead.set(m, { group, rows: groups.get(group) ?? [] });
			}
		}
		return { lead, hidden };
	});
	function groupInfo(run: Msg[]) {
		let running = false;
		let failed = 0;
		for (const x of run) {
			if (x.kind !== 'tool') continue;
			if (x.running) running = true;
			if (x.isError) failed++;
		}
		const last = run[run.length - 1];
		const latest =
			last?.kind === 'tool'
				? { Icon: toolIcon(last.name), verb: toolVerb(last.name), target: toolTarget(last.name, parseToolOutput(last.output)) }
				: null;
		return { running, failed, latest };
	}
</script>

<svelte:document onselectionchange={() => cite && window.getSelection()?.isCollapsed && (cite = null)} />

<div class="list" bind:this={listEl} onmouseup={(e) => e.button === 0 && setTimeout(offerCite)} role="presentation" style:padding-top="{padTop}px" style:padding-bottom="{padBottom}px">
	{#each windowRows as m, k (m)}
		{@const i = range.first + k}
		{#if shown(m)}
			<div class="mwrap" class:animate={!virtual} class:turn={m.kind === 'user' && i > 0} class:hit={i === findActive} bind:this={rowEls[i]} use:measure={m}>
				{#if m.kind === 'user'}
			{@const delivery = parseDelivery(m.text)}
			{@const drop = userOrdinal.size - (userOrdinal.get(m) ?? 0)}
			{#if delivery}
				<DeliveryNotice {delivery} {onOpenSession} />
			{:else}
			{@const sent = splitAttachments(m.text)}
			{@const hasBubble = !!sent.text || !!m.images?.length}
			<div class="row user" class:filed={hasBubble && (sent.files.length > 0 || sent.videos.length > 0)}>
				<button class="uedit ucopy" class:done={copied === m} onclick={() => copy(copyableText(m.text), m)} aria-label={t(copied === m ? 'common.copied' : 'common.copy')} title={t(copied === m ? 'common.copied' : 'common.copy')}>
					{#if copied === m}<CheckIcon size={12} />{:else}<CopyIcon size={12} />{/if}
				</button>
				<button class="uedit rewind" onclick={() => onRewind(m.text, userOrdinal.get(m) ?? 0)} aria-label={t('chat.rewindTitleN', { n: drop })} title={t('chat.rewindTitleN', { n: drop })}>
					<ArrowCounterClockwiseIcon size={12} />{#if drop > 1}<span class="rwn">{drop}</span>{/if}
				</button>
				<button class="uedit" onclick={() => onEdit(m.text)} aria-label={t('chat.quoteTitle')} title={t('chat.quoteTitle')}><PencilSimpleIcon size={12} /></button>
				<div class="ucol">
					<!-- Files and videos sent with it: chips above the bubble, which
					     shows what was typed (attachments.ts). -->
					{#if sent.files.length || sent.videos.length}<SentFiles files={sent.files} videos={sent.videos} onOpen={onAttachment} />{/if}
					<!-- One line: the bubble is pre-wrap, so template whitespace would show. -->
					{#if hasBubble}<div class="bubble" class:pending={m.state === 'sending'}>{#if m.images?.length}<div class="uimgs" class:alone={!sent.text}>{#each m.images as p (p)}<UserImage path={p} load={loadImage} group={m.images} />{/each}</div>{/if}{#each userBlocks(sent.text) as block, b (b)}{#if block.quote}<span class="uquote">{block.text}</span>{:else}<span class="utext">{#each userSegments(block.text) as seg, j (j)}{#if seg.image}<span class="utoken">{t('chat.imageToken', { n: seg.image })}</span>{:else}{seg.text}{/if}{/each}</span>{/if}{/each}</div>{/if}
					{#if m.state}
						{#key m.state}
							<div class="sendstate {m.state}" in:fade={{ duration: 160 }}>
								{#if m.state === 'failed'}<WarningCircleIcon size={13} />{:else}<span class="sdot"></span>{/if}
								<span>{t(`chat.send.${m.state}`)}</span>
								{#if call && (m.state === 'connecting' || m.state === 'waiting')}<CallTimer since={call.since} />{/if}
							</div>
						{/key}
					{/if}
				</div>
			</div>
			{/if}
		{:else if m.kind === 'assistant'}
			{@const r = m === streamingMsg ? streamingReply(m) : null}
			{@const blocks = r ? r.blocks : replyBlocks(m)}
			<div class="answer" use:contextItems={() => turnMenu(i)}>
				<!-- The same keyed chunks while it streams and once it has
				     finished: only the tail renders anew at its end. -->
				{#each blocks as block, b (block.key)}<Markdown text={block.text} more={!!r || b < blocks.length - 1} onFile={(href) => onFile?.(href, m.text)} />{/each}
				{#if r}
					<div class="stream" use:streamText={{ text: r.tail, from: r.split }}></div>
				{:else}
					{@const turnEnd = ends.has(m) && i < liveFrom}
					<!-- Only the turn's last reply carries the request's totals
					     and the copy button for the whole turn. -->
					{#if m.turn || m.elapsed || turnEnd || m.interrupted}
						<div class="foot">
							{#if m.interrupted}<span title={t('chat.interruptedTitle')}>{t('chat.interrupted')}</span>{/if}
							{#if m.turn}
								{#each turnParts(m.turn, prefs.turnStats) as part, j (j)}
									{#if part.change}
										<!-- The files the turn changed: a change pill that opens the Changes panel. -->
										<svelte:element this={onChanges ? 'button' : 'span'} class="change" class:open={!!onChanges} title={onChanges ? t('chat.stat.openChanges') : part.title} onclick={onChanges} role={onChanges ? undefined : 'note'}
											><FileTextIcon size={14} /><span>{t('chat.stat.filesCount', { n: part.change.files })}</span><span class="add">+{part.change.added}</span><span class="del">−{part.change.removed}</span></svelte:element
										>
									{:else}
										<span class="stat" class:mono={part.mono} title={part.title}>{part.text}</span>
									{/if}
								{/each}
							{:else if m.elapsed}
								<span class="mono">{fmtDur(m.elapsed)}</span>
								{#if m.tokens}<span class="mono">{t('chat.tokens', { n: m.tokens })}</span>{/if}
							{/if}
							{#if turnEnd}
								<button class="tcopy" class:done={copied === m} onclick={() => copyTurn(i)} aria-label={t(copied === m ? 'common.copied' : 'chat.copyTurn')} title={t('chat.copyTurn')}>
									{#if copied === m}<CheckIcon size={13} /><span>{t('common.copied')}</span>{:else}<CopyIcon size={13} />{/if}
								</button>
							{/if}
						</div>
					{/if}
					{#if m.recap && m.recap.choice !== 'closed'}<RecapReceipt outcome={m.recap} />{/if}
				{/if}
			</div>
		{:else if m.kind === 'reasoning'}
			<div class="reason" class:open={!m.collapsed}>
				<div class="reason-row">
				<button class="reason-head" onclick={() => (m.collapsed = !m.collapsed)}>
					<span>
						{#if m.durationMs !== undefined}
							{t('chat.reasoningFor', { t: fmtDur(Math.max(1000, m.durationMs)) })}
						{:else if m === streamingReasoning && m.startedAt !== undefined}
							{t('chat.reasoningNow')} <CallTimer since={m.startedAt} />
						{:else}
							{t('chat.reasoning')}
						{/if}
						{#if m.interrupted}<span class="cut" title={t('chat.interruptedTitle')}>{t('chat.interrupted')}</span>{/if}
					</span>
					<span class="rchev"><CaretRightIcon size={13} /></span>
				</button>
				{#if m.collapsed && m === streamingReasoning}
					<!-- Folded while it streams: its latest words in one line,
					     the earliest sliding out to the left. -->
					<button class="reason-line" onclick={() => (m.collapsed = false)} aria-label={t('chat.reasoningExpand')}
						><span>{reasoningTail(m)}</span></button
					>
				{/if}
				</div>
				<Collapse open={!m.collapsed}>
					<div class="reason-body">
						<!-- Plain text while it streams (no per-frame Markdown), in
						     blocks written once; Markdown once finished, taking
						     over from the plain text a few chunks each frame. -->
						<ReasoningBody source={shownText(m)} text={m.text} live={m === streamingReasoning} onFile={(href) => onFile?.(href, m.text)} />
					</div>
				</Collapse>
			</div>
		{:else if m.kind === 'tool'}
			{@const run = toolGroups.members.get(m)}
			{#if run}
				{@const g = groupInfo(run)}
				{@const open = openGroups.has(m)}
				<button class="tgroup" class:open onclick={() => (open ? openGroups.delete(m) : openGroups.add(m))}>
					<span class="tg-count">{t('chat.toolGroup', { n: run.length })}</span>
					{#if g.failed}<span class="tg-fail">{t('chat.toolGroupFailed', { n: g.failed })}</span>{/if}
					{#if g.latest && !open}
						<span class="tg-latest">
							<g.latest.Icon size={13} />
							<span class="tg-verb">{g.latest.verb}</span>
							{#if g.latest.target}<span class="tg-target">{g.latest.target}</span>{/if}
						</span>
					{/if}
					{#if g.running}<CircleNotchIcon size={12} class="spin" />{/if}
					<span class="rchev"><CaretRightIcon size={13} /></span>
				</button>
				{#if open}
					<div class="tg-list">
						{#each run as x (x)}
							{#if x.kind === 'tool'}<ToolCard name={x.name} output={x.output} running={x.running} isError={x.isError} subagent={x.subagent} trace={traceOf?.(x) ?? undefined} />{/if}
						{/each}
					</div>
				{/if}
			{:else if agents && isAgentCall(m)}
				{@const attempt = attempts.lead.get(m)}
				{#if attempt}
					<AttemptGroupCard group={attempt.group} rows={attempt.rows} picked={attemptPicks[attempt.group] ?? ''} onOpen={onOpenAgent} onViewChanges={onAgentChanges} onPick={onPickAttempt} onStop={onStopAgent} />
				{:else}
					<SubagentCard name={m.name} callId={m.callId} output={m.output} args={m.args} running={m.running} isError={m.isError} rows={agents} onOpen={onOpenAgent} onViewChanges={onAgentChanges} onMerge={onMergeAgent} onStop={onStopAgent} />
				{/if}
			{:else if m.name === 'send_to_session'}
				{@const card = sendCardProps(sendCardView(m, sendOf?.(m.callId)), m.isError)}
				<ToolCard name={m.name} output={m.output} running={m.running} isError={m.isError} subagent={m.subagent} heading={card.heading} badge={card.badge} sections={card.sections} />
			{:else}
				<ToolCard name={m.name} output={m.output} running={m.running} isError={m.isError} subagent={m.subagent} trace={traceOf?.(m) ?? undefined} />
			{/if}
		{:else if m.kind === 'compaction'}
			<CompactionCard stage={m.state} before={m.before} after={m.after} written={m.written} since={m.since} summary={m.summary} error={m.error} live={m.live} />
		{:else if m.kind === 'plan'}
			<PlanCard id={m.id} title={m.title} text={m.text} status={m.status} actionable={m === lastShown} defaultMode={planMode} onAction={onPlan} onOpen={onOpenPlan} />
		{:else if m.kind === 'agent_message'}
			<AgentMessageLine from={m.from} to={m.to} summary={m.summary} />
		{:else if m.kind === 'escalation'}
			<EscalationLine record={m.record} />
		{:else if m.kind === 'error'}
			<ErrorNotice text={m.text} {backend} {provider} onAction={onErrorAction} onDismiss={onDismiss ? () => onDismiss(m) : undefined} />
				{/if}
			</div>
		{/if}
	{/each}
	{#if retry}
		<RetryNotice {retry} {backend} />
	{:else if autoRetry}
		<RetryNotice retry={autoRetry} {backend} onNow={onAutoRetryNow} onCancel={onAutoRetryCancel} />
	{:else}
		<Indicator phase={shownPhase} tokens={compactionTokens} {call} />
	{/if}
</div>
{#if cite}
	{@const below = cite.top < 60}
	<!-- mousedown would clear the selection before the click lands. -->
	<div class="cite" class:below style:left="{cite.x}px" style:top="{below ? cite.bottom + 8 : cite.top - 8}px">
		<button onmousedown={(e) => e.preventDefault()} onclick={() => takeCite()}>
			<QuotesIcon size={13} />{t('chat.cite')}
		</button>
		{#if onNote}
			<button onmousedown={(e) => e.preventDefault()} onclick={() => takeCite(onNote)}>
				<ListPlusIcon size={13} />{t('shell.requirement.note')}
			</button>
		{/if}
	</div>
{/if}

<style>
	.cite {
		position: fixed;
		z-index: 300;
		transform: translate(-50%, -100%);
		display: inline-flex;
		border-radius: var(--r-sm);
		border: 1px solid var(--border);
		background: var(--panel);
		box-shadow: var(--shadow-pop);
		overflow: hidden;
		animation: cite-in var(--t-fast) var(--ease-out);
	}
	.cite button {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 5px 10px;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.cite button + button {
		border-left: 1px solid var(--border);
	}
	.cite.below {
		transform: translateX(-50%);
	}
	.cite button:hover {
		background: var(--surface2);
	}
	@keyframes cite-in {
		from {
			opacity: 0;
		}
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	/* Never let a flex column squeeze an item below its content height — that
	   collapses tool cards into stray horizontal lines under content pressure. */
	.list > :global(*) {
		flex-shrink: 0;
	}
	.mwrap {
		border-radius: var(--r-md);
		transition: background var(--t-slow) var(--ease-out), box-shadow var(--t-slow) var(--ease-out);
	}
	/* New rows come in once: fade and rise over --t-enter. Suppressed under
	   windowing so rows scrolling back into the window don't replay. Fill
	   backwards only: a fill that held the end would leave every row
	   transformed (by an identity matrix) for good, the containing block of
	   its fixed children (a menu's click-away backdrop would cover only its
	   row) and, in Chromium, a compositing layer whose paint time grows with
	   a streaming row's text. The end values are the row's own, so nothing
	   moves when the animation lets go. */
	.mwrap.animate {
		animation: msg-in var(--t-enter) var(--ease-enter) backwards;
	}
	.mwrap.hit {
		background: var(--accent-soft);
		background-clip: content-box;
		box-shadow: 0 0 0 6px var(--accent-soft);
	}
	/* Spacing (design.md, "Workbench canvas"): 16px between the blocks of a
	   turn (the list's gap), 32px above the user message that starts a new
	   one. Padding, not margin: the windowing measures it with the row. */
	.mwrap.turn {
		padding-top: 16px;
	}
	.row {
		display: flex;
	}
	.row.user {
		justify-content: flex-end;
		align-items: center;
		gap: 6px;
	}
	/* Files above the bubble: the actions sit beside the bubble's last line,
	   not halfway up the files. */
	.row.user.filed {
		align-items: flex-end;
	}
	.row.user.filed .uedit {
		margin-bottom: 12px;
	}
	.uedit {
		opacity: 0;
		transform: translateX(4px);
		display: inline-flex;
		padding: 4px;
		border: none;
		background: none;
		color: var(--dim2);
		border-radius: var(--r-sm);
		cursor: pointer;
		flex-shrink: 0;
		transition:
			opacity var(--t-med) var(--ease-out),
			transform var(--t-med) var(--ease-out),
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.row.user:hover .uedit,
	.uedit:focus-visible {
		opacity: 1;
		transform: translateX(0);
	}
	.uedit:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.uedit:active {
		transform: scale(0.9);
	}
	.uedit.rewind {
		gap: 2px;
		align-items: center;
	}
	.uedit.done,
	.tcopy.done {
		opacity: 1;
		transform: none;
		color: var(--ok);
	}
	.rwn {
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
		line-height: 1;
	}
	/* The user's message: a right-aligned bubble, at most 85% of the column. */
	.ucol {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
		gap: 6px;
		max-width: 85%;
		min-width: 0;
	}
	.bubble.pending {
		opacity: 0.7;
	}
	.sendstate {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		padding-right: 6px;
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.sendstate.failed {
		color: var(--err, var(--warn));
	}
	.sdot {
		position: relative;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--dim);
	}
	/* sending: the dot breathes; connecting: it sends out rings (the handshake
	   with the gateway); waiting: steady, connected. */
	.sending .sdot {
		animation: sbreathe 1.2s ease-in-out infinite;
	}
	.connecting .sdot {
		background: var(--accent-bright);
	}
	.connecting .sdot::after {
		content: '';
		position: absolute;
		inset: 0;
		border-radius: 50%;
		border: 1.5px solid var(--accent-bright);
		animation: sring 1.3s ease-out infinite;
	}
	.waiting .sdot {
		background: var(--accent-bright);
	}
	@keyframes sbreathe {
		0%,
		100% {
			opacity: 0.35;
		}
		50% {
			opacity: 1;
		}
	}
	@keyframes sring {
		0% {
			transform: scale(1);
			opacity: 0.7;
		}
		100% {
			transform: scale(2.8);
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sdot,
		.sdot::after {
			animation: none !important;
		}
	}
	.stat + .stat::before {
		content: '·';
		margin-right: 10px;
		opacity: 0.6;
	}
	.foot .stat + .stat {
		margin-left: -2px;
	}
	.bubble {
		background: var(--surface2);
		border-radius: var(--r-xl);
		padding: 10px 14px;
		font-size: var(--fs-md);
		line-height: 24px;
		white-space: pre-wrap;
		word-break: break-word;
		max-width: 100%;
	}
	.uimgs {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}
	.uimgs.alone {
		margin-bottom: 0;
	}
	.uquote,
	.utext {
		display: block;
	}
	.uquote {
		position: relative;
		padding: 5px 10px 5px 29px;
		border-radius: var(--r-md);
		background: color-mix(in oklab, var(--text) 5%, transparent);
		color: var(--dim);
	}
	.uquote::before {
		content: '';
		position: absolute;
		left: 10px;
		top: calc(5px + 0.8em - 6px);
		width: 12px;
		height: 12px;
		background: var(--dim2);
		mask: var(--quote-mask) center / contain no-repeat;
	}
	.uquote + .utext,
	.utext + .uquote,
	.uquote + .uquote {
		margin-top: 8px;
	}
	.utoken {
		padding: 0 5px;
		border-radius: var(--r-xs);
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border-strong);
		font-size: var(--fs-sm);
		white-space: nowrap;
	}
	/* The assistant's text sits bare on the canvas. */
	.answer {
		font-size: var(--fs-md);
		line-height: 24px;
		word-break: break-word;
	}
	.stream {
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 24px;
	}
	/* A reply reads as one document: a drag selects across its Markdown
	   blocks, the tail still streaming and the replies around it, and the
	   user's message likewise; buttons and stats stay out of the selection. */
	.answer,
	.stream,
	.ucol {
		-webkit-user-select: text;
		user-select: text;
	}
	.foot,
	.sendstate,
	.answer :global(button) {
		-webkit-user-select: none;
		user-select: none;
	}
	/* Copies the whole turn: quiet until the row is hovered. */
	.tcopy {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 5px;
		margin: -3px 0;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim2);
		font: inherit;
		cursor: pointer;
		opacity: 0;
		transition:
			opacity var(--t-med) var(--ease-out),
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out),
			transform var(--t-fast) var(--ease-out);
	}
	.tcopy:first-child {
		margin-left: -5px;
	}
	.mwrap:hover .tcopy,
	.tcopy:focus-visible {
		opacity: 1;
	}
	.tcopy:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.tcopy:active {
		transform: scale(0.94);
	}
	/* Touch screens (the phone page) have no hover: the copy buttons stay. */
	@media (hover: none) {
		.tcopy,
		.uedit.ucopy {
			opacity: 1;
			transform: none;
		}
	}
	/* The turn's summary line: duration, tokens, cost, in mono. */
	.foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 12px;
		margin-top: 6px;
		font-size: var(--fs-xs);
		line-height: 16px;
		color: var(--dim2);
	}
	.mono {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	/* A change pill: the files the turn changed, +added −removed. An
	   outlined --r-md chip, not a full pill. */
	.change {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 24px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-xs);
		white-space: nowrap;
	}
	.change :global(svg) {
		color: var(--dim);
	}
	.change .add,
	.change .del {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.change .add {
		color: var(--ok);
	}
	.change .del {
		color: var(--err);
	}
	button.change {
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-base);
	}
	button.change:hover {
		background: var(--surface2);
	}
	.reason-row {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
	}
	.reason-head {
		flex-shrink: 0;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 2px 0;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 16px;
		cursor: pointer;
	}
	.reason-head {
		transition: color var(--t-fast) var(--ease-out);
	}
	.reason-head:hover {
		color: var(--text);
	}
	.reason-head .cut {
		margin-left: 6px;
		color: var(--dim2);
		font-size: var(--fs-2xs);
		font-weight: 400;
	}
	.rchev {
		display: inline-flex;
		color: var(--dim2);
		transition: transform var(--t-base) var(--ease-base);
	}
	.reason.open .rchev,
	.tgroup.open .rchev {
		transform: rotate(90deg);
	}
	/* A run of tool calls: one summary line (--fs-xs --dim, no card). */
	.tgroup {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		max-width: 100%;
		min-height: 24px;
		margin-left: -6px;
		text-align: left;
		padding: 2px 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 16px;
		cursor: pointer;
		transition:
			color var(--t-fast) var(--ease-base),
			background var(--t-fast) var(--ease-base);
	}
	.tgroup:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.tg-count,
	.tg-fail {
		flex-shrink: 0;
		white-space: nowrap;
	}
	/* The latest call, in the card's own format, trailing the count. */
	.tg-latest {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		color: var(--dim2);
	}
	.tg-latest::before {
		content: '·';
	}
	.tg-latest :global(svg) {
		flex-shrink: 0;
	}
	.tg-verb {
		flex-shrink: 0;
	}
	.tg-target {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	.tgroup .rchev,
	.tgroup :global(.spin) {
		flex-shrink: 0;
	}
	.tg-fail {
		color: var(--err);
	}
	/* The group's calls hang indented under its header, 4px apart. */
	.tg-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 4px 0 0 20px;
	}
	/* One line, anchored at its end: overflowing text leaves on the left,
	   where it fades out. */
	.reason-line {
		flex: 1;
		min-width: 0;
		display: flex;
		justify-content: flex-end;
		overflow: hidden;
		padding: 2px 0;
		border: none;
		background: none;
		color: var(--dim2, var(--dim));
		font: inherit;
		font-size: var(--fs-xs);
		font-style: italic;
		white-space: nowrap;
		text-align: left;
		cursor: pointer;
		-webkit-mask-image: linear-gradient(to right, transparent, #000 56px);
		mask-image: linear-gradient(to right, transparent, #000 56px);
		animation: reason-line-in var(--t-med) var(--ease-out);
	}
	.reason-line > span {
		flex: none;
	}
	.reason-line:hover {
		color: var(--dim);
	}
	@keyframes reason-line-in {
		from {
			opacity: 0;
		}
	}
	.reason-body {
		margin-top: 4px;
		color: var(--dim);
		font-style: italic;
		font-size: var(--fs-sm);
		line-height: 20px;
		word-break: break-word;
	}
	.foot .stat {
		white-space: nowrap;
	}
</style>
