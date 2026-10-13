<script lang="ts" module>
	export type ModeItem = {
		key: string;
		label: string;
		/** One short line under the label. */
		desc: string;
		recommended?: boolean;
		/** Risky choice (full access): label in the warning colour. */
		tone?: 'warn';
		/** Not offered (an engine that refused it): shown, not picked. */
		disabled?: boolean;
	};
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	import { popOut } from '$lib/ui/motion';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import { t } from '$lib/i18n';
	import { shortcutLabel } from '$lib/shortcuts';

	// The approval-mode menu opened from the composer footer's mode label: one
	// two-line row per mode with its number key at the right. While it is open,
	// 1–9 pick a mode, arrows and Enter move and pick, Shift+Tab switches to
	// the next mode (as in the composer), Escape closes.
	let {
		items,
		current,
		note = '',
		disabled = false,
		onSelect,
		onCycle,
		onClose
	}: {
		items: ModeItem[];
		current: string;
		/** Gray line under the title (an agent's session: where to change it). */
		note?: string;
		/** Shown read-only. */
		disabled?: boolean;
		onSelect: (key: string) => void;
		/** Shift+Tab: the next mode. */
		onCycle?: () => void;
		onClose: () => void;
	} = $props();

	let sel = $state(0);
	$effect.pre(() => {
		sel = Math.max(0, items.findIndex((i) => i.key === current));
	});

	function pick(i: number) {
		const it = items[i];
		if (!it || disabled || it.disabled) return;
		onSelect(it.key);
	}

	// Capture phase: the keys never reach the editor or the pane's handlers.
	function onKey(e: KeyboardEvent) {
		if (e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
		const n = /^[1-9]$/.test(e.key) ? Number(e.key) : 0;
		if (n && n <= items.length) pick(n - 1);
		else if (e.key === 'Tab' && e.shiftKey && onCycle && !disabled) onCycle();
		else if (e.key === 'ArrowDown') sel = (sel + 1) % items.length;
		else if (e.key === 'ArrowUp') sel = (sel - 1 + items.length) % items.length;
		else if (e.key === 'Enter') pick(sel);
		else if (e.key === 'Escape') onClose();
		else return;
		e.preventDefault();
		e.stopPropagation();
	}

	// The menu opens up from the mode label. Kept inside the window: moved
	// left when its right edge would leave it, and given a scroll when the
	// space above the label is too short.
	let menu = $state<HTMLDivElement>();
	let shift = $state(0);
	let maxHeight = $state<number | null>(null);
	const MARGIN = 8;
	function fit() {
		if (!menu) return;
		const r = menu.getBoundingClientRect();
		const left = r.left - shift;
		const right = left + r.width;
		shift = right > innerWidth - MARGIN ? Math.min(0, innerWidth - MARGIN - right) : 0;
		if (left + shift < MARGIN) shift = MARGIN - left;
		const room = r.bottom - MARGIN;
		maxHeight = menu.scrollHeight > room ? Math.max(120, room) : null;
	}
	$effect(() => {
		void items;
		untrack(fit);
	});
	// Its size changes with the text (a language switch, a long description).
	$effect(() => {
		if (!menu) return;
		const observer = new ResizeObserver(() => fit());
		observer.observe(menu);
		return () => observer.disconnect();
	});
	const cycleKey = $derived(shortcutLabel('approvalMode'));
</script>

<svelte:window onkeydowncapture={onKey} onresize={fit} />

<button class="mode-backdrop" aria-label={t('common.close')} tabindex="-1" onclick={onClose}></button>
<div
	class="pop modes"
	role="menu"
	bind:this={menu}
	out:popOut|global
	aria-label={t('chat.modeTitle')}
	style:translate={shift ? `${shift}px 0` : undefined}
	style:max-height={maxHeight != null ? `${maxHeight}px` : undefined}
>
	<div class="pop-head">
		<span>{t('chat.modeTitle')}</span>
		{#if cycleKey && !disabled}<kbd class="cycle" title={t('chat.modeCycle')}>{cycleKey}</kbd>{/if}
	</div>
	{#if note}<div class="note">{note}</div>{/if}
	{#each items as it, i (it.key)}
		<button
			class="pop-row two"
			class:sel={i === sel}
			class:warn={it.tone === 'warn'}
			role="menuitemradio"
			aria-checked={it.key === current}
			disabled={disabled || it.disabled}
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
	/* The composer's footer keeps its controls on one line (nowrap): the menu
	   sets its own wrapping, so a description wraps inside its row instead of
	   running out of the menu. */
	.modes {
		position: absolute;
		left: 0;
		bottom: calc(100% + 8px);
		z-index: 81;
		width: max-content;
		min-width: min(300px, calc(100vw - 16px));
		max-width: min(400px, calc(100vw - 16px));
		overflow-y: auto;
		overscroll-behavior: contain;
		white-space: normal;
		transform-origin: bottom left;
		animation: pop-in var(--t-pop) var(--ease-enter);
	}
	.pop-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 12px 4px;
		font-size: var(--fs-xs);
	}
	.cycle {
		color: var(--dim2);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
	}
	.note {
		padding: 0 12px 6px;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	/* Text, check and number in their own columns: the text never runs
	   under the check or the number. */
	.pop-row.two {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 15px 14px;
		align-items: center;
		column-gap: 10px;
	}
	.name {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		min-width: 0;
	}
	/* A mode is chosen on what it does: its line wraps rather than hide the end. */
	.pop-desc {
		line-height: 1.45;
		overflow-wrap: anywhere;
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
		color: var(--text);
	}
	.check.off {
		visibility: hidden;
	}
	.key {
		color: var(--dim2);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		text-align: right;
	}
</style>
