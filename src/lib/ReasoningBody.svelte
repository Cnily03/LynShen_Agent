<script lang="ts">
	// A reasoning's text: plain while it streams (streamPlain), Markdown once
	// it has finished, as chunks (finishedBlocks).
	//
	// When it finishes in view, the chunks take over from the plain text a
	// few each frame, from the top; the plain text written as it streamed
	// stays below them, laid out as it was, and loses its front as they come.
	// Rendered all at once, a long reasoning held the main thread for the
	// whole text as it finished, and made garbage as large. One that is
	// already finished when it shows (opened, or scrolled back to) renders at
	// once, as it did: its height must not change under a reader scrolling.
	import { flushSync, untrack } from 'svelte';
	import Markdown from '$lib/Markdown.svelte';
	import { blockStart, finishedBlocks, type Block } from '$lib/streamBlocks';
	import { streamPlain, type PlainSource } from '$lib/streamPlain';

	let {
		source,
		text,
		live,
		onFile
	}: {
		/** The text shown so far (the smoothed reveal while it streams). */
		source: PlainSource;
		/** The whole text, read once it has finished. */
		text: string;
		/** Still streaming. */
		live: boolean;
		onFile?: (href: string) => void;
	} = $props();

	/** Characters rendered as it finishes: more than a screenful at the top. */
	const FIRST = 4000;
	/** Script time a frame spends rendering chunks, ms: laying them out and
	 *  painting them takes about twice that again. */
	const BUDGET = 4;

	const streamed = untrack(() => live);
	const blocks = $derived(live ? [] : finishedBlocks(text));

	/** The chunks from `from` on that hold `chars` characters (at least one). */
	function upTo(list: Block[], chars: number, from: number): number {
		let n = from;
		for (let sum = 0; n < list.length && (n === from || sum < chars); n++) sum += list[n]!.text.length;
		return n;
	}

	/** Chunks rendered: those at the top at once, `more` since. */
	let more = $state(0);
	const ready = $derived(streamed ? Math.min(blocks.length, upTo(blocks, FIRST, 0) + more) : blocks.length);
	/** Where the plain text starts: at the first chunk not rendered yet. */
	const from = $derived(live ? 0 : ready < blocks.length ? blockStart(blocks[ready]!) : source.length);

	$effect(() => {
		const list = blocks;
		if (untrack(() => ready) >= list.length) return;
		let raf = 0;
		let stopped = false;
		// Characters a frame renders, set by how long the last frame took.
		let chars = FIRST;
		const step = () => {
			const at = ready;
			const to = upTo(list, chars, at);
			let sum = 0;
			for (let i = at; i < to; i++) sum += list[i]!.text.length;
			const t = performance.now();
			more += to - at;
			flushSync();
			const ms = performance.now() - t;
			chars = ms > 0.5 ? Math.max(500, Math.round((sum * BUDGET) / ms)) : chars * 2;
			// (Rendering may have unmounted it: then it stops.)
			if (!stopped && ready < list.length) raf = requestAnimationFrame(step);
		};
		raf = requestAnimationFrame(step);
		return () => {
			stopped = true;
			cancelAnimationFrame(raf);
		};
	});
</script>

{#each blocks.slice(0, ready) as block, b (block.key)}<Markdown text={block.text} more={b < blocks.length - 1} {onFile} />{/each}
{#if live || ready < blocks.length}<div class="stream" use:streamPlain={{ ...source, from }}></div>{/if}

<style>
	.stream {
		white-space: pre-wrap;
		word-break: break-word;
		line-height: 1.65;
		-webkit-user-select: text;
		user-select: text;
	}
</style>
