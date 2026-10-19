<script lang="ts">
	// Settings → 远程访问 (rows inside a SettingsSection): the relay
	// switch and status (relay_status / relay_set), "add device" with a QR code
	// of a one-time pairing link (pair_link; pair_start for the LAN address when
	// the relay is off), the paired devices with revoke, and the LAN/Tailscale
	// address as an advanced alternative.
	import { onDestroy, onMount } from 'svelte';
	import DeviceMobileIcon from 'phosphor-svelte/lib/DeviceMobileIcon';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import { renderSVG } from 'uqr';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import { daemon } from '$lib/protocol';
	import { isChatDevice } from '$lib/chatConnectors';
	import { t } from '$lib/i18n';
	import SettingsRow from './SettingsRow.svelte';

	let {
		address = $bindable(),
		onAddressChange
	}: { address: string; onAddressChange: () => void } = $props();

	type Device = { id: string; name: string; paired_at: number; pending?: boolean; check?: string; scopes?: string[]; last_seen?: number | null };
	/** The elevated scopes a phone may be granted (LynShen-CLI scopes.rs). */
	const SCOPES = [
		{ id: 'full_auto', label: 'settings.backend.scopeFullAuto' },
		{ id: 'full_access', label: 'settings.backend.scopeFullAccess' },
		{ id: 'add_folder', label: 'settings.backend.scopeAddFolder' },
		{ id: 'terminal', label: 'settings.backend.scopeTerminal' }
	] as const;
	/** The device whose scopes are open. */
	let openScopes = $state<string | null>(null);
	type RelayStatus = { enabled: boolean; connected: boolean; host?: string; url?: string };
	let devices = $state<Device[]>([]);
	/** The pairing on show: its code, expiry and what the QR code holds. */
	let pairing = $state<{ code: string; expires_at: number; link: string } | null>(null);
	let relay = $state<RelayStatus | null>(null);
	let relayError = $state('');
	let relayOn = $state(false);
	let error = $state('');
	let copied = $state(false);
	let lanOpen = $state(false);
	let now = $state(Date.now());
	let poll: ReturnType<typeof setInterval> | null = null;
	let tick: ReturnType<typeof setInterval> | null = null;
	let statusPoll: ReturnType<typeof setInterval> | null = null;

	const base = $derived(address.trim().replace(/\/+$/, ''));
	// The code brings its own white ground and quiet zone (four modules, as
	// scanners expect), in the dark theme too: the tile adds no fill.
	const qr = $derived(pairing?.link ? renderSVG(pairing.link, { border: 4 }) : '');
	const remaining = $derived.by(() => {
		if (!pairing) return '';
		const s = Math.max(0, Math.round((pairing.expires_at - now) / 1000));
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	});

	function message(e: unknown) {
		return e instanceof Error ? e.message : String(e);
	}

	async function loadRelay() {
		try {
			const reply = await daemon.request({ op: 'relay_status' });
			relay = {
				enabled: Boolean(reply.enabled),
				connected: Boolean(reply.connected),
				host: typeof reply.host === 'string' ? reply.host : undefined,
				url: typeof reply.url === 'string' ? reply.url : undefined
			};
			relayOn = relay.enabled;
			relayError = '';
		} catch (e) {
			relay = null;
			relayError = message(e);
		}
	}

	async function setRelay(enabled: boolean) {
		try {
			await daemon.request({ op: 'relay_set', enabled });
		} catch (e) {
			relayError = message(e);
		}
		await loadRelay();
	}

	async function refresh() {
		try {
			const reply = await daemon.request({ op: 'device_list' });
			// Chat accounts have their own page (聊天连接).
			const next = ((reply.devices as (Device & { kind?: string })[]) ?? []).filter((d) => !isChatDevice(d));
			// A new device means the shown code was just used.
			if (pairing && next.length > devices.length) stopPairing(false);
			devices = next;
			error = '';
		} catch (e) {
			error = message(e);
		}
	}

	async function addDevice() {
		try {
			if (relay?.enabled) {
				const reply = await daemon.request({ op: 'pair_link' });
				pairing = { code: String(reply.code), expires_at: Number(reply.expires_at), link: String(reply.link) };
			} else {
				const reply = await daemon.request({ op: 'pair_start' });
				const code = String(reply.code);
				pairing = {
					code,
					expires_at: Number(reply.expires_at),
					link: base ? `${base}/remote?pair=${code}` : ''
				};
			}
			now = Date.now();
			copied = false;
			poll = setInterval(() => {
				if (pairing && Date.now() > pairing.expires_at) stopPairing();
				else void refresh();
			}, 3000);
			tick = setInterval(() => (now = Date.now()), 1000);
		} catch (e) {
			error = message(e);
		}
	}

	/** Closes the pairing dialog; `cancel`: its code pairs nobody from now
	 *  on (the daemon forgets it), unless it was just used. */
	function stopPairing(cancel = true) {
		const code = pairing?.code;
		pairing = null;
		if (poll) clearInterval(poll);
		if (tick) clearInterval(tick);
		poll = tick = null;
		if (cancel && code) daemon.request({ op: 'pair_cancel', code }).catch(() => {});
	}

	async function confirmDevice(device: Device) {
		try {
			await daemon.request({ op: 'device_confirm', device: device.id });
			await refresh();
		} catch (e) {
			error = message(e);
		}
	}

	async function setScope(device: Device, scope: string, on: boolean) {
		const next = new Set(device.scopes ?? []);
		if (on) next.add(scope);
		else next.delete(scope);
		try {
			await daemon.request({ op: 'device_scopes', device: device.id, scopes: SCOPES.map((x) => x.id).filter((id) => next.has(id)) });
			await refresh();
		} catch (e) {
			error = message(e);
		}
	}

	async function copyLink() {
		if (!pairing?.link) return;
		try {
			await navigator.clipboard.writeText(pairing.link);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch (e) {
			error = message(e);
		}
	}

	async function revoke(device: Device) {
		try {
			await daemon.request({ op: 'device_revoke', device: device.id });
			await refresh();
		} catch (e) {
			error = message(e);
		}
	}

	onMount(() => {
		void refresh();
		void loadRelay();
		// The relay connects in the background; keep the status line current,
		// and a phone that paired (and waits to be confirmed) shows up.
		statusPoll = setInterval(() => {
			void loadRelay();
			void refresh();
		}, 5000);
	});
	onDestroy(() => {
		stopPairing();
		if (statusPoll) clearInterval(statusPoll);
	});
</script>

<SettingsRow id="relay" title={t('settings.backend.relayToggle')} description={t('settings.backend.relayHint')}>
	{#snippet detail()}
		<span class="status">
			{#if relayError}
				<span class="warn">{t('settings.backend.relayUnavailable', { error: relayError })}</span>
			{:else if relay?.enabled && relay.connected}
				<span class="dot ok"></span>{t('settings.backend.relayConnected', { host: relay.host ?? '' })}
			{:else if relay?.enabled}
				<span class="dot wait pulse"></span>{t('settings.backend.relayConnecting')}
			{:else if relay}
				<span class="dot"></span>{t('settings.backend.relayOff')}
			{/if}
		</span>
	{/snippet}
	<Switch bind:checked={relayOn} label={t('settings.backend.relayToggle')} onChange={setRelay} />
</SettingsRow>

<SettingsRow id="devices" title={t('settings.backend.devices')}>
	{#if !pairing}
		<Button size="sm" onclick={addDevice}><DeviceMobileIcon size={13} /> {t('settings.backend.addDevice')}</Button>
	{/if}
</SettingsRow>

{#if pairing}
	<SettingsRow stacked>
		<div class="code">
			{#if qr}
				<!-- SVG generated locally from the daemon's pairing link, no outside input. -->
				<div class="qr">{@html qr}</div>
			{/if}
			<div class="code-text">
				{#if relay?.enabled}
					<strong>{t('settings.backend.addDevice')}</strong>
					<span>{t('settings.backend.pairLinkScan')}</span>
				{:else}
					<strong>{t('settings.backend.pairCode', {
						code: pairing.code,
						minutes: String(Math.max(1, Math.round((pairing.expires_at - now) / 60000)))
					})}</strong>
					<span>{base ? t('settings.backend.pairLinkScan') : t('settings.backend.pairNoAddress')}</span>
				{/if}
				<span class="expires">{t('settings.backend.pairExpires', { time: remaining })}</span>
				{#if pairing.link}
					<div class="link-row">
						<Button size="sm" onclick={copyLink}>
							{#if copied}<CheckIcon size={13} /> {t('settings.backend.copied')}{:else}<CopyIcon size={13} /> {t('settings.backend.copyLink')}{/if}
						</Button>
					</div>
				{/if}
			</div>
			<IconButton onclick={stopPairing} label={t('common.close')}><XIcon size={14} /></IconButton>
		</div>
	</SettingsRow>
{/if}

<SettingsRow stacked>
	<div class="devices">
		{#if devices.length === 0}
			<span class="none">{t('settings.backend.noDevices')}</span>
		{/if}
		{#each devices as device (device.id)}
			{#if device.pending}
				<!-- Paired with the code just shown; trusted once the user sees the
				     phone shows the same check code. -->
				<div class="confirm" role="alertdialog" aria-label={t('settings.backend.pairPending', { name: device.name })}>
					<strong>{t('settings.backend.pairPending', { name: device.name })}</strong>
					<span class="check">{(device.check ?? '').slice(0, 3)} {(device.check ?? '').slice(3)}</span>
					<span class="hint">{t('settings.backend.pairPendingHint')}</span>
					<div class="confirm-actions">
						<Button size="sm" variant="primary" onclick={() => confirmDevice(device)}>{t('settings.backend.pairConfirm')}</Button>
						<Button size="sm" variant="ghost" onclick={() => revoke(device)}>{t('settings.backend.pairReject')}</Button>
					</div>
				</div>
			{:else}
				<div class="device">
					<DeviceMobileIcon size={14} />
					<button class="name link" aria-expanded={openScopes === device.id} onclick={() => (openScopes = openScopes === device.id ? null : device.id)}>
						{device.name}
						{#if device.scopes?.length}<span class="granted">+{device.scopes.length}</span>{/if}
					</button>
					<span class="when">{new Date(device.paired_at).toLocaleDateString()}</span>
					<Button size="sm" variant="ghost" onclick={() => revoke(device)}>{t('settings.backend.revoke')}</Button>
				</div>
				{#if openScopes === device.id}
					<div class="scopes">
						<span class="scopes-head">{t('settings.backend.deviceScopes')}</span>
						<span class="hint">{t('settings.backend.deviceScopesHint')}</span>
						{#each SCOPES as scope (scope.id)}
							<label class="scope">
								<span>{t(scope.label)}</span>
								<Switch
									checked={device.scopes?.includes(scope.id) ?? false}
									label={t(scope.label)}
									onChange={(on) => setScope(device, scope.id, on)}
								/>
							</label>
						{/each}
					</div>
				{/if}
			{/if}
		{/each}
		{#if error}<Notice>{error}</Notice>{/if}
	</div>
</SettingsRow>

<SettingsRow stacked>
	<button class="adv" onclick={() => (lanOpen = !lanOpen)}>
		<span class="chev" class:open={lanOpen}><CaretRightIcon size={12} /></span>
		{t('settings.backend.lanAdvanced')}
	</button>
	{#if lanOpen}
		<div class="lan">
			<input
				bind:value={address}
				aria-label={t('settings.backend.remoteLabel')}
				placeholder={t('settings.backend.remotePlaceholder')}
				onchange={onAddressChange}
			/>
			<p class="hint">{t('settings.backend.lanAdvancedHint')}</p>
		</div>
	{/if}
</SettingsRow>

<style>
	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
		font-size: var(--fs-2xs);
		font-family: var(--font-mono);
		color: var(--dim);
	}
	.warn {
		color: var(--warn);
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--dim2);
		flex-shrink: 0;
	}
	.dot.ok {
		background: var(--ok);
	}
	.dot.wait {
		background: var(--accent-bright);
	}
	.code {
		display: flex;
		align-items: flex-start;
		gap: 16px;
	}
	.qr {
		width: 156px;
		height: 156px;
		border-radius: var(--r-md);
		overflow: hidden;
		flex-shrink: 0;
	}
	.qr :global(svg) {
		width: 100%;
		height: 100%;
	}
	.code-text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: var(--fs-xs);
		line-height: 1.5;
		color: var(--dim);
	}
	.code-text strong {
		font-size: var(--fs-sm);
		color: var(--text);
		font-weight: 600;
	}
	.expires {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		font-variant-numeric: tabular-nums;
	}
	.link-row {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 4px;
		min-width: 0;
	}
	.devices {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--fs-sm);
	}
	.none {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.device {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 32px;
		color: var(--dim);
	}
	.name {
		flex: 1;
		color: var(--text);
	}
	.when {
		color: var(--dim2);
		font-size: var(--fs-xs);
		font-family: var(--font-mono);
	}
	.adv {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 0;
		border: none;
		background: none;
		font-size: var(--fs-xs);
		color: var(--dim);
		cursor: pointer;
	}
	.adv:hover {
		color: var(--text);
	}
	.chev {
		display: inline-flex;
		transition: transform var(--t-med) var(--ease-spring);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.lan {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 10px;
		max-width: 480px;
	}
	.lan input {
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		padding: 8px 10px;
		outline: none;
	}
	.lan input::placeholder {
		color: var(--dim2);
	}
	.lan input:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.hint {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--dim2);
		line-height: 1.5;
	}
	.confirm {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px;
		border: 1px solid var(--accent);
		border-radius: var(--r-md);
		background: var(--surface2);
	}
	.confirm .check {
		font-family: var(--font-mono);
		font-size: 26px;
		font-weight: 600;
		letter-spacing: 0.08em;
	}
	.confirm-actions {
		display: flex;
		gap: 8px;
	}
	.hint {
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.45;
	}
	.name.link {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
		text-align: left;
	}
	.granted {
		padding: 0 6px;
		border-radius: var(--r-full);
		background: var(--warn);
		color: #000;
		font-size: var(--fs-2xs);
	}
	.scopes {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0 0 8px 22px;
		padding: 10px 12px;
		border-radius: var(--r-md);
		background: var(--surface2);
	}
	.scopes-head {
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.scope {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		font-size: var(--fs-sm);
	}
</style>
