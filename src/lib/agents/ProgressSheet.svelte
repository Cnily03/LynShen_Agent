<script lang="ts">
	// The phone page's plan and subagents (RemoteSession): each card is its
	// title line on a strip above the conversation, and a tap opens it as a
	// sheet from the bottom of the screen, closed by its close button, a tap
	// on the scrim or Escape. A step that fails or waits for the reader marks
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

	let {
		chat,
		rows,
		onOpen,
		onStop
	}: {
		chat: ChatState;
		rows: AgentRow[];
		/** Shows a subagent's conversation (the sheet closes first). */
		onOpen?: (row: AgentRow) => void;
		/** Stops a subagent the engine runs as a background task (its id). */
		onStop?: (id: string) => void;
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
	// A card that is gone (the next turn started) takes its sheet with it.
	$effect(() => {
		if (sheet && !shown[sheet]) sheet = null;
	});
</script>

<svelte:window onkeydowncapture={onKey} />

{#if shown.plan || shown.agents}
	<div class="chips" role="region" aria-label={t('chat.progress.region')}>
		{#each (['plan', 'agents'] as const).filter((k) => shown[k]) as kind (kind)}
			<button id="{uid}-{kind}" class="chip" aria-haspopup="dialog" aria-expanded={sheet === kind} onclick={() => show(kind)}>
				{#if kind === 'plan'}<CardTitle plan={pTitle} />{:else}<CardTitle agents={aTitle} />{/if}
				<span class="caret"><CaretDownIcon size={12} /></span>
			</button>
		{/each}
	</div>
{/if}

{#if sheet}
	<div class="scrim" onclick={hide} aria-hidden="true"></div>
	<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="{uid}-{sheet}-head">
		<div class="head" id="{uid}-{sheet}-head">
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
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		background: var(--scrim);
		animation: scrim-in var(--t-fast) var(--ease-enter);
	}
	.sheet {
		position: fixed;
		left: 0;
		right: 0;
		bottom: 0;
		z-index: 31;
		display: flex;
		flex-direction: column;
		max-height: 75dvh;
		padding-bottom: env(safe-area-inset-bottom);
		border-radius: var(--r-lg) var(--r-lg) 0 0;
		background: var(--panel);
		box-shadow: var(--shadow-pop);
		animation: sheet-in var(--t-med) var(--ease-enter);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 48px;
		padding: 4px 8px 4px 16px;
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
	@media (prefers-reduced-motion: reduce) {
		.scrim,
		.sheet {
			animation: none;
		}
	}
</style>
