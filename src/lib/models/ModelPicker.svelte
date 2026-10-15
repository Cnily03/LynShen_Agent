<script lang="ts">
	// A settings row's model picker: a button with the chosen model's full
	// name that opens the quick switcher below it, and from there the full
	// browser. The same components as the composer's model menu, over the
	// models the setting may take (the caller filters them, e.g. image models).
	import { tick } from 'svelte';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import Vendor from '$lib/Vendor.svelte';
	import { t } from '$lib/i18n';
	import { fitMenu, visibleBand } from '$lib/ui/menuFit';
	import { popOut } from '$lib/ui/motion';
	import type { PickItem } from './catalog';
	import { gatewayCatalog } from './catalogStore.svelte';
	import ModelBrowser from './ModelBrowser.svelte';
	import QuickSwitcher, { type PickExtra } from './QuickSwitcher.svelte';
	import { pick } from './pick';
	import { factsOptions, onTrial } from './pickerState.svelte';

	let {
		items,
		value,
		extras = [],
		placeholder = '',
		label,
		disabled = false,
		remember = true,
		variant = 'field',
		onChange
	}: {
		items: PickItem[];
		value: string;
		/** Rows that are not models ("跟随主模型"); their values are not item values. */
		extras?: PickExtra[];
		placeholder?: string;
		/** The control's accessible name (the settings row's title). */
		label: string;
		disabled?: boolean;
		/** A pick here is a model to chat with: it joins the recents. */
		remember?: boolean;
		/** 'field': a settings control; 'inline': a text button in a box (the
		 *  home page's start box). */
		variant?: 'field' | 'inline';
		onChange: (value: string) => void;
	} = $props();

	const facts = $derived(factsOptions());
	const trial = $derived(onTrial());
	const chosen = $derived(items.find((i) => i.value === value));
	const extra = $derived(extras.find((x) => x.value === value));
	const shownExtras = $derived(extras.map((x) => ({ ...x, active: x.value === value })));

	let open = $state(false);
	let browsing = $state<string | null>(null);
	let button = $state<HTMLButtonElement>();
	let popEl = $state<HTMLDivElement>();
	let pos = $state({ left: 0, top: 0, width: 0, maxHeight: 0, side: 'down' as 'up' | 'down' });

	function place() {
		if (!button || !popEl) return;
		const r = button.getBoundingClientRect();
		const width = Math.min(Math.max(r.width, variant === 'inline' ? 380 : 400), window.innerWidth - 16);
		const fit = fitMenu({ anchor: { top: r.top, bottom: r.bottom }, band: visibleBand(button, popEl), natural: popEl.scrollHeight, preferred: 'down' });
		const height = Math.min(popEl.scrollHeight, fit.maxHeight);
		pos = {
			// Settings put the control at the row's right end: the list lines up
			// with it there; an inline button's list starts at its left.
			left: Math.max(8, Math.min(variant === 'inline' ? r.left : r.right - width, window.innerWidth - width - 8)),
			top: fit.side === 'down' ? r.bottom + 6 : r.top - 8 - height,
			width,
			maxHeight: fit.maxHeight,
			side: fit.side
		};
	}
	async function show() {
		if (disabled) return;
		open = true;
		void gatewayCatalog.refreshIfStale();
		await tick();
		place();
	}
	/** Closes the list; the focus goes back to the button unless the caller
	 *  moved it on (the home page's text box). */
	function close() {
		open = false;
		browsing = null;
		tick().then(() => {
			if (!document.activeElement || document.activeElement === document.body) button?.focus();
		});
	}
	function choose(item: PickItem) {
		void pick(
			item,
			(picked) => {
				close();
				onChange(picked.value);
			},
			remember
		);
	}
	function chooseExtra(v: string) {
		close();
		onChange(v);
	}
	// Escape closes the list before it can leave the settings page.
	function onWindowKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !open) return;
		e.preventDefault();
		e.stopPropagation();
		close();
	}
	// Rows can change height (a pin, the catalog arriving): stay in the window.
	$effect(() => {
		if (!popEl) return;
		const ro = new ResizeObserver(() => open && place());
		ro.observe(popEl);
		return () => ro.disconnect();
	});
</script>

<svelte:window onkeydowncapture={onWindowKey} onresize={() => open && place()} />

