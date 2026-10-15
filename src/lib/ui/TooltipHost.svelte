<script lang="ts">
	// Replaces the native `title` tooltip for the whole app: components keep
	// writing `title=`; on hover the text moves to data-tip (so the WebView shows
	// nothing) and appears here after a short delay, below the element or above
	// it near the bottom edge. Once one tooltip has shown, the next one within
	// a moment appears immediately, as in native toolbars.
	const DELAY = 450;
	const WARM = 400;

	let tip = $state<{ text: string; x: number; y: number; side: 'below' | 'above' | 'right' } | null>(null);
	let current: HTMLElement | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let lastHide = 0;

	function claim(el: HTMLElement): string {
		const title = el.getAttribute('title');
		if (title !== null) {
			el.removeAttribute('title');
			el.dataset.tip = title;
			// Icon-only controls relied on the title for their accessible name.
			if (!el.hasAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', title);
		}
		return el.dataset.tip ?? '';
	}

	/** The right edge of what shows of `el`: the collapsed rail keeps rows at
	 *  their expanded width and clips them, so the element's own edge can be
	 *  far right of anything visible. */
	function visibleRight(el: HTMLElement, right: number): number {
		for (let p = el.parentElement; p; p = p.parentElement) {
			if (getComputedStyle(p).overflowX !== 'visible') right = Math.min(right, p.getBoundingClientRect().right);
		}
		return right;
	}

	// `data-tip-side="right"` (the collapsed sidebar's icons) shows the tip
	// beside the element instead of below it.
	function show(el: HTMLElement, text: string) {
		const r = el.getBoundingClientRect();
		if (el.dataset.tipSide === 'right') {
			tip = { text, x: visibleRight(el, r.right) + 8, y: r.top + r.height / 2, side: 'right' };
			return;
		}
		const above = r.bottom + 40 > window.innerHeight;
		tip = { text, x: r.left + r.width / 2, y: above ? r.top - 6 : r.bottom + 6, side: above ? 'above' : 'below' };
	}
	function hide() {
		clearTimeout(timer);
		if (tip) lastHide = performance.now();
		tip = null;
		current = null;
	}

	function onOver(e: PointerEvent) {
		const el = (e.target as Element | null)?.closest?.('[title], [data-tip]') as HTMLElement | null;
		if (el === current) return;
		hide();
		if (!el) return;
		const text = claim(el);
		if (!text) return;
		current = el;
		const warm = performance.now() - lastHide < WARM;
		timer = setTimeout(() => current === el && el.isConnected && show(el, text), warm ? 0 : DELAY);
	}
	function onOut(e: PointerEvent) {
		if (current && !current.contains(e.relatedTarget as Node | null)) hide();
	}

	/** A tip near the window's edge is moved back inside it: centred under
	 *  an element at the left edge it used to run off the window. */
	const EDGE = 8;
	function keepInside(node: HTMLElement, _tip: unknown) {
		const fit = () => {
			node.style.translate = '';
			const r = node.getBoundingClientRect();
			const dx = r.left < EDGE ? EDGE - r.left : r.right > window.innerWidth - EDGE ? window.innerWidth - EDGE - r.right : 0;
			const dy = r.top < EDGE ? EDGE - r.top : r.bottom > window.innerHeight - EDGE ? window.innerHeight - EDGE - r.bottom : 0;
			if (dx || dy) node.style.translate = `${Math.round(dx)}px ${Math.round(dy)}px`;
		};
		fit();
		return { update: fit };
	}
</script>

<svelte:document onpointerover={onOver} onpointerout={onOut} />
<svelte:window onpointerdown={hide} onkeydown={hide} onblur={hide} onwheel={hide} />

{#if tip}
	<div class="tip" class:above={tip.side === 'above'} class:right={tip.side === 'right'} role="tooltip" style:left="{tip.x}px" style:top="{tip.y}px" use:keepInside={tip}>{tip.text}</div>
{/if}

<style>
	.tip {
		position: fixed;
		z-index: 400;
		max-width: min(320px, calc(100vw - 16px));
		padding: 4px 8px;
		border-radius: var(--r-md);
		background: var(--panel);
		color: var(--text);
		box-shadow: var(--shadow-pop);
		font-size: var(--fs-sm);
		line-height: 18px;
		white-space: pre-line;
		pointer-events: none;
		transform: translateX(-50%);
		animation: tip-in var(--t-fast) var(--ease-out);
	}
	.tip.above {
		transform: translate(-50%, -100%);
	}
	.tip.right {
		transform: translateY(-50%);
	}
	@keyframes tip-in {
		from {
			opacity: 0;
		}
	}
</style>
