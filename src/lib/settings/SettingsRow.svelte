<script lang="ts">
	// One setting inside a SettingsSection: title and an optional short gray
	// line on the left, the control on the right. `stacked` puts wide content
	// (a list, a form, a chart) under the text instead. `id` is the search
	// anchor (element id `set-<id>`, see settings/nav.ts).
	import type { Snippet } from 'svelte';

	let {
		title,
		tag,
		description,
		id,
		stacked = false,
		detail,
		children
	}: {
		title?: string;
		/** A small label after the title (`Beta`). */
		tag?: string;
		description?: string;
		id?: string;
		stacked?: boolean;
		/** Extra lines under the description (status, errors). */
		detail?: Snippet;
		children?: Snippet;
	} = $props();
</script>

<div class="row" class:stacked id={id ? `set-${id}` : undefined}>
	{#if title || description || detail}
		<div class="txt">
			{#if title}<div class="title">{title}{#if tag}<span class="tag">{tag}</span>{/if}</div>{/if}
			{#if description}<div class="desc">{description}</div>{/if}
			{#if detail}{@render detail()}{/if}
		</div>
	{/if}
	{#if children}
		<div class="ctl">{@render children()}</div>
	{/if}
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
		min-height: 48px;
		padding: 10px 0;
		scroll-margin: 24px;
	}
	.row.stacked {
		flex-direction: column;
		align-items: stretch;
		justify-content: flex-start;
		gap: 12px;
		padding: 14px 0;
	}
	.txt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.title {
		font-size: var(--fs-sm);
		line-height: 18px;
		color: var(--text);
	}
	.tag {
		display: inline-block;
		margin-left: 8px;
		padding: 0 6px;
		border-radius: var(--r-xs);
		background: var(--surface2);
		font-size: var(--fs-2xs);
		line-height: 1.6;
		vertical-align: 1px;
		color: var(--dim);
	}
	.desc {
		max-width: 52ch;
		font-size: var(--fs-xs);
		line-height: 16px;
		color: var(--dim);
	}
	.ctl {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 8px;
		min-width: 0;
	}
	.stacked .ctl {
		display: block;
	}
	/* Search hit: SettingsPage adds .flash for a moment after scrolling here. */
	.row:global(.flash) {
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
</style>
