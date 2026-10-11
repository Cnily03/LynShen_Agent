<script lang="ts">
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { slide } from 'svelte/transition';
	import ToolCard from '$lib/ToolCard.svelte';
	import { t } from '$lib/i18n';
	import type { Delivery } from '$lib/delivery';

	let {
		delivery,
		onOpenSession
	}: {
		delivery: Delivery;
		/** Opens the conversation another conversation's message came from:
		 *  its label is the link, the rest of the line opens the message. */
		onOpenSession?: (session: string) => void;
	} = $props();

	let open = $state(false);
	const preview = $derived(delivery.kind === 'message' ? (delivery.body.split('\n').find((l) => l.trim()) ?? '') : '');
	const source = $derived(delivery.kind === 'message' && onOpenSession ? delivery.source : undefined);
</script>

<div class="delivery">
	{#if delivery.kind === 'message'}
		{#if source}
			<div class="dhead split">
				<button class="dlabel dsrc" onclick={() => onOpenSession?.(source.session)} title={t('chat.delivery.openSource', { title: source.title })}>{delivery.label}</button>
				<button class="dmore" class:open onclick={() => (open = !open)} disabled={!delivery.body.trim()} aria-expanded={open} aria-label={t('chat.delivery.showMessage')}>
					{#if !open && preview}<span class="dpreview">{preview}</span>{/if}
					{#if delivery.body.trim()}<span class="rchev"><CaretRightIcon size={13} /></span>{/if}
				</button>
			</div>
		{:else}
			<button class="dhead" class:open onclick={() => (open = !open)} disabled={!delivery.body.trim()}>
				<span class="dlabel">{delivery.label}</span>
				{#if !open && preview}<span class="dpreview">{preview}</span>{/if}
				{#if delivery.body.trim()}<span class="rchev"><CaretRightIcon size={13} /></span>{/if}
			</button>
		{/if}
		{#if open}
			<div class="dbody" transition:slide={{ duration: 180 }}>{delivery.body}</div>
		{/if}
	{:else}
		<div class="dhead">
			<span class="dlabel">{delivery.label}</span>
			{#if delivery.kind === 'action' && delivery.failed}<span class="dfail">{t('chat.delivery.failed')}</span>{/if}
		</div>
		{#if delivery.kind === 'action'}
			<ToolCard name={delivery.name} output={delivery.output} running={false} isError={delivery.failed} />
		{/if}
	{/if}
</div>

<style>
	.delivery {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.dhead {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		max-width: 100%;
		min-height: 22px;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim2);
		font-size: var(--fs-xs);
		text-align: left;
	}
	button.dhead:not(:disabled) {
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out);
	}
	button.dhead:not(:disabled):hover {
		color: var(--text);
	}
	.dlabel {
		flex-shrink: 0;
		font-weight: 600;
	}
	/* Another conversation's message: the label opens that conversation, the
	   rest of the line the message. */
	.dsrc,
	.dmore {
		min-width: 0;
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: color var(--t-fast) var(--ease-out);
	}
	.dsrc {
		display: block;
		flex-shrink: 0;
		max-width: 24em;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 600;
	}
	.dsrc:hover {
		color: var(--text);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
	.dmore {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-height: 22px;
	}
	.dmore:disabled {
		cursor: default;
	}
	.dmore:not(:disabled):hover {
		color: var(--text);
	}
	.dpreview {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.dfail {
		flex-shrink: 0;
		white-space: nowrap;
		color: var(--err);
	}
	.rchev {
		display: inline-flex;
		flex-shrink: 0;
		transition: transform var(--t-med) var(--ease-spring);
	}
	.dhead.open .rchev,
	.dmore.open .rchev {
		transform: rotate(90deg);
	}
	.dbody {
		padding-left: 18px;
		color: var(--dim);
		font-size: var(--fs-sm);
		line-height: 1.6;
		white-space: pre-wrap;
		word-break: break-word;
	}
</style>
