<script lang="ts">
	// 通知: turn this phone's notifications on or off, and the rules of the
	// computer shown (how many a day, the quiet hours, 本轮完成). Approvals
	// and errors are never limited; the rules belong to each computer.
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import BellIcon from 'phosphor-svelte/lib/BellIcon';
	import { untrack } from 'svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { t } from '$lib/i18n';
	import { DEFAULT_RULES, disablePush, enablePush, loadRules, pushOn, pushSupported, saveRules, type PushRules } from './push';
	import type { HostConnection } from './connection.svelte';

	let {
		conn,
		conns,
		name,
		onTest,
		onClose
	}: {
		/** The computer whose rules are shown. */
		conn: HostConnection;
		/** Every paired computer: notifications turn on or off on all of them. */
		conns: HostConnection[];
		name: string;
		onTest: () => void;
		onClose: () => void;
	} = $props();

	const supported = pushSupported();
	let on = $state(pushOn());
	let busy = $state(false);
	let rules = $state<PushRules | null>(null);
	let loaded = $state(false);

	// Asked once the computer is reached (again after it comes back).
	const online = $derived(conn.agents.status === 'on');
	$effect(() => {
		const daemon = conn.daemon;
		if (!online) return;
		let current = true;
		// The request reads the connection's state: not a dependency.
		untrack(() => loadRules(daemon)).then((r) => {
			if (!current) return;
			rules = r;
			loaded = true;
		});
		return () => (current = false);
	});

	async function toggle(next: boolean) {
		busy = true;
		try {
			if (next) await enablePush(conns.map((c) => c.daemon));
			else await disablePush(conns.map((c) => c.daemon));
			on = pushOn();
		} catch (e) {
			on = pushOn();
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			busy = false;
		}
	}

	async function change(patch: Partial<PushRules>) {
		if (!rules) return;
		const before = rules;
		rules = { ...rules, ...patch };
		try {
			rules = await saveRules(conn.daemon, patch);
		} catch (e) {
			rules = before;
			toast.error(e instanceof Error ? e.message : String(e));
		}
	}

	const BUDGETS = [5, 10, 20, 50];
	const quietOn = $derived(!!rules && rules.quiet_start !== rules.quiet_end);
</script>

