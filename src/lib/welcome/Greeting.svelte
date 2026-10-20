<script lang="ts">
	// The one-time greeting after the first run (手机端方案/首次欢迎/说明.md §4;
	// design.md, "First-run page"). Over the workbench, which is built under
	// it: a teal light (LynShen's, --lynshen-light) writes 「你好，…」 left to
	// right; the line slides away while the light draws to the middle; the
	// 04 林光 mark assembles there, its trunks rising as on the launch screen
	// and the light settling into its slant; one line fades in; a round
	// opening from the mark's centre shows the workbench.
	// Enter, Space, Escape or a click go straight to the opening; Tab reaches
	// only 跳过. Reduced motion: fades only.
	import { onMount } from 'svelte';
	import { t } from '$lib/i18n';
	import {
		GREETING_PHASES,
		GREETING_SKIP_OPEN_MS,
		greetingNext,
		greetingReached,
		greetingTimeline,
		type GreetingPhase
	} from './flow';

	let {
		name = '',
		onDone
	}: {
		/** The account's name; empty without an account. */
		name?: string;
		/** It has played or was skipped: record it and give focus back. */
		onDone: () => void;
	} = $props();

	const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
	const at = greetingTimeline(reduced);
	let phase = $state<GreetingPhase>('light');
	let skipped = $state(false);
	let timers: ReturnType<typeof setTimeout>[] = [];
	let skipEl = $state<HTMLButtonElement>();
	/** The greeting's width: the light writes along it. */
	let helloW = $state(0);

	const hello = $derived(name ? t('setup.greeting.hello', { name }) : t('setup.greeting.helloNoName'));
	const reached = (p: GreetingPhase) => greetingReached(phase, p);

	onMount(() => {
		for (const p of GREETING_PHASES) {
			if (p !== 'light') timers.push(setTimeout(() => !skipped && (phase = p), at[p]));
		}
		skipEl?.focus({ preventScroll: true });
		return () => timers.forEach(clearTimeout);
	});

	$effect(() => {
		if (phase === 'done') onDone();
	});

	function skip() {
		if (skipped || reached('open')) return;
		skipped = true;
		timers.forEach(clearTimeout);
		phase = greetingNext(phase, 'skip');
		timers = [setTimeout(() => (phase = 'done'), (reduced ? 200 : GREETING_SKIP_OPEN_MS) + 30)];
	}

	function onKey(e: KeyboardEvent) {
		if (e.key === 'Tab') {
			// Focus stays on 跳过 (the only control) while the greeting is up.
			e.preventDefault();
			skipEl?.focus();
			return;
		}
		if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
			e.preventDefault();
			e.stopPropagation();
			skip();
		}
	}
</script>

<svelte:window onkeydowncapture={onKey} />

