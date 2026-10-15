<script lang="ts">
	// The plan card's checklist: a done step shows a check, the current one
	// is bold, a failed one shows in the error color and one that waits for
	// the reader has a 6px caution dot, with the reason on the line below.
	// In LynShen's agent team a step names the subagent it belongs to, a
	// click away from its conversation.
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import { t } from '$lib/i18n';
	import { shortPath, type AgentRow } from '$lib/agentProgress';
	import type { OpenHow } from './subagentPages.svelte';
	import type { PlanCard, StepReason } from './progressCards';

	let {
		card,
		rows = [],
		onOpen
	}: {
		card: PlanCard;
		rows?: AgentRow[];
		/** Shows a subagent's conversation. Absent: owners are not links. */
		onOpen?: (row: AgentRow, how: OpenHow) => void;
	} = $props();

	const ownerRow = (agent: string) => (agent ? rows.find((r) => r.id === agent) : undefined);
	function reasonText(r: StepReason): string {
		switch (r.kind) {
			case 'approval':
				return t('chat.progress.waitApproval');
			case 'question':
				return t('chat.progress.waitQuestion');
			case 'agent':
				return r.error ? t('chat.progress.agentFailedWhy', { name: r.name, error: r.error }) : t('chat.progress.agentFailed', { name: r.name });
			case 'turn':
				return t('chat.progress.turnFailed', { error: r.error });
		}
	}

	// The step being worked on (or the one that needs the reader) comes into
	// view in the card's own scroll box (data-card-scroll); scrollIntoView
	// would scroll the panes around it too.
	let list = $state<HTMLElement | null>(null);
	$effect(() => {
		const i = card.attention >= 0 ? card.attention : card.current;
		const box = list?.closest<HTMLElement>('[data-card-scroll]');
		const el = list?.querySelector<HTMLElement>(`[data-step="${i}"]`);
		if (i < 0 || !box || !el) return;
		const b = box.getBoundingClientRect();
		const r = el.getBoundingClientRect();
		if (r.top < b.top) box.scrollTop -= b.top - r.top;
		else if (r.bottom > b.bottom) box.scrollTop += Math.min(r.bottom - b.bottom, r.top - b.top);
	});
</script>

<ol class="steps" bind:this={list}>
	{#each card.steps as s, i (i)}
		{@const owner = ownerRow(s.agent)}
		<li class="step {s.state}" class:current={s.current} data-step={i} aria-current={s.current ? 'step' : undefined}>
			<span class="mark" role={s.state === 'pending' || s.state === 'active' ? undefined : 'img'} aria-label={s.state === 'pending' || s.state === 'active' ? undefined : t(`chat.progress.step.${s.state}`)}>
				{#if s.state === 'done'}<CheckIcon size={12} weight="bold" />
				{:else if s.state === 'failed' || s.state === 'waiting'}<span class="dot"></span>{/if}
			</span>
			<span class="body">
				<span class="text" title={s.files.length ? s.files.join('\n') : undefined}>{s.text}</span>
				{#if s.reason}<span class="why">{reasonText(s.reason)}</span>{/if}
			</span>
			{#if s.agent}
				<button
					class="owner"
					disabled={!onOpen || !owner}
					onclick={(e) => owner && onOpen?.(owner, e.metaKey || e.ctrlKey ? 'other' : 'default')}
					title={t('chat.progress.owner', { name: shortPath(s.agent) })}
					aria-label={t('chat.progress.owner', { name: shortPath(s.agent) })}>{owner?.label ?? shortPath(s.agent)}</button
				>
			{/if}
		</li>
	{/each}
</ol>

<style>
	.steps {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.step {
		display: grid;
		grid-template-columns: 14px minmax(0, 1fr) auto;
		align-items: start;
		column-gap: 6px;
		padding: 4px 8px;
		font-size: var(--fs-sm);
		line-height: 18px;
		color: var(--text);
	}
	.mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 18px;
		color: var(--dim);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--r-full);
	}
	.step.waiting .dot {
		background: var(--warn);
	}
	.step.failed .dot {
		background: var(--err);
	}
	.body {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.text {
		overflow-wrap: anywhere;
	}
	/* 500, not 600: 600 is for page, section and group titles (design.md §4 "Type"). */
	.step.current .text {
		font-weight: 500;
	}
	.step.done .text {
		color: var(--dim);
	}
	.step.skipped .text {
		color: var(--dim2);
		text-decoration: line-through;
	}
	.step.failed .text {
		color: var(--err);
	}
	.why {
		font-size: var(--fs-xs);
		line-height: 16px;
		color: var(--dim);
		overflow-wrap: anywhere;
	}
	/* The subagent a step belongs to (LynShen's agent team). */
	.owner {
		max-width: 96px;
		margin: 0 -4px 0 0;
		padding: 0 4px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 18px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-base),
			color var(--t-fast) var(--ease-base);
	}
	.owner:disabled {
		cursor: default;
	}
	.owner:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.owner:focus-visible {
		outline-offset: -2px;
	}
</style>
