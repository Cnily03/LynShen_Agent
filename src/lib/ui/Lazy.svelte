<script lang="ts" module>
	import type { Component } from 'svelte';

	/* eslint-disable @typescript-eslint/no-explicit-any */
	const loaded = new Map<() => Promise<{ default: Component<any> }>, Component<any>>();
	const loading = new Map<() => Promise<{ default: Component<any> }>, Promise<Component<any>>>();

	/** Loads a component's code ahead of need (it renders at once then). */
	export function preload(load: () => Promise<{ default: Component<any> }>): Promise<Component<any>> {
		const done = loaded.get(load);
		if (done) return Promise.resolve(done);
		let p = loading.get(load);
		if (!p) {
			p = load().then((m) => {
				loaded.set(load, m.default);
				loading.delete(load);
				return m.default;
			});
			loading.set(load, p);
		}
		return p;
	}
</script>

<script lang="ts">
	import { untrack } from 'svelte';
	// A component whose code loads when it first shows: the editor
	// (CodeMirror), the terminals (xterm) and the file preview are a large
	// part of the app's code and most sessions never open them; imported
	// with the page, they were fetched, parsed and held from every start.
	// `load` must be one function for each component (declared once, not
	// inline), so each loads once. Its props pass through; `bind:instance`
	// gives the component itself once it has loaded.
	let {
		load,
		instance = $bindable(),
		...rest
	}: {
		load: () => Promise<{ default: Component<any> }>;
		instance?: any;
		[key: string]: unknown;
	} = $props();
	/* eslint-enable @typescript-eslint/no-explicit-any */

	let Loaded = $state(untrack(() => loaded.get(load) ?? null));
	$effect(() => {
		const want = load;
		if (Loaded && loaded.get(want) === Loaded) return;
		let alive = true;
		void preload(want).then((c) => alive && (Loaded = c));
		return () => {
			alive = false;
		};
	});
</script>

{#if Loaded}<Loaded bind:this={instance} {...rest} />{/if}
