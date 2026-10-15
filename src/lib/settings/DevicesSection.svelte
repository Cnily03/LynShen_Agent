<script lang="ts">
	// Settings → 授权设备 (gateway DA-10): the computers signed in to the account
	// and the IP addresses they used, against the account's seats, and buying
	// a seat from the balance. Nothing here can be removed by hand: idle
	// devices and IP addresses expire on their own (AD-R1, AD-R3).
	import { onMount } from 'svelte';
	import DesktopIcon from 'phosphor-svelte/lib/DesktopIcon';
	import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { t } from '$lib/i18n';
	import { prefs } from '$lib/prefs.svelte';
	import { shownBalanceText } from '$lib/money';
	import { openExternal } from '$lib/openExternal';
	import { buySeat, fetchDevices, GatewayError, readConfig, type DeviceOverview } from '$lib/protocol';
	import SettingsSection from './SettingsSection.svelte';
	import GatewayNotice from './GatewayNotice.svelte';

	let { onSignIn }: { onSignIn: () => void } = $props();

	let data = $state<DeviceOverview | null>(null);
	let error = $state<unknown>(null);
	let loading = $state(true);
	let web = $state('https://www.lynshen.org');

	async function load() {
		loading = true;
		error = null;
		try {
			data = await fetchDevices();
		} catch (e) {
			error = e;
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		void load();
		readConfig()
			.then((cfg) => (web = String(cfg.lynshen_web_url || web).replace(/\/+$/, '')))
			.catch(() => {});
	});

	const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	const yuan = (fen: number) => shownBalanceText((fen / 100).toFixed(2), 'CNY', prefs.balanceCurrency);

	// The purchase dialog. `requestId` stays the same for one choice, so a
	// retried click cannot buy twice (AD-P2).
	let buying = $state<'device' | 'ip' | null>(null);
	let days = $state(30);
	let requestId = $state('');
	let busy = $state(false);
	let buyError = $state<{ text: string; topUp: boolean } | null>(null);
	function openBuy(kind: 'device' | 'ip') {
		buying = kind;
		days = 30;
		requestId = crypto.randomUUID();
		buyError = null;
	}
	function pick(n: number) {
		if (n === days) return;
		days = n;
		requestId = crypto.randomUUID();
	}
	const price = $derived.by(() => {
		const row = data?.prices.find((p) => p.days === days);
		return row && buying ? (buying === 'ip' ? row.ip_cny_fen : row.device_cny_fen) : 0;
	});
	async function confirmBuy() {
		if (!buying) return;
		busy = true;
		buyError = null;
		try {
			await buySeat(buying, days, requestId);
			toast.success(t('settings.devices.bought', { n: days }));
			buying = null;
			await load();
		} catch (e) {
			const short = e instanceof GatewayError && e.code === 'insufficient_balance';
			buyError = { text: short ? t('settings.devices.insufficient') : e instanceof Error ? e.message : String(e), topUp: short };
		} finally {
			busy = false;
		}
	}
</script>

