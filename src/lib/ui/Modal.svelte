<script lang="ts">
	// The app's modal: scrim, a centred sheet with an optional title row and
	// footer, focus kept inside, Escape and a scrim click close it (a press
	// that starts in the sheet does not; ui/scrimClick). Callers render it
	// inside {#if}; entrance and exit use ui/motion.
	import type { Snippet } from 'svelte';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import { focusTrap } from '$lib/focusTrap';
	import { t } from '$lib/i18n';
	import { scrim, sheet } from './motion';
	import { scrimClick } from './scrimClick';

	let {
		title,
		icon,
		label,
		width = 460,
		placement = 'center',
		dismissible = true,
		padded = true,
		onClose,
		children,
		footer
	}: {
		title?: string;
		icon?: Snippet;
		/** Accessible name when there is no visible title. */
		label?: string;
		width?: number;
		/** 'top' for palettes and pickers that list results under a search box. */
		placement?: 'center' | 'top';
		/** False while a request is in flight: Escape and the scrim do nothing. */
		dismissible?: boolean;
		/** False for sheets that lay out their own body (palettes, settings). */
		padded?: boolean;
		onClose: () => void;
		children: Snippet;
		footer?: Snippet;
	} = $props();

	// A pane that animates in with a transform would make `position: fixed`
	// relative to the pane (the dialog showed in the chat area, then jumped to
	// the window). The scrim lives under <body>; the wrapper stays in the tree
	// so Svelte removes its own node, and the action takes the moved one.
	// The sheet's focusTrap runs first and focuses its first control; moving
	// the scrim blurs it, and Escape then reached nothing until a click.
	function portal(node: HTMLElement) {
		const focused = document.activeElement;
		document.body.appendChild(node);
		if (focused instanceof HTMLElement && focused !== document.activeElement && node.contains(focused)) focused.focus();
		return { destroy: () => node.remove() };
	}

	const away = scrimClick(() => dismissible && onClose());

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && dismissible) {
			e.stopPropagation();
			onClose();
		}
	}
</script>

<div class="modal-root">
<div
	use:portal
	class="scrim {placement}"
	role="presentation"
	in:scrim|global
	out:scrim|global
	onpointerdown={away.onpointerdown}
	onclick={away.onclick}
	onkeydown={onKey}
>
	<div
		class="sheet"
		role="dialog"
		aria-modal="true"
		aria-label={title ?? label}
		tabindex="-1"
		style:width="min({width}px, calc(100vw - 48px))"
		in:sheet|global
		out:sheet|global
		use:focusTrap
	>
		{#if title}
			<div class="head">
				<span class="title">{#if icon}{@render icon()}{/if}{title}</span>
				<button class="x" aria-label={t('common.close')} disabled={!dismissible} onclick={onClose}><XIcon size={18} /></button>
			</div>
		{/if}
		<div class="body" class:padded>{@render children()}</div>
		{#if footer}<div class="foot">{@render footer()}</div>{/if}
	</div>
</div>
</div>

<style>
	.modal-root {
		display: contents;
	}
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	/* Both blurs sit on pseudo-elements. On the scrim itself, backdrop-filter
	   would make it the backdrop root of the sheet, whose blur would then see
	   only the scrim fill; on the sheet itself, it would make the sheet the
	   containing block of its fixed children (menus, click-away backdrops). */
	.scrim::before,
	.sheet::before {
		content: '';
		position: absolute;
		inset: 0;
		z-index: -1;
		border-radius: inherit;
		pointer-events: none;
	}
	.scrim::before {
		background: var(--scrim);
		-webkit-backdrop-filter: blur(8px);
		backdrop-filter: blur(8px);
	}
	.sheet::before {
		background: var(--glass-strong);
		-webkit-backdrop-filter: var(--glass-blur);
		backdrop-filter: var(--glass-blur);
	}
	.scrim.top {
		align-items: flex-start;
		padding-top: 12vh;
	}
	.sheet {
		display: flex;
		flex-direction: column;
		max-height: 84vh;
		/* clip, not hidden: a hidden overflow can still be scrolled by focus
		   or scrollIntoView, which slides the head out of view. */
		overflow: hidden;
		overflow: clip;
		position: relative;
		isolation: isolate;
		border-radius: var(--r-xl);
		box-shadow: var(--shadow-modal);
		outline: none;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 16px 16px 4px 22px;
	}
	.title {
		display: inline-flex;
		flex: 1;
		min-width: 0;
		align-items: center;
		gap: 10px;
		color: var(--text);
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.x {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.x:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.body {
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow-y: auto;
	}
	.body.padded {
		gap: 14px;
		padding: 14px 22px 20px;
	}
	.foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		padding: 0 22px 20px;
	}
</style>