<button
	class="trigger"
	class:open
	class:inline={variant === 'inline'}
	{disabled}
	bind:this={button}
	aria-haspopup="listbox"
	aria-expanded={open}
	aria-label={`${label}: ${chosen?.name ?? extra?.label ?? placeholder}`}
	title={chosen?.id}
	onclick={() => (open ? close() : show())}
	onkeydown={(e) => {
		if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
			e.preventDefault();
			void show();
		}
	}}
>
	{#if chosen}
		<span class="ico"><Vendor model={chosen.id} size={variant === 'inline' ? 14 : 16} /></span>
		<span class="txt">
			<span class="name"
				>{#if chosen.health === 'down' || chosen.health === 'degraded'}<span class="dot" class:err={chosen.health === 'down'} aria-hidden="true"></span>{/if}{chosen.name}</span
			>
			{#if chosen.providerName}<span class="sub">{chosen.providerName}</span>{/if}
		</span>
	{:else if extra}
		<span class="txt"><span class="name">{extra.label}</span></span>
	{:else if value}
		<!-- A model the list does not have (any more): its id, as stored. -->
		<span class="txt"><span class="name mono">{value}</span></span>
	{:else}
		<span class="txt"><span class="ph">{placeholder || t('models.choose')}</span></span>
	{/if}
	<span class="chev" class:up={open}><CaretDownIcon size={variant === 'inline' ? 12 : 15} /></span>
</button>

{#if open && browsing === null}
	<button class="backdrop" aria-label={t('common.close')} tabindex="-1" onclick={() => close()}></button>
	<div
		class="pop mp"
		class:up={pos.side === 'up'}
		bind:this={popEl}
		out:popOut|global
		style:left="{pos.left}px"
		style:top="{pos.top}px"
		style:width="{pos.width}px"
		style:max-height={pos.maxHeight ? `${pos.maxHeight}px` : undefined}
	>
		<QuickSwitcher
			{items}
			extras={shownExtras}
			{trial}
			{facts}
			onPick={choose}
			onExtra={chooseExtra}
			onBrowse={(q) => (browsing = q)}
		/>
	</div>
{/if}
{#if open && browsing !== null}
	<ModelBrowser {items} extras={shownExtras} {trial} {facts} query={browsing} title={label} onPick={choose} onExtra={chooseExtra} onClose={() => close()} />
{/if}

<style>
	.trigger {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 38px;
		padding: 7px 11px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.trigger:hover:not(:disabled),
	.trigger.open {
		border-color: var(--border-strong);
	}
	.trigger.inline {
		display: inline-flex;
		width: auto;
		min-height: 30px;
		gap: 6px;
		padding: 0 10px;
		border: none;
		background: none;
		color: var(--dim);
		transition:
			background var(--t-fast) var(--ease-base),
			color var(--t-fast) var(--ease-base);
	}
	.trigger.inline:hover:not(:disabled),
	.trigger.inline.open {
		background: var(--surface2);
		color: var(--text);
	}
	.trigger.inline .txt {
		flex: none;
	}
	.trigger:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.ico {
		display: inline-flex;
		flex-shrink: 0;
	}
	.txt {
		display: flex;
		flex: 1;
		min-width: 0;
		flex-direction: column;
		gap: 1px;
	}
	/* The full name: it wraps rather than end in "Claude Sonn…". */
	.name {
		overflow-wrap: anywhere;
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
	}
	.sub {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.ph {
		color: var(--dim2);
	}
	.dot {
		display: inline-block;
		width: 6px;
		height: 6px;
		margin: 0 7px 0 1px;
		border-radius: var(--r-full);
		background: var(--warn);
		vertical-align: middle;
		transform: translateY(-1px);
	}
	.dot.err {
		background: var(--err);
	}
	.chev {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--dim);
		transition: transform var(--t-fast) var(--ease-spring);
	}
	.chev.up {
		transform: rotate(180deg);
	}
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 60;
		border: none;
		background: none;
		cursor: default;
	}
	.mp {
		position: fixed;
		z-index: 61;
		overflow: hidden;
		overscroll-behavior: contain;
		transform-origin: top left;
		animation: drop-in var(--t-pop) var(--ease-enter);
	}
	.mp.up {
		transform-origin: bottom left;
		animation-name: pop-in;
	}
	.mp :global(.qs) {
		flex: 1;
		min-height: 0;
	}
</style>
