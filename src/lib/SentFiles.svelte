<script lang="ts">
	// The files and videos a user message sent, as chips above its bubble (the
	// bubble shows only what was typed; see attachments.ts). A chip names the
	// file and its folder; the full path is its tooltip. With `onOpen` a chip
	// opens the file (with the message's list of files: only those may be
	// previewed); without (the phone page) it only shows it.
	import FilmStripIcon from 'phosphor-svelte/lib/FilmStripIcon';
	import { fileKind, fileName, folderOf, type SentVideo } from '$lib/attachments';
	import { FILE_ICONS } from '$lib/fileIcons';
	import { t } from '$lib/i18n';

	let {
		files,
		videos = [],
		onOpen
	}: {
		files: string[];
		videos?: SentVideo[];
		onOpen?: (path: string, files: string[]) => void;
	} = $props();

	/** The name of the folder the file is in (the tooltip has the whole path). */
	function folderLabel(path: string): string {
		const dir = folderOf(path);
		return dir ? fileName(dir) : '';
	}
</script>

<div class="ufiles">
	{#each files as path, i (i)}
		{@const Icon = FILE_ICONS[fileKind(path)]}
		{@const folder = folderLabel(path)}
		{#if onOpen}
			<button type="button" class="ufile" title={path} aria-label={t('chat.openAttachment', { name: fileName(path) })} onclick={() => onOpen(path, files)}>
				<Icon size={13} aria-hidden="true" /><span class="uname">{fileName(path)}</span>{#if folder}<span class="udir">{folder}</span>{/if}
			</button>
		{:else}
			<span class="ufile" title={path}>
				<Icon size={13} aria-hidden="true" /><span class="uname">{fileName(path)}</span>{#if folder}<span class="udir">{folder}</span>{/if}
			</span>
		{/if}
	{/each}
	{#each videos as v, i (i)}
		<span class="ufile" title={v.name}>
			<FilmStripIcon size={13} aria-hidden="true" /><span class="uname">{v.name}</span><span class="udir">{t('chat.videoMeta', { s: v.duration.toFixed(0), n: v.frames })}</span>
		</span>
	{/each}
</div>

<style>
	.ufiles {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 6px;
		max-width: 100%;
	}
	.ufile {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		max-width: 100%;
		padding: 6px 11px 6px 10px;
		border: none;
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		line-height: 1.3;
		text-align: left;
		/* The chips are not part of the message's text. */
		-webkit-user-select: none;
		user-select: none;
	}
	.ufile :global(svg) {
		flex-shrink: 0;
		color: var(--dim);
	}
	button.ufile {
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	button.ufile:hover {
		background: color-mix(in oklab, var(--text) 10%, transparent);
	}
	button.ufile:active {
		background: color-mix(in oklab, var(--text) 13%, transparent);
	}
	.uname {
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
	}
	/* A long folder gives way before the file's name does. */
	.udir {
		flex-shrink: 4;
		min-width: 2.5em;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
</style>
