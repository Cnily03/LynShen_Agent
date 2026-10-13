<script lang="ts">
	// A file the app does not show (a PDF, an archive, a document, a folder):
	// what it is and where, and the two ways to open it outside the app.
	import type FileIcon from 'phosphor-svelte/lib/FileIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import Button from '$lib/ui/Button.svelte';
	import { fileName } from '$lib/attachments';
	import { when } from '$lib/time';
	import { t } from '$lib/i18n';
	import { extOf, formatSize, IMAGE_PREVIEW_BYTES, type CardReason, type PreviewFacts } from './kinds';

	let {
		facts,
		reason,
		icon: Icon,
		onReveal,
		onOpen
	}: {
		facts: PreviewFacts;
		reason: CardReason;
		icon: typeof FileIcon;
		onReveal: () => void;
		onOpen: () => void;
	} = $props();

	const ext = $derived(extOf(facts.path).toUpperCase());
	const kind = $derived(facts.is_dir ? t('preview.kindFolder') : ext ? t('preview.kindFile', { ext }) : t('preview.kindPlain'));
	const why = $derived(
		reason === 'imageTooLarge' ? t('preview.card.imageTooLarge', { max: formatSize(IMAGE_PREVIEW_BYTES) }) : t(`preview.card.${reason}`)
	);
</script>

<div class="wrap">
	<section class="card">
		<span class="ico"><Icon size={28} aria-hidden="true" /></span>
		<h3 class="name selectable">{fileName(facts.path)}</h3>
		<p class="why">{why}</p>
		{#if facts.runs}<p class="why">{t('preview.card.runs')}</p>{/if}
		<div class="actions">
			{#if !facts.runs}
				<Button variant="primary" size="sm" onclick={onOpen}><ArrowSquareOutIcon size={14} aria-hidden="true" />{t('preview.openDefault')}</Button>
			{/if}
			<Button variant={facts.runs ? 'primary' : 'secondary'} size="sm" onclick={onReveal}><FolderOpenIcon size={14} aria-hidden="true" />{t('preview.reveal')}</Button>
		</div>
		<dl class="facts">
			<dt>{t('preview.facts.kind')}</dt>
			<dd>{kind}</dd>
			{#if !facts.is_dir}
				<dt>{t('preview.facts.size')}</dt>
				<dd class="num">{formatSize(facts.size)}</dd>
			{/if}
			<dt>{t('preview.facts.modified')}</dt>
			<dd class="num">{facts.mtime_ms ? when(facts.mtime_ms) : '—'}</dd>
			<dt>{t('preview.facts.where')}</dt>
			<dd class="path selectable">{facts.path}</dd>
		</dl>
	</section>
</div>

<style>
	.wrap {
		flex: 1;
		min-height: 0;
		overflow: auto;
		display: flex;
		align-items: flex-start;
		justify-content: center;
		padding: 48px 20px 24px;
	}
	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		width: 100%;
		max-width: 440px;
		padding: 24px 24px 20px;
		border-radius: var(--r-lg);
		background: var(--surface);
		text-align: center;
	}
	.ico {
		display: inline-flex;
		color: var(--dim);
		margin-bottom: 10px;
	}
	.name {
		margin: 0;
		max-width: 100%;
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.why {
		margin: 6px 0 0;
		font-size: var(--fs-sm);
		color: var(--dim);
		line-height: 1.5;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 8px;
		margin-top: 16px;
	}
	.facts {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 6px 14px;
		width: 100%;
		margin: 20px 0 0;
		padding-top: 14px;
		border-top: 1px solid var(--hairline);
		font-size: var(--fs-xs);
		text-align: left;
	}
	dt {
		color: var(--dim);
	}
	dd {
		margin: 0;
		min-width: 0;
		color: var(--text);
	}
	.num {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.path {
		font-family: var(--font-mono);
		overflow-wrap: anywhere;
	}
</style>
