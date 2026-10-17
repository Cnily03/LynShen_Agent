<script lang="ts">
	// The work status line under the transcript: one sign, what the turn is
	// doing in words ("正在运行 pnpm vitest run"), how long this step has
	// taken, and "›" to the running tool call's details (workStatus.ts). The
	// words change at once when the step does; only the sign moves.
	import AsteriskSimpleIcon from 'phosphor-svelte/lib/AsteriskSimpleIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import type { CallTiming, Msg } from '$lib/chat.svelte';
	import { workElapsed, workStep, type WorkPhase } from '$lib/workStatus';

	let {
		phase,
		tokens = 0,
		call = null,
		messages = [],
		onDetails
	}: {
		/** ChatState.phase. */
		phase: WorkPhase | (string & {}) | null;
		/** What a running compaction has written. */
		tokens?: number;
		/** The model request in flight. */
		call?: CallTiming | null;
		messages?: readonly Msg[];
		/** Show a tool call's details (its card in the transcript). */
		onDetails?: (call: Extract<Msg, { kind: 'tool' }>) => void;
	} = $props();

	const step = $derived(workStep(phase, call, messages));
	const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);
	const object = $derived(step?.verb === 'compacting' && tokens > 0 ? t('chat.tokens', { n: fmt(tokens) }) : (step?.object ?? ''));

	// When this step began: a tool call's own start; otherwise the request
	// stage's start for the first step this line shows, and the moment the
	// words changed for the next ones (a stage can hold two steps: thinking,
	// then writing).
	let anchor = $state<{ key: string; since: number } | null>(null);
	$effect.pre(() => {
		const s = step;
		untrack(() => {
			if (!s) anchor = null;
			else if (anchor?.key !== s.key) anchor = { key: s.key, since: s.exact || !anchor ? (s.since ?? Date.now()) : Date.now() };
		});
	});
	let now = $state(Date.now());
	$effect(() => {
		if (!anchor) return;
		now = Date.now();
		const timer = setInterval(() => (now = Date.now()), 500);
		return () => clearInterval(timer);
	});
</script>

{#if step}
	<div class="ind">
		<span class="sign" aria-hidden="true"><AsteriskSimpleIcon size={12} weight="bold" /></span>
		<span class="verb">{t(`chat.work.${step.verb}`)}</span>
		{#if object}<span class="obj" title={object}>{object}</span>{/if}
		{#if anchor}<span class="time">· {workElapsed(now - anchor.since)}</span>{/if}
		{#if step.call && onDetails}
			{@const running = step.call}
			<button class="more" onclick={() => onDetails(running)} aria-label={t('chat.work.details')} title={t('chat.work.details')}>
				<CaretRightIcon size={12} />
			</button>
		{/if}
	</div>
{/if}

<style>
	.ind {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		height: 24px;
		padding: 0 2px;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 16px;
	}
	/* The one sign: it turns slowly while the turn works (still under
	   reduced motion, app.css). */
	.sign {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim);
		animation: spin calc(2.4s * var(--time-scale)) linear infinite;
	}
	.verb {
		flex-shrink: 0;
		white-space: nowrap;
	}
	.obj {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
	}
	.time {
		flex-shrink: 0;
		color: var(--dim2);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}
	.more {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim2);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-base),
			color var(--t-fast) var(--ease-base);
	}
	.more:hover {
		background: var(--surface2);
		color: var(--text);
	}
</style>
