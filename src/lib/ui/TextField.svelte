<script lang="ts">
	let {
		value = $bindable(),
		placeholder = '',
		type = 'text',
		mono = false,
		align = 'left',
		disabled = false
	}: {
		value: string | number | undefined;
		placeholder?: string;
		type?: 'text' | 'password' | 'number';
		mono?: boolean;
		align?: 'left' | 'right';
		disabled?: boolean;
	} = $props();
</script>

{#if type === 'password'}
	<input class="tf" class:mono style:text-align={align} type="password" {placeholder} {disabled} bind:value />
{:else if type === 'number'}
	<input class="tf" class:mono style:text-align={align} type="number" {placeholder} {disabled} bind:value />
{:else}
	<input class="tf" class:mono style:text-align={align} {placeholder} {disabled} bind:value />
{/if}

<style>
	.tf {
		width: 100%;
		min-width: 0;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		min-height: 32px;
		padding: 6px 10px;
		font-size: var(--fs-sm);
		line-height: 18px;
		font-family: var(--font-sans);
		outline: none;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.tf.mono {
		font-family: var(--font-mono);
	}
	.tf::placeholder {
		color: var(--dim2);
	}
	.tf:focus {
		border-color: var(--border-strong);
	}
	.tf:disabled {
		opacity: 0.55;
	}
</style>
