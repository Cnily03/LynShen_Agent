<script lang="ts">
	// 工作台 on the phone: the computer's name under a header, three number
	// cards that ride over the header's lower edge and stay under the top bar
	// once the page scrolls (等你处理 · 进行中 · 今天用量), 等你处理 one item
	// at a time (swipe sideways, or the arrows), then the rest of the desk
	// (DeskList: who is working, what is scheduled, the reports) and the
	// dispatches.
	import { untrack } from 'svelte';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeftIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import ShieldCheckIcon from 'phosphor-svelte/lib/ShieldCheckIcon';
	import QuestionIcon from 'phosphor-svelte/lib/QuestionIcon';
	import PaperPlaneTiltIcon from 'phosphor-svelte/lib/PaperPlaneTiltIcon';
	import Button from '$lib/ui/Button.svelte';
	import { t } from '$lib/i18n';
	import DeskList from './DeskList.svelte';
	import DispatchList from './DispatchList.svelte';
	import { useHost } from './connection.svelte';
	import { fromEdge, swipeStep, turn } from './deck';
	import { when } from './desk';

	let {
		name,
		current,
		onOpenDesk,
		onOpenAgent,
		onOpenSession,
		onOpenDispatch,
		onNewDispatch
	}: {
		/** The computer's name. */
		name: string;
		current?: string;
		onOpenDesk: (key: string) => void;
		onOpenAgent: (agent: string) => void;
		onOpenSession: (session: string) => void;
		onOpenDispatch: (id: string) => void;
		/** 派一件事 (as the round button). */
		onNewDispatch: () => void;
	} = $props();

	const conn = useHost();
	const agents = $derived(conn.agents);

	/** What waits for the user, one card each: actions (allow / deny here),
	 *  questions and dispatch plans (opened to answer). */
	type Item =
		| { kind: 'action'; id: string; title: string; who: string; at: number; session: string }
		| { kind: 'question'; id: string; title: string; who: string; at: number }
		| { kind: 'plan'; id: string; title: string; at: number };
	const items = $derived<Item[]>([
		...agents.actions.map((a) => ({
			kind: 'action' as const,
			id: a.id,
			title: a.summary || a.name,
			who: agents.agentOfSession(a.session_id)?.name ?? a.cwd.split(/[\\/]/).pop() ?? '',
			at: a.created_at,
			session: a.session_id
		})),
		...agents.questions.map((q) => ({ kind: 'question' as const, id: q.id, title: q.title, who: agents.agentName(q.agent), at: q.asked_at })),
		...conn.dispatches.list
			.filter((d) => d.status === 'awaiting')
			.map((d) => ({ kind: 'plan' as const, id: d.id, title: d.text, at: d.updated_at }))
	]);
	const running = $derived(agents.sessions.filter((s) => s.running).length);

	// 今天用量: the account's plan, the window used most.
	let quota = $state<{ pct: number; label: string } | null>(null);
	$effect(() => {
		if (agents.status !== 'on') return;
		const daemon = conn.daemon;
		untrack(() =>
			daemon
				.request({ op: 'plan_quota' })
				.then((reply) => {
					const windows = (reply.windows as { kind: string; used_pct: number }[]) ?? [];
					const top = windows.reduce<{ kind: string; used_pct: number } | null>((a, w) => (!a || w.used_pct > a.used_pct ? w : a), null);
					quota = top ? { pct: Math.round(top.used_pct), label: top.kind } : null;
				})
				.catch(() => (quota = null))
		);
	});

	// The deck: one card at a time.
	let at = $state(0);
	let hint = $state<'first' | 'last' | null>(null);
	let hintTimer: ReturnType<typeof setTimeout> | undefined;
	let dir = $state<1 | -1>(1);
	$effect(() => {
		if (at > items.length - 1) at = Math.max(0, items.length - 1);
	});
	function go(step: 1 | -1) {
		const next = turn(at, step, items.length);
		if (next.hit) {
			hint = next.hit;
			clearTimeout(hintTimer);
			hintTimer = setTimeout(() => (hint = null), 1400);
			return;
		}
		dir = step;
		at = next.at;
	}
	let start: { x: number; y: number; id: number } | null = null;
	let dragX = $state(0);
	function down(e: PointerEvent) {
		if (fromEdge(e.clientX, window.innerWidth) || (e.target as HTMLElement).closest('button, textarea, a')) return;
		start = { x: e.clientX, y: e.clientY, id: e.pointerId };
	}
	function move(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		const dx = e.clientX - start.x;
		const dy = e.clientY - start.y;
		// Sideways only: a vertical move is the page scrolling.
		dragX = Math.abs(dx) > Math.abs(dy) ? dx : 0;
	}
	function up(e: PointerEvent) {
		if (!start || e.pointerId !== start.id) return;
		const step = swipeStep(e.clientX - start.x, e.clientY - start.y);
		start = null;
		dragX = 0;
		if (step) go(step);
	}

	async function decide(item: Item & { kind: 'action' }, allow: boolean) {
		const action = agents.actions.find((a) => a.id === item.id);
		if (action) await agents.decide(action, allow).catch(() => {});
	}
	function openItem(item: Item) {
		if (item.kind === 'plan') onOpenDispatch(item.id);
		else onOpenDesk(`${item.kind}:${item.id}`);
	}

	// The cards stick under the top bar once the header has scrolled away.
	let stats = $state<HTMLElement | null>(null);
	let stuck = $state(false);
	$effect(() => {
		const el = stats;
		if (!el) return;
		// Stuck once its top reaches the title bar's bottom.
		const topBar = () => parseFloat(getComputedStyle(el).top) || 0;
		const check = () => (stuck = el.getBoundingClientRect().top <= topBar() + 0.5);
		check();
		addEventListener('scroll', check, { passive: true });
		return () => removeEventListener('scroll', check);
	});
	let deckEl = $state<HTMLElement | null>(null);
	const jump = (el: HTMLElement | null) => el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
	let runningEl = $state<HTMLElement | null>(null);
