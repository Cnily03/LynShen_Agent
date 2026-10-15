<script lang="ts">
	// The full model browser: a search field over every model, in vendor
	// sections; each family shows its current version and folds the older
	// ones under 更多版本. A query lists every matching version instead. The
	// field keeps the focus: the arrows move, Enter picks (or opens a
	// family), → / ← open and close a family's versions, ⌘D pins.
	import { onMount, tick, untrack } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import Modal from '$lib/ui/Modal.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import { getLocale, t } from '$lib/i18n';
	import { nextRow, scrollToShow } from '$lib/ui/menuFit';
	import { vendorLabel, type PickItem } from './catalog';
	import type { FactsOptions } from './facts';
	import ModelLine from './ModelLine.svelte';
	import { listKey, ownsKey } from './keys';
	import { modelPicks } from './picks.svelte';
	import { browseLines, browseSections, openAtFirst, searchSections, type BrowseLine } from './rank';
	import type { PickExtra } from './QuickSwitcher.svelte';

	let {
		items,
		extras = [],
		trial = false,
		facts,
		query: initial = '',
		title,
		onPick,
		onExtra,
		onRoutes,
		onClose,
		manage
	}: {
		items: PickItem[];
		extras?: PickExtra[];
		trial?: boolean;
		facts: FactsOptions;
		/** What was typed before the browser opened. */
		query?: string;
		title?: string;
		onPick: (item: PickItem) => void;
		onExtra?: (value: string) => void;
		onRoutes?: (item: PickItem) => void;
		onClose: () => void;
		/** A link in the footer (管理模型: which gateway models the engine lists). */
		manage?: { label: string; onClick: () => void };
	} = $props();

	const uid = `mb-${Math.random().toString(36).slice(2, 8)}`;
	// What was typed before the browser opened: its start, not followed after.
	let typed = $state(untrack(() => initial));
	/** The query in effect: what is typed, once an input method has finished. */
	let query = $state(untrack(() => initial));
	let composing = false;

	const sections = $derived(query.trim() ? searchSections(items, query) : browseSections(items, { trial }));
	let open = $state<Set<string>>(new Set());
	// The family of a folded version in use starts open.
	let opened = false;
	$effect(() => {
		if (opened || query.trim() || !items.length) return;
		opened = true;
		open = openAtFirst(sections);
	});
	type Stop = { kind: 'extra'; key: string; extra: PickExtra } | (BrowseLine & { kind: 'model' | 'more' });
	const lines = $derived(browseLines(sections, open));
	const shownExtras = $derived(query.trim() ? [] : extras);
	const stops = $derived<Stop[]>([
		...shownExtras.map((extra) => ({ kind: 'extra' as const, key: `x:${extra.value}`, extra })),
		...lines.filter((l): l is BrowseLine & { kind: 'model' | 'more' } => l.kind !== 'vendor')
	]);
	const stopAt = $derived(new Map(stops.map((s, i) => [s.key, i])));

	let sel = $state(0);
	let moved = false;
	// Start on the model in use; a new query starts at its best match.
	$effect(() => {
		const at = stops.findIndex((s) => (s.kind === 'extra' ? s.extra.active : s.kind === 'model' && s.item.active));
		if (!moved) sel = at >= 0 && !query.trim() ? at : 0;
	});
	function select(i: number) {
		moved = true;
		sel = i;
	}
	const idOf = (key: string) => `${uid}-${key.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
	// Keep the keyboard's row in view (the model in use starts in the middle).
	// The list scrolls itself: scrollIntoView would move the page behind too.
	let listEl = $state<HTMLDivElement>();
	let scrolled = false;
	$effect(() => {
		const stop = stops[sel];
		const el = stop ? document.getElementById(idOf(stop.key)) : null;
		if (!el || !listEl) return;
		const top = el.getBoundingClientRect().top - listEl.getBoundingClientRect().top + listEl.scrollTop;
		listEl.scrollTop = scrolled
			? scrollToShow(listEl.scrollTop, listEl.clientHeight, top, el.offsetHeight, 6)
			: Math.max(0, top - (listEl.clientHeight - el.offsetHeight) / 2);
		scrolled = true;
	});

	let input = $state<HTMLInputElement>();
	onMount(() => {
		tick().then(() => {
			input?.focus({ preventScroll: true });
			input?.setSelectionRange(typed.length, typed.length);
		});
	});
	function setQuery(next: string) {
		query = next;
		moved = false;
	}

	function toggle(familyKey: string, to?: boolean) {
		const next = new Set(open);
		const on = to ?? !next.has(familyKey);
		if (on) next.add(familyKey);
		else next.delete(familyKey);
		open = next;
	}
	function act(stop: Stop | undefined) {
		if (!stop) return;
		if (stop.kind === 'extra') onExtra?.(stop.extra.value);
		else if (stop.kind === 'model') onPick(stop.item);
		else toggle(stop.family.key);
	}
	/** The family a line belongs to, for → and ←. */
	function familyOf(stop: Stop | undefined): string | null {
		if (!stop || stop.kind === 'extra') return null;
		if (stop.kind === 'more') return stop.family.key;
		const fam = sections.flatMap((s) => s.families).find((f) => f.shown.includes(stop.item) || f.more.includes(stop.item));
		return fam?.more.length ? fam.key : null;
	}
	function pin(key: string) {
		modelPicks.toggleFavorite(key);
	}
	function onKey(e: KeyboardEvent) {
		if (ownsKey(e)) e.stopPropagation();
		const key = listKey(e);
		if (!key) return;
		const stop = stops[sel];
		if (key === 'pin') {
			if (stop?.kind === 'model') {
				e.preventDefault();
				pin(stop.item.key);
			}
			return;
		}
		if (key === 'pick') {
			e.preventDefault();
			act(stop);
			return;
		}
		// ← → move the caret while there is text; on an empty field they fold.
		if (key === 'open' || key === 'close') {
			const fam = typed ? null : familyOf(stop);
			if (!fam) return;
			e.preventDefault();
			toggle(fam, key === 'open');
			if (key === 'close') {
				const more = stopAt.get(`m:${fam}`);
				tick().then(() => select(stopAt.get(`m:${fam}`) ?? more ?? sel));
			}
			return;
		}
		const move = key === 'up' ? 'ArrowUp' : key === 'down' ? 'ArrowDown' : '';
		let next = move ? nextRow(move, sel, stops.length) : null;
		if (key === 'pageUp') next = Math.max(0, sel - 8);
		if (key === 'pageDown') next = Math.min(stops.length - 1, sel + 8);
		if (next !== null) {
			e.preventDefault();
			select(next);
		}
	}
	const locale = $derived(getLocale());
	const anyPrice = $derived(items.some((i) => i.price));
</script>

<Modal label={title ?? t('models.browserTitle')} width={760} placement="top" padded={false} {onClose}>
	<div class="mb">
		<label class="search">
			<MagnifyingGlassIcon size={16} />
			<input
				bind:this={input}
				bind:value={typed}
				placeholder={t('models.search')}
				aria-label={t('models.search')}
				role="combobox"
				aria-expanded="true"
				aria-controls={`${uid}-list`}
				aria-activedescendant={stops[sel] ? idOf(stops[sel].key) : undefined}
				autocomplete="off"
				spellcheck="false"
				oninput={(e) => {
					if (!composing && !(e as unknown as InputEvent).isComposing) setQuery(typed);
				}}
				oncompositionstart={() => (composing = true)}
				oncompositionend={() => {
					composing = false;
					setQuery(typed);
				}}
				onkeydown={onKey}
			/>
			{#if !typed}<span class="hint">{t('models.searchHint')}</span>{/if}
		</label>
		<div class="list" role="listbox" id={`${uid}-list`} aria-label={title ?? t('models.browserTitle')} bind:this={listEl}>
			{#each shownExtras as extra (extra.value)}
				{@const i = stopAt.get(`x:${extra.value}`) ?? -1}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div class="pop-row" class:sel={i === sel} role="option" tabindex="-1" id={idOf(`x:${extra.value}`)} aria-selected={extra.active} onclick={() => onExtra?.(extra.value)} onmousemove={() => i !== sel && select(i)}>
					<span class="pop-txt"><span class="pop-label">{extra.label}</span></span>
					<span class="pop-check" class:off={!extra.active}><CheckIcon size={16} /></span>
				</div>
			{/each}
			{#each lines as line (line.key)}
				{#if line.kind === 'vendor'}
					<div class="vhead" role="presentation">
						<Vendor model={line.section.families[0]?.shown[0]?.id ?? ''} size={14} />
						<span class="vname">{line.section.vendor === 'other' ? t('models.vendorOther') : vendorLabel({ vendor: line.section.vendor, vendorName: line.section.vendorName }, locale)}</span>
					</div>
				{:else if line.kind === 'model'}
					{@const i = stopAt.get(line.key) ?? -1}
					<ModelLine
						item={line.item}
						id={idOf(line.key)}
						selected={i === sel}
						folded={line.folded}
						pinned={modelPicks.isFavorite(line.item.key)}
						wrapFacts
						{facts}
						{onPick}
						onPin={(item) => pin(item.key)}
						{onRoutes}
						onHover={() => i !== sel && select(i)}
					/>
				{:else}
					{@const i = stopAt.get(line.key) ?? -1}
					<!-- svelte-ignore a11y_click_events_have_key_events -->
					<div class="pop-row more" class:sel={i === sel} role="option" tabindex="-1" id={idOf(line.key)} aria-selected="false" onclick={() => toggle(line.family.key)} onmousemove={() => i !== sel && select(i)}>
						<span class="pop-txt"><span class="pop-label">{line.open ? t('models.less') : t('models.more', { n: line.family.more.length })}</span></span>
						<span class="pop-ico caret" class:up={line.open}><CaretDownIcon size={14} /></span>
					</div>
				{/if}
			{/each}
			{#if !lines.length}
				<div class="empty">{query.trim() ? t('models.noMatch') : t('models.empty')}</div>
			{/if}
		</div>
		{#if anyPrice || manage}
			<div class="foot">
				{#if anyPrice}<span>{t('models.priceTip')} · {facts.currency}</span>{/if}
				{#if manage}<button class="manage" onclick={manage.onClick}>{manage.label}</button>{/if}
			</div>
		{/if}
	</div>
</Modal>

<style>
	.mb {
		display: flex;
		flex-direction: column;
		max-height: min(72vh, 720px);
		background: var(--panel);
	}
	.search {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 10px;
		padding: 12px 16px;
		border-bottom: 1px solid var(--hairline);
		color: var(--dim);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
	}
	.search input::placeholder {
		color: var(--dim2);
	}
	.hint {
		flex-shrink: 1;
		min-width: 0;
		overflow: hidden;
		color: var(--dim2);
		font-size: var(--fs-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-height: 0;
		padding: 6px;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.list > :global(*) {
		flex-shrink: 0;
	}
	.vhead {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 12px 4px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 600;
	}
	.vhead:first-child {
		padding-top: 6px;
	}
	.more {
		min-height: 30px;
		padding-left: 42px;
		color: var(--dim);
	}
	.more .pop-label {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.more .caret {
		width: auto;
		color: var(--dim2);
		transition: transform var(--t-fast) var(--ease-out);
	}
	.more .caret.up {
		transform: rotate(180deg);
	}
	.pop-check.off {
		visibility: hidden;
	}
	.empty {
		padding: 16px 12px;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.foot {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 12px;
		padding: 8px 16px;
		border-top: 1px solid var(--hairline);
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.manage {
		margin-left: auto;
		padding: 2px 6px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.manage:hover {
		background: var(--surface2);
		color: var(--text);
	}
</style>
