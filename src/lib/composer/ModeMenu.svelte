<script lang="ts" module>
	export type ModeItem = {
		key: string;
		label: string;
		/** One short line under the label. */
		desc: string;
		recommended?: boolean;
		/** Risky choice (full access): label in the warning colour. */
		tone?: 'warn';
	};
</script>

<script lang="ts">
	import { popOut } from '$lib/ui/motion';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import { t } from '$lib/i18n';

	// The approval-mode menu opened from the composer footer's mode label: one
	// two-line row per mode with its number key at the right. While it is open,
	// 1–9 pick a mode, arrows and Enter move and pick, Escape closes.
	let {
		items,
		current,
		note = '',
		disabled = false,
		onSelect,
		onClose
	}: {
		items: ModeItem[];
		current: string;
		/** Gray line under the title (an agent's session: where to change it). */
		note?: string;
		/** Shown read-only. */
		disabled?: boolean;
		onSelect: (key: string) => void;
		onClose: () => void;
	} = $props();

	let sel = $state(0);
	$effect.pre(() => {
		sel = Math.max(0, items.findIndex((i) => i.key === current));
	});

	function pick(i: number) {
		const it = items[i];
		if (!it || disabled) return;
		onSelect(it.key);
	}

	// Capture phase: the keys never reach the editor or the pane's handlers.
	function onKey(e: KeyboardEvent) {
		if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
		const n = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
		if (n && n <= items.length) pick(n - 1);
		else if (e.key === 'ArrowDown') sel = (sel + 1) % items.length;
		else if (e.key === 'ArrowUp') sel = (sel - 1 + items.length) % items.length;
		else if (e.key === 'Enter') pick(sel);
		else if (e.key === 'Escape') onClose();
		else return;
		e.preventDefault();
		e.stopPropagation();
	}
</script>

<svelte:window onkeydowncapture={onKey} />

<button class="mode-backdrop" aria-label={t('common.close')} tabindex="-1" onclick={onClose}></button>
<div class="pop modes" role="menu" out:popOut|global aria-label={t('chat.modeTitle')}>
	<div class="pop-head">{t('chat.modeTitle')}</div>
	{#if note}<div class="note">{note}</div>{/if}
	{#each items as it, i (it.key)}
		<button
			class="pop-row two"
			class:sel={i === sel}
			class:warn={it.tone === 'warn'}
			role="menuitemradio"
			aria-checked={it.key === current}
			{disabled}
			onmouseenter={() => (sel = i)}
			onmousedown={(e) => e.preventDefault()}
			onclick={() => pick(i)}
		>
			<span class="pop-txt">
				<span class="name">
					<span class="pop-label">{it.label}</span>
					{#if it.recommended}<span class="tag">{t('chat.modeRecommended')}</span>{/if}
				</span>
				<span class="pop-desc">{it.desc}</span>
			</span>
			<span class="check" class:off={it.key !== current}><CheckIcon size={15} /></span>
			<kbd class="key">{i + 1}</kbd>
		</button>
	{/each}
</div>

<style>
	.mode-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		border: none;
		background: none;
		cursor: default;
	}
	.modes {
		position: absolute;
		left: 0;
		bottom: calc(100% + 8px);
		z-index: 81;
		width: min(360px, calc(100vw - 32px));
		transform-origin: bottom left;
		animation: pop-in var(--t-pop) var(--ease-enter);
	}
	.pop-head {
		padding: 6px 12px 4px;
		font-size: var(--fs-xs);
	}
	.note {
		padding: 0 12px 6px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.name {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	/* A mode is chosen on what it does: its line wraps rather than hide the end. */
	.pop-desc {
		line-height: 1.45;
	}
	.tag {
		flex-shrink: 0;
		padding: 0 6px;
		border-radius: var(--r-full);
		background: var(--surface2);
		color: var(--dim);
		font-size: var(--fs-2xs);
		line-height: 1.6;
	}
	.pop-row.warn .pop-label,
	.pop-row.warn .check {
		color: var(--warn);
	}
	.check {
		display: inline-flex;
		flex-shrink: 0;
		color: var(--text);
	}
	.check.off {
		visibility: hidden;
	}
	.key {
		flex-shrink: 0;
		min-width: 14px;
		color: var(--dim2);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		text-align: right;
	}
</style>