</script>

<div class="bench">
	<div class="hero">
		<span class="name">{name}</span>
		<span class="state"><span class="ok" class:off={agents.status !== 'on'}></span>{t(conn.state.short)}</span>
	</div>

	<div class="stats" class:stuck bind:this={stats}>
		<button class="cell" onclick={() => jump(deckEl)}>
			{#key items.length}<b class="num">{items.length}</b>{/key}
			<span class="cap">{#if items.length}<i class="dot"></i>{/if}{t('shell.remote.bench.waiting')}</span>
		</button>
		<button class="cell" onclick={() => jump(runningEl)}>
			{#key running}<b class="num">{running}</b>{/key}
			<span class="cap">{t('shell.remote.bench.running')}</span>
		</button>
		<div class="cell static" title={quota ? t('shell.remote.bench.usageWindow', { label: quota.label, pct: quota.pct }) : undefined}>
			{#key quota?.pct}<b class="num">{#if quota}{quota.pct}<small>%</small>{:else}{t('shell.remote.bench.usageNone')}{/if}</b>{/key}
			<span class="cap">{t('shell.remote.bench.usage')}</span>
		</div>
	</div>

	<section class="deck-wrap" bind:this={deckEl} aria-label={t('shell.remote.bench.deckTitle')}>
		<div class="deck-h">
			<b>{t('shell.remote.bench.deckTitle')}</b>
			{#if items.length > 1}<span>{t('shell.remote.bench.deckCount', { n: at + 1, of: items.length })}</span>{/if}
		</div>
		{#if items.length === 0}
			<div class="empty">
				<CheckCircleIcon size={20} />
				<span><b>{t('shell.remote.bench.clear')}</b><span>{t('shell.remote.bench.clearHint')}</span></span>
			</div>
		{:else}
			{@const item = items[Math.min(at, items.length - 1)]}
			<div class="deck" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} role="group">
				{#key item.kind + item.id}
					<article class="card" style:--from="{dir * 24}px" style:transform={dragX ? `translateX(${dragX * 0.6}px)` : undefined} class:dragging={dragX !== 0}>
						<div class="card-h">
							{#if item.kind === 'action'}<ShieldCheckIcon size={15} />{:else if item.kind === 'question'}<QuestionIcon size={15} />{:else}<PaperPlaneTiltIcon size={15} />{/if}
							<span>{item.kind === 'action' ? t('shell.remote.bench.approval') : item.kind === 'question' ? t('shell.remote.bench.question') : t('shell.remote.bench.plan')}</span>
							<span class="when">{when(item.at)}</span>
						</div>
						<div class="title">{item.title}</div>
						{#if item.kind !== 'plan' && item.who}<div class="who">{item.who}</div>{/if}
						<div class="acts">
							{#if item.kind === 'action'}
								<Button size="sm" variant="primary" onclick={() => decide(item, true)}>{t('shell.remote.bench.allow')}</Button>
								<Button size="sm" onclick={() => decide(item, false)}>{t('shell.remote.bench.deny')}</Button>
								<Button size="sm" variant="ghost" onclick={() => onOpenSession(item.session)}>{t('shell.remote.bench.openIt')}</Button>
							{:else}
								<Button size="sm" variant="primary" onclick={() => openItem(item)}>{t('shell.remote.bench.openIt')}</Button>
							{/if}
						</div>
					</article>
				{/key}
			</div>
			{#if items.length > 1}
				<div class="deck-foot">
					<button class="arrow" onclick={() => go(-1)} aria-label={t('shell.remote.bench.prev')}><CaretLeftIcon size={16} /></button>
					<span class="dots" aria-hidden="true">{#each items as _, i (i)}<i class:on={i === at}></i>{/each}</span>
					<button class="arrow" onclick={() => go(1)} aria-label={t('shell.remote.bench.next')}><CaretRightIcon size={16} /></button>
				</div>
			{/if}
			<p class="hint" class:on={!!hint} role="status">{hint === 'first' ? t('shell.remote.bench.first') : hint === 'last' ? t('shell.remote.bench.last') : ''}</p>
		{/if}
	</section>

	<div class="rest" bind:this={runningEl}>
		<DeskList {current} status queue={false} onOpen={onOpenDesk} {onOpenAgent} />
		{#if conn.dispatches.list.length}
			<h2 class="sub">{t('shell.remote.bench.dispatches')}</h2>
			<DispatchList composing={false} onNew={onNewDispatch} onOpen={(d) => onOpenDispatch(d.id)} />
		{/if}
	</div>
</div>

<style>
	.bench {
		--ease-sheet: cubic-bezier(0.32, 0.86, 0.28, 1);
		padding-bottom: 24px;
	}
	.hero {
		display: flex;
		flex-direction: column;
		gap: 2px;
		height: 108px;
		padding: 10px 16px 0;
		background: var(--surface);
		border-radius: var(--r-lg);
		margin: 0 4px;
	}
	.name {
		font-size: 26px;
		font-weight: 700;
		line-height: 1.2;
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.ok {
		width: 6px;
		height: 6px;
		border-radius: 3px;
		background: var(--ok);
	}
	.ok.off {
		background: var(--warn);
	}
	/* Over the header's lower edge; under the top bar once scrolled. */
	.stats {
		position: sticky;
		top: var(--top-h, 0px);
		z-index: 4;
		display: flex;
		gap: 8px;
		margin-top: -30px;
		padding: 0 12px 8px;
	}
	.stats::before {
		content: '';
		position: absolute;
		inset: -12px 0 0;
		z-index: -1;
		background: var(--bg);
		opacity: 0;
		transition: opacity 0.15s;
	}
	.stats.stuck::before {
		opacity: 1;
		border-bottom: 1px solid var(--hairline);
	}
	.cell {
		flex: 1;
		min-width: 0;
		padding: 10px 12px 9px;
		border: 1px solid var(--hairline);
		border-radius: 18px;
		background: var(--panel);
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.cell:active:not(.static) {
		background: var(--surface2);
	}
	.cell.static {
		cursor: default;
	}
	.num {
		display: block;
		font-size: 26px;
		font-weight: 600;
		line-height: 32px;
		font-variant-numeric: tabular-nums;
		animation: num-in 0.2s var(--ease-out);
	}
	.num small {
		font-size: 15px;
	}
	@keyframes num-in {
		from {
			opacity: 0;
		}
	}
	.cap {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: var(--fs-xs);
		color: var(--dim);
		white-space: nowrap;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 3px;
		background: var(--accent-bright);
	}
	.deck-wrap {
		margin-top: 18px;
		scroll-margin-top: 80px;
	}
	.deck-h {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		margin: 0 18px 8px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.deck-h b {
		font-weight: 600;
		color: var(--text);
	}
	.deck {
		margin: 0 12px;
		touch-action: pan-y;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 14px 16px;
		border-radius: 18px;
		background: var(--panel);
		border: 1px solid var(--hairline);
		animation: card-in 0.32s var(--ease-sheet);
	}
	.card:not(.dragging) {
		transition: transform 0.3s var(--ease-sheet);
	}
	@keyframes card-in {
		from {
			opacity: 0;
			transform: translateX(var(--from));
		}
	}
	.card-h {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: var(--fs-xs);
		color: var(--accent-bright);
	}
	.when {
		margin-left: auto;
		color: var(--dim2);
	}
	.title {
		font-size: var(--fs-md);
		font-weight: 500;
		line-height: 1.4;
		overflow-wrap: anywhere;
	}
	.who {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.acts {
		display: flex;
		gap: 8px;
		margin-top: 4px;
	}
	.deck-foot {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 14px;
		margin-top: 8px;
	}
	.arrow {
		display: inline-grid;
		place-items: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: 16px;
		background: var(--surface2);
		color: var(--text);
		cursor: pointer;
	}
	.dots {
		display: flex;
		gap: 6px;
	}
	.dots i {
		width: 6px;
		height: 6px;
		border-radius: 3px;
		background: var(--dim2);
		transition:
			width 0.2s,
			background 0.15s;
	}
	.dots i.on {
		width: 16px;
		background: var(--text);
	}
	.hint {
		min-height: 18px;
		margin: 4px 0 0;
		text-align: center;
		font-size: var(--fs-xs);
		color: var(--dim);
		opacity: 0;
		transition: opacity 0.2s;
	}
	.hint.on {
		opacity: 1;
	}
	.empty {
		display: flex;
		gap: 10px;
		margin: 0 12px;
		padding: 14px 16px;
		border-radius: 18px;
		background: var(--panel);
		border: 1px solid var(--hairline);
		color: var(--ok);
	}
	.empty > span {
		display: flex;
		flex-direction: column;
		gap: 2px;
		color: var(--text);
	}
	.empty span span {
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.rest {
		margin-top: 18px;
		scroll-margin-top: 80px;
	}
	.sub {
		margin: 16px 12px 4px;
		font-size: var(--fs-xs);
		font-weight: 500;
		color: var(--dim2);
	}
	/* Reduced motion: no slide, no rising number. */
	@media (prefers-reduced-motion: reduce) {
		.card,
		.num {
			animation-name: fade-only;
		}
		.card:not(.dragging) {
			transition: none;
		}
	}
	@keyframes fade-only {
		from {
			opacity: 0;
		}
	}
</style>