{#if loading && !data}
	<div class="skeleton" aria-busy="true">
		<div class="sk-row"><div class="sk"></div><div class="sk"></div></div>
		<div class="sk tall"></div>
	</div>
{:else if error && !data}
	<GatewayNotice {error} fallback={t('settings.devices.loadFailed')} onRetry={load} {onSignIn} />
{:else if data}
	<Notice tone="info">{t('settings.devices.autoRemoval', { deviceDays: data.device_idle_days, ipDays: data.ip_idle_days })}</Notice>

	<section class="stats">
		{#each [{ kind: 'device' as const, icon: DesktopIcon, label: t('settings.devices.deviceSeats') }, { kind: 'ip' as const, icon: GlobeIcon, label: t('settings.devices.ipSeats') }] as tile (tile.kind)}
			{@const usage = data.limits[tile.kind]}
			<div class="tile" class:full={usage.used >= usage.limit}>
				<div class="tile-head">
					<span class="tile-label"><tile.icon size={14} /> {tile.label}</span>
					<Button size="sm" onclick={() => openBuy(tile.kind)}><PlusIcon size={12} /> {t('settings.devices.buy')}</Button>
				</div>
				<span class="num">{usage.used} / {usage.limit}</span>
				<div class="bar" aria-hidden="true"><span style:width="{Math.min(100, (usage.used / Math.max(1, usage.limit)) * 100)}%"></span></div>
			</div>
		{/each}
	</section>

	<SettingsSection title={t('settings.devices.devices')}>
		{#if data.devices.length === 0}
			<p class="empty">{t('settings.devices.noDevices')}</p>
		{:else}
			<ul class="rows">
				{#each data.devices as d (d.id)}
					<li class:inactive={!d.active}>
						<DesktopIcon size={16} />
						<span class="main">
							<span class="name">
								{d.name.replace(/^LynShen Desktop \/ /, '')}
								{#if d.api_key_id === data.current_api_key_id}<span class="chip">{t('settings.devices.thisDevice')}</span>{/if}
							</span>
							<span class="small">
								{d.last_used_at ? t('settings.devices.lastUsed', { time: when(Date.parse(d.last_used_at)) }) : t('settings.devices.neverUsed')}
								· {t('settings.devices.removedAt', { time: when(d.revokes_at) })}
							</span>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</SettingsSection>

	<SettingsSection title={t('settings.devices.ips')}>
		{#if data.ips.length === 0}
			<p class="empty">{t('settings.devices.noIps')}</p>
		{:else}
			<ul class="rows">
				{#each data.ips as row (row.ip)}
					<li class:inactive={!row.active}>
						<GlobeIcon size={16} />
						<span class="main">
							<span class="name mono">{row.ip}</span>
							<span class="small">
								{t('settings.devices.lastSeen', { time: when(row.last_seen_at) })} · {t('settings.devices.removedAt', { time: when(row.expires_at) })}
							</span>
						</span>
					</li>
				{/each}
			</ul>
		{/if}
	</SettingsSection>

	{#if data.seats.some((s) => s.active)}
		<SettingsSection title={t('settings.devices.seats')}>
			<ul class="rows">
				{#each data.seats.filter((s) => s.active) as seat (seat.id)}
					<li>
						{#if seat.kind === 'ip'}<GlobeIcon size={16} />{:else}<DesktopIcon size={16} />{/if}
						<span class="main">
							<span class="name">{t(`settings.devices.seatKind.${seat.kind}`)}</span>
							<span class="small">
								{t('settings.devices.seatUntil', { time: when(seat.expires_at) })}{seat.source === 'admin' ? ` · ${t('settings.devices.seatGranted')}` : ''}
							</span>
						</span>
					</li>
				{/each}
			</ul>
		</SettingsSection>
	{/if}
{/if}

{#if buying && data}
	<Modal title={t(`settings.devices.buyTitle.${buying}`)} dismissible={!busy} onClose={() => (buying = null)} width={420}>
		<div class="buy">
			<div class="field-label">{t('settings.devices.duration')}</div>
			<div class="durations" role="group" aria-label={t('settings.devices.duration')}>
				{#each data.prices as p (p.days)}
					<button type="button" class="dur" aria-pressed={p.days === days} onclick={() => pick(p.days)}>
						<span>{t('settings.devices.days', { n: p.days })}</span>
						<span class="small">{yuan(buying === 'ip' ? p.ip_cny_fen : p.device_cny_fen)}</span>
					</button>
				{/each}
			</div>
			<p class="summary">
				{t('settings.devices.price')} <b>{yuan(price)}</b> · {t('settings.devices.until', { time: when(Date.now() + days * 86_400_000) })}
			</p>
			<p class="small">{t('settings.devices.fromBalance')}</p>
			{#if buyError}
				<p class="err" role="alert">
					{buyError.text}
					{#if buyError.topUp}<button type="button" class="linkish" onclick={() => openExternal(`${web}/dashboard/wallet`)}>{t('settings.devices.topUp')}</button>{/if}
				</p>
			{/if}
		</div>
		{#snippet footer()}
			<Button onclick={() => (buying = null)} disabled={busy}>{t('settings.devices.cancel')}</Button>
			<Button variant="primary" onclick={confirmBuy} disabled={busy || !price}>{t('settings.devices.confirm')}</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	.stats {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
		margin: 14px 0 18px;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		padding: 14px 16px;
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.tile-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}
	.tile-label {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.num {
		font-family: var(--font-mono);
		font-size: var(--fs-xl);
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.bar {
		height: 4px;
		border-radius: var(--r-full);
		background: color-mix(in oklab, var(--text) 7%, transparent);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
		transition: width var(--t-base) var(--ease-out);
	}
	.tile.full .bar span {
		background: var(--warn);
	}
	.empty {
		margin: 0;
		padding: 18px 0;
		color: var(--dim);
		font-size: var(--fs-sm);
		text-align: center;
	}
	.rows {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.rows li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
		color: var(--dim);
	}
	.rows li + li {
		box-shadow: inset 0 1px 0 var(--hairline);
	}
	.rows li.inactive {
		opacity: 0.55;
	}
	.main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.name {
		display: flex;
		align-items: center;
		gap: 8px;
		overflow: hidden;
		color: var(--text);
		font-size: var(--fs-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.mono {
		font-family: var(--font-mono);
	}
	.chip {
		flex-shrink: 0;
		padding: 0 7px;
		border-radius: var(--r-sm);
		background: color-mix(in oklab, var(--accent) 14%, transparent);
		color: var(--accent);
		font-size: var(--fs-2xs);
	}
	.small {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.buy {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.field-label {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.durations {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 8px;
	}
	.dur {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		min-height: 44px;
		padding: 8px 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition:
			border-color var(--t-fast) var(--ease-out),
			background var(--t-fast) var(--ease-out);
	}
	.dur:hover {
		background: color-mix(in oklab, var(--text) 4%, transparent);
	}
	.dur[aria-pressed='true'] {
		border-color: var(--accent);
		background: color-mix(in oklab, var(--accent) 8%, transparent);
	}
	.dur:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 1px;
	}
	.summary {
		margin: 4px 0 0;
		font-size: var(--fs-sm);
	}
	.summary b {
		font-variant-numeric: tabular-nums;
	}
	.err {
		margin: 0;
		color: var(--err);
		font-size: var(--fs-xs);
	}
	.linkish {
		margin-left: 6px;
		padding: 0;
		border: none;
		background: none;
		color: var(--accent);
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
	}
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.sk-row {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 10px;
	}
	.sk {
		height: 92px;
		border-radius: var(--r-lg);
		background: color-mix(in oklab, var(--text) 5%, transparent);
		animation: pulse 1.4s ease-in-out infinite;
	}
	.sk.tall {
		height: 200px;
	}
	@keyframes pulse {
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sk {
			animation: none;
		}
		.bar span {
			transition: none;
		}
	}
</style>
