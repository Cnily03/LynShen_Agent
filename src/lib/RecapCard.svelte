<script lang="ts">
	// The end of a turn hands control back (recap.ts): what the turn did, a
	// question, the next step as the one primary button, "not now" and ×.
	// ⌘↵ (Ctrl+↵) picks the primary and Esc closes, on the active pane while
	// the composer is empty; the keys show only in the tooltips. It waits for
	// the reader, so it only fades in (--t-wait) and takes no focus.
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { getLocale, t } from '$lib/i18n';
	import { isMac } from '$lib/shortcuts';
	import { isPickKey, keysFree, pickKeyLabel, type Recap } from '$lib/recap';

	let {
		recap,
		keys = false,
		composer = null,
		onPick,
		onSkip,
		onClose
	}: {
		recap: Recap;
		/** Answers ⌘↵ and Esc (the active pane, its composer empty). */
		keys?: boolean;
		/** The composer's editor: keys typed there still reach the card
		 *  while its menu is closed. */
		composer?: Element | null;
		onPick: () => void;
		onSkip: () => void;
		onClose: () => void;
	} = $props();

	const id = $props.id();
	const mac = isMac();
	const primary = $derived(recap.suggestion || t('chat.recap.review'));
	// The figures in mono, inside the sentence the locale words.
	const changed = $derived(
		recap.turn.files > 0
			? t(recap.turn.files === 1 ? 'chat.recap.changedOne' : 'chat.recap.changed', { n: recap.turn.files, lines: '\u0001' }).split('\u0001')
			: null
	);
	const gap = $derived(getLocale() === 'zh' ? '' : ' ');

	function onKey(e: KeyboardEvent) {
		if (!keys || e.isComposing || e.keyCode === 229) return;
		const pick = isPickKey(e, mac);
		const esc = e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
		if (!(pick || esc) || !keysFree(document.activeElement, composer, document)) return;
		e.preventDefault();
		e.stopPropagation();
		if (pick) onPick();
		else onClose();
	}
</script>

<svelte:window onkeydowncapture={onKey} />
<section class="recap" aria-labelledby="{id}-title">
	<div class="head">
		<span class="title" id="{id}-title">{t('chat.recap.title')}</span>
		<IconButton size="sm" label={t('chat.recap.close')} title="{t('chat.recap.close')} · Esc" onclick={onClose}><XIcon size={14} /></IconButton>
	</div>
	{#if changed || recap.summary}
		<p class="result">
			{#if changed}{changed[0]}<span class="mono">+{recap.turn.added} −{recap.turn.removed}</span>{changed[1]}{gap}{/if}{recap.summary}
		</p>
	{/if}
	<p class="ask">{t(recap.suggestion ? 'chat.recap.askContinue' : 'chat.recap.askReview')}</p>
	<div class="acts">
		<span class="go">
			<Button variant="primary" size="sm" title="{primary} · {pickKeyLabel(mac)}" onclick={onPick}><span class="label">{primary}</span></Button>
		</span>
		<Button variant="secondary" size="sm" onclick={onSkip}>{t('chat.recap.notNow')}</Button>
	</div>
</section>

<style>
	/* Raised like the approval card (it waits for a decision): --panel,
	   1px --border, --r-lg, --shadow-float; with glass the same tint and rim.
	   Only a fade in, fill backwards: no transform is left on it. */
	.recap {
		position: relative;
		padding: 10px 14px 12px;
		background: var(--panel);
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-float);
		font-size: var(--fs-sm);
		line-height: 20px;
		color: var(--text);
		animation: fade var(--t-wait) var(--ease-enter) backwards;
	}
	/* With glass, as the approval card (app.css): the thinned fill and its
	   blur on a layer behind the card, the rim on the card. */
	:global(:root[data-glass]) .recap {
		isolation: isolate;
		background: none;
		border-color: transparent;
		box-shadow:
			inset 0 1px 0 var(--glass-rim),
			inset 0 0 0 1px color-mix(in oklab, var(--glass-rim) 60%, transparent),
			var(--shadow-float);
	}
	:global(:root[data-glass]) .recap::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: inherit;
		background: color-mix(in oklab, var(--panel) var(--float-tint), transparent);
		-webkit-backdrop-filter: var(--glass-filter);
		backdrop-filter: var(--glass-filter);
		pointer-events: none;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-right: -6px;
	}
	.title {
		flex: 1;
		min-width: 0;
		font-size: var(--fs-sm);
		font-weight: 500;
		line-height: 20px;
	}
	.result {
		margin: 4px 0 0;
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		overflow: hidden;
		overflow-wrap: anywhere;
	}
	.mono {
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.ask {
		margin: 8px 0 10px;
	}
	.acts {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	/* A long suggestion keeps one line and ends in an ellipsis; the full
	   text is in the tooltip. */
	.go {
		display: flex;
		min-width: 0;
	}
	.go :global(.b) {
		min-width: 0;
		max-width: 100%;
	}
	.label {
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
