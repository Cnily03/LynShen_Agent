<script lang="ts">
	// The plan card's checklist, each step as the plan says it is (design.md,
	// "Status, attention and emphasis"): one to do has a hollow circle and
	// --dim text; the one in progress a 6px --accent dot and --text, with the
	// running light sweeping its words while the turn works (ui/shimmer.ts,
	// on the navigator's clock; none under reduced motion); a done one a
	// filled circle with a check, its words struck through in --dim; a failed
	// one shows in the error color and one that waits for the reader has a
	// 6px caution dot, with the reason on the line below. In LynShen's agent
	// team a step names the subagent it belongs to, a click away from its
	// conversation.
	//
	// A step done while the checklist is on screen plays it: its circle
	// fills and the check draws, a line strikes its words left to right and
	// they dim; then the step in progress after it lights its dot. Several
	// done at once play one after another (progressCards.ts, stepMotions).
	// Only transform, opacity, clip-path and stroke-dashoffset move, over
	// copies of the words (::before, ::after); nothing moves the layout. A
	// checklist that comes on screen (a plan loaded, a card opened again) is
	// drawn as it is. Reduced motion: the end state at once.
	import { untrack } from 'svelte';
	import { t } from '$lib/i18n';
	import { shimmer } from '$lib/ui/shimmer';
	import { motionMs, timeScale } from '$lib/ui/motion';
	import { shortPath, type AgentRow } from '$lib/agentProgress';
	import type { OpenHow } from './subagentPages.svelte';
	import { STEP_SETTLE, stepMotions, stepStates, type PlanCard, type StepMark, type StepMotion, type StepReason } from './progressCards';

	let {
		card,
		rows = [],
		onOpen
	}: {
		card: PlanCard;
		rows?: AgentRow[];
		/** Shows a subagent's conversation. Absent: owners are not links. */
		onOpen?: (row: AgentRow, how: OpenHow) => void;
	} = $props();

	const ownerRow = (agent: string) => (agent ? rows.find((r) => r.id === agent) : undefined);
	function reasonText(r: StepReason): string {
		switch (r.kind) {
			case 'approval':
				return t('chat.progress.waitApproval');
			case 'question':
				return t('chat.progress.waitQuestion');
			case 'agent':
				return r.error ? t('chat.progress.agentFailedWhy', { name: r.name, error: r.error }) : t('chat.progress.agentFailed', { name: r.name });
			case 'turn':
				return t('chat.progress.turnFailed', { error: r.error });
		}
	}

	// What changed since the checklist was last drawn (none on its first
	// draw), played before the update is drawn, so its end state never
	// shows first; cleared once it has landed, leaving the static markup.
	let motions = $state<StepMotion[]>([]);
	let seen: Map<string, StepMark> | null = null;
	let landing: ReturnType<typeof setTimeout> | undefined;
	$effect.pre(() => {
		const steps = card.steps;
		untrack(() => {
			const next = motionMs(1) > 0 ? stepMotions(seen, steps) : [];
			seen = stepStates(steps);
			if (!next.length) return;
			motions = [...motions.filter((m) => !next.some((n) => n.index === m.index)), ...next];
			clearTimeout(landing);
			const last = Math.max(...motions.map((m) => m.delay));
			landing = setTimeout(() => (motions = []), (last + STEP_SETTLE) * timeScale());
		});
	});
	$effect(() => () => clearTimeout(landing));
	const motionAt = (i: number) => motions.find((m) => m.index === i);

	// The step being worked on (or the one that needs the reader) comes into
	// view in the card's own scroll box (data-card-scroll); scrollIntoView
	// would scroll the panes around it too.
	let list = $state<HTMLElement | null>(null);
	$effect(() => {
		const i = card.attention >= 0 ? card.attention : card.current;
		const box = list?.closest<HTMLElement>('[data-card-scroll]');
		const el = list?.querySelector<HTMLElement>(`[data-step="${i}"]`);
		if (i < 0 || !box || !el) return;
		const b = box.getBoundingClientRect();
		const r = el.getBoundingClientRect();
		if (r.top < b.top) box.scrollTop -= b.top - r.top;
		else if (r.bottom > b.bottom) box.scrollTop += Math.min(r.bottom - b.bottom, r.top - b.top);
	});
</script>