<div class="screen">
	<header>
		<button class="back" onclick={onClose} aria-label={t('shell.remote.back')}><ArrowLeftIcon size={18} /></button>
		<span class="title">{t('shell.remote.push.title')}</span>
	</header>
	<div class="body">
		{#if !supported}
			<Notice tone="info">{t('shell.remote.pushIosHint')}</Notice>
		{:else}
			<div class="group">
				<div class="row">
					<span class="ico"><BellIcon size={20} /></span>
					<span class="main">
						<span class="label">{t('shell.remote.push.onLabel')}</span>
						<span class="desc">{t('shell.remote.push.onDesc')}</span>
					</span>
					<Switch checked={on} disabled={busy} label={t('shell.remote.push.onLabel')} onChange={toggle} />
				</div>
			</div>
		{/if}

		<h2>{t('shell.remote.push.always')}</h2>
		<div class="group">
			<div class="row plain"><span class="main"><span class="label">{t('shell.remote.push.approvals')}</span></span><span class="value">{t('shell.remote.push.anytime')}</span></div>
			<div class="row plain"><span class="main"><span class="label">{t('shell.remote.push.errors')}</span></span><span class="value">{t('shell.remote.push.anytime')}</span></div>
		</div>

		<h2>{t('shell.remote.push.rulesOf', { name })}</h2>
		{#if !loaded}
			<p class="foot">{t('shell.remote.connecting')}</p>
		{:else if !rules}
			<Notice tone="info">{t('shell.remote.push.old')}</Notice>
		{:else}
			<div class="group">
				<div class="row plain">
					<span class="main">
						<span class="label">{t('shell.remote.push.budget')}</span>
						<span class="desc">{t('shell.remote.push.sentToday', { n: rules.sent_today ?? 0 })}</span>
					</span>
					<select
						aria-label={t('shell.remote.push.budget')}
						value={rules.daily_budget}
						onchange={(e) => change({ daily_budget: Number((e.currentTarget as HTMLSelectElement).value) })}
					>
						{#each [...new Set([...BUDGETS, rules.daily_budget])].sort((a, b) => a - b) as n (n)}
							<option value={n}>{t('shell.remote.push.perDay', { n })}</option>
						{/each}
					</select>
				</div>
				<div class="row plain">
					<span class="main">
						<span class="label">{t('shell.remote.push.quiet')}</span>
						<span class="desc">{t('shell.remote.push.quietDesc')}</span>
					</span>
					<Switch
						checked={quietOn}
						label={t('shell.remote.push.quiet')}
						onChange={(v) => change(v ? { quiet_start: DEFAULT_RULES.quiet_start, quiet_end: DEFAULT_RULES.quiet_end } : { quiet_start: '00:00', quiet_end: '00:00' })}
					/>
				</div>
				{#if quietOn}
					<div class="row plain times">
						<label>
							<span>{t('shell.remote.push.from')}</span>
							<input type="time" value={rules.quiet_start} onchange={(e) => change({ quiet_start: (e.currentTarget as HTMLInputElement).value })} />
						</label>
						<label>
							<span>{t('shell.remote.push.to')}</span>
							<input type="time" value={rules.quiet_end} onchange={(e) => change({ quiet_end: (e.currentTarget as HTMLInputElement).value })} />
						</label>
					</div>
				{/if}
				<div class="row plain">
					<span class="main">
						<span class="label">{t('shell.remote.push.turnDone')}</span>
						<span class="desc">{t('shell.remote.push.turnDoneDesc')}</span>
					</span>
					<Switch checked={rules.turn_done} label={t('shell.remote.push.turnDone')} onChange={(v) => change({ turn_done: v })} />
				</div>
			</div>
		{/if}

		<h2>{t('shell.remote.push.other')}</h2>
		<div class="group">
			<div class="row plain"><span class="main"><span class="label">{t('shell.remote.push.viewing')}</span><span class="desc">{t('shell.remote.push.viewingDesc')}</span></span></div>
			<div class="row plain"><span class="main"><span class="label">{t('shell.remote.push.merge')}</span><span class="desc">{t('shell.remote.push.mergeDesc')}</span></span></div>
		</div>
		<p class="foot">{t('shell.remote.push.privacy')}</p>
		{#if supported && on}
			<div class="test"><Button size="sm" onclick={onTest}>{t('shell.remote.pushTest')}</Button></div>
		{/if}
	</div>
</div>

<style>
	.screen {
		position: fixed;
		inset: 0;
		z-index: 60;
		display: flex;
		flex-direction: column;
		background: var(--bg);
		color: var(--text);
		animation: rise var(--t-slow) var(--ease-out);
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: calc(env(safe-area-inset-top) + 10px) 12px 10px;
		border-bottom: 1px solid var(--hairline);
	}
	.title {
		font-size: var(--fs-lg);
		font-weight: 600;
	}
	.back {
		display: inline-flex;
		padding: 6px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--text);
		cursor: pointer;
	}
	.body {
		flex: 1;
		overflow-y: auto;
		padding: 12px 16px calc(env(safe-area-inset-bottom) + 24px);
		max-width: 560px;
		width: 100%;
		margin: 0 auto;
	}
	h2 {
		margin: 20px 4px 6px;
		font-size: var(--fs-xs);
		font-weight: 500;
		color: var(--dim);
	}
	.group {
		border: 1px solid var(--hairline);
		border-radius: var(--r-lg);
		background: var(--surface);
		overflow: hidden;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 52px;
		padding: 10px 14px;
	}
	.row + .row {
		border-top: 1px solid var(--hairline);
	}
	.ico {
		display: inline-flex;
		color: var(--accent-bright);
	}
	.main {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.label {
		font-size: var(--fs-md);
	}
	.desc {
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.45;
	}
	.value {
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	select,
	input[type='time'] {
		height: 34px;
		padding: 0 8px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
	}
	.times {
		gap: 16px;
	}
	.times label {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.foot {
		margin: 14px 4px 0;
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.5;
	}
	.test {
		margin-top: 14px;
	}
	@media (prefers-reduced-motion: reduce) {
		.screen {
			animation: none;
		}
	}
</style>
