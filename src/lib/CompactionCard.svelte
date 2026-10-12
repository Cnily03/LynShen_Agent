<script lang="ts">
	// Context compaction in the conversation. While it runs, a card: the
	// conversation's lines folding together, how much is being folded, how
	// much of the summary is written, and a timer. Once done, a divider
	// where the summary took over: the size before and after, the bar
	// shrinking to it, and the summary itself on a click.
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { getLocale, t } from '$lib/i18n';
	import { fmtCtxTokens } from '$lib/composer/contextUsage';
	import CallTimer from '$lib/CallTimer.svelte';
	import Collapse from '$lib/ui/Collapse.svelte';
	import Markdown from '$lib/Markdown.svelte';

	let {
		stage,
		before = 0,
		after,
		written = 0,
		since = 0,
		summary = '',
		error = '',
		live = false
	}: {
		stage: 'running' | 'done' | 'failed';
		/** The context's tokens when it began (0: not known). */
		before?: number;
		/** Its tokens once compacted, when the engine has said. */
		after?: number;
		/** Summary tokens written so far. */
		written?: number;
		/** When it began (ms), for the timer. */
		since?: number;
		summary?: string;
		error?: string;
		/** It ran in front of the user: the divider animates in. */
		live?: boolean;
	} = $props();

	const locale = $derived(getLocale());
	const fmt = (n: number) => fmtCtxTokens(n, locale);
	const known = $derived(before > 0 && after !== undefined && after < before);
	const ratio = $derived(known ? Math.max(0.02, (after ?? 0) / before) : 1);
	const saved = $derived(known ? Math.round((1 - (after ?? 0) / before) * 100) : 0);
	let open = $state(false);

	// The bar starts full and shrinks to what is left, one frame after it shows.
	let shrunk = $state(false);
	$effect(() => {
		if (!known) return;
		if (!live) {
			shrunk = true;
			return;
		}
		const raf = requestAnimationFrame(() => requestAnimationFrame(() => (shrunk = true)));
		return () => cancelAnimationFrame(raf);
	});
</script>

