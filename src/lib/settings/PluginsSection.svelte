<script lang="ts">
	// Settings → 插件. LynShen has no plugin system of its own yet: skills and
	// MCP servers are managed one by one (Settings → 技能, MCP 服务器). What
	// other coding agents call plugins (Claude Code, Codex, ZCode) bundle both
	// — and commands and hooks — so this page lists the plugins they have
	// turned on, with the skills and servers in each that can be imported.
	// When LynShen gains plugins, its own go on this page above these.
	import { onMount } from 'svelte';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { importScan } from '$lib/protocol';
	import { foreignPlugins, type ForeignPlugin } from '$lib/skills';
	import { SOURCE_LABELS } from '$lib/agentImport';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';

	let { onOpen }: { onOpen: (section: 'skills' | 'mcp' | 'import') => void } = $props();

	let plugins = $state<ForeignPlugin[] | null>(null);
	let loading = $state(false);
	let error = $state('');

	async function scan() {
		loading = true;
		error = '';
		try {
			plugins = foreignPlugins(await importScan());
		} catch (e) {
			error = t('settings.plugins.scanFailed', { msg: e instanceof Error ? e.message : String(e) });
		} finally {
			loading = false;
		}
	}
	onMount(scan);

	/** `2 个技能 · 1 个 MCP 服务器：docx, xlsx, files`, leaving out what it has none of. */
	function contents(p: ForeignPlugin): string {
		const parts = [
			p.skills.length ? t('settings.plugins.skillCount', { n: p.skills.length }) : '',
			p.mcp.length ? t('settings.plugins.mcpCount', { n: p.mcp.length }) : ''
		].filter(Boolean);
		return t('settings.plugins.contents', { counts: parts.join(' · '), names: [...p.skills, ...p.mcp].join(', ') });
	}
</script>

<div class="intro"><Notice tone="info">{t('settings.plugins.intro')}</Notice></div>

<SettingsSection id="plugins-foreign" title={t('settings.plugins.foreign')} description={t('settings.plugins.foreignHint')}>
	{#snippet action()}
		<IconButton size="sm" title={t('settings.skills.refresh')} disabled={loading} onclick={scan}>
			{#if loading}<CircleNotchIcon size={16} class="spin" />{:else}<ArrowsClockwiseIcon size={16} />{/if}
		</IconButton>
	{/snippet}
	{#if error}
		<div class="pad"><Notice>{error}</Notice></div>
	{:else if plugins === null}
		<SettingsRow description={t('settings.plugins.scanning')} />
	{:else if !plugins.length}
		<SettingsRow description={t('settings.plugins.none')} />
	{:else}
		{#each plugins as p (`${p.source}:${p.name}`)}
			<div class="prow">
				<div class="ptext">
					<div class="ptitle">
						<span class="pname">{p.name}</span>
						<span class="psource">{SOURCE_LABELS[p.source]}</span>
					</div>
					<div class="pdesc" title={[...p.skills, ...p.mcp].join(', ')}>{contents(p)}</div>
				</div>
				{#if p.importable}
					<Button size="sm" onclick={() => onOpen('import')}>{t('settings.plugins.import')}</Button>
				{:else}
					<span class="done">{t('settings.plugins.allImported')}</span>
				{/if}
			</div>
		{/each}
	{/if}
</SettingsSection>

<SettingsSection title={t('settings.plugins.where')}>
	<SettingsRow title={t('settings.plugins.skillsRow')} description={t('settings.plugins.skillsRowHint')}>
		<Button size="sm" onclick={() => onOpen('skills')}>{t('settings.plugins.open')}</Button>
	</SettingsRow>
	<SettingsRow title={t('settings.plugins.mcpRow')} description={t('settings.plugins.mcpRowHint')}>
		<Button size="sm" onclick={() => onOpen('mcp')}>{t('settings.plugins.open')}</Button>
	</SettingsRow>
</SettingsSection>

<style>
	.intro {
		margin-top: 18px;
	}
	.pad {
		padding: 12px 0;
	}
	.prow {
		display: flex;
		align-items: center;
		gap: 16px;
		min-height: 56px;
		padding: 10px 0;
	}
	.ptext {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.ptitle {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}
	.pname {
		color: var(--text);
		font-size: var(--fs-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.psource {
		flex-shrink: 0;
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.pdesc {
		color: var(--dim);
		font-size: var(--fs-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.done {
		flex-shrink: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
</style>
