<script lang="ts" module>
	import type IconType from 'phosphor-svelte/lib/CheckIcon';

	export type PopMenuItem = {
		key: string;
		label: string;
		/** Second line in gray under the label. */
		desc?: string;
		icon?: typeof IconType;
		checked?: boolean;
		/** Keyboard shortcut shown at the right, e.g. ⌘C. */
		hint?: string;
		disabled?: boolean;
		/** Risky choice (e.g. full access): label, icon and check in the warning colour. */
		tone?: 'warn';
		/** Section heading: shown above the first item of each group, with a
		 *  divider between groups (as ChatGPT / Claude menus separate them). */
		group?: string;
	};
</script>

<script lang="ts">
	import { popOut } from '$lib/ui/motion';
	// The app's list popover: an optional gray question on top, then rows of
	// icon · label (· gray description) with a check on the current choice.
	// Anchored to its positioned parent; `placement` says which way it opens.
	// It keeps inside the part of the window it can be seen in (ui/menuFit.ts):
	// a long list scrolls its own rows, and the wheel over it never scrolls
	// the page behind it.
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import { t } from '$lib/i18n';
	import { fitMenu, nextRow, scrollToShow, visibleBand, wheelScrolls, type Side } from './menuFit';

	let {
		items,
		title,
		placement = 'down-right',
		fit = true,
		onSelect,
		onClose
	}: {
		items: PopMenuItem[];
		title?: string;
		placement?: 'up-left' | 'up-right' | 'down-left' | 'down-right';
		/** Size and place against the anchor (false: the parent places the
		 *  menu itself, as the context menu does at the pointer). */
		fit?: boolean;
		onSelect: (key: string) => void;
		onClose: () => void;
	} = $props();

	const hasIcons = $derived(items.some((i) => i.icon));

	let menu = $state<HTMLDivElement>();
	// The backdrop takes the click wherever it is on top. An ancestor that
	// stacks or clips it leaves other things over it: under glass the composer
	// is painted over the backdrop of a menu in the masked transcript or in an
	// approval card, and Chromium gives a masked element's backdrop no click
	// outside the mask. A press outside the menu's anchor (its parent: the
	// menu, its button, the backdrop) closes the menu there too.
	function onPress(e: PointerEvent) {
		const anchor = menu?.parentElement;
		if (anchor && !anchor.contains(e.target as Node)) onClose();
	}

	// The side it opens on: the placement's, or the other one when the list
	// does not fit there and has more room on that side. Measured before the
	// first paint, again when the window or the list changes size.
	const asked: Side = $derived(placement.startsWith('up') ? 'up' : 'down');
	let side = $state<Side>();
	const shown = $derived(`${side ?? asked}-${placement.split('-')[1]}`);
	function place() {
		const anchor = menu?.parentElement;
		if (!fit || !menu || !anchor) return;
		const r = anchor.getBoundingClientRect();
		const got = fitMenu({ anchor: { top: r.top, bottom: r.bottom }, band: visibleBand(anchor, menu), natural: menu.scrollHeight, preferred: asked });
		side = got.side;
		// On the element at once: the scroll to the current choice below
		// measures the height it leaves.
		menu.style.maxHeight = `${got.maxHeight}px`;
	}
	$effect(() => {
		// Again for other rows (`items`), which the observer below follows.
		if (!menu || !items) return;
		place();
		// The current choice in view when the list opens scrolled.
		const checked = menu.querySelector<HTMLElement>('.pop-row[aria-checked="true"]');
		if (checked) show(checked);
		const ro = new ResizeObserver(() => place());
		for (const row of menu.children) ro.observe(row);
		return () => ro.disconnect();
	});

	// The wheel over the menu is the menu's: it scrolls the rows, and at
	// either end (or with nothing to scroll) it goes nowhere. Not passive, as
	// Svelte makes `onwheel`, so it can hold the page still. A pinch (ctrl +
	// wheel) is left to the window's zoom.
	$effect(() => {
		const el = menu;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !wheelScrolls(el.scrollTop, el.scrollHeight - el.clientHeight, e.deltaY)) e.preventDefault();
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	});

	function show(row: HTMLElement) {
		if (!menu) return;
		menu.scrollTop = scrollToShow(menu.scrollTop, menu.clientHeight, row.offsetTop, row.offsetHeight, 6);
	}

	// Up and down (Home, End) move through the rows, from the menu's button or
	// a row; the row they reach is scrolled into view. Enter or space takes it
	// (it is a button). Arrows in a text field elsewhere stay the field's.
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Escape') return onClose();
		if (!menu || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
		const focus = document.activeElement;
		const inMenu = !!focus && menu.contains(focus);
		if (!inMenu && focus !== document.body && !(focus && menu.parentElement?.contains(focus))) return;
		const rows = [...menu.querySelectorAll<HTMLButtonElement>('.pop-row:not(:disabled)')];
		const to = nextRow(e.key, inMenu ? rows.indexOf(focus as HTMLButtonElement) : -1, rows.length);
		if (to === null) return;
		e.preventDefault();
		rows[to].focus({ preventScroll: true });
		show(rows[to]);
	}
