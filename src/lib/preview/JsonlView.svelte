<script lang="ts">
	// A JSON Lines file as its records, one per line, each folded to one
	// line of its text; a click lays a record out as formatted JSON. Records
	// come JSONL_PAGE at a time, so a file of thousands of lines draws fast.
	import { SvelteSet } from 'svelte/reactivity';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import Markdown from '$lib/Markdown.svelte';
	import Button from '$lib/ui/Button.svelte';
	import { t } from '$lib/i18n';
	import { JSONL_PAGE, prettyJson, type JsonlRecord } from './kinds';

	let { records }: { records: JsonlRecord[] } = $props();

	let shown = $state(JSONL_PAGE);
	const open = new SvelteSet<number>();
	const toggle = (line: number) => (open.has(line) ? open.delete(line) : open.add(line));

	/** A record as a fenced JSON block, its fence longer than any run of
	 *  backticks in it. */
	function block(raw: string): string {
		const body = prettyJson(raw) ?? raw;
		const longest = Math.max(0, ...(body.match(/`+/g) ?? []).map((run) => run.length));
		const fence = '`'.repeat(Math.max(3, longest + 1));
		return `${fence}json\n${body}\n${fence}`;
	}
</script>

<div class="records">
	{#each records.slice(0, shown) as r (r.line)}
		<div class="rec" class:open={open.has(r.line)}>
			<button
				type="button"
				class="rrow"
				aria-expanded={open.has(r.line)}
				title={r.ok ? undefined : t('preview.badRecord')}
				onclick={() => toggle(r.line)}
			>
				<span class="ln">{r.line}</span>
				<span class="caret"><CaretRightIcon size={11} aria-hidden="true" /></span>
				{#if !r.ok}<span class="bad"><WarningIcon size={12} aria-hidden="true" /></span>{/if}
				<span class="raw">{r.raw.length > 600 ? `${r.raw.slice(0, 600)}…` : r.raw}</span>
			</button>
			{#if open.has(r.line)}
				<div class="pretty"><Markdown text={block(r.raw)} /></div>
			{/if}
		</div>
	{/each}
	{#if records.length > shown}
		<div class="more">
			<Button variant="ghost" size="sm" onclick={() => (shown += JSONL_PAGE)}>{t('preview.showMore', { n: Math.min(JSONL_PAGE, records.length - shown) })}</Button>
		</div>
	{/if}
</div>

<style>
	.records {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 6px 8px 16px;
	}
	.rrow {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		min-width: 0;
		height: 28px;
		padding: 0 8px 0 4px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		text-align: left;
		cursor: pointer;
	}
	.rrow:hover,
	.open .rrow {
		background: var(--surface2);
	}
	.ln {
		flex-shrink: 0;
		min-width: 4ch;
		color: var(--dim);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}
	.caret {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim);
		transition: transform var(--t-fast) var(--ease-out);
	}
	.open .caret {
		transform: rotate(90deg);
	}
	.raw {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	.bad {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--warn);
	}
	.pretty {
		margin: 4px 0 8px calc(4ch + 31px);
		font-size: var(--fs-xs);
	}
	.more {
		display: flex;
		justify-content: center;
		padding-top: 8px;
	}
</style>
