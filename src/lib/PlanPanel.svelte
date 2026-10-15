<script lang="ts">
	// The plan tool panel (`plan`): the session's to-do list with the same
	// checklist as the plan card at the top right of the conversation.
	import type { PlanStep } from '$lib/chat.svelte';
	import { planSummary } from '$lib/agentProgress';
	import { planCard } from '$lib/agents/progressCards';
	import PlanBody from '$lib/agents/PlanBody.svelte';
	import { t } from '$lib/i18n';

	let { plan }: { plan: PlanStep[] } = $props();

	const card = $derived(planCard({ plan: planSummary(plan), rows: [], busy: false, wait: null, error: '' }));
</script>

<div class="panel">
	{#if plan.length}
		<div class="head">
			<span class="title">{t('dock.plan.title')}</span>
			<span class="count">{card.done}/{card.total}</span>
		</div>
		<div class="steps" data-card-scroll><PlanBody {card} /></div>
	{:else}
		<p class="empty">{t('dock.plan.emptyHint')}</p>
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		height: 100%;
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 16px 18px 10px;
	}
	.title {
		font-weight: 600;
		font-size: var(--fs-sm);
	}
	.count {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}
	.steps {
		min-height: 0;
		padding: 0 10px 16px;
		overflow-y: auto;
	}
	.empty {
		margin: 0;
		padding: 16px 18px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
</style>
