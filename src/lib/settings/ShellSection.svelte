<script lang="ts">
	// Settings → 编码智能体 → Shell: what LynShen's commands and the terminal
	// panel run in (`shell` and `terminal_shell` in config.json). The
	// daemon's `shells` reply lists the shells this computer has, with their
	// versions; a missing PowerShell 7 or Git Bash (Windows) gets 安装, which
	// runs winget in a terminal tab, and a link to the official download. A
	// daemon before the `shells` op cannot choose: the section says so.
	import { onMount } from 'svelte';
	import ArrowClockwiseIcon from 'phosphor-svelte/lib/ArrowClockwiseIcon';
	import { writeConfig } from '$lib/protocol';
	import { openExternal } from '$lib/openExternal';
	import { INSTALL, currentLabel, fellBack, missingShells, sandboxInstead, shellLabel, shellName, shellOptions } from '$lib/shells';
	import { shells } from '$lib/shellStore.svelte';
	import { terminalRequests } from '$lib/sandbox/terminal.svelte';
	import { t } from '$lib/i18n';
	import { toast } from '$lib/ui/toast.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Select from '$lib/ui/Select.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';

	/** `onClose`: leaves the settings page, so the terminal 安装 opens is in view. */
	let { onClose }: { onClose?: () => void } = $props();

	const reply = $derived(shells.reply);
	const commandOptions = $derived(reply ? shellOptions(reply, reply.shell, t) : []);
	const terminalOptions = $derived(reply ? shellOptions(reply, reply.terminal_shell ?? '', t, true) : []);
	const missing = $derived(reply ? missingShells(reply) : []);
	const chosenName = $derived(reply ? shellName(reply.shell) : '');
	const known = $derived(!!reply?.shells.some((s) => s.id === reply.shell));
	onMount(() => {
		void shells.load();
	});

	async function save(patch: Record<string, unknown>) {
		try {
			await writeConfig(patch);
		} catch (e) {
			toast.error(t('settings.page.saveFailed', { msg: String(e) }));
			return;
		}
		// The engine reads the setting each turn; the reply says what it comes to.
		await shells.load();
	}
	const setShell = (value: string) => save({ shell: value });
	// '' follows the commands' shell: no `terminal_shell`.
	const setTerminal = (value: string) => save({ terminal_shell: value || null });

	function install(id: string) {
		terminalRequests.open(INSTALL[id].command, '', '', true);
		onClose?.();
	}
</script>

<SettingsSection id="shell" title={t('settings.shells.title')}>
	{#snippet action()}
		{#if !shells.unsupported}
			<IconButton onclick={() => shells.load(true)} title={t('settings.shells.redetect')} disabled={shells.loading}>
				<ArrowClockwiseIcon size={14} class={shells.loading ? 'spin' : ''} />
			</IconButton>
		{/if}
	{/snippet}
	{#if shells.unsupported}
		<SettingsRow id="shell-command" title={t('settings.shells.command')} description={t('settings.shells.oldDaemon')} />
	{:else if !reply}
		<SettingsRow id="shell-command" title={t('settings.shells.command')} description={shells.error ? t('settings.shells.loadFailed', { msg: shells.error }) : t('settings.shells.detecting')} />
	{:else}
		<SettingsRow id="shell-command" title={t('settings.shells.command')} description={t('settings.shells.commandHint')}>
			{#snippet detail()}
				<div class="now">
					{#if fellBack(reply)}
						{known
							? t('settings.shells.fellBack', { name: chosenName, label: currentLabel(reply) })
							: t('settings.shells.fellBackPath', { path: reply.shell, label: currentLabel(reply) })}
					{:else}
						{t('settings.shells.now', { label: currentLabel(reply) })}
					{/if}
					{#if reply.commands.helper}
						· {t('settings.shells.helper', { label: shellLabel(reply.commands.helper.id, reply.commands.helper.version) })}
					{/if}
				</div>
				{#if sandboxInstead(reply)}
					<div class="now">{t('settings.shells.sandboxInstead', { label: currentLabel(reply) })}</div>
				{/if}
				{#if reply.platform !== 'windows' && !reply.commands.snapshot && reply.commands.id !== 'sh'}
					<div class="now dim">{t('settings.shells.noSnapshot')}</div>
				{/if}
			{/snippet}
			<div class="selw">
				<Select value={reply.shell} options={commandOptions} onChange={setShell} />
			</div>
		</SettingsRow>
		{#each missing as s (s.id)}
			<SettingsRow id={`shell-install-${s.id}`} title={t('settings.shells.missing', { name: shellName(s.id) })} description={t('settings.shells.missingHint')}>
				<span class="acts">
					<Button size="sm" onclick={() => install(s.id)} title={INSTALL[s.id].command}>{t('settings.shells.install', { name: shellName(s.id) })}</Button>
					<Button size="sm" variant="ghost" onclick={() => openExternal(INSTALL[s.id].url)}>{t('settings.shells.download')}</Button>
				</span>
			</SettingsRow>
		{/each}
		<SettingsRow id="terminal-shell" title={t('settings.shells.terminal')} description={t('settings.shells.terminalHint')}>
			<div class="selw">
				<Select value={reply.terminal_shell ?? ''} options={terminalOptions} onChange={setTerminal} />
			</div>
		</SettingsRow>
		{#if reply.commands.notes.length && fellBack(reply) && !known}
			<div class="top"><Notice tone="warn" mono>{reply.commands.notes.join('\n')}</Notice></div>
		{/if}
	{/if}
</SettingsSection>

<style>
	.selw {
		width: 340px;
		max-width: 100%;
	}
	.now {
		margin-top: 4px;
		font-size: var(--fs-2xs);
		color: var(--dim);
	}
	.now.dim {
		color: var(--dim2);
	}
	.acts {
		display: inline-flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 6px;
	}
	.top {
		margin-top: 12px;
	}
</style>
