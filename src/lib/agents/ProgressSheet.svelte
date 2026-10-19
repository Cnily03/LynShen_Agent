<script lang="ts">
	// The phone page's plan and subagents (RemoteSession): each card is its
	// title line on a strip above the conversation, and a tap opens it as a
	// sheet from the bottom of the screen that does not dim the page: the
	// conversation behind keeps scrolling and streaming. Closed by its close
	// button, a tap outside it, a drag down past 40 px, its chip or Escape. A step that fails or waits for the reader marks
	// the plan's title line; the sheet does not open by itself, since it would
	// cover the approval the reader has to answer.
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { tick } from 'svelte';
	import { t } from '$lib/i18n';
	import { planSummary, type AgentRow } from '$lib/agentProgress';
	import type { ChatState } from '$lib/chat.svelte';
	import { agentsTitle, cardsShown, planCard, planTitle, type ReaderWait } from './progressCards';
	import CardTitle from './CardTitle.svelte';
	import PlanBody from './PlanBody.svelte';
	import AgentsBody from './AgentsBody.svelte';

	type Kind = 'plan' | 'agents';
	/** How far down a drag closes the sheet (px). */
	const DRAG_CLOSE = 40;

	let {
		chat,
		rows,
		onOpen,
		onStop,
		sheetHeight = $bindable(0)
	}: {
		chat: ChatState;
		rows: AgentRow[];
		/** Shows a subagent's conversation (the sheet closes first). */
		onOpen?: (row: AgentRow) => void;
		/** Stops a subagent the engine runs as a background task (its id). */
		onStop?: (id: string) => void;
		/** The open sheet's height (0 when closed): the conversation makes
		 *  room for it, so its end stays readable above the sheet. */
		sheetHeight?: number;
	} = $props();

	const plan = $derived(planSummary(chat.plan, chat.team));
	const planFresh = $derived(chat.turnStartedAt > 0 && chat.planAt >= chat.turnStartedAt);
	const shown = $derived(cardsShown(plan, rows, chat.busy, planFresh));
	const wait = $derived.by((): ReaderWait | null => {
		const a = chat.pendingApproval;
		return a && chat.busy ? { kind: a.questions?.length ? 'question' : 'approval', agent: a.subagentId ?? '' } : null;
	});
	const card = $derived(planCard({ plan, rows, busy: chat.busy, wait, error: chat.lastError ?? '' }));
	const pTitle = $derived(planTitle(card));
	const aTitle = $derived(agentsTitle(rows));

	let sheet = $state<Kind | null>(null);
	let closeBtn = $state<HTMLButtonElement | null>(null);
	const uid = `ps-${Math.random().toString(36).slice(2, 8)}`;
	async function show(kind: Kind) {
		sheet = kind;
		await tick();
		closeBtn?.focus();
	}
	function hide() {
		const kind = sheet;
		sheet = null;
		if (kind) document.getElementById(`${uid}-${kind}`)?.focus();
	}
	function onKey(e: KeyboardEvent) {
		if (!sheet || e.key !== 'Escape') return;
		e.preventDefault();
		e.stopPropagation();
		hide();
	}
	// Drag the grabber or the title down past 40 px to close.
	let sheetEl = $state<HTMLElement | null>(null);
	let dragY = $state<number | null>(null);
	let dragFrom = 0;
	let dragId: number | null = null;
	// Followed on the window: the sheet moves under the finger.
	function dragStart(e: PointerEvent) {
		if ((e.target as HTMLElement).closest('button')) return;
		e.preventDefault();
		dragId = e.pointerId;
		dragFrom = e.clientY;
		dragY = 0;
		window.addEventListener('pointermove', dragMove);
		window.addEventListener('pointerup', dragEnd);
		window.addEventListener('pointercancel', dragEnd);
	}
	function dragMove(e: PointerEvent) {
		if (dragId !== e.pointerId) return;
		dragY = e.clientY - dragFrom;
	}
	function dragEnd(e: PointerEvent) {
		if (dragId !== e.pointerId) return;
		dragId = null;
		window.removeEventListener('pointermove', dragMove);
		window.removeEventListener('pointerup', dragEnd);
		window.removeEventListener('pointercancel', dragEnd);
		const far = (dragY ?? 0) > DRAG_CLOSE;
		dragY = null;
		if (far) hide();
	}
	// A tap (not a scroll) outside the sheet closes it; the tap still reaches
	// what it landed on. A press on the chips toggles them instead.
	let outside: { x: number; y: number; at: number } | null = null;
	function onDown(e: PointerEvent) {
		const target = e.target as HTMLElement;
		outside = sheet && !target.closest('.sheet') && !target.closest('.chips') ? { x: e.clientX, y: e.clientY, at: e.timeStamp } : null;
	}
	function onUp(e: PointerEvent) {
		const o = outside;
		outside = null;
		if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) < 8 && e.timeStamp - o.at < 600) sheet = null;
	}

	$effect(() => {
		const el = sheetEl;
		if (!el) {
			sheetHeight = 0;
			return;
		}
		// The next frame: the room it makes resizes the page, which must not
		// be in the same observation (a ResizeObserver loop).
		let frame = 0;
		const ro = new ResizeObserver(() => {
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(() => (sheetHeight = el.offsetHeight));
		});
		ro.observe(el);
		return () => {
			cancelAnimationFrame(frame);
			ro.disconnect();
		};
	});

	// A card that is gone (the next turn started) takes its sheet with it.
	$effect(() => {
		if (sheet && !shown[sheet]) sheet = null;
	});
