<script lang="ts">
	import ContextRing from '$lib/ContextRing.svelte';
	import { getLocale, t } from '$lib/i18n';
	import { BREAKDOWN_KEYS, fmtCtxTokens, fmtPct, type BreakdownKey, type RequestParts } from './contextUsage';
	import { fmtResetAt, remainingPct, type QuotaSource } from './quota';
	import { costText, type BillingCost } from '$lib/sessionCost';
	import { fmtDur } from '$lib/turnStats';
	import type { ContextBreakdown } from '$lib/chat.svelte';
	import { breakdownRows, categoryKey } from './contextBreakdown';

	// The composer's context ring and the card it shows on hover or keyboard
	// focus: how full the next request is, what the context holds by category
	// (asked from engines that can say, on hover) or else by request part (when
	// the LynShen engine sends them), the session's usage and average
	// prompt-cache hit rate, and the plan quota left when the session draws on
	// one.
	let {
		used,
		window: ctxWindow,
		limit,
		pct,
		atThreshold = false,
		parts = null,
		breakdown = null,
		onBreakdown,
		cacheHitRate = null,
		quota = null,
		totalIn = 0,
		totalOut = 0,
		runMs = 0,
		cost = 0,
		billing = null,
		billingError = ''
	}: {
		/** Tokens the next request holds. */
		used: number;
		/** The model's context window ('0' when unknown: the limit stands in). */
		window: number;
		/** The gauge's full mark: the auto-compaction point, else the window. */
		limit: number;
		/** Ring fill, 0–100, against `limit`. */
		pct: number;
		/** `limit` is the engine's real compaction threshold (lynshen). */
		atThreshold?: boolean;
		/** The request by part, as the engine sends it with `context_usage`. */
		parts?: RequestParts | null;
		/** What the context holds by category, as last asked; null before. */
		breakdown?: ContextBreakdown | null;
		/** Asks the engine for it (engines that can say); absent: no categories. */
		onBreakdown?: () => void;
		/** 0–1; null hides the row. */
		cacheHitRate?: number | null;
		/** null hides the remaining-quota part. */
		quota?: QuotaSource | null;
		/** The session's tokens in and out. */
		totalIn?: number;
		totalOut?: number;
		/** The session's total running time (sum of its turns), ms. */
		runMs?: number;
		/** The engine's cost estimate for the session, USD (0: none). */
		cost?: number;
		/** What the gateway settled for the session's requests. */
		billing?: BillingCost | null;
		billingError?: string;
	} = $props();

	const uid = $props.id();
	const locale = $derived(getLocale());
	const fmt = (n: number) => fmtCtxTokens(n, locale);
	const total = $derived(ctxWindow || limit);
	const usedPct = $derived(total > 0 ? (used / total) * 100 : 0);

	// Asked again on hover or focus, at most every few seconds.
	let askedAt = 0;
	function ask() {
		if (!onBreakdown || Date.now() - askedAt < 5000) return;
		askedAt = Date.now();
		onBreakdown();
	}
	const counted = $derived(onBreakdown && breakdown && 'total' in breakdown ? breakdown : null);
	const rows = $derived(counted ? breakdownRows(counted) : null);
	const catLabel = (name: string) => {
		const key = categoryKey(name);
		return key ? t(`chat.contextCat.${key}`) : name;
	};
	const base = (path: string) => path.split(/[\\/]/).pop() || path;

	// Request parts: shades of the info blue, strongest first, one per part.
	const SHADES: Record<BreakdownKey, number> = { system_tools: 100, skills: 80, system_prompt: 62, messages: 46, mcp_tools: 32 };
	const shade = (k: BreakdownKey) => `color-mix(in oklab, var(--info) ${SHADES[k]}%, var(--panel))`;
	const partRows = $derived(
		parts && !rows
			? BREAKDOWN_KEYS.filter((k) => (parts[k] ?? 0) > 0).map((k) => ({
					key: k,
					tokens: parts[k] ?? 0,
					color: shade(k)
				}))
			: []
	);
	// Where the engine compacts, on the bar (only when that is short of the window).
	const markPct = $derived(atThreshold && total > limit && limit > 0 ? (limit / total) * 100 : null);
	const quotaTone = (left: number) => (left <= 0 ? 'full' : left <= 20 ? 'warn' : '');
</script>

