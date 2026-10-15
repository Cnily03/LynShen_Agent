<script lang="ts">
	// A card's title line: "计划 3/7 · 跑单元测试" or "子智能体 3 · 2 个运行中".
	// A step that waits for the reader puts a 6px caution dot before the
	// title; a failed step or subagent shows in the error color.
	import { t } from '$lib/i18n';
	import type { AgentsTitle, PlanTitle } from './progressCards';

	let { plan, agents }: { plan?: PlanTitle; agents?: AgentsTitle } = $props();
</script>

<span class="tl">
	{#if plan}
		{#if plan.tone === 'waiting'}<span class="dot warn" aria-hidden="true"></span>{/if}
		<span class="lbl">{t('chat.progress.plan')}</span>
		<span class="num">{plan.count}</span>
		{#if plan.step || plan.allDone}
			<span class="sep" aria-hidden="true">·</span>
			<span class="what" class:err={plan.tone === 'failed'}>{plan.step || t('chat.progress.allDone')}</span>
		{/if}
	{:else if agents}
		<span class="lbl">{t('chat.progress.agents')}</span>
		<span class="num">{agents.count}</span>
		<span class="sep" aria-hidden="true">·</span>
		{#if agents.running}<span class="what">{t('chat.progress.runningN', { n: agents.running })}</span>
		{:else if agents.failed}<span class="what err">{t('chat.progress.failedN', { n: agents.failed })}</span>
		{:else}<span class="what">{t('chat.progress.allDone')}</span>{/if}
	{/if}
</span>

<style>
	.tl {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		white-space: nowrap;
	}
	.lbl {
		flex: none;
		font-weight: 500;
		color: var(--text);
	}
	.num {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}
	.sep {
		flex: none;
		color: var(--dim2);
	}
	.what {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--dim);
	}
	.what.err {
		color: var(--err);
	}
	.dot {
		flex: none;
		width: 6px;
		height: 6px;
		border-radius: var(--r-full);
	}
	.dot.warn {
		background: var(--warn);
	}
</style>
