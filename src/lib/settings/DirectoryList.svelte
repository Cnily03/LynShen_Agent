<script lang="ts">
	// Directories besides the working directory, one row each: the path, an
	// optional label of where it applies, read-only or read-write, remove.
	// The Agent page and Settings → 权限与沙箱 use it.
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { t } from '$lib/i18n';

	type DirMode = 'ro' | 'rw';
	let {
		items,
		empty,
		onMode,
		onRemove
	}: {
		/** `badge`: where the directory applies (所有项目, a project's name). */
		items: { path: string; mode: DirMode; badge?: string; badgeTitle?: string }[];
		/** The line in place of an empty list. */
		empty: string;
		onMode: (index: number, mode: DirMode) => void;
		onRemove: (index: number) => void;
	} = $props();

	const MODES = $derived([
		{ value: 'ro', label: t('shell.agentPage.readOnly') },
		{ value: 'rw', label: t('shell.agentPage.readWrite') }
	]);
</script>

{#each items as dir, index (`${dir.badgeTitle ?? ''}\n${dir.path}`)}
	<div class="item">
		<code class="grow" title={dir.path}>{dir.path}</code>
		{#if dir.badge}<span class="badge" title={dir.badgeTitle ?? dir.badge}>{dir.badge}</span>{/if}
		<div class="pick">
			<Select value={dir.mode} options={MODES} onChange={(mode) => onMode(index, mode as DirMode)} />
		</div>
		<IconButton label={t('shell.agentPage.remove')} onclick={() => onRemove(index)}>
			<XIcon size={13} />
		</IconButton>
	</div>
{:else}
	<p class="none">{empty}</p>
{/each}

<style>
	.item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px 10px 18px;
	}
	.grow {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	code.grow {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		color: var(--text);
	}
	/* One width, so the controls line up whatever the label. */
	.badge {
		flex: none;
		width: 120px;
		text-align: right;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.pick {
		flex: none;
		width: 120px;
	}
	.none {
		margin: 0;
		padding: 16px 18px;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
</style>
