<script lang="ts">
	// One model in a picker: its vendor mark, the full name (it wraps rather
	// than cut off what tells two models apart), the quiet facts line, a 6px
	// dot for a model that is unstable or unavailable, the pin, and the check
	// on the model in use. The list around it owns the keyboard (the search
	// field keeps focus; this row is its active descendant).
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import PushPinIcon from 'phosphor-svelte/lib/PushPinIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import Vendor from '$lib/Vendor.svelte';
	import { t } from '$lib/i18n';
	import { comboLabel } from '$lib/shortcuts';
	import { PIN_COMBO } from './keys';
	import type { PickItem } from './catalog';
	import { factsOf, outsidePlan, shortFactsOf, tipOf, type FactsOptions } from './facts';

	let {
		item,
		id,
		selected = false,
		pinned = false,
		folded = false,
		compact = false,
		withProvider = false,
		wrapFacts = false,
		facts,
		onPick,
		onPin,
		onRoutes,
		onHover
	}: {
		item: PickItem;
		/** The element id the list points at (aria-activedescendant). */
		id: string;
		/** The keyboard's row. */
		selected?: boolean;
		pinned?: boolean;
		/** An older version shown under its family. */
		folded?: boolean;
		/** One line: the name and a short fact at the right (the quick switcher). */
		compact?: boolean;
		/** Another row has the same name: the compact line names the provider too. */
		withProvider?: boolean;
		/** The browser has room: the facts wrap instead of being cut. */
		wrapFacts?: boolean;
		facts: FactsOptions;
		onPick: (item: PickItem) => void;
		onPin?: (item: PickItem) => void;
		/** The model's route page (several gateway Providers serve it). */
		onRoutes?: (item: PickItem) => void;
		onHover?: () => void;
	} = $props();

	const parts = $derived(
		compact ? [...(withProvider && item.providerName ? [item.providerName] : []), ...shortFactsOf(item, facts)] : factsOf(item, facts)
	);
	const pinKey = comboLabel(PIN_COMBO);
</script>

<!-- svelte-ignore a11y_click_events_have_key_events (the search field drives the keys) -->
<div
	class="pop-row mline"
	class:two={!compact}
	class:compact
	class:sel={selected}
	class:folded
	class:down={item.health === 'down'}
	class:outside={outsidePlan(item, facts)}
	role="option"
	tabindex="-1"
	{id}
	aria-selected={item.active}
	title={tipOf(item)}
	onclick={() => onPick(item)}
	onmousemove={onHover}
>
	<span class="pop-ico"><Vendor model={item.id} size={16} /></span>
	<span class="pop-txt">
		<span class="pop-label name"
			>{#if item.health === 'down' || item.health === 'degraded'}<span class="dot" class:err={item.health === 'down'} aria-hidden="true"></span>{/if}{item.name}</span
		>
		{#if parts.length && !compact}<span class="pop-desc facts" class:wrap={wrapFacts}>{parts.join(' · ')}</span>{/if}
	</span>
	{#if parts.length && compact}<span class="aside">{parts.join(' · ')}</span>{/if}
	{#if onRoutes && item.routes !== undefined}
		<button
			class="act routes"
			tabindex="-1"
			title={t('models.routes')}
			aria-label={t('models.routes')}
			onclick={(e) => {
				e.stopPropagation();
				onRoutes(item);
			}}
		>
			{#if item.routes}<span class="n">{t('chat.routeCount', { n: item.routes })}</span>{/if}<CaretRightIcon size={14} />
		</button>
	{/if}
	{#if onPin}
		<button
			class="act pin"
			class:on={pinned}
			tabindex="-1"
			title={`${pinned ? t('models.unpin') : t('models.pin')}${pinKey ? ` · ${pinKey}` : ''}`}
			aria-label={pinned ? t('models.unpin') : t('models.pin')}
			aria-pressed={pinned}
			onclick={(e) => {
				e.stopPropagation();
				onPin(item);
			}}
		>
			<PushPinIcon size={14} weight={pinned ? 'fill' : 'regular'} />
		</button>
	{/if}
	<span class="pop-check" class:off={!item.active}><CheckIcon size={16} /></span>
</div>

<style>
	.mline {
		flex-shrink: 0;
		align-items: flex-start;
		cursor: pointer;
	}
	.mline .pop-ico {
		margin-top: 1px;
	}
	.mline.compact {
		align-items: center;
		min-height: 32px;
		padding-top: 5px;
		padding-bottom: 5px;
	}
	.mline.compact .pop-ico,
	.mline.compact .pop-check {
		margin-top: 0;
	}
	.aside {
		flex-shrink: 0;
		max-width: 40%;
		overflow: hidden;
		color: var(--dim2);
		font-size: var(--fs-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mline.folded {
		padding-left: 42px;
	}
	/* The full name, wrapped when it is long: never cut to "Claude Sonn…". */
	.name {
		overflow-wrap: anywhere;
		white-space: normal;
	}
	/* On the plan, a model the plan does not include: listed (not hidden),
	   its name secondary; the facts say why. */
	.mline.outside .name {
		color: var(--dim);
	}
	.facts {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.facts.wrap {
		white-space: normal;
	}
	/* State: one 6px dot before the name (design.md §4); the word is in the facts. */
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
	.act {
		display: inline-flex;
		flex-shrink: 0;
		align-items: center;
		gap: 4px;
		height: 22px;
		padding: 0 4px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim2);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.act:hover {
		background: var(--surface2);
		color: var(--text);
	}
	/* The pin shows on hover and on the keyboard's row; a pinned one always. */
	.pin {
		visibility: hidden;
	}
	.mline:hover .pin,
	.mline.sel .pin,
	.pin.on,
	.pin:focus-visible {
		visibility: visible;
	}
	.pin.on {
		color: var(--dim);
	}
	.pop-check.off {
		visibility: hidden;
	}
	.pop-check {
		margin-top: 1px;
	}
</style>
