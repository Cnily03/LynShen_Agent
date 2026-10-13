<script lang="ts">
	// A file a sent message names, in a tab beside the conversation: its
	// text in a read-only code view (Markdown laid out, JSON formatted, JSON
	// Lines as records, each with its source a click away), an image fitted
	// with zoom, or a card for what the app does not show (PDFs, archives,
	// documents, folders). The header always offers the file's folder and
	// its default app. Only a file a click asked for is read (store.svelte.ts).
	import { untrack } from 'svelte';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import FileXIcon from 'phosphor-svelte/lib/FileXIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import MagnifyingGlassPlusIcon from 'phosphor-svelte/lib/MagnifyingGlassPlusIcon';
	import MagnifyingGlassMinusIcon from 'phosphor-svelte/lib/MagnifyingGlassMinusIcon';
	import CornersOutIcon from 'phosphor-svelte/lib/CornersOutIcon';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Markdown from '$lib/Markdown.svelte';
	import { previewFile, openFileDefault } from '$lib/protocol';
	import { editorStore } from '$lib/editor/editorStore.svelte';
	import { fileKind, fileName, folderOf, isInside } from '$lib/attachments';
	import { FILE_ICONS } from '$lib/fileIcons';
	import { toast } from '$lib/ui/toast.svelte';
	import { when } from '$lib/time';
	import { t } from '$lib/i18n';
	import { filePreviews } from './store.svelte';
	import {
		canRender,
		codeText,
		formatSize,
		jsonlRecords,
		LINE_MAX,
		previewView,
		textBytesFor,
		TEXT_PREVIEW_BYTES,
		zoomStep,
		type PreviewFacts,
		type TextMode
	} from './kinds';
	import CodeView from './CodeView.svelte';
	import JsonlView from './JsonlView.svelte';
	import ImageView from './ImageView.svelte';
	import FileCard from './FileCard.svelte';

	/** `root`: the project of the conversation; a text file inside it can
	 *  move to the editor. */
	let { path, root = '' }: { path: string; root?: string } = $props();

	let read = $state<{ facts: PreviewFacts } | { error: unknown } | undefined>();
	let imageFailed = $state(false);
	let seq = 0;
	async function load() {
		const n = ++seq;
		read = undefined;
		imageFailed = false;
		try {
			const facts = await previewFile(path, textBytesFor(path));
			if (n === seq) read = { facts };
		} catch (error) {
			if (n === seq) read = { error };
		}
	}
	const asked = $derived(filePreviews.asked(path));
	$effect(() => {
		if (asked) untrack(() => void load());
	});

	const view = $derived(asked ? previewView(path, read, imageFailed) : null);
	const facts = $derived(read && 'facts' in read ? read.facts : null);
	/** The real path once read (symlinks resolved), the sent one before. */
	const real = $derived(facts?.path ?? path);
	const Icon = $derived(FILE_ICONS[facts?.is_dir ? 'folder' : fileKind(path)]);
	/** The folder and the default app: once read, or when the read failed
	 *  for another reason than the file being gone. */
	const actionable = $derived(!!facts || view?.view === 'error');

	const text = $derived(view?.view === 'text' ? view : null);
	let chosen = $state<TextMode | null>(null);
	const renderable = $derived(!!text && canRender(text.kind, text.text));
	const rendered = $derived(renderable && (chosen ?? 'rendered') === 'rendered');
	const records = $derived(text?.kind === 'jsonl' ? jsonlRecords(text.text, text.truncated) : null);
	const code = $derived(
		text && text.text && !(rendered && (text.kind === 'markdown' || text.kind === 'jsonl'))
			? codeText(text.kind, rendered ? 'rendered' : 'source', text.text)
			: null
	);
	/** The language of the code view (JSON Lines read as JSON). */
	const langName = $derived(text?.kind === 'json' || text?.kind === 'jsonl' ? 'x.json' : fileName(path));
	const notJson = $derived(text?.kind === 'json' && rendered && !!code && !code.formatted);
	const noted = $derived(!!text && (text.truncated || text.lossy || !!code?.clipped || notJson));

	let zoom = $state<'fit' | number>('fit');
	let scale = $state(1);

	const canEdit = $derived(!!root && !!text && !text.truncated && !text.lossy && isInside(real, root));
	const failed = (e: unknown) => toast.error(t('preview.openFailed', { error: String(e) }));
	const openInEditor = () => editorStore.open(real, root).catch(failed);
	const reveal = () => revealItemInDir(real).catch(failed);
	const openDefault = () => openFileDefault(real).catch(failed);