<div class="ctxwrap">
	<button
		type="button"
		class="ring-btn"
		aria-label="{t('chat.context')} {fmt(used)}/{fmt(total)}"
		aria-describedby="{uid}-card"
		onmouseenter={ask}
		onfocus={ask}
	>
		<ContextRing {pct} size={14} /><span class="pctl">{fmtPct(pct)}</span>
	</button>
	<div class="ctx-card" id="{uid}-card" role="tooltip">
		<div class="row head">
			<span class="label">{t('chat.context')}</span>
			<span class="num">{fmt(used)}/{fmt(total)} ({fmtPct(usedPct)})</span>
		</div>
		<div class="bar" class:warn={pct >= 75} class:full={pct >= 90}>
			{#if rows}
				<!-- Each category's share of the window; the room kept for compaction hatched. -->
				{#each rows.used as r (r.name)}<span class="seg cat" style:--hue={r.hue} style:width="{r.pct}%"></span>{/each}
				{#each rows.room as r (r.name)}{#if r.kind === 'buffer'}<span class="seg buffer" style:width="{r.pct}%"></span>{/if}{/each}
			{:else if partRows.length}
				{#each partRows as p (p.key)}
					<span class="seg" style:width="{Math.min(100, (p.tokens / total) * 100)}%" style:background={p.color}></span>
				{/each}
			{:else}
				<span class="seg plain" style:width="{Math.min(100, usedPct)}%"></span>
			{/if}
			{#if markPct !== null && !rows}<span class="mark" style:left="{markPct}%"></span>{/if}
		</div>
		{#if markPct !== null}<div class="caption">{t('chat.compactAt', { n: fmt(limit) })}</div>{/if}
		{#if rows}
			<ul class="parts">
				{#each rows.used as r (r.name)}
					<li class="row"><span class="dot cat" style:--hue={r.hue}></span><span class="name">{catLabel(r.name)}</span><span class="num">{fmt(r.tokens)}</span><span class="pct">{r.pct}%</span></li>
				{/each}
				{#each rows.deferred as r (r.name)}
					<li class="row dimrow" title={t('chat.contextDeferredHint')}><span class="dot hollow"></span><span class="name">{catLabel(r.name)}</span><span class="num">{fmt(r.tokens)}</span><span class="pct"></span></li>
				{/each}
				{#each rows.room as r (r.name)}
					<li class="row dimrow"><span class="dot {r.kind === 'buffer' ? 'buffer' : 'hollow'}"></span><span class="name">{catLabel(r.name)}</span><span class="num">{fmt(r.tokens)}</span><span class="pct">{r.pct}%</span></li>
				{/each}
			</ul>
			{#if counted?.memoryFiles.length}
				<div class="caption cap">{t('chat.contextFiles')}</div>
				{#each counted.memoryFiles.slice(0, 6) as f (f.path)}
					<div class="row" title={f.path}><span class="name">{base(f.path)}</span><span class="num">{fmt(f.tokens)}</span></div>
				{/each}
			{/if}
		{:else if partRows.length}
			<ul class="parts">
				{#each partRows as p (p.key)}
					<li class="row">
						<span class="dot" style:background={p.color}></span>
						<span class="name">{t(`chat.ctxPart.${p.key}`)}</span>
						<span class="num dim">{fmtPct((p.tokens / Math.max(1, used)) * 100)}</span>
					</li>
				{/each}
			</ul>
		{:else if onBreakdown && !breakdown}
			<div class="caption">{t('chat.contextLoading')}</div>
		{/if}
		{#if cacheHitRate !== null}
			<div class="sep"></div>
			<div class="row">
				<span class="name">{t('chat.cacheHit')}</span>
				<span class="num">{fmtPct(cacheHitRate * 100)}</span>
			</div>
		{/if}
		{#if totalIn || totalOut || cost > 0 || billing || billingError || runMs > 0}
			<div class="sep"></div>
			{#if totalIn || totalOut}
				<div class="row sub"><span class="label">{t('chat.sessionUsage')}</span></div>
				<div class="row"><span class="name">{t('chat.sessionIn')}</span><span class="num">{fmt(totalIn)}</span></div>
				<div class="row"><span class="name">{t('chat.sessionOut')}</span><span class="num">{fmt(totalOut)}</span></div>
			{/if}
			{#if cost > 0 || billing}
				<div class="row" title={billing ? t('chat.costSettledHint') : undefined}>
					<span class="name">{t('chat.cost')}</span>
					<span class="num">{costText(cost, billing)}</span>
				</div>
			{/if}
			{#if billingError}<div class="caption">{t('chat.costError', { error: billingError })}</div>{/if}
			{#if runMs > 0}<div class="row"><span class="name">{t('chat.sessionRun')}</span><span class="num">{fmtDur(runMs)}</span></div>{/if}
		{/if}
		{#if quota?.windows.length}
			<div class="sep"></div>
			<div class="row sub">
				<span class="label">{t('chat.quota.remaining')}</span>
				{#if quota.plan}<span class="dim">{quota.plan}</span>{/if}
			</div>
			{#each quota.windows as w, i (i)}
				{@const left = remainingPct(w)}
				<div class="qwin">
					<div class="row">
						<span class="name">{w.label}</span>
						<span class="num">{Math.round(left)}%{#if w.resetsAt}<span class="dim">{` · ${fmtResetAt(w.resetsAt, locale)}`}</span>{/if}</span>
					</div>
					<div class="bar thin {quotaTone(left)}"><span class="seg plain" style:width="{left}%"></span></div>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.ctxwrap {
		position: relative;
		display: inline-flex;
	}
	/* The ring is the hover target; the card also shows on keyboard focus. */
	/* In the composer's footer: the ring and the share used, in mono. */
	.ring-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		height: 28px;
		padding: 0 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
		cursor: default;
		transition: background var(--t-fast) var(--ease-out);
	}
	.ring-btn:hover {
		background: var(--surface2);
	}
	.ctx-card {
		position: absolute;
		bottom: calc(100% + 8px);
		right: -4px;
		z-index: 21;
		display: flex;
		flex-direction: column;
		gap: 8px;
		width: 288px;
		max-width: calc(100vw - 32px);
		padding: 12px 14px 14px;
		background: var(--panel);
		border-radius: var(--r-lg);
		box-shadow: var(--shadow-pop);
		opacity: 0;
		visibility: hidden;
		transform: translateY(4px) scale(0.97);
		transform-origin: bottom right;
		pointer-events: none;
		transition:
			opacity var(--t-med) var(--ease-out),
			transform var(--t-med) var(--ease-spring),
			visibility 0s linear var(--t-med);
	}
	.ring-btn:hover + .ctx-card,
	.ring-btn:focus-visible + .ctx-card {
		opacity: 1;
		visibility: visible;
		transform: none;
		transition-delay: 0s;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.row.head {
		font-size: var(--fs-sm);
	}
	.row.dimrow {
		color: var(--dim2);
	}
	.label {
		flex: 1;
		color: var(--text);
		font-weight: 500;
	}
	.row.sub .label {
		font-size: var(--fs-xs);
	}
	.name {
		flex: 1;
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.num {
		flex-shrink: 0;
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.pct {
		flex: none;
		width: 40px;
		text-align: right;
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
		color: var(--dim2);
	}
	.dim,
	.num.dim {
		color: var(--dim);
	}
	.bar {
		position: relative;
		display: flex;
		height: 6px;
		border-radius: var(--r-full);
		background: var(--surface2);
		overflow: hidden;
	}
	.bar.thin {
		height: 4px;
		margin-top: 5px;
	}
	.seg {
		height: 100%;
		flex-shrink: 0;
		transition: width var(--t-slow) var(--ease-out);
	}
	.seg + .seg {
		box-shadow: inset 1px 0 0 var(--panel);
	}
	.seg.plain {
		background: var(--info);
		border-radius: inherit;
	}
	.bar.warn .seg.plain {
		background: var(--warn);
	}
	.bar.full .seg.plain {
		background: var(--err);
	}
	/* Categories: colours step around the brand hue in oklch; the room kept
	   for compaction is hatched, free space is the bare track. */
	.seg.cat,
	.dot.cat {
		background: var(--dim);
		background: oklch(from var(--brand) calc(l + 0.08 - var(--hue) * 0.05) calc(c * 0.8) calc(h - 40 + var(--hue) * 24));
	}
	.seg.cat {
		min-width: 2px;
	}
	.seg.buffer,
	.dot.buffer {
		background: repeating-linear-gradient(135deg, var(--border) 0 2px, transparent 2px 4px);
	}
	/* The compaction point. */
	.mark {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		background: var(--dim2);
	}
	.caption {
		margin-top: -2px;
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.caption.cap {
		margin-top: 2px;
	}
	.parts {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 2px 0 0;
		padding: 0;
		list-style: none;
	}
	.dot {
		width: 8px;
		height: 8px;
		flex-shrink: 0;
		border-radius: var(--r-full);
	}
	.dot.hollow {
		background: none;
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.sep {
		height: 1px;
		margin: 2px 0;
		background: var(--hairline);
	}
</style>
