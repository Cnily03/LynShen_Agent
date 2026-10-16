<script lang="ts">
	// An engine error in the conversation: what went wrong and what to do
	// (errorInfo.ts), with the actions that fix it and the raw text on
	// demand. Errors it does not recognise show as they came. A request the
	// plan refused (planStop.ts) names the window and when it recovers, and
	// offers the ways on side by side, none of them taken for the user:
	// wait for the window (the turn goes on then), pay with the balance and
	// go on, buy or renew a plan, or pick another model.
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { untrack } from 'svelte';
	import { slide } from 'svelte/transition';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';
	import { describeError, stripEngineHint, type ErrorAction, type ErrorInfo } from '$lib/errorInfo';
	import { planStopText, resetFromPlan, resetText } from '$lib/planStop';
	import { trial } from '$lib/trial.svelte';

	let {
		text,
		backend = '',
		provider = '',
		waitingUntil = null,
		onAction,
		onCancelWait,
		onDismiss
	}: {
		text: string;
		backend?: string;
		/** The LynShen engine's provider: tells a wrong key from an expired login. */
		provider?: string;
		/** The turn waits for the plan's window: when it goes on (ms). */
		waitingUntil?: number | null;
		/** `info` carries what the plan refused, with `resetsAt` filled in. */
		onAction?: (action: ErrorAction, info: ErrorInfo) => void;
		onCancelWait?: () => void;
		onDismiss?: () => void;
	} = $props();

	const info = $derived(describeError(text, backend, provider));
	const subject = $derived(info?.subject ?? t('chat.err.thisTool'));
	// When a used-up window recovers: the gateway's answer says, else the plan
	// as last read (read again as the card shows).
	const stop = $derived(info?.plan ?? null);
	const resetsAt = $derived(stop?.code === 'plan_quota_exhausted' ? (stop.resetsAt ?? resetFromPlan(trial.plan, stop.window)) : undefined);
	$effect(() => {
		if (stop?.code === 'plan_quota_exhausted' && stop.resetsAt == null) untrack(() => void trial.refreshStatus());
	});
	const words = $derived(
		stop ? planStopText(stop, resetsAt) : info ? { title: t(`chat.err.${info.kind}.title`, { subject }), hint: t(`chat.err.${info.kind}.hint`, { subject }) } : null
	);
	// Waiting needs a time to wait for.
	const actions = $derived((info?.actions ?? []).filter((a) => a !== 'waitPlan' || resetsAt != null));
	const label = (action: ErrorAction) =>
		action === 'waitPlan' && resetsAt ? t('chat.err.action.waitPlanAt', { time: resetText(resetsAt) }) : t(`chat.err.action.${action}`);
	function act(action: ErrorAction) {
		if (!info || !onAction) return;
		onAction(action, stop ? { ...info, plan: { ...stop, ...(resetsAt ? { resetsAt } : {}) } } : info);
	}
	let showRaw = $state(false);
</script>

{#if info && words}
	<div class="err" role="alert">
		<div class="head">
			<span class="ico"><WarningCircleIcon size={16} weight="bold" /></span>
			<span class="title">{words.title}</span>
			{#if info.status}<span class="code">{info.status}</span>{/if}
			{#if onDismiss}
				<button class="x" aria-label={t('common.close')} onclick={onDismiss}><XIcon size={14} /></button>
			{/if}
		</div>
		<p class="hint">{words.hint}</p>
		{#if waitingUntil != null}
			<p class="wait" role="status">
				{t('chat.planStop.waiting', { time: resetText(waitingUntil) })}
				{#if onCancelWait}<button class="link" onclick={onCancelWait}>{t('chat.planStop.cancelWait')}</button>{/if}
			</p>
		{/if}
		<div class="foot">
			{#if onAction}
				<!-- A plan stop's ways on are equals: no primary among them. -->
				{#each actions as action, i (action)}
					{#if !(action === 'waitPlan' && waitingUntil != null)}
						<Button size="sm" variant={stop || i === 0 ? 'secondary' : 'ghost'} onclick={() => act(action)}>{label(action)}</Button>
					{/if}
				{/each}
			{/if}
			<button class="raw-toggle" class:open={showRaw} onclick={() => (showRaw = !showRaw)}>
				<CaretRightIcon size={12} />{showRaw ? t('chat.err.hideRaw') : t('chat.err.raw')}
			</button>
		</div>
		{#if showRaw}
			<pre class="raw selectable" transition:slide={{ duration: 160 }}>{stripEngineHint(text)}{#if info.requestId}

{t('chat.err.requestId')}: {info.requestId}{/if}</pre>
		{/if}
	</div>
{:else}
	<Notice mono {onDismiss}>{text}</Notice>
{/if}

<style>
	.err {
		padding: 10px 12px;
		border-radius: var(--r-md);
		background: color-mix(in oklab, var(--err) 7%, transparent);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--err) 22%, transparent);
		animation: rise var(--t-fast) var(--ease-out);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.ico {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--err);
	}
	.title {
		flex: 1;
		min-width: 0;
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.code {
		flex-shrink: 0;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.x {
		display: inline-flex;
		flex-shrink: 0;
		padding: 2px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim2);
		cursor: pointer;
	}
	.x:hover {
		color: var(--text);
	}
	.hint {
		margin: 4px 0 0 24px;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.55;
	}
	.foot {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin: 10px 0 0 24px;
	}
	.wait {
		display: flex;
		align-items: baseline;
		gap: 10px;
		margin: 6px 0 0 24px;
		color: var(--text);
		font-size: var(--fs-xs);
	}
	.link {
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
	}
	.link:hover {
		color: var(--text);
	}
	.raw-toggle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim2);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.raw-toggle:hover {
		color: var(--text);
	}
	.raw-toggle :global(svg) {
		transition: transform var(--t-med) var(--ease-spring);
	}
	.raw-toggle.open :global(svg) {
		transform: rotate(90deg);
	}
	.raw {
		margin: 8px 0 0 24px;
		padding: 8px 10px;
		max-height: 160px;
		overflow: auto;
		border-radius: var(--r-sm);
		background: var(--surface);
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
</style>