<ol class="steps" bind:this={list}>
	{#each card.steps as s, i (i)}
		{@const owner = ownerRow(s.agent)}
		{@const sweep = card.live && s.state === 'active'}
		{@const m = motionAt(i)}
		{@const completing = m?.kind === 'complete' && s.state === 'done'}
		{@const lighting = m?.kind === 'light' && s.state === 'active'}
		<li
			class="step {s.state}"
			class:current={s.current}
			class:completing
			class:lighting
			class:recolour={lighting || (completing && m?.from !== 'pending')}
			data-step={i}
			data-from={completing || lighting ? m?.from : undefined}
			style:--d={completing || lighting ? `${m?.delay}ms` : undefined}
			aria-current={s.current ? 'step' : undefined}
		>
			<span class="mark" role="img" aria-label={t(`chat.progress.step.${s.state}`)}>
				{#if s.state === 'done'}
					<span class="tick">
						{#if completing}<span class="was {m?.from === 'pending' ? 'ring' : `dot ${m?.from}`}"></span>{/if}
						<span class="disc"></span>
						<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path class="check" d="M3.6 6.2 5.3 7.8 8.4 4.4" pathLength="1" /></svg>
					</span>
				{:else if s.state === 'pending'}<span class="ring"></span>
				{:else if s.state === 'skipped'}<span class="dash"></span>
				{:else}
					{#if lighting}<span class="ring was"></span>{/if}
					<span class="dot"></span>
				{/if}
			</span>
			<span class="body">
				<span class="text" class:sweep data-text={completing || lighting ? s.text : undefined} title={s.files.length ? s.files.join('\n') : undefined}
					><span class="words">{s.text}</span>{#if sweep}<i class="veil" aria-hidden="true" use:shimmer></i>{/if}</span
				>
				{#if s.reason}<span class="why">{reasonText(s.reason)}</span>{/if}
			</span>
			{#if s.agent}
				<button
					class="owner"
					disabled={!onOpen || !owner}
					onclick={(e) => owner && onOpen?.(owner, e.metaKey || e.ctrlKey ? 'other' : 'default')}
					title={t('chat.progress.owner', { name: shortPath(s.agent) })}
					aria-label={t('chat.progress.owner', { name: shortPath(s.agent) })}>{owner?.label ?? shortPath(s.agent)}</button
				>
			{/if}
		</li>
	{/each}
</ol>

<style>
	/* The running light's veil matches the fill under the list: the card's
	   --bg, or the --plan-fill a popover or sheet sets (--panel). */
	.steps {
		--step-bg: var(--plan-fill, var(--bg));
		--step-veil: 24%;
		list-style: none;
		margin: 0;
		padding: 0;
	}
	:global([data-theme='light']) .steps {
		--step-veil: 18%;
	}
	.step {
		display: grid;
		grid-template-columns: 14px minmax(0, 1fr) auto;
		align-items: start;
		column-gap: 6px;
		padding: 4px 8px;
		font-size: var(--fs-sm);
		line-height: 18px;
		color: var(--text);
	}
	.mark {
		position: relative;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		height: 18px;
		color: var(--dim);
	}
	/* Done: a 10px disc with the check cut out of it, in the list's fill. */
	.tick {
		position: relative;
		display: block;
		width: 12px;
		height: 12px;
	}
	.tick > * {
		position: absolute;
		inset: 0;
		margin: auto;
	}
	.tick .disc {
		width: 10px;
		height: 10px;
		border-radius: var(--r-full);
		background: var(--dim2);
	}
	.tick svg {
		display: block;
	}
	.tick .check {
		fill: none;
		stroke: var(--step-bg);
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
		stroke-dasharray: 1;
		stroke-dashoffset: 0;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--r-full);
	}
	.ring {
		box-sizing: border-box;
		width: 9px;
		height: 9px;
		border: 1.5px solid var(--dim2);
		border-radius: var(--r-full);
	}
	.dash {
		width: 8px;
		height: 1.5px;
		border-radius: var(--r-full);
		background: var(--dim2);
	}
	.step.active .dot {
		background: var(--accent);
	}
	.step.waiting .dot {
		background: var(--warn);
	}
	.step.failed .dot {
		background: var(--err);
	}
	.body {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.text {
		overflow-wrap: anywhere;
	}
	.step.pending .text,
	.step.done .text {
		color: var(--dim);
	}
	.step.done .text {
		text-decoration: line-through;
		text-decoration-thickness: 1px;
	}
	/* The step in progress while the turn works: the words hug their text,
	   so the light crosses them, not the empty row. */
	.text.sweep {
		position: relative;
		align-self: flex-start;
		max-width: 100%;
		overflow: hidden;
	}
	/* The navigator's veil (Sidebar.svelte), lighter: the list's own fill
	   over the words, with a clear window the sweep moves across. */
	.veil {
		position: absolute;
		top: 0;
		bottom: 0;
		left: 0;
		width: 300%;
		pointer-events: none;
		background: linear-gradient(
			90deg,
			color-mix(in srgb, var(--step-bg) var(--step-veil), transparent) 0%,
			color-mix(in srgb, var(--step-bg) var(--step-veil), transparent) 42%,
			transparent 50%,
			color-mix(in srgb, var(--step-bg) var(--step-veil), transparent) 58%,
			color-mix(in srgb, var(--step-bg) var(--step-veil), transparent) 100%
		);
		transform: translateX(-60%);
	}
	/* Where the light does not sweep (ui/shimmer.ts), the words stay --text. */
	:global(:root[data-vibrancy]) .veil,
	:global(:root[data-canvas-bg]) .veil {
		display: none;
	}
	@media (prefers-reduced-motion: reduce) {
		.veil {
			display: none;
		}
	}
	.step.skipped .text {
		color: var(--dim2);
		text-decoration: line-through;
	}

	/* ── a step done, or lit, while the checklist is on screen ──
	   --d: when it starts (its place in a sequence); every time follows
	   --time-scale. The circle it had fades as the disc grows from its size,
	   the check draws (stroke-dashoffset), the line crosses the words
	   (clip-path on a copy that only carries the line), and the words cross-
	   fade from a copy in their old colour. */
	.completing,
	.lighting {
		--at: calc(var(--d, 0ms) * var(--time-scale));
	}
	.completing .tick .disc {
		animation: step-fill calc(180ms * var(--time-scale)) var(--ease-enter) var(--at) both;
	}
	/* The disc grows from the size of the mark it replaces: the 9px circle,
	   or the 6px dot. */
	.completing[data-from='pending'] {
		--from: 0.9;
		--was-text: var(--dim);
	}
	.completing:not([data-from='pending']) {
		--from: 0.6;
		--was-text: var(--text);
	}
	.completing[data-from='failed'] {
		--was-text: var(--err);
	}
	.completing .tick .check {
		animation: step-draw calc(200ms * var(--time-scale)) var(--ease-enter) calc(var(--at) + 60ms * var(--time-scale)) both;
	}
	.tick .was {
		animation: step-fade calc(140ms * var(--time-scale)) var(--ease-exit) var(--at) both;
	}
	.tick .was {
		border-radius: var(--r-full);
	}
	.tick .was.ring {
		width: 9px;
		height: 9px;
		border: 1.5px solid var(--dim2);
	}
	.tick .was.dot {
		width: 6px;
		height: 6px;
		background: var(--accent);
	}
	.tick .was.dot.failed {
		background: var(--err);
	}
	.tick .was.dot.waiting {
		background: var(--warn);
	}
	/* The words hug their text (as .sweep), so the line crosses the words,
	   not the empty row; wrapping stays the same. */
	.completing .text,
	.lighting .text {
		position: relative;
		align-self: flex-start;
		max-width: 100%;
	}
	/* The line comes with the sweep (::after), not with the class. */
	.step.done.completing .text {
		text-decoration: none;
	}
	.completing .text::after,
	.recolour .text::before {
		content: attr(data-text);
		content: attr(data-text) / '';
		position: absolute;
		inset: 0;
		pointer-events: none;
	}
	/* The words in their old colour, crossfading into the new one (none
	   for a step to do: it is --dim before and after). */
	.recolour .text::before {
		color: var(--was-text);
		animation: step-fade calc(300ms * var(--time-scale)) var(--ease-base) calc(var(--at) + 80ms * var(--time-scale)) both;
	}
	.recolour .words {
		animation: step-show calc(300ms * var(--time-scale)) var(--ease-base) calc(var(--at) + 80ms * var(--time-scale)) both;
	}
	.completing .text::after {
		color: transparent;
		text-decoration: line-through;
		text-decoration-color: var(--dim);
		text-decoration-thickness: 1px;
		animation: step-strike calc(300ms * var(--time-scale)) var(--ease-base) calc(var(--at) + 80ms * var(--time-scale)) both;
	}
	.lighting {
		--was-text: var(--dim);
	}
	.lighting .dot {
		animation: step-light calc(220ms * var(--time-scale)) var(--ease-enter) var(--at) both;
	}
	.mark .ring.was {
		position: absolute;
		animation: step-fade calc(140ms * var(--time-scale)) var(--ease-exit) var(--at) both;
	}
	.lighting .veil {
		animation: step-show calc(220ms * var(--time-scale)) var(--ease-enter) var(--at) both;
	}
	@keyframes step-fill {
		from {
			opacity: 0;
			transform: scale(var(--from));
		}
	}
	@keyframes step-draw {
		from {
			stroke-dashoffset: 1;
		}
	}
	@keyframes step-strike {
		from {
			clip-path: inset(0 100% 0 0);
		}
		to {
			clip-path: inset(0 0 0 0);
		}
	}
	@keyframes step-fade {
		to {
			opacity: 0;
		}
	}
	@keyframes step-light {
		from {
			opacity: 0;
			transform: scale(0);
		}
	}
	@keyframes step-show {
		from {
			opacity: 0;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.completing *,
		.completing .text::after,
		.lighting *,
		.recolour .text::before {
			animation: none !important;
		}
		.tick .was,
		.mark .ring.was,
		.recolour .text::before {
			opacity: 0;
		}
	}
	.step.failed .text {
		color: var(--err);
	}
	.why {
		font-size: var(--fs-xs);
		line-height: 16px;
		color: var(--dim);
		overflow-wrap: anywhere;
	}
	/* The subagent a step belongs to (LynShen's agent team). */
	.owner {
		max-width: 96px;
		margin: 0 -4px 0 0;
		padding: 0 4px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		line-height: 18px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-base),
			color var(--t-fast) var(--ease-base);
	}
	.owner:disabled {
		cursor: default;
	}
	.owner:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.owner:focus-visible {
		outline-offset: -2px;
	}
</style>
