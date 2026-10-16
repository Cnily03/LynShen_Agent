<script lang="ts">
	// Settings → 聊天连接: chat bots in the daemon (LynShen-CLI
	// docs/chat-connectors.md). Add a Telegram bot by its token, bind an
	// account with a one-time code (link and QR code), see the connection
	// state and the bound accounts, unbind, switch the bot off, and choose
	// what a chat may do. The daemon keeps the token; the page never gets it
	// back.
	import { onDestroy, onMount } from 'svelte';
	import { renderSVG } from 'uqr';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { daemon } from '$lib/protocol';
	import { t } from '$lib/i18n';
	import {
		MAX_MODES,
		isOldDaemon,
		isTelegramToken,
		parseConnectors,
		proxyValue,
		remaining,
		type Connector,
		type MaxMode
	} from '$lib/chatConnectors';
	import SettingsRow from './SettingsRow.svelte';
	import SettingsSection from './SettingsSection.svelte';

	let connectors = $state<Connector[]>([]);
	let loaded = $state(false);
	let loadError = $state('');
	let old = $state(false);

	// The add form.
	let adding = $state(false);
	let token = $state('');
	let proxy = $state('');
	let busy = $state(false);
	let addError = $state('');

	/** The binding code on show, for one connector. */
	let code = $state<{ connector: string; code: string; expires_at: number; link: string | null; bound: number } | null>(null);
	let copied = $state(false);
	let now = $state(Date.now());
	/** Per connector: the proxy field as typed, and the last error. */
	let proxies = $state<Record<string, string>>({});
	let errors = $state<Record<string, string>>({});
	let timer: ReturnType<typeof setInterval> | null = null;
	let poll: ReturnType<typeof setInterval> | null = null;

	const qr = $derived(code?.link ? renderSVG(code.link, { border: 4 }) : '');
	const tokenOk = $derived(isTelegramToken(token));
	const proxyOk = $derived(proxyValue(proxy).ok);

	/** A daemon op, connecting first (the page may open before any session). */
	async function ask(op: Record<string, unknown>) {
		await daemon.connect();
		return daemon.request(op);
	}

	function message(e: unknown) {
		return e instanceof Error ? e.message : String(e);
	}

	async function load() {
		try {
			const reply = await ask({ op: 'connector_list' });
			const next = parseConnectors(reply);
			// A new binding closes the code that made it.
			if (code) {
				const owner = next.find((c) => c.id === code?.connector);
				if (owner && owner.bindings.length > code.bound) {
					const fresh = owner.bindings[owner.bindings.length - 1];
					toast.success(t('settings.chat.bound', { name: fresh?.name ?? '' }));
					code = null;
				}
			}
			for (const c of next) if (!(c.id in proxies)) proxies[c.id] = c.proxy ?? '';
			connectors = next;
			loadError = '';
			old = false;
		} catch (e) {
			const text = message(e);
			old = isOldDaemon(text);
			loadError = old ? '' : text;
		} finally {
			loaded = true;
		}
	}

	async function add() {
		const parsed = proxyValue(proxy);
		if (!tokenOk || !parsed.ok) return;
		busy = true;
		addError = '';
		try {
			const reply = await ask({
				op: 'connector_add',
				platform: 'telegram',
				token: token.trim(),
				...(parsed.value ? { proxy: parsed.value } : {})
			});
			const name = String((reply.connector as Record<string, unknown> | undefined)?.name ?? '');
			toast.success(t('settings.chat.added', { name }));
			adding = false;
			token = '';
			proxy = '';
			await load();
		} catch (e) {
			addError = message(e);
		} finally {
			busy = false;
		}
	}

	async function set(c: Connector, change: Record<string, unknown>) {
		try {
			const reply = await ask({ op: 'connector_set', connector: c.id, ...change });
			connectors = parseConnectors(reply);
			errors[c.id] = '';
		} catch (e) {
			errors[c.id] = message(e);
			await load();
		}
	}

	async function saveProxy(c: Connector) {
		const parsed = proxyValue(proxies[c.id] ?? '');
		if (!parsed.ok) {
			errors[c.id] = t('settings.chat.proxyInvalid');
			return;
		}
		await set(c, { proxy: parsed.value ?? '' });
	}

	async function bind(c: Connector) {
		try {
			const reply = await ask({ op: 'connector_bind_start', connector: c.id });
			code = {
				connector: c.id,
				code: String(reply.code),
				expires_at: Number(reply.expires_at),
				link: typeof reply.link === 'string' ? reply.link : null,
				bound: c.bindings.length
			};
			copied = false;
			now = Date.now();
			errors[c.id] = '';
		} catch (e) {
			errors[c.id] = message(e);
		}
	}

	async function copyLink() {
		if (!code?.link) return;
		try {
			await navigator.clipboard.writeText(code.link);
			copied = true;
			setTimeout(() => (copied = false), 1500);
		} catch {
			// The link stays on screen to copy by hand.
		}
	}

	async function unbind(c: Connector, device: string, name: string) {
		const ok = await confirm({
			title: t('settings.chat.revokeTitle', { name }),
			message: t('settings.chat.revokeMessage'),
			confirmLabel: t('settings.chat.revoke'),
			danger: true
		});
		if (!ok) return;
		try {
			await ask({ op: 'device_revoke', device });
			await load();
		} catch (e) {
			errors[c.id] = message(e);
		}
	}

	async function remove(c: Connector) {
		const ok = await confirm({
			title: t('settings.chat.removeTitle', { name: c.name }),
			message: t('settings.chat.removeMessage'),
			confirmLabel: t('settings.chat.remove'),
			danger: true
		});
		if (!ok) return;
		try {
			await ask({ op: 'connector_remove', connector: c.id });
			if (code?.connector === c.id) code = null;
			await load();
		} catch (e) {
			errors[c.id] = message(e);
		}
	}

	function when(ms: number | null) {
		return ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }) : '';
	}

	onMount(() => {
		void load();
		// The connection state changes in the background; a code waits for its binding.
		poll = setInterval(() => void load(), 3000);
		timer = setInterval(() => {
			now = Date.now();
			if (code && now > code.expires_at) code = null;
		}, 1000);
	});
	onDestroy(() => {
		if (poll) clearInterval(poll);
		if (timer) clearInterval(timer);
	});
