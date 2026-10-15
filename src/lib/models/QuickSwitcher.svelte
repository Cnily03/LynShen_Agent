<script lang="ts" module>
	/** A row that is not a model: "跟随主模型", "自动选择". */
	export interface PickExtra {
		value: string;
		label: string;
		active: boolean;
	}
</script>

<script lang="ts">
	// The quick switcher: about eight models (pinned, used lately, the plan's
	// picks) and 全部模型… for the full browser. The search field keeps the
	// focus: the arrows move, Enter picks, ⌘D pins, and typing opens the
	// browser with what was typed (after an input method has finished).
	import { onMount, tick } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import SquaresFourIcon from 'phosphor-svelte/lib/SquaresFourIcon';
	import { t } from '$lib/i18n';
	import { nextRow, scrollToShow } from '$lib/ui/menuFit';
	import type { PickItem } from './catalog';
	import type { FactsOptions } from './facts';
	import ModelLine from './ModelLine.svelte';
	import { listKey, ownsKey } from './keys';
	import { modelPicks } from './picks.svelte';
	import { quickList, type QuickSection } from './rank';

	let {
		items,
		extras = [],
		trial = false,
		facts,
		limit = 8,
		autofocus = true,
		onPick,
		onExtra,
		onBrowse,
		onRoutes
	}: {
		items: PickItem[];
		extras?: PickExtra[];
		trial?: boolean;
		facts: FactsOptions;
		limit?: number;
		autofocus?: boolean;
		onPick: (item: PickItem) => void;
		onExtra?: (value: string) => void;
		/** Opens the full browser, with the text typed so far. */
		onBrowse: (query: string) => void;
		onRoutes?: (item: PickItem) => void;
	} = $props();

	const uid = `qs-${Math.random().toString(36).slice(2, 8)}`;
	const rows = $derived(quickList(items, { favorites: modelPicks.favorites, recent: modelPicks.recent, trial, limit }));
	/** The keyboard's stops: the extras, the models, then 全部模型…. */
	type Stop = { kind: 'extra'; extra: PickExtra } | { kind: 'model'; item: PickItem; section: QuickSection } | { kind: 'all' };
	const stops = $derived<Stop[]>([
		...extras.map((extra) => ({ kind: 'extra' as const, extra })),
		...rows.map((r) => ({ kind: 'model' as const, item: r.item, section: r.section })),
		{ kind: 'all' as const }
	]);
	let sel = $state(0);
	/** The keyboard or the pointer chose a row: the list no longer follows the model in use. */
	let moved = false;
	// Start on the row in use (the rows can arrive after the menu opens).
	$effect(() => {
		const at = stops.findIndex((s) => (s.kind === 'extra' ? s.extra.active : s.kind === 'model' && s.item.active));
		if (!moved) sel = at >= 0 ? at : 0;
	});
	function select(i: number) {
		moved = true;
		sel = i;
	}
	/** Pins or unpins a row and keeps the keyboard on it as the rows reorder. */
	function pin(key: string) {
		modelPicks.toggleFavorite(key);
		moved = true;
		tick().then(() => {
			const at = stops.findIndex((s) => s.kind === 'model' && s.item.key === key);
			if (at >= 0) sel = at;
		});
	}
	const idOf = (i: number) => `${uid}-${i}`;
	// Keep the keyboard's row in view where the list scrolls (a short window).
	let listEl = $state<HTMLDivElement>();
	$effect(() => {
		const el = document.getElementById(idOf(sel));
		if (!el || !listEl) return;
		const top = el.getBoundingClientRect().top - listEl.getBoundingClientRect().top + listEl.scrollTop;
		listEl.scrollTop = scrollToShow(listEl.scrollTop, listEl.clientHeight, top, el.offsetHeight, 4);
	});

	let input = $state<HTMLInputElement>();
	let typed = $state('');
	let composing = false;
	let leaving = false;
	onMount(() => {
		if (autofocus) tick().then(() => input?.focus({ preventScroll: true }));
	});
	function browse(query = '') {
		if (leaving) return;
		leaving = true;
		onBrowse(query);
	}
	function onInput(e: Event) {
		if (composing || (e as InputEvent).isComposing) return;
		if (typed.trim()) browse(typed);
	}

	function act(stop: Stop | undefined) {
		if (!stop) return;
		if (stop.kind === 'extra') onExtra?.(stop.extra.value);
		else if (stop.kind === 'model') onPick(stop.item);
		else browse();
	}
	function onKey(e: KeyboardEvent) {
		if (ownsKey(e)) e.stopPropagation();
		const key = listKey(e);
		if (!key) return;
		if (key === 'pin') {
			const stop = stops[sel];
			if (stop?.kind === 'model') {
				e.preventDefault();
				pin(stop.item.key);
			}
			return;
		}
		if (key === 'pick') {
			e.preventDefault();
			act(stops[sel]);
			return;
		}
		if (key === 'open' && stops[sel]?.kind === 'all' && !typed) {
			e.preventDefault();
			browse();
			return;
		}
		const move = key === 'up' ? 'ArrowUp' : key === 'down' ? 'ArrowDown' : key === 'pageUp' ? 'Home' : key === 'pageDown' ? 'End' : '';
		const next = move ? nextRow(move, sel, stops.length) : null;
		if (next !== null) {
			e.preventDefault();
			select(next);
		}
	}
	const head = (i: number) => {
		const stop = stops[i];
		if (stop?.kind !== 'model') return '';
		const prev = stops[i - 1];
		return prev?.kind === 'model' && prev.section === stop.section ? '' : t(`models.section.${stop.section}`);
	};
	const count = $derived(items.length);
	/** Names two rows share (one model through two providers). */
	const repeated = $derived.by(() => {
		const seen = new Set<string>();
		const twice = new Set<string>();
		for (const r of rows) (seen.has(r.item.name) ? twice : seen).add(r.item.name);
		return twice;
	});
