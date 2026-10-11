<script lang="ts">
	// Settings → General → Startup: launch at login, and whether that start
	// shows the window or keeps the app in the tray (src-tauri/src/autostart.rs).
	import { onMount } from 'svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import { autostartGet, autostartSet, type Autostart } from '$lib/protocol';
	import { t } from '$lib/i18n';

	let current = $state<Autostart | null>(null);
	let busy = $state(false);
	let error = $state('');

	onMount(() => {
		autostartGet().then(
			(s) => (current = s),
			(e) => (error = t('settings.autostart.readFailed', { msg: String(e) }))
		);
	});

	async function apply(next: Autostart) {
		const before = current;
		current = next;
		busy = true;
		error = '';
		try {
			current = await autostartSet(next.enabled, next.silent);
		} catch (e) {
			current = before;
			error = t('settings.autostart.failed', { msg: String(e) });
		} finally {
			busy = false;
		}
	}
</script>

<SettingsRow id="autostart" title={t('settings.autostart.title')} description={t('settings.autostart.hint')}>
	<Switch checked={current?.enabled ?? false} disabled={!current || busy} label={t('settings.autostart.title')} onChange={(on) => current && apply({ ...current, enabled: on })} />
</SettingsRow>
{#if current?.enabled}
	<SettingsRow id="autostart-mode" title={t('settings.autostart.mode')} description={t('settings.autostart.modeHint')}>
		<Segmented
			value={current.silent ? 'silent' : 'window'}
			options={[
				{ value: 'window', label: t('settings.autostart.window') },
				{ value: 'silent', label: t('settings.autostart.silent') }
			]}
			onChange={(v) => current && apply({ ...current, silent: v === 'silent' })}
		/>
	</SettingsRow>
{/if}
{#if error}
	<div class="notice"><Notice onDismiss={() => (error = '')}>{error}</Notice></div>
{/if}

<style>
	.notice {
		padding-bottom: 12px;
	}
</style>
