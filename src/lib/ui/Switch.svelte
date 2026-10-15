<script lang="ts">
	let {
		checked = $bindable(),
		label,
		disabled = false,
		onChange
	}: { checked: boolean; label?: string; disabled?: boolean; onChange?: (checked: boolean) => void } = $props();

	function toggle() {
		checked = !checked;
		onChange?.(checked);
	}
</script>

<button class="sw" class:on={checked} role="switch" aria-checked={checked} aria-label={label} {disabled} onclick={toggle}>
	<span class="knob"></span>
</button>

<style>
	.sw {
		width: 36px;
		height: 20px;
		border-radius: var(--r-full);
		border: none;
		background: var(--surface2);
		box-shadow: inset 0 0 0 1px var(--border);
		cursor: pointer;
		padding: 0;
		position: relative;
		flex-shrink: 0;
		transition: background var(--t-fast) var(--ease-out);
	}
	.sw.on {
		background: var(--accent);
		box-shadow: none;
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 16px;
		height: 16px;
		border-radius: 50%;
		background: var(--on-accent);
		transition: transform var(--t-med) var(--ease-spring);
	}
	.sw.on .knob {
		transform: translateX(16px);
	}
	.sw:disabled {
		opacity: 0.45;
		cursor: default;
	}
</style>
