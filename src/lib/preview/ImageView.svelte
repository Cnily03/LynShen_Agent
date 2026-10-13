<script lang="ts">
	// An image file, fitted to the tab (never enlarged past its own size) or
	// at a zoom the header sets; ⌘/Ctrl + wheel zooms too. A larger image
	// scrolls in both directions.
	let {
		src,
		alt,
		zoom = $bindable('fit'),
		scale = $bindable(1),
		onFail
	}: {
		src: string;
		alt: string;
		/** `fit`, or a scale (1 = the image's own size). */
		zoom?: 'fit' | number;
		/** The scale the image shows at (out). */
		scale?: number;
		onFail: () => void;
	} = $props();

	let stage = $state<HTMLElement | null>(null);
	let natural = $state({ w: 0, h: 0 });
	let room = $state({ w: 0, h: 0 });

	$effect(() => {
		const el = stage;
		if (!el) return;
		const ro = new ResizeObserver(() => (room = { w: el.clientWidth, h: el.clientHeight }));
		ro.observe(el);
		// Not passive (as Svelte makes `onwheel`): the zoom takes the wheel
		// from the page's own zoom.
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => {
			ro.disconnect();
			el.removeEventListener('wheel', onWheel);
		};
	});

	const PAD = 24;
	const shown = $derived.by(() => {
		if (!natural.w || !natural.h) return 1;
		if (zoom !== 'fit') return zoom;
		const fit = Math.min((room.w - 2 * PAD) / natural.w, (room.h - 2 * PAD) / natural.h);
		return Math.max(0.01, Math.min(1, fit));
	});
	$effect(() => {
		scale = shown;
	});

	function onWheel(e: WheelEvent) {
		if (!(e.ctrlKey || e.metaKey) || !natural.w) return;
		e.preventDefault();
		const next = shown * (e.deltaY < 0 ? 1.1 : 1 / 1.1);
		zoom = Math.min(16, Math.max(0.05, next));
	}
</script>

<div class="stage" bind:this={stage}>
	<div class="frame">
		<img
			{src}
			{alt}
			draggable="false"
			style:width={natural.w ? `${natural.w * shown}px` : undefined}
			style:height={natural.h ? `${natural.h * shown}px` : undefined}
			class:free={!natural.w}
			onload={(e) => {
				const img = e.currentTarget as HTMLImageElement;
				natural = { w: img.naturalWidth, h: img.naturalHeight };
			}}
			onerror={onFail}
		/>
	</div>
</div>

<style>
	.stage {
		flex: 1;
		min-height: 0;
		overflow: auto;
	}
	.frame {
		display: grid;
		place-items: center;
		min-width: 100%;
		min-height: 100%;
		width: max-content;
		padding: 24px;
		box-sizing: border-box;
	}
	img {
		display: block;
		max-width: none;
		border-radius: var(--r-xs);
		background: var(--surface);
		user-select: none;
	}
	/* An image without its own size (an SVG with a viewBox only). */
	img.free {
		max-width: 100%;
		max-height: 100%;
	}
</style>
