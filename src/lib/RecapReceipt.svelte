<script lang="ts">
	// What the reader did with a turn's recap card (recap.ts), one line under
	// the turn's reply: it stays with the turn as the next one comes in below.
	// A new receipt fades in once the card has collapsed (--t-base).
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import MinusIcon from 'phosphor-svelte/lib/MinusIcon';
	import { t } from '$lib/i18n';
	import type { RecapOutcome } from '$lib/recap';

	let { outcome }: { outcome: RecapOutcome } = $props();

	const what = $derived(outcome.what || t('chat.recap.review'));
	// The locale's words around the choice, which keeps its own line.
	const words = $derived(t(outcome.choice === 'picked' ? 'chat.recap.picked' : 'chat.recap.skipped', { what: '\u0001' }).split('\u0001'));
	// Only just chosen: the fade (a row scrolled back into view does not
	// replay it).
	// svelte-ignore state_referenced_locally
	const fresh = Date.now() - outcome.at < 1500;
</script>

<p class="receipt" class:fresh title={what}>
	{#if outcome.choice === 'picked'}<CheckIcon size={12} />{:else}<MinusIcon size={12} />{/if}
	<span class="text">{words[0]}<span class="what">{what}</span>{words[1] ?? ''}</span>
</p>

<style>
	.receipt {
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
		margin: 8px 0 0;
		font-size: var(--fs-xs);
		line-height: 16px;
		color: var(--dim);
	}
	.receipt :global(svg) {
		flex: none;
	}
	.text {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* After the card's collapse (--t-base), the same fade as a card that
	   waits for the reader; fill backwards, opacity only. */
	.fresh {
		animation: fade var(--t-wait) var(--ease-enter) var(--t-base) backwards;
	}
	@media (prefers-reduced-motion: reduce) {
		.fresh {
			animation-delay: 0s;
		}
	}
</style>