</script>

<svelte:window onkeydown={onKey} onpointerdowncapture={onPress} onresize={place} />

<button class="pm-backdrop" aria-label={t('common.close')} tabindex="-1" onclick={onClose}></button>
<div class="pop pm {shown}" role="menu" bind:this={menu} out:popOut|global>
	{#if title}<div class="pop-head">{title}</div>{/if}
	{#each items as it, i (it.key)}
		{#if it.group && it.group !== items[i - 1]?.group}
			{#if i > 0}<div class="pm-sep" role="separator"></div>{/if}
			<div class="pm-group">{it.group}</div>
		{/if}
		<button class="pop-row" class:warn={it.tone === 'warn'} class:two={!!it.desc} role={it.checked === undefined ? 'menuitem' : 'menuitemradio'} aria-checked={it.checked} disabled={it.disabled} onmousedown={(e) => e.preventDefault()} onclick={() => onSelect(it.key)}>
			{#if it.icon}<span class="pop-ico"><it.icon size={18} /></span>{:else if hasIcons}<span class="pop-ico"></span>{/if}
			<span class="pop-txt">
				<span class="pop-label">{it.label}</span>
				{#if it.desc}<span class="pop-desc">{it.desc}</span>{/if}
			</span>
			{#if it.hint}<span class="pop-hint">{it.hint}</span>{/if}
			{#if it.checked}<span class="pop-check"><CheckIcon size={16} /></span>{/if}
		</button>
	{/each}
</div>

<style>
	.pm-sep {
		height: 1px;
		margin: 3px 4px;
		background: var(--hairline);
	}
	.pm-group {
		padding: 6px 8px 2px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 600;
		line-height: 16px;
	}
	.pm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		border: none;
		background: none;
		cursor: default;
	}
	/* Taller than the room it has: the rows scroll, and the scroll stays in
	   the menu (place() sets the max-height; the window's height bounds a
	   menu its parent places). */
	.pm {
		position: absolute;
		z-index: 81;
		width: max-content;
		min-width: 180px;
		max-width: min(480px, calc(100vw - 32px));
		max-height: calc(100vh - 16px);
		overflow-x: hidden;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	/* A column that scrolls would squeeze its rows to their min-height. */
	.pm > :global(*) {
		flex-shrink: 0;
	}
	.pm .pop-row:focus-visible {
		background: var(--surface2);
		outline-offset: -2px;
	}
	.up-left {
		left: 0;
		bottom: calc(100% + 8px);
		transform-origin: bottom left;
		animation: pop-in var(--t-pop) var(--ease-enter);
	}
	.up-right {
		right: 0;
		bottom: calc(100% + 8px);
		transform-origin: bottom right;
		animation: pop-in var(--t-pop) var(--ease-enter);
	}
	.down-left {
		left: 0;
		top: calc(100% + 6px);
		transform-origin: top left;
		animation: drop-in var(--t-pop) var(--ease-enter);
	}
	.down-right {
		right: 0;
		top: calc(100% + 6px);
		transform-origin: top right;
		animation: drop-in var(--t-pop) var(--ease-enter);
	}
</style>