</script>

<div class="preview">
	<header class="head">
		<div class="row">
			<span class="ficon"><Icon size={15} aria-hidden="true" /></span>
			<span class="name selectable" title={real}>{fileName(path)}</span>
			{#if canEdit}
				<IconButton size="sm" label={t('preview.openInEditor')} title={t('preview.openInEditor')} onclick={openInEditor}><PencilSimpleIcon size={14} /></IconButton>
			{/if}
			<Button variant="ghost" size="sm" disabled={!actionable} aria-label={t('preview.reveal')} title={t('preview.reveal')} onclick={reveal}>
				<FolderOpenIcon size={14} aria-hidden="true" /><span class="blabel">{t('preview.reveal')}</span>
			</Button>
			{#if !facts?.runs}
				<Button variant="ghost" size="sm" disabled={!actionable} aria-label={t('preview.openDefault')} title={t('preview.openDefault')} onclick={openDefault}>
					<ArrowSquareOutIcon size={14} aria-hidden="true" /><span class="blabel">{t('preview.openDefault')}</span>
				</Button>
			{/if}
		</div>
		<div class="meta">
			<span class="where" title={folderOf(real)}><bdi>{folderOf(real)}</bdi></span>
			{#if facts && !facts.is_dir}<span class="num">{formatSize(facts.size)}</span>{/if}
			{#if facts?.mtime_ms}<span class="num">{when(facts.mtime_ms)}</span>{/if}
			{#if records}<span>{t('preview.records', { n: records.length.toLocaleString() })}</span>{/if}
			<span class="grow"></span>
			{#if text && renderable}
				<Segmented
					value={rendered ? 'rendered' : 'source'}
					options={[
						{ value: 'rendered', label: t(`preview.rendered.${text.kind}`) },
						{ value: 'source', label: t('preview.source') }
					]}
					onChange={(v) => (chosen = v as TextMode)}
				/>
			{:else if view?.view === 'image'}
				<span class="zoom">
					<IconButton size="sm" label={t('preview.zoomOut')} title={t('preview.zoomOut')} onclick={() => (zoom = zoomStep(scale, -1))}><MagnifyingGlassMinusIcon size={14} /></IconButton>
					<span class="num pct">{Math.round(scale * 100)}%</span>
					<IconButton size="sm" label={t('preview.zoomIn')} title={t('preview.zoomIn')} onclick={() => (zoom = zoomStep(scale, 1))}><MagnifyingGlassPlusIcon size={14} /></IconButton>
					<IconButton size="sm" active={zoom === 'fit'} label={t('preview.fit')} title={t('preview.fit')} onclick={() => (zoom = 'fit')}><CornersOutIcon size={14} /></IconButton>
				</span>
			{/if}
		</div>
	</header>

	{#if text && noted}
		<div class="notes">
			{#if text.truncated && facts}<Notice tone="info">{t('preview.truncated', { size: formatSize(facts.size), shown: formatSize(TEXT_PREVIEW_BYTES) })}</Notice>{/if}
			{#if text.lossy}<Notice tone="warn">{t('preview.lossy')}</Notice>{/if}
			{#if code?.clipped}<Notice tone="info">{t('preview.clipped', { n: code.clipped, max: LINE_MAX })}</Notice>{/if}
			{#if notJson}<Notice tone="info">{t('preview.notJson')}</Notice>{/if}
		</div>
	{/if}

	{#if !asked}
		<p class="empty">{t('preview.notAsked')}</p>
	{:else if !view || view.view === 'loading'}
		<div class="center" role="status" aria-label={t('preview.loading')}><CircleNotchIcon size={18} class="spin" /></div>
	{:else if view.view === 'missing'}
		<div class="state">
			<FileXIcon size={28} aria-hidden="true" />
			<h3>{t('preview.missingTitle')}</h3>
			<p>{t('preview.missingBody')}</p>
			<p class="path selectable">{path}</p>
			<Button variant="secondary" size="sm" onclick={load}>{t('preview.retry')}</Button>
		</div>
	{:else if view.view === 'error'}
		<div class="failed">
			<Notice>{t('preview.readFailed', { error: view.message })}</Notice>
			<Button variant="secondary" size="sm" onclick={load}>{t('preview.retry')}</Button>
		</div>
	{:else if view.view === 'card' && facts}
		<FileCard {facts} reason={view.reason} icon={Icon} onReveal={reveal} onOpen={openDefault} />
	{:else if view.view === 'image'}
		<ImageView src={convertFileSrc(real)} alt={fileName(path)} bind:zoom bind:scale onFail={() => (imageFailed = true)} />
	{:else if text}
		{#if !text.text}
			<p class="empty">{t('preview.empty')}</p>
		{:else if rendered && text.kind === 'markdown'}
			<div class="doc"><div class="doc-col selectable"><Markdown text={text.text} /></div></div>
		{:else if rendered && text.kind === 'jsonl' && records}
			<JsonlView {records} />
		{:else if code}
			<CodeView text={code.text} name={langName} />
		{/if}
	{/if}
</div>

<style>
	.preview {
		display: flex;
		flex-direction: column;
		height: 100%;
		min-width: 0;
		background: var(--bg);
		container-type: inline-size;
	}
	.head {
		display: flex;
		flex-direction: column;
		gap: 2px;
		flex-shrink: 0;
		padding: 7px 10px 6px 16px;
		border-bottom: 1px solid var(--hairline);
	}
	.row,
	.meta {
		display: flex;
		align-items: center;
		min-width: 0;
	}
	.row {
		gap: 4px;
		min-height: 32px;
	}
	.ficon {
		display: inline-flex;
		flex-shrink: 0;
		margin-right: 4px;
		color: var(--dim);
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
	}
	.meta {
		gap: 12px;
		/* As tall with a view switch as without: the content does not move
		   between tabs. */
		min-height: 40px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.meta > span {
		flex-shrink: 0;
	}
	/* A long folder keeps its end (the folders nearest the file). */
	.meta > .where {
		flex-shrink: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		direction: rtl;
		text-align: left;
		font-family: var(--font-mono);
	}
	.where bdi {
		direction: ltr;
	}
	.meta > .grow {
		flex: 1;
	}
	.num {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.zoom {
		display: inline-flex;
		align-items: center;
		gap: 2px;
	}
	.pct {
		min-width: 4.5ch;
		text-align: center;
	}
	/* A narrow tab keeps the two actions as icons (their names stay as labels). */
	@container (max-width: 460px) {
		.blabel {
			display: none;
		}
	}
	.notes {
		display: flex;
		flex-direction: column;
		gap: 6px;
		flex-shrink: 0;
		padding: 8px 12px 6px;
	}
	.center {
		flex: 1;
		display: grid;
		place-items: center;
		color: var(--dim);
	}
	.empty {
		margin: 0;
		padding: 18px 16px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.state {
		flex: 1;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 24px;
		text-align: center;
		color: var(--dim);
	}
	.state h3 {
		margin: 6px 0 0;
		font-size: var(--fs-md);
		font-weight: 600;
		color: var(--text);
	}
	.state p {
		margin: 0;
		font-size: var(--fs-sm);
	}
	.state .path {
		max-width: 480px;
		margin-bottom: 10px;
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		overflow-wrap: anywhere;
	}
	.failed {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		padding: 12px;
	}
	.doc {
		flex: 1;
		min-height: 0;
		overflow: auto;
		padding: 20px 24px 32px;
	}
	.doc-col {
		max-width: 760px;
		margin: 0 auto;
		font-size: var(--fs-md);
		color: var(--text);
	}
</style>
