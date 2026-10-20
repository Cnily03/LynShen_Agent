<script lang="ts">
	// Settings → MCP 与扩展 → 安卓手机（Android-Use）: lets the agent read and
	// operate an Android phone connected to this computer, through
	// android-use (github.com/austinintelligence/android-use, MIT). The daemon
	// installs the version the engine pins (SHA-256 checked), runs its setup
	// and switches the tools on; each phone action then asks like a command.
	import { onMount } from 'svelte';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { daemon } from '$lib/protocol';
	import { canSetUp, isOldDaemonForAndroid, parseAndroidUse, statusLine, type AndroidUseStatus } from '$lib/androidUse';
	import { confirm } from '$lib/ui/confirm.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import { t } from '$lib/i18n';

	let status = $state<AndroidUseStatus | null>(null);
	let busy = $state<'' | 'status' | 'install' | 'setup' | 'enable'>('');
	let error = $state('');
	let old = $state(false);
	let howto = $state(false);

	async function ask(op: Record<string, unknown>) {
		await daemon.connect();
		return daemon.request(op);
	}

	async function run(kind: typeof busy, op: Record<string, unknown>) {
		busy = kind;
		error = '';
		try {
			status = parseAndroidUse(await ask(op));
			old = false;
		} catch (e) {
			const text = e instanceof Error ? e.message : String(e);
			old = isOldDaemonForAndroid(text);
			error = old ? '' : text;
		} finally {
			busy = '';
		}
	}

	const refresh = (doctor = false) => run('status', { op: 'android_use_status', doctor });

	async function install() {
		const ok = await confirm({
			title: t('settings.androidUse.installTitle'),
			message: t('settings.androidUse.installMessage', { version: status?.version ?? '' }),
			confirmLabel: t('settings.androidUse.installConfirm')
		});
		if (ok) await run('install', { op: 'android_use_install' });
	}

	const setup = () => run('setup', { op: 'android_use_setup' });
	const enable = (on: boolean) => run('enable', { op: 'android_use_enable', enabled: on });

	onMount(() => void refresh());
</script>

<SettingsSection id="android-use" title={t('settings.androidUse.title')}>
	{#snippet action()}
		<IconButton size="sm" title={t('settings.androidUse.recheck')} disabled={!!busy} onclick={() => refresh(true)}>
			{#if busy === 'status'}<CircleNotchIcon size={16} class="spin" />{:else}<ArrowsClockwiseIcon size={16} />{/if}
		</IconButton>
	{/snippet}
	{#if old}
		<SettingsRow description={t('settings.androidUse.oldDaemon')} />
	{:else if !status}
		<SettingsRow description={error || t('settings.androidUse.checking')} />
	{:else}
		<SettingsRow
			id="android-use-enable"
			title={t('settings.androidUse.enable')}
			description={t('settings.androidUse.enableHint')}
		>
			{#snippet detail()}
				<div class="status">{statusLine(status!)}</div>
			{/snippet}
			{#if !status.installed}
				<Button size="sm" disabled={!!busy || !status.asset} onclick={install}>
					{#if busy === 'install'}<CircleNotchIcon size={14} class="spin" />{/if}{t('settings.androidUse.install')}
				</Button>
			{:else}
				<Switch checked={status.enabled} label={t('settings.androidUse.enable')} disabled={!!busy} onChange={enable} />
			{/if}
		</SettingsRow>
		{#if status.installed}
			<SettingsRow id="android-use-device" title={t('settings.androidUse.phone')} description={status.hint}>
				<Button size="sm" variant="secondary" disabled={!!busy || !canSetUp(status)} onclick={setup}>
					{#if busy === 'setup'}<CircleNotchIcon size={14} class="spin" />{/if}{t('settings.androidUse.setup')}
				</Button>
			</SettingsRow>
		{/if}
		{#if error}
			<div class="pad"><Notice>{error}</Notice></div>
		{/if}
		<SettingsRow id="android-use-howto" title={t('settings.androidUse.howto')} stacked>
			<button class="link" onclick={() => (howto = !howto)}>{howto ? t('settings.androidUse.hide') : t('settings.androidUse.show')}</button>
			{#if howto}
				<ol class="howto">
					{#each ['step1', 'step2', 'step3', 'step4'] as step (step)}
						<li>{t(`settings.androidUse.${step}`)}</li>
					{/each}
					<li>{status.wirelessHint}</li>
				</ol>
				<div class="src">{t('settings.androidUse.source')}</div>
			{/if}
		</SettingsRow>
	{/if}
</SettingsSection>

<style>
	.status {
		margin-top: 4px;
		color: var(--dim);
		font-size: 12px;
	}
	.pad {
		padding: 8px 0;
	}
	.link {
		align-self: flex-start;
		padding: 0;
		border: 0;
		background: none;
		color: var(--accent);
		font: inherit;
		font-size: 12px;
		cursor: pointer;
	}
	.howto {
		margin: 8px 0 0;
		padding-left: 20px;
		color: var(--dim);
		font-size: 12px;
		line-height: 1.6;
	}
	.src {
		margin-top: 6px;
		color: var(--dim);
		font-size: 11px;
	}
</style>