{#if phase !== 'done'}
	<div
		class="greeting"
		class:reduced
		class:skipped
		data-phase={phase}
		role="dialog"
		aria-modal="true"
		aria-label={t('setup.greeting.label')}
		tabindex="-1"
		onclick={skip}
		onkeydown={() => {}}
	>
		<div class="drag" data-tauri-drag-region></div>
		<div class="ground"></div>

		<div class="stage" style:--hello-w="{helloW}px">
			<p class="hello" class:written={reached('write')} class:away={reached('trail')} aria-live="polite">
				<span class="ink" bind:clientWidth={helloW}>{hello}</span>
			</p>
			<span class="spark" class:on={!reached('mark')} class:writing={reached('write')} class:trailing={reached('trail')} aria-hidden="true"></span>

			<div class="mark" class:in={reached('mark')} aria-hidden="true">
				<span class="t1"><i></i></span>
				<span class="t2"><i></i></span>
				<span class="ray"><i></i></span>
			</div>
			<p class="line" class:in={reached('line')}>{t('setup.greeting.line')}</p>
		</div>

		<button
			class="skip"
			bind:this={skipEl}
			onclick={(e) => {
				e.stopPropagation();
				skip();
			}}
			hidden={reached('open')}
		>
			{t('setup.greeting.skip')}
		</button>
	</div>
{/if}

<style>
	/* Sized on the launch screen's mark (app.html #launch .l-mark, 96px high). */
	.greeting {
		--mark-h: 96px;
		--teal: var(--lynshen-light);
		--write-ms: 1600ms;
		--open-ms: 700ms;
		position: fixed;
		inset: 0;
		z-index: 95;
		color: var(--text);
		cursor: default;
		user-select: none;
		-webkit-user-select: none;
		outline: none;
	}
	.greeting.skipped {
		--open-ms: 320ms;
	}
	.drag {
		position: absolute;
		inset: 0 0 auto;
		height: 40px;
		z-index: 3;
	}
	/* The ground, with the round opening that grows from the mark's centre. */
	.ground {
		position: absolute;
		inset: 0;
		background: var(--bg);
		-webkit-mask: radial-gradient(circle at 50% 46%, transparent 0, transparent var(--hole, 0px), #000 calc(var(--hole, 0px) + 1px));
		mask: radial-gradient(circle at 50% 46%, transparent 0, transparent var(--hole, 0px), #000 calc(var(--hole, 0px) + 1px));
		transition: --hole var(--open-ms) cubic-bezier(0.55, 0, 0.75, 0.2);
	}
	@property --hole {
		syntax: '<length>';
		inherits: false;
		initial-value: 0px;
	}
	[data-phase='open'] .ground {
		--hole: 150vmax;
	}
	.stage {
		position: absolute;
		left: 0;
		right: 0;
		top: 46%;
		height: 0;
	}

	/* The greeting: display type, revealed left to right behind the light. */
	.hello {
		position: absolute;
		left: 50%;
		top: -28px;
		margin: 0;
		transform: translateX(-50%);
		font-family: var(--font-display);
		font-size: 40px;
		font-weight: 500;
		line-height: 56px;
		white-space: nowrap;
		transition:
			transform 700ms cubic-bezier(0.55, 0, 0.75, 0.2),
			opacity 700ms var(--ease-base);
	}
	.hello .ink {
		display: inline-block;
		clip-path: inset(0 100% 0 0);
		transition: clip-path var(--write-ms) cubic-bezier(0.45, 0, 0.55, 1);
	}
	.hello.written .ink {
		clip-path: inset(0 0 0 0);
	}
	.hello.away {
		transform: translateX(calc(-50% - 40vw));
		opacity: 0;
	}

	/* The light: teal, writing along the line, then drawing to the middle. */
	.spark {
		position: absolute;
		left: calc(50% - var(--hello-w, 260px) / 2);
		top: -9px;
		width: 18px;
		height: 18px;
		margin-left: -9px;
		border-radius: 50%;
		background: radial-gradient(closest-side, #fff, var(--teal) 45%, transparent);
		opacity: 0;
		transition:
			opacity 250ms var(--ease-base),
			left var(--write-ms) cubic-bezier(0.45, 0, 0.55, 1),
			top 700ms cubic-bezier(0.65, 0, 0.35, 1);
	}
	.spark.on {
		opacity: 1;
	}
	.spark.writing {
		left: calc(50% + var(--hello-w, 260px) / 2);
	}
	.spark.trailing {
		left: 50%;
		top: calc(var(--mark-h) * -0.2);
		transition:
			opacity 250ms var(--ease-base),
			left 700ms cubic-bezier(0.65, 0, 0.35, 1),
			top 700ms cubic-bezier(0.65, 0, 0.35, 1);
	}

	/* The 04 林光 mark, as on the launch screen; the light in teal. */
	.mark {
		position: absolute;
		left: calc(50% - 36.67px);
		top: calc(var(--mark-h) / -2);
		width: 73.34px;
		height: var(--mark-h);
		transition:
			transform var(--open-ms) cubic-bezier(0.55, 0, 0.75, 0.2),
			opacity var(--open-ms) var(--ease-base);
	}
	.mark > * {
		position: absolute;
		display: block;
	}
	.t1 {
		left: 0;
		top: 30.72px;
		width: 15.54px;
		height: 65.28px;
		overflow: hidden;
	}
	.t2 {
		left: 57.8px;
		top: 0;
		width: 15.54px;
		height: 96px;
		overflow: hidden;
	}
	.t1 i,
	.t2 i {
		display: block;
		height: 100%;
		border-radius: 7.77px;
		background: currentColor;
		transform: translateY(101%);
		transition: transform 700ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	.t2 i {
		transition-delay: 160ms;
	}
	.ray {
		left: 28.61px;
		top: 13.07px;
		width: 10.88px;
		height: 53.76px;
		transform: rotate(-20deg);
	}
	.ray i {
		display: block;
		height: 100%;
		border-radius: 5.44px;
		background: var(--teal);
		opacity: 0;
		transform: translateY(-45%);
		transition:
			transform 640ms cubic-bezier(0.22, 1, 0.36, 1) 300ms,
			opacity 320ms var(--ease-base) 300ms;
	}
	.mark.in .t1 i,
	.mark.in .t2 i,
	.mark.in .ray i {
		transform: none;
		opacity: 1;
	}
	[data-phase='open'] .mark {
		transform: scale(3.2);
		opacity: 0;
	}

	.line {
		position: absolute;
		left: 0;
		right: 0;
		top: calc(var(--mark-h) / 2 + 32px);
		margin: 0;
		text-align: center;
		color: var(--dim);
		font-size: var(--fs-md);
		line-height: 24px;
		opacity: 0;
		transform: translateY(6px);
		transition:
			opacity 400ms var(--ease-base),
			transform 400ms cubic-bezier(0, 0, 0.2, 1);
	}
	.line.in {
		opacity: 1;
		transform: none;
	}
	[data-phase='open'] .line {
		opacity: 0;
		transition-duration: 150ms;
	}

	.skip {
		position: absolute;
		right: 28px;
		top: 56px;
		z-index: 4;
		padding: 6px 10px;
		border: 0;
		border-radius: 6px;
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
	}
	.skip:hover {
		color: var(--text);
	}
	.skip:focus-visible {
		outline: 2px solid var(--accent, var(--teal));
		outline-offset: 2px;
	}

	@media (max-width: 720px) {
		.hello {
			font-size: 30px;
			line-height: 44px;
			top: -22px;
		}
	}

	/* Reduced motion: no light, no trail, no zoom, no opening; fades only
	   (app.css cuts transitions under reduced motion, so these use none). */
	.reduced .spark {
		display: none;
	}
	.reduced .hello .ink {
		clip-path: none;
	}
	.reduced .hello {
		opacity: 0;
	}
	.reduced .hello.written {
		opacity: 1;
	}
	.reduced .hello.away {
		transform: translateX(-50%);
		opacity: 0;
	}
	.reduced .t1 i,
	.reduced .t2 i,
	.reduced .ray i {
		transform: none;
	}
	.reduced .mark {
		opacity: 0;
	}
	.reduced .mark.in {
		opacity: 1;
	}
	.reduced[data-phase='open'] .ground {
		--hole: 0px;
		opacity: 0;
	}
	.reduced[data-phase='open'] .mark {
		transform: none;
	}
</style>
