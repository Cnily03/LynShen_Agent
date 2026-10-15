<script lang="ts">
	let {
		value = $bindable(),
		options,
		onChange
	}: { value: string; options: { value: string; label?: string }[]; onChange?: (v: string) => void } = $props();

	function pick(v: string) {
		value = v;
		onChange?.(v);
	}
</script>

<div class="seg">
	{#each options as o (o.value)}
		<button class="opt" class:on={o.value === value} onclick={() => pick(o.value)}>{o.label ?? o.value}</button>
	{/each}
</div>

<style>
	.seg {
		display: inline-flex;
		padding: 2px;
		gap: 2px;
		background: var(--surface2);
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
	}
	.opt {
		flex: 1;
		padding: 3px 12px;
		border: none;
		background: none;
		color: var(--dim);
		font-size: var(--fs-sm);
		line-height: 18px;
		font-family: var(--font-sans);
		border-radius: var(--r-sm);
		cursor: pointer;
		white-space: nowrap;
		transition:
			color var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out),
			box-shadow var(--t-med) var(--ease-out),
			transform var(--t-fast) var(--ease-spring);
	}
	.opt:hover {
		color: var(--text);
	}
	.opt:active {
		transform: scale(0.96);
	}
	.opt.on {
		background: var(--panel);
		color: var(--text);
		box-shadow: 0 0 0 1px var(--border);
	}
	/* On a phone the labels can be wider than the control's row (the remote
	   page's new-session dialog: LynShen | Claude Code | Codex in ~300px).
	   The control then keeps to its row: each option sizes from its label
	   and gives way by wrapping between words, never inside one. Without
	   this, the last option ran past the control and the dialog body grew a
	   horizontal scrollbar, which showed as a line above the buttons. Wider
	   windows keep equal-width options (the desktop window is never this
	   narrow). */
	@media (max-width: 640px) {
		.seg {
			max-width: 100%;
		}
		.opt {
			flex: 1 1 auto;
			padding-inline: 8px;
			white-space: normal;
		}
	}
</style>