</script>

<div class="qs">
	<label class="search">
		<MagnifyingGlassIcon size={15} />
		<input
			bind:this={input}
			bind:value={typed}
			placeholder={t('models.searchAll')}
			aria-label={t('models.searchAll')}
			role="combobox"
			aria-expanded="true"
			aria-controls={`${uid}-list`}
			aria-activedescendant={sel >= 0 ? idOf(sel) : undefined}
			autocomplete="off"
			spellcheck="false"
			oninput={onInput}
			oncompositionstart={() => (composing = true)}
			oncompositionend={() => {
				composing = false;
				if (typed.trim()) browse(typed);
			}}
			onkeydown={onKey}
		/>
	</label>
	<div class="list" role="listbox" id={`${uid}-list`} aria-label={t('models.choose')} bind:this={listEl}>
		{#each stops as stop, i (stop.kind === 'model' ? stop.item.key : stop.kind === 'extra' ? `x:${stop.extra.value}` : 'all')}
			{#if stop.kind === 'extra'}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div class="pop-row" class:sel={i === sel} role="option" tabindex="-1" id={idOf(i)} aria-selected={stop.extra.active} onclick={() => act(stop)} onmousemove={() => i !== sel && select(i)}>
					<span class="pop-txt"><span class="pop-label">{stop.extra.label}</span></span>
					<span class="pop-check" class:off={!stop.extra.active}><CheckIcon size={16} /></span>
				</div>
			{:else if stop.kind === 'model'}
				{@const label = head(i)}
				{#if label}<div class="head" role="presentation">{label}</div>{/if}
				<ModelLine
					item={stop.item}
					id={idOf(i)}
					selected={i === sel}
					pinned={modelPicks.isFavorite(stop.item.key)}
					compact
					withProvider={repeated.has(stop.item.name)}
					{facts}
					onPick={() => act(stop)}
					onPin={(item) => pin(item.key)}
					{onRoutes}
					onHover={() => i !== sel && select(i)}
				/>
			{:else}
				{#if !items.length}<div class="empty" role="presentation">{t('models.empty')}</div>{/if}
				<div class="sep" role="presentation"></div>
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<div class="pop-row all" class:sel={i === sel} role="option" tabindex="-1" id={idOf(i)} aria-selected="false" onclick={() => browse()} onmousemove={() => i !== sel && select(i)}>
					<span class="pop-ico"><SquaresFourIcon size={16} /></span>
					<span class="pop-txt"><span class="pop-label">{t('models.all')}</span></span>
					<span class="pop-hint">{t('models.allCount', { n: count })}</span>
					<span class="pop-ico caret"><CaretRightIcon size={14} /></span>
				</div>
			{/if}
		{/each}
	</div>
</div>

<style>
	.qs {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.search {
		display: flex;
		flex-shrink: 0;
		align-items: center;
		gap: 8px;
		height: 32px;
		margin: 0 0 4px;
		padding: 0 10px;
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--dim2);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		outline: none;
	}
	.search input::placeholder {
		color: var(--dim2);
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}
	.head {
		padding: 8px 12px 2px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 600;
	}
	.sep {
		flex-shrink: 0;
		height: 1px;
		margin: 4px 6px;
		background: var(--hairline);
	}
	.pop-row {
		flex-shrink: 0;
	}
	.all .caret {
		width: auto;
		color: var(--dim2);
	}
	.pop-check.off {
		visibility: hidden;
	}
	.empty {
		padding: 10px 12px;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
</style>