</script>

<svelte:window onkeydowncapture={onKey} onpointerdowncapture={onDown} onpointerupcapture={onUp} />

{#if shown.plan || shown.agents}
	<div class="chips" role="region" aria-label={t('chat.progress.region')}>
		{#each (['plan', 'agents'] as const).filter((k) => shown[k]) as kind (kind)}
			<button id="{uid}-{kind}" class="chip" aria-haspopup="dialog" aria-expanded={sheet === kind} onclick={() => (sheet === kind ? hide() : show(kind))}>
				{#if kind === 'plan'}<CardTitle plan={pTitle} />{:else}<CardTitle agents={aTitle} />{/if}
				<span class="caret"><CaretDownIcon size={12} /></span>
			</button>
		{/each}
	</div>
{/if}

{#if sheet}
	<!-- Not modal, no scrim: the conversation behind keeps scrolling and
	     taking taps. A tap outside closes the sheet and still lands; a drag
	     down past 40 px closes it. -->
	<div
		class="sheet"
		class:dragging={dragY !== null}
		role="dialog"
		aria-modal="false"
		aria-labelledby="{uid}-{sheet}-head"
		bind:this={sheetEl}
		style:transform={dragY !== null ? `translateY(${Math.max(dragY, dragY * 0.15)}px)` : undefined}
	>
		<div class="grab" aria-hidden="true" onpointerdown={dragStart}><i></i></div>
		<!-- svelte-ignore a11y_no_static_element_interactions -- the drag is a pointer shortcut; the close button and Escape do the same -->
		<div class="head" id="{uid}-{sheet}-head" onpointerdown={dragStart}>
			{#if sheet === 'plan'}<CardTitle plan={pTitle} />{:else}<CardTitle agents={aTitle} />{/if}
			<button class="x" bind:this={closeBtn} onclick={hide} aria-label={t('common.close')}><XIcon size={16} /></button>
		</div>
		<div class="body" data-card-scroll>
			{#if sheet === 'plan'}
				<PlanBody {card} {rows} onOpen={onOpen ? (row) => (hide(), onOpen(row)) : undefined} />
			{:else}
				<AgentsBody {chat} {rows} onOpen={onOpen ? (row) => (hide(), onOpen(row)) : undefined} {onStop} />
			{/if}
		</div>
	</div>
{/if}

<style>
	/* A strip under the header: opaque, a hairline under it, outside the
	   scrolling conversation. */
	.chips {
		flex: none;
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		padding: 2px 10px 8px;
		border-bottom: 1px solid var(--hairline);
		background: var(--bg);
	}
	/* The plan's chip gives way first (its step ellipsizes); the subagents'
	   count stays whole. */
	.chip {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 0 1 auto;
		min-width: 0;
		min-height: 32px;
		padding: 0 8px 0 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		background: var(--bg);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
	}
	.chip :global(.tl) {
		flex: 1;
	}
	.chip + .chip {
		flex-shrink: 0;
	}
	.chip:active {
		background: var(--surface2);
	}
	.caret {
		display: inline-flex;
		flex: none;
		color: var(--dim2);
	}
	/* Rises in 0.55 s on the sheet curve (the mockup's), over the bottom of
	   the conversation, which stays live behind it. */
	.sheet {
		--plan-fill: var(--panel);
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 31;
		display: flex;
		flex-direction: column;
		max-height: 62dvh;
		padding-bottom: env(safe-area-inset-bottom);
		border-radius: 22px 22px 0 0;
		background: var(--panel);
		box-shadow:
			0 -1px 0 var(--hairline),
			0 -18px 50px rgb(0 0 0 / 0.28);
		animation: sheet-rise calc(0.55s * var(--time-scale)) cubic-bezier(0.32, 0.86, 0.28, 1);
		touch-action: pan-y;
	}
	.sheet:not(.dragging) {
		transition: transform 0.3s cubic-bezier(0.32, 0.86, 0.28, 1);
	}
	@keyframes sheet-rise {
		from {
			transform: translateY(105%);
		}
	}
	.grab {
		flex: none;
		display: grid;
		place-items: center;
		height: 18px;
		touch-action: none;
		cursor: grab;
	}
	.grab i {
		width: 36px;
		height: 5px;
		border-radius: 3px;
		background: var(--dim2);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		padding: 0 8px 4px 16px;
		touch-action: none;
		border-bottom: 1px solid var(--hairline);
		font-size: var(--fs-sm);
	}
	.head :global(.tl) {
		flex: 1;
	}
	.x {
		display: inline-flex;
		flex: none;
		padding: 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.x:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.body :global(.aacts) {
		background: linear-gradient(var(--surface2), var(--surface2)), var(--panel);
	}
	.body {
		min-height: 0;
		padding: 6px 8px 12px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	/* Reduced motion: it fades in, nothing moves. */
	@media (prefers-reduced-motion: reduce) {
		.sheet {
			animation: sheet-fade 0.15s linear;
		}
		.sheet:not(.dragging) {
			transition: none;
		}
	}
	@keyframes sheet-fade {
		from {
			opacity: 0;
		}
	}
</style>
