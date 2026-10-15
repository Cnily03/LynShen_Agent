<script lang="ts">
	// One block of a settings page: a small heading over plain rows divided
	// by hairlines (no card). Children are SettingsRows or wide blocks; a
	// wide block lines up with the rows (no side padding).
	import type { Snippet } from 'svelte';

	let {
		title,
		description,
		id,
		action,
		children
	}: {
		title?: string;
		/** Optional gray line under the heading. Settings pages leave it out. */
		description?: string;
		/** Search anchor (element id `set-<id>`, see settings/nav.ts). */
		id?: string;
		/** Small control at the right of the heading (e.g. refresh). */
		action?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section class="sec" id={id ? `set-${id}` : undefined}>
	{#if title || action}
		<div class="head">
			<div class="txt">
				{#if title}<h3>{title}</h3>{/if}
				{#if description}<p>{description}</p>{/if}
			</div>
			{#if action}<div class="act">{@render action()}</div>{/if}
		</div>
	{/if}
	<div class="body">
		{@render children()}
	</div>
</section>

<style>
	.sec {
		margin-top: 36px;
		scroll-margin: 24px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		min-height: 32px;
		margin-bottom: 4px;
	}
	.txt {
		min-width: 0;
	}
	h3 {
		margin: 0;
		font-size: var(--fs-sm);
		font-weight: 600;
		line-height: 18px;
		color: var(--text);
	}
	p {
		margin: 2px 0 0;
		max-width: 64ch;
		font-size: var(--fs-xs);
		line-height: 16px;
		color: var(--dim);
	}
	.act {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-shrink: 0;
	}
	/* Rows, and any direct wide block, are divided by hairlines (doubled class:
	   wins over a child's own `border: none`). */
	.body.body > :global(* + *) {
		border-top: 1px solid var(--hairline);
	}
	/* Search hit: SettingsPage adds .flash for a moment after scrolling here. */
	.sec:global(.flash) .body {
		animation: flash 1.6s var(--ease-out);
	}
	@keyframes flash {
		0%,
		40% {
			background: var(--accent-soft);
		}
		100% {
			background: transparent;
		}
	}
	/* The header's action (a select-all box, a button) keeps its size beside a long description. */
	.head > :global(:not(.txt)) {
		flex-shrink: 0;
	}
</style>
