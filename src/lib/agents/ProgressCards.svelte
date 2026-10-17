<script lang="ts">
	// The turn's plan and subagents as cards at the top right of the chat
	// leaf (design.md §4, "Status, attention and emphasis"), while the turn
	// has a to-do list or runs subagents, and until the next turn starts.
	//
	// Beside: where the leaf leaves CARD_LANE px right of the transcript
	// column (ChatPane moves the column to make that room), a column of
	// cards: the plan card ("计划 3/7 · 跑单元测试", then the checklist) and
	// the subagents card. Each collapses to its title line; what the reader
	// chose is kept per session. Otherwise each card is its title line at the
	// top right of the leaf, on a strip above the transcript, and opens as a
	// solid popover over it, closed by Escape or a click outside.
	//
	// A step that fails or waits for the reader opens the plan card by
	// itself (once per step and reason). The agent team's panel is a button
	// on the subagents card's title line (beside), or on the first line of
	// its popover.
	//
	// The wheel over the cards is theirs (ui/keepWheel.ts): it scrolls their
	// lists, and at either end, or with nothing to scroll, it goes nowhere.
	// It never scrolls the transcript, nor counts as the reader scrolling it
	// (chatFollow.ts).
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import UsersThreeIcon from 'phosphor-svelte/lib/UsersThreeIcon';
	import { untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { keepWheel } from '$lib/ui/keepWheel';
	import type { AgentRow, PlanSummary } from '$lib/agentProgress';
	import type { ChatState } from '$lib/chat.svelte';
	import type { OpenHow } from './subagentPages.svelte';
	import { agentsTitle, attentionKey, loadCards, opensItself, planCard, planTitle, saveCards, type CardsShown, type ReaderWait } from './progressCards';
	import CardTitle from './CardTitle.svelte';
	import PlanBody from './PlanBody.svelte';
	import AgentsBody from './AgentsBody.svelte';

	type Kind = 'plan' | 'agents';

	let {
		chat,
		sessionId,
		plan,
		rows,
		shown,
		beside,
		lane = 0,
		onOpen,
		onStop,
		onStopAgent,
		onOpenTeam
	}: {
		chat: ChatState;
		/** Keys what the reader chose (collapsed cards). */
		sessionId: string;
		plan: PlanSummary;
		rows: AgentRow[];
		shown: CardsShown;
		/** The cards sit beside the column; else title lines and popovers. */
		beside: boolean;
		/** The room right of the column while beside, px (the cards' width follows it). */
		lane?: number;
		/** Shows a subagent's conversation. Absent: rows are not links. */
		onOpen?: (row: AgentRow, how: OpenHow) => void;
		/** Stops a subagent the engine runs as a background task (its id). */
		onStop?: (id: string) => void;
		/** Stops an agent of LynShen's agent team still at work (close_agent). */
		onStopAgent?: (row: AgentRow) => void;
		/** Opens the agent team's panel (task board, messages). */
		onOpenTeam?: () => void;
	} = $props();

	const uid = `pc-${Math.random().toString(36).slice(2, 8)}`;

	// What the reader chose for this session: a card collapsed, the last
	// step that opened the plan card by itself.
	let st = $state(untrack(() => loadCards(sessionId)));
	// The title line whose popover is open (narrow only; not kept).
	let popover = $state<Kind | null>(null);
	$effect(() => {
		const id = sessionId;
		untrack(() => {
			st = loadCards(id);
			popover = null;
		});
	});
	$effect(() => {
		if (beside) untrack(() => (popover = null));
	});

	const wait = $derived.by((): ReaderWait | null => {
		const a = chat.pendingApproval;
		return a && chat.busy ? { kind: a.questions?.length ? 'question' : 'approval', agent: a.subagentId ?? '' } : null;
	});
	const card = $derived(planCard({ plan, rows, busy: chat.busy, wait, error: chat.lastError ?? '' }));
	const pTitle = $derived(planTitle(card));
	const aTitle = $derived(agentsTitle(rows));

	// A step newly failing or waiting for the reader opens the plan card:
	// expanded beside the column, its popover in a narrow leaf. Keyed by the
	// turn too: the same step failing in a later turn is news again.
	const attention = $derived.by(() => {
		const key = shown.plan ? attentionKey(card) : '';
		return key && `${chat.turnStartedAt}|${key}`;
	});
	$effect(() => {
		const key = attention;
		untrack(() => {
			if (!opensItself(st.seen, key)) return;
			st.plan = true;
			st.seen = key;
			saveCards(sessionId, st);
			if (!beside) popover = 'plan';
		});
	});

	function toggle(kind: Kind) {
		if (!beside) {
			popover = popover === kind ? null : kind;
			if (popover) place(kind);
			return;
		}
		st[kind] = !st[kind];
		saveCards(sessionId, st);
	}

	// A popover opens under its title line, right edges aligned, or at the
	// leaf's right edge when it would run past the left one.
	let strip = $state<HTMLElement | null>(null);
	let popEl = $state<HTMLElement | null>(null);
	let popRight = $state(8);
	const titleEl = (kind: Kind) => document.getElementById(`${uid}-${kind}-title`);
	function place(kind: Kind) {
		const s = strip?.getBoundingClientRect();
		const b = titleEl(kind)?.getBoundingClientRect();
		if (!s || !b) return;
		const width = Math.min(360, s.width - 16);
		const right = Math.max(8, Math.round(s.right - b.right));
		popRight = s.right - right - width >= s.left + 8 ? right : 8;
	}
	$effect(() => {
		// The auto-opened popover: placed once it is in the page.
		if (popover && popEl) untrack(() => place(popover!));
	});
	function close(refocus: boolean) {
		const kind = popover;
		popover = null;
		if (refocus && kind) titleEl(kind)?.focus();
	}
	// Escape closes the popover before anything under it sees the key (an
	// approval card reads Escape as "deny").
	function onKeyCapture(e: KeyboardEvent) {
		if (!popover || e.key !== 'Escape' || e.isComposing) return;
		e.preventDefault();
		e.stopPropagation();
		close(!!popEl?.contains(document.activeElement) || document.activeElement === titleEl(popover));
	}
	function onPointerCapture(e: PointerEvent) {
		if (!popover) return;
		const target = e.target as Node | null;
		if (target && (popEl?.contains(target) || titleEl(popover)?.contains(target))) return;
		close(false);
	}

	const cardW = $derived(Math.max(248, Math.min(320, lane - 32)));
</script>

<svelte:window onkeydowncapture={onKeyCapture} onpointerdowncapture={onPointerCapture} />

{#snippet body(kind: Kind)}
	{#if kind === 'plan'}
		<PlanBody {card} {rows} {onOpen} />
	{:else}
		<AgentsBody {chat} {rows} {onOpen} {onStop} {onStopAgent} onOpenTeam={beside ? undefined : onOpenTeam} />
	{/if}
{/snippet}

{#snippet title(kind: Kind)}
	{#if kind === 'plan'}<CardTitle plan={pTitle} />{:else}<CardTitle agents={aTitle} />{/if}
{/snippet}

{#if shown.plan || shown.agents}
	{@const kinds = (['plan', 'agents'] as const).filter((k) => shown[k])}
	{#if beside}
		<div class="column" role="region" aria-label={t('chat.progress.region')} style:width="{cardW}px" use:keepWheel>
			{#each kinds as kind (kind)}
				{@const team = kind === 'agents' && !!onOpenTeam}
				<section class="card {kind}" class:open={st[kind]} class:team>
					<div class="headrow">
						<button id="{uid}-{kind}-title" class="head" aria-expanded={st[kind]} aria-controls={st[kind] ? `${uid}-${kind}` : undefined} onclick={() => toggle(kind)}>
							{@render title(kind)}
							<span class="caret"><CaretDownIcon size={12} /></span>
						</button>
						{#if team}
							<span class="teamlink">
								<IconButton size="xs" label={t('chat.progress.openTeam')} title={t('chat.progress.openTeam')} onclick={onOpenTeam}><UsersThreeIcon size={14} /></IconButton>
							</span>
						{/if}
					</div>
					{#if st[kind]}
						<div class="cbody" id="{uid}-{kind}" data-card-scroll>{@render body(kind)}</div>
					{/if}
				</section>
			{/each}
		</div>
	{:else}
		<!-- Each popover follows its title line, so Tab goes from the title
		     line into it and on to the next. -->
		<div class="strip" role="region" aria-label={t('chat.progress.region')} bind:this={strip}>
			{#each kinds as kind (kind)}
				<button
					id="{uid}-{kind}-title"
					class="tline"
					class:on={popover === kind}
					aria-expanded={popover === kind}
					aria-controls={popover === kind ? `${uid}-${kind}` : undefined}
					aria-haspopup="dialog"
					onclick={() => toggle(kind)}
				>
					{@render title(kind)}
					<span class="caret"><CaretDownIcon size={12} /></span>
				</button>
				{#if popover === kind}
					<div
						class="pop cardpop"
						id="{uid}-{kind}"
						role="dialog"
						aria-labelledby="{uid}-{kind}-title"
						bind:this={popEl}
						style:right="{popRight}px"
						data-card-scroll
						use:keepWheel
					>
						{@render body(kind)}
					</div>
				{/if}
			{/each}
		</div>
	{/if}
{/if}

<style>
	/* ── beside the column ── */
	.column {
		position: absolute;
		top: 12px;
		right: 16px;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: calc(100% - 24px);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.card {
		flex: none;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		background: var(--bg);
	}
	.headrow {
		position: relative;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		height: 34px;
		padding: 0 8px 0 10px;
		border: none;
		border-radius: var(--r-lg);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-base);
	}
	.head:hover {
		background: var(--surface2);
	}
	.card.open .head {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}
	/* The team's panel, on the title line before the caret: a sibling of the
	   title button (a button holds no button), laid over its right end. */
	.card.team .head {
		padding-right: 34px;
	}
	.card.team .caret {
		position: absolute;
		top: 11px;
		right: 8px;
	}
	.teamlink {
		position: absolute;
		top: 8px;
		right: 26px;
		display: inline-flex;
	}
	.head:focus-visible,
	.tline:focus-visible {
		outline-offset: -2px;
	}
	.head :global(.tl),
	.tline :global(.tl) {
		flex: 1;
	}
	.caret {
		display: inline-flex;
		flex: none;
		color: var(--dim2);
		transition: transform var(--t-fast) var(--ease-base);
	}
	.card.open .caret,
	.tline.on .caret {
		transform: rotate(180deg);
	}
	.cbody {
		padding: 4px;
		border-top: 1px solid var(--hairline);
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.card.plan .cbody {
		max-height: min(50vh, 440px);
	}
	.card.agents .cbody {
		max-height: min(42vh, 380px);
	}

	/* ── narrow: title lines on a strip, popovers over the transcript ── */
	/* A strip above the transcript (design.md, "Workbench canvas"): opaque
	   --bg, or the canvas veil over a custom background, never over the
	   transcript; the title lines at its right. */
	.strip {
		flex: none;
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 4px;
		height: 36px;
		padding: 0 8px;
		border-bottom: 1px solid var(--hairline);
		background: var(--bg);
	}
	:global(:root[data-canvas-bg]) .strip {
		background: transparent;
	}
	.tline {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 0 1 auto;
		min-width: 0;
		max-width: 62%;
		height: 28px;
		padding: 0 6px 0 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-base);
	}
	.tline:hover,
	.tline.on {
		background: var(--surface2);
	}
	/* Positioned against the leaf below the strip (.mainwrap). */
	.cardpop {
		position: absolute;
		top: 40px;
		z-index: 30;
		width: min(360px, calc(100% - 16px));
		max-height: calc(100% - 56px);
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 4px;
		gap: 0;
		user-select: text;
		animation: drop-in var(--t-pop) var(--ease-enter);
	}
	.cardpop :global(.aacts) {
		background: linear-gradient(var(--surface2), var(--surface2)), var(--panel);
	}
	@media (prefers-reduced-motion: reduce) {
		.cardpop {
			animation: none;
		}
	}
</style>