{#if stage === 'running'}
	<div class="card" role="status" aria-live="polite">
		<span class="fold" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
		<span class="txt">
			<span class="head">
				<span class="title">{t('chat.compaction.running')}</span>
				{#if since}<CallTimer {since} />{/if}
			</span>
			<span class="sub">
				{#if before > 0}{t('chat.compaction.folding', { n: fmt(before) })}{:else}{t('chat.compaction.foldingUnknown')}{/if}
				{#if written > 0}<span class="dot">·</span><span class="num">{t('chat.compaction.written', { n: fmt(written) })}</span>{/if}
			</span>
			<span class="track" aria-hidden="true"><span class="sweep"></span></span>
		</span>
	</div>
{:else}
	<div class="divider" class:live class:failed={stage === 'failed'}>
		<span class="rule" aria-hidden="true"></span>
		{#if stage === 'failed'}
			<span class="pill" title={error}>{t('chat.compaction.failed')}{#if error}<span class="err">{error}</span>{/if}</span>
		{:else}
			<button class="pill" onclick={() => (open = !open)} disabled={!summary} aria-expanded={summary ? open : undefined} title={summary ? t(open ? 'chat.compaction.hideSummary' : 'chat.compaction.showSummary') : undefined}>
				<span class="label">{t('chat.compaction.done')}</span>
				{#if known}
					<span class="num">{fmt(before)} → {fmt(after ?? 0)}</span>
					<span class="bar" aria-hidden="true"><span class="fill" style:transform="scaleX({shrunk ? ratio : 1})"></span></span>
					<span class="saved">−{saved}%</span>
				{/if}
				{#if summary}<span class="caret" class:open><CaretRightIcon size={11} /></span>{/if}
			</button>
		{/if}
		<span class="rule" aria-hidden="true"></span>
	</div>
	{#if summary}
		<Collapse {open}>
			<div class="summary">
				<div class="shead">{t('chat.compaction.summaryTitle')}</div>
				<Markdown text={summary} />
			</div>
		</Collapse>
	{/if}
{/if}

<style>
	/* Running: a card in the conversation. Its entrance and the divider's
	   fill backwards only: their end values are the elements' own, and a fill
	   that held them kept each element transformed (by an identity matrix)
	   for good, in Chromium a compositing layer of its own. */
	.card {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 12px 16px;
		border-radius: var(--r-xl);
		background: var(--panel);
		box-shadow: var(--shadow-float);
		animation: card-in var(--t-enter) var(--ease-enter) backwards;
	}
	@keyframes card-in {
		from {
			opacity: 0;
			transform: translateY(6px) scale(0.985);
		}
	}
	.txt {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		flex: 1;
	}
	.head {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.title {
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--text);
	}
	.sub {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.dot {
		margin: 0 6px;
		color: var(--dim2);
	}
	.num {
		font-variant-numeric: tabular-nums;
	}
	/* A highlight sweeping along the track; transform only, so it costs no
	   layout or paint per frame. */
	.track {
		position: relative;
		height: 3px;
		margin-top: 4px;
		border-radius: var(--r-full);
		background: var(--surface2);
		overflow: hidden;
	}
	.sweep {
		position: absolute;
		inset: 0 auto 0 0;
		width: 35%;
		border-radius: var(--r-full);
		background: linear-gradient(90deg, transparent, var(--accent-bright), transparent);
		animation: sweep 1.4s var(--ease-in-out) infinite;
	}
	@keyframes sweep {
		from {
			transform: translateX(-100%);
		}
		to {
			transform: translateX(290%);
		}
	}

	/* The conversation's lines folding together into one, and again. */
	.fold {
		position: relative;
		flex: none;
		width: 26px;
		height: 26px;
	}
	.fold i {
		position: absolute;
		left: 3px;
		right: 3px;
		height: 3px;
		border-radius: var(--r-full);
		background: var(--accent-bright);
		animation: fold 1.6s var(--ease-in-out) infinite;
	}
	.fold i:nth-child(1) {
		top: 3px;
		--to: 8px;
		right: 7px;
	}
	.fold i:nth-child(2) {
		top: 9px;
		--to: 2px;
	}
	.fold i:nth-child(3) {
		top: 15px;
		--to: -4px;
		right: 9px;
	}
	.fold i:nth-child(4) {
		top: 21px;
		--to: -10px;
		right: 5px;
	}
	@keyframes fold {
		0%,
		12% {
			transform: translateY(0) scaleX(1);
			opacity: 0.85;
		}
		50%,
		62% {
			transform: translateY(var(--to)) scaleX(0.78);
			opacity: 0.45;
		}
		100% {
			transform: translateY(0) scaleX(1);
			opacity: 0.85;
		}
	}

	/* Done: a divider where the summary took over. */
	.divider {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 4px 0;
	}
	.rule {
		flex: 1;
		height: 1px;
		background: var(--border);
	}
	.live .rule:first-child {
		transform-origin: right;
		animation: rule-in var(--t-slow) var(--ease-out) backwards;
	}
	.live .rule:last-child {
		transform-origin: left;
		animation: rule-in var(--t-slow) var(--ease-out) backwards;
	}
	@keyframes rule-in {
		from {
			transform: scaleX(0);
		}
	}
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		max-width: 80%;
		padding: 3px 12px;
		border: none;
		border-radius: var(--r-full);
		background: var(--accent-soft);
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		white-space: nowrap;
	}
	button.pill:not(:disabled) {
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-base), color var(--t-fast) var(--ease-base);
	}
	button.pill:not(:disabled):hover {
		color: var(--text);
		background: color-mix(in oklab, var(--accent-soft), var(--text) 6%);
	}
	.live .pill {
		animation: pill-in var(--t-enter) var(--ease-out) backwards;
	}
	@keyframes pill-in {
		from {
			opacity: 0;
			transform: scale(0.92);
		}
	}
	.label {
		font-weight: 500;
	}
	/* The track is the size before, faintly; the fill shrinks to what is left. */
	.bar {
		position: relative;
		width: 44px;
		height: 4px;
		border-radius: var(--r-full);
		background: color-mix(in oklab, var(--accent-bright) 22%, transparent);
		overflow: hidden;
	}
	.fill {
		position: absolute;
		inset: 0;
		border-radius: var(--r-full);
		background: var(--accent-bright);
		transform-origin: left;
		transition: transform 0.9s var(--ease-out) 0.15s;
	}
	.saved {
		color: var(--accent-bright);
		font-variant-numeric: tabular-nums;
	}
	.caret {
		display: inline-flex;
		transition: transform var(--t-fast) var(--ease-base);
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.failed .pill {
		color: var(--err);
		background: color-mix(in oklab, var(--err) 12%, transparent);
	}
	.err {
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--dim);
	}
	.summary {
		margin: 6px 0 4px;
		padding: 12px 16px;
		border-radius: var(--r-lg);
		background: var(--accent-soft);
		font-size: var(--fs-sm);
	}
	.shead {
		margin-bottom: 6px;
		font-size: var(--fs-2xs);
		color: var(--dim2);
		letter-spacing: 0.02em;
	}

	@media (prefers-reduced-motion: reduce) {
		.card,
		.live .rule,
		.live .pill {
			animation: none;
		}
		.fold i,
		.sweep {
			animation-duration: 3.2s;
		}
		.fill {
			transition: none;
		}
	}
</style>
