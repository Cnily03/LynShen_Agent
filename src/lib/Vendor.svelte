<script lang="ts">
	import SparkleIcon from 'phosphor-svelte/lib/SparkleIcon';
	import { modelBrand, providerBrand } from '$lib/brandIcons';
	import mark from '$lib/lynshen-mark.svg?raw';

	// Brand mark for a model (by name) or a provider (by id), from brandIcons.
	// A model with no known brand shows a sparkle; a provider shows its initial,
	// and the LynShen gateway its own mark (lynshen-mark.svg: trunks in
	// currentColor, the light --lynshen-light).
	let { model, provider, size = 14 }: { model?: string; provider?: string; size?: number } = $props();

	const svg = $derived(provider ? providerBrand(provider) : model ? modelBrand(model) : undefined);
	// The gateway's Auto model is LynShen's own pick: its mark.
	const own = $derived(provider === 'lynshen' || provider === 'monoize' || model?.toLowerCase() === 'auto');
	const initial = $derived(provider?.[0]?.toUpperCase() ?? '');
</script>

{#if svg}
	<span class="vendor" style:font-size="{size}px" aria-hidden="true">{@html svg}</span>
{:else if own}
	<span class="vendor" style:font-size="{size}px" aria-hidden="true">{@html mark}</span>
{:else if provider}
	<span class="mono" style:font-size="{size}px" aria-hidden="true">{initial}</span>
{:else}
	<SparkleIcon {size} />
{/if}

<style>
	.vendor {
		display: inline-flex;
		align-items: center;
		line-height: 0;
		flex-shrink: 0;
	}
	.vendor :global(svg) {
		width: 1em;
		height: 1em;
	}
	.mono {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 1em;
		height: 1em;
		flex-shrink: 0;
		color: var(--text);
		font-weight: 600;
		line-height: 1;
	}
</style>
