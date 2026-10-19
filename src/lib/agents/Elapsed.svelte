<script lang="ts">
	import { visibleInterval } from '$lib/visibleInterval';
	// A subagent's running time, ticking once a second while it runs. Its own
	// component, so the clock re-renders this label only, not the list it is in.
	import { rowElapsed, shortElapsed, type AgentRow } from '$lib/agentProgress';

	let { row }: { row: Pick<AgentRow, 'state' | 'startedAt' | 'durationMs' | 'endedAt'> } = $props();

	let now = $state(Date.now());
	const live = $derived(row.state === 'running' && row.startedAt > 0);
	$effect(() => {
		if (!live) return;
		now = Date.now();
		return visibleInterval(() => (now = Date.now()), 1000);
	});
	const ms = $derived(rowElapsed(row as AgentRow, now));
</script>

{#if ms > 0 || live}<span class="el">{shortElapsed(ms)}</span>{/if}

<style>
	.el {
		flex: none;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
		color: var(--dim);
	}
</style>