</script>

<SettingsSection id="chat-connectors">
	<SettingsRow stacked>
		<div class="lede">
			<p>{t('settings.chat.intro')}</p>
			<p class="safety">{t('settings.chat.safety')}</p>
		</div>
	</SettingsRow>
	{#if old}
		<SettingsRow stacked><Notice tone="info">{t('settings.chat.oldDaemon')}</Notice></SettingsRow>
	{:else if loadError}
		<SettingsRow stacked><Notice>{t('settings.chat.loadFailed', { msg: loadError })}</Notice></SettingsRow>
	{/if}
	<SettingsRow id="chat-telegram" title={t('settings.chat.addTelegram')} description={t('settings.chat.telegramHint')}>
		{#if !adding}
			<Button size="sm" disabled={!loaded || old} onclick={() => (adding = true)}>{t('settings.chat.add')}</Button>
		{/if}
	</SettingsRow>
	{#if adding}
		<SettingsRow stacked>
			<form
				class="form"
				onsubmit={(e) => {
					e.preventDefault();
					void add();
				}}
			>
				<label class="field">
					<span class="label">{t('settings.chat.token')}</span>
					<TextField bind:value={token} type="password" mono placeholder="123456789:AA…" disabled={busy} />
					{#if token.trim() && !tokenOk}<span class="bad">{t('settings.chat.tokenShape')}</span>{/if}
				</label>
				<label class="field">
					<span class="label">{t('settings.chat.proxy')}</span>
					<TextField bind:value={proxy} mono placeholder={t('settings.chat.proxyPlaceholder')} disabled={busy} />
					<span class="hint">{t('settings.chat.proxyHint')}</span>
					{#if !proxyOk}<span class="bad">{t('settings.chat.proxyInvalid')}</span>{/if}
				</label>
				{#if addError}<Notice>{addError}</Notice>{/if}
				<div class="actions">
					<Button variant="primary" size="sm" type="submit" disabled={busy || !tokenOk || !proxyOk}>
						{#if busy}<CircleNotchIcon size={13} class="spin" /> {t('settings.chat.checking')}{:else}{t('settings.chat.connect')}{/if}
					</Button>
					<Button size="sm" variant="ghost" type="button" disabled={busy} onclick={() => ((adding = false), (addError = ''))}>{t('common.cancel')}</Button>
				</div>
			</form>
		</SettingsRow>
	{/if}
</SettingsSection>

{#each connectors as c (c.id)}
	<SettingsSection id={`chat-${c.id}`} title={`${t('settings.chat.telegram')} · ${c.name}`}>
		<SettingsRow title={t('settings.chat.connection')}>
			{#snippet detail()}
				<span class="status">
					<span class="dot {c.state}" class:pulse={c.state === 'connecting'}></span>{t(`settings.chat.state.${c.state}`)}
				</span>
				{#if c.state === 'error' && c.error}<span class="err">{c.error}</span>{/if}
			{/snippet}
			<Switch checked={c.enabled} label={t('settings.chat.connection')} onChange={(on) => set(c, { enabled: on })} />
		</SettingsRow>

		<SettingsRow title={t('settings.chat.bind')}>
			{#if code?.connector !== c.id}
				<Button size="sm" disabled={!c.enabled} onclick={() => bind(c)}>{t('settings.chat.bind')}</Button>
			{/if}
		</SettingsRow>
		{#if code?.connector === c.id}
			<SettingsRow stacked>
				<div class="code">
					{#if qr}
						<!-- SVG generated locally from the daemon's t.me link, no outside input. -->
						<div class="qr">{@html qr}</div>
					{/if}
					<div class="code-text">
						<strong class="mono">{t('settings.chat.bindCode', { code: code.code })}</strong>
						<span>{t('settings.chat.bindHint', { code: code.code })}</span>
						<span class="expires">{t('settings.chat.expires', { time: remaining(code.expires_at, now) })}</span>
						{#if code.link}
							<div class="link-row">
								<Button size="sm" onclick={() => code?.link && openUrl(code.link).catch(() => {})}><ArrowSquareOutIcon size={13} /> {t('settings.chat.openLink')}</Button>
								<Button size="sm" variant="ghost" onclick={copyLink}>
									{#if copied}<CheckIcon size={13} /> {t('settings.chat.copied')}{:else}<CopyIcon size={13} /> {t('settings.chat.copyLink')}{/if}
								</Button>
							</div>
						{/if}
					</div>
					<IconButton onclick={() => (code = null)} label={t('common.close')}><XIcon size={14} /></IconButton>
				</div>
			</SettingsRow>
		{/if}

		<SettingsRow stacked title={t('settings.chat.bindings')}>
			<div class="bindings">
				{#if c.bindings.length === 0}
					<span class="none">{t('settings.chat.noBindings')}</span>
				{/if}
				{#each c.bindings as b (b.device)}
					<div class="binding">
						<span class="name">{b.name}</span>
						<span class="when">
							{b.last_seen ? t('settings.chat.lastSeen', { time: when(b.last_seen) }) : t('settings.chat.pairedOn', { date: when(b.paired_at) })}
						</span>
						<Button size="sm" variant="ghost" onclick={() => unbind(c, b.device, b.name)}>{t('settings.chat.revoke')}</Button>
					</div>
				{/each}
			</div>
		</SettingsRow>

		<SettingsRow title={t('settings.chat.approvals')} description={t('settings.chat.approvalsHint')}>
			<Switch checked={c.settings.approvals} label={t('settings.chat.approvals')} onChange={(on) => set(c, { approvals: on })} />
		</SettingsRow>
		<SettingsRow title={t('settings.chat.notify')} description={t('settings.chat.notifyHint')}>
			<Switch checked={c.settings.notify} label={t('settings.chat.notify')} onChange={(on) => set(c, { notify: on })} />
		</SettingsRow>
		<SettingsRow title={t('settings.chat.maxMode')} description={t('settings.chat.maxModeHint')}>
			<Segmented
				value={c.settings.max_mode}
				options={MAX_MODES.map((m) => ({ value: m, label: t(`settings.chat.mode.${m}`) }))}
				onChange={(m) => set(c, { max_mode: m as MaxMode })}
			/>
		</SettingsRow>
		<SettingsRow title={t('settings.chat.proxy')} description={t('settings.chat.proxyHint')}>
			{#snippet detail()}
				<span class="status">{t(`settings.chat.proxyNow.${c.proxySource}`, { proxy: c.proxyShown ?? '' })}</span>
			{/snippet}
			<div class="proxy">
				<TextField bind:value={proxies[c.id]} mono placeholder={t('settings.chat.proxyPlaceholder')} />
				<Button size="sm" disabled={(proxies[c.id] ?? '') === (c.proxy ?? '')} onclick={() => saveProxy(c)}>{t('settings.chat.save')}</Button>
			</div>
		</SettingsRow>
		{#if errors[c.id]}
			<SettingsRow stacked><Notice onDismiss={() => (errors[c.id] = '')}>{errors[c.id]}</Notice></SettingsRow>
		{/if}
		<SettingsRow title={t('settings.chat.remove')} description={t('settings.chat.removeHint')}>
			<Button size="sm" variant="danger" onclick={() => remove(c)}>{t('settings.chat.remove')}</Button>
		</SettingsRow>
	</SettingsSection>
{/each}

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 480px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.label {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.lede {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.lede p {
		margin: 0;
		font-size: var(--fs-sm);
		line-height: 1.6;
		color: var(--dim);
	}
	.lede .safety {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.hint {
		margin: 0;
		font-size: var(--fs-xs);
		line-height: 1.5;
		color: var(--dim2);
	}
	.bad,
	.err {
		font-size: var(--fs-xs);
		color: var(--err);
	}
	.err {
		display: block;
		margin-top: 2px;
		overflow-wrap: anywhere;
	}
	.actions {
		display: flex;
		gap: 8px;
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		margin-top: 2px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: var(--r-full);
		background: var(--dim2);
		flex-shrink: 0;
	}
	.dot.connected {
		background: var(--ok);
	}
	.dot.connecting {
		background: var(--dim);
	}
	.dot.error {
		background: var(--err);
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
		font-weight: 500;
		color: var(--text);
	}
	.mono {
		font-family: var(--font-mono);
	}
	.expires {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim2);
		font-variant-numeric: tabular-nums;
	}
	.link-row {
		display: flex;
		gap: 8px;
		margin-top: 4px;
	}
	.bindings {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: var(--fs-sm);
	}
	.none {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.binding {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 32px;
		border-top: 1px solid var(--hairline);
	}
	.binding:first-child {
		border-top: none;
	}
	.name {
		flex: 1;
		min-width: 0;
		color: var(--text);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.when {
		color: var(--dim);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
	}
	.proxy {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 280px;
	}
</style>
