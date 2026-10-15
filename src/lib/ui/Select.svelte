<script lang="ts">
	import { popOut } from '$lib/ui/motion';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import type { Snippet } from 'svelte';
	import { t } from '$lib/i18n';

	type Opt = { value: string; label?: string; group?: string } & Record<string, unknown>;
	let {
		value = $bindable(),
		options,
		placeholder = '',
		disabled = false,
		item,
		onChange
	}: {
		value: string;
		options: Opt[];
		placeholder?: string;
		disabled?: boolean;
		item?: Snippet<[Opt]>;
		onChange?: (value: string) => void;
	} = $props();

	let open = $state(false);
	const sel = $derived(options.find((o) => o.value === value));
	function pick(v: string) {
		value = v;
		open = false;
		onChange?.(v);
	}
</script>

<div class="select">
	<button class="trigger" class:open {disabled} onclick={() => (open = !open)}>
		<span class="cur">
			{#if sel}
				{#if item}{@render item(sel)}{:else}{sel.label ?? sel.value}{/if}
			{:else}
				<span class="ph">{placeholder || t('common.select')}</span>
			{/if}
		</span>
		<span class="chev" class:up={open}><CaretDownIcon size={15} /></span>
	</button>
	{#if open}
		<button class="backdrop" aria-label={t('common.close')} onclick={() => (open = false)}></button>
		<div class="menu" out:popOut|global>
			{#each options as o, i (o.value)}
				{#if o.group && (i === 0 || options[i - 1]?.group !== o.group)}
					<div class="opt-group">{o.group}</div>
				{/if}
				<button class="opt" class:on={o.value === value} onclick={() => pick(o.value)}>
					<span class="opt-c">{#if item}{@render item(o)}{:else}{o.label ?? o.value}{/if}</span>
					{#if o.value === value}<CheckIcon size={14} class="opt-chk" />{/if}
				</button>
			{/each}
			{#if options.length === 0}<div class="opt-empty">{t('shell.noOptions')}</div>{/if}
		</div>
	{/if}
</div>

<style>
	.select {
		position: relative;
		width: 100%;
	}
	.trigger {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 32px;
		padding: 6px 10px;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		font-size: var(--fs-sm);
		line-height: 18px;
		cursor: pointer;
		text-align: left;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.trigger:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.trigger:hover,
	.trigger.open {
		border-color: var(--border-strong);
	}
	.cur {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
	}
	.ph {
		color: var(--dim2);
	}
	.chev {
		display: inline-flex;
		color: var(--dim);
		flex-shrink: 0;
		transition: transform var(--t-med) var(--ease-spring);
	}
	.chev.up {
		transform: rotate(180deg);
	}
	.backdrop {
		position: fixed;
		inset: 0;
		background: none;
		border: none;
		z-index: 30;
		cursor: default;
	}
	.menu {
		position: absolute;
		top: calc(100% + 5px);
		left: 0;
		right: 0;
		z-index: 31;
		max-height: 240px;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: 4px;
		background: var(--panel);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-pop);
		transform-origin: bottom left;
		animation: pop-in var(--t-pop) var(--ease-enter);
	}
	.opt {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 28px;
		padding: 4px 8px;
		border: none;
		background: none;
		color: var(--text);
		font-size: var(--fs-sm);
		line-height: 18px;
		border-radius: var(--r-md);
		cursor: pointer;
		text-align: left;
	}
	.opt-group {
		padding: 6px 8px 2px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-weight: 600;
		line-height: 16px;
	}
	.opt-group:not(:first-child) {
		margin-top: 3px;
		border-top: 1px solid var(--hairline);
	}
	.opt:hover {
		background: var(--surface2);
	}
	.opt.on {
		background: var(--surface2);
	}
	.opt-c {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
	}
	:global(.opt-chk) {
		color: var(--accent-bright);
		flex-shrink: 0;
	}
	.opt-empty {
		padding: 10px;
		font-size: var(--fs-xs);
		color: var(--dim2);
		text-align: center;
	}
</style>
