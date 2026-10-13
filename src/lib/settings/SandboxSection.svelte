<script lang="ts">
	// Settings → 权限与沙箱: what LynShen's commands may touch. The sandbox
	// mode (完全访问 only after a confirmation), the network switch, where
	// 始终允许 keeps its rules, the writable directories (桌面 / 下载 / 文档 in
	// one click) and the command rules, the ones 始终允许 saved included —
	// config.json in the sandbox contract's format (sandbox/config.ts). Each
	// change is written at once over a fresh read of the file, then sent to
	// the running LynShen sessions whose engine reported its sandbox (an
	// older engine has no such ops): set_sandbox, add_directory,
	// remove_directory. Rules have no op: the engine reads them from the file.
	import { onMount } from 'svelte';
	import { open } from '@tauri-apps/plugin-dialog';
	import { desktopDir, documentDir, downloadDir } from '@tauri-apps/api/path';
	import FolderPlusIcon from 'phosphor-svelte/lib/FolderPlusIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import { readConfig, writeConfig, type Op } from '$lib/protocol';
	import { dispatch } from '$lib/backends/router';
	import { caps } from '$lib/backends';
	import type { ChatState } from '$lib/chat.svelte';
	import { t } from '$lib/i18n';
	import { toast } from '$lib/ui/toast.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import DirectoryList from './DirectoryList.svelte';
	import CommandRuleList from './CommandRuleList.svelte';
	import {
		addDirectoryPatch,
		addRulePatch,
		GLOBAL,
		readSandboxSettings,
		removeDirectoryPatch,
		removeRulePatch,
		samePath,
		updateRulePatch,
		type AlwaysAllowScope,
		type DirMode,
		type RuleAction,
		type SandboxSettings,
		type Scope
	} from '$lib/sandbox/config';
	import { baseName, onWindows, type SandboxMode } from '$lib/sandbox/request';

	let {
		project = '',
		sessions = []
	}: {
		/** The open project's root ('' for none): its entries are listed first. */
		project?: string;
		/** The open sessions; the running LynShen ones get the changes at once. */
		sessions?: { id: string; chat: ChatState }[];
	} = $props();

	type Json = Record<string, unknown>;
	let view = $state<SandboxSettings | null>(null);
	let error = $state('');
	const windows = onWindows();

	async function read(): Promise<Json> {
		return ((await readConfig()) ?? {}) as Json;
	}
	onMount(async () => {
		try {
			view = readSandboxSettings(await read(), project);
		} catch (e) {
			error = String(e);
		}
	});

	/** Writes the patch built over a fresh read, then shows the result. */
	async function apply(make: (cfg: Json) => Json): Promise<boolean> {
		try {
			const fresh = await read();
			const patch = make(fresh);
			await writeConfig(patch);
			view = readSandboxSettings({ ...fresh, ...patch }, project);
			return true;
		} catch (e) {
			toast.error(t('settings.page.saveFailed', { msg: String(e) }));
			return false;
		}
	}

	// ---------- running sessions ----------
	/** LynShen sessions whose engine reported its sandbox: it takes the ops. */
	const live = $derived(sessions.filter((s) => caps(s.chat).sandbox && s.chat.sandbox && s.chat.engineState !== 'exited'));
	const inScope = (chat: ChatState, scope: Scope) => scope === GLOBAL || (!!chat.cwd && samePath(chat.cwd, scope));
	function send(scope: Scope, op: (chat: ChatState) => Op | null) {
		for (const s of live) {
			if (!inScope(s.chat, scope)) continue;
			const o = op(s.chat);
			if (o) void dispatch(s.id, o);
		}
	}
	/** Why a running session's sandbox cannot start (bwrap missing…), once. */
	const unavailable = $derived([...new Set(live.map((s) => s.chat.sandbox?.unavailable ?? '').filter(Boolean))]);

	// ---------- sandbox ----------
	const MODES = $derived([
		{ value: 'read-only', label: t('settings.sandbox.mode.read-only') },
		{ value: 'workspace-write', label: t('settings.sandbox.mode.workspace-write') },
		{ value: 'full-access', label: t('settings.sandbox.mode.full-access') }
	]);
	// Remounts the control after a declined confirmation (it shows the old mode again).
	let modeKey = $state(0);
	async function setMode(v: string) {
		const mode = v as SandboxMode;
		if (!view || mode === view.mode) return;
		if (
			mode === 'full-access' &&
			!(await confirm({
				title: t('settings.sandbox.fullConfirmTitle'),
				message: t('settings.sandbox.fullConfirmBody'),
				confirmLabel: t('settings.sandbox.fullConfirm'),
				danger: true
			}))
		) {
			modeKey++;
			return;
		}
		if (!(await apply(() => ({ sandbox: mode })))) return modeKey++;
		send(GLOBAL, (chat) => ({ op: 'set_sandbox', mode, network: chat.sandbox?.network ?? view?.network ?? true }));
	}
	async function setNetwork(network: boolean) {
		if (!(await apply(() => ({ sandbox_network: network })))) return;
		send(GLOBAL, (chat) => ({ op: 'set_sandbox', mode: chat.sandbox?.mode || view?.mode || 'workspace-write', network }));
	}
	const ALWAYS = $derived([
		{ value: 'project', label: t('settings.sandbox.alwaysProject') },
		{ value: 'global', label: t('settings.sandbox.alwaysGlobal') }
	]);
	const setAlways = (v: string) => apply(() => ({ always_allow_scope: v as AlwaysAllowScope }));

	// ---------- directories ----------
	const scopeLabel = (scope: Scope) => (scope === GLOBAL ? t('settings.sandbox.everyProject') : baseName(scope));
	const scopeTitle = (scope: Scope) => (scope === GLOBAL ? t('settings.sandbox.everyProject') : scope);
	const dirItems = $derived(
		(view?.directories ?? []).map((d) => ({ ...d, badge: scopeLabel(d.scope), badgeTitle: scopeTitle(d.scope) }))
	);
	async function addDir(path: string, mode: DirMode = 'rw') {
		if (!(await apply((cfg) => addDirectoryPatch(cfg, GLOBAL, path, mode)))) return;
		// The file has it now: the running sessions take it for themselves.
		send(GLOBAL, () => ({ op: 'add_directory', path, mode, persist: 'session' }));
	}
	async function setDirMode(index: number, mode: DirMode) {
		const d = view?.directories[index];
		if (!d || !(await apply((cfg) => addDirectoryPatch(cfg, d.scope, d.path, mode)))) return;
		send(d.scope, () => ({ op: 'add_directory', path: d.path, mode, persist: 'session' }));
	}
	async function removeDir(index: number) {
		const d = view?.directories[index];
		if (!d || !(await apply((cfg) => removeDirectoryPatch(cfg, d.scope, d.path)))) return;
		// Removed where the session has it from.
		send(d.scope, (chat) => {
			const had = chat.sandbox?.directories.find((x) => samePath(x.path, d.path));
			return had ? { op: 'remove_directory', path: d.path, persist: had.source } : null;
		});
	}
	async function pickDir() {
		const path = await open({ directory: true, title: t('settings.sandbox.addDir') });
		if (path && !Array.isArray(path)) await addDir(path);
	}
	// The user's folders as the system names them (Windows: its known
	// folders, so a Desktop that OneDrive moved is found where it is).
	const KNOWN = [
		{ key: 'desktop', dir: desktopDir },
		{ key: 'downloads', dir: downloadDir },
		{ key: 'documents', dir: documentDir }
	] as const;
	let known = $state<{ key: string; path: string }[]>([]);
	onMount(async () => {
		const found = await Promise.all(KNOWN.map(async (k) => ({ key: k.key, path: await k.dir().catch(() => '') })));
		known = found.filter((k) => k.path);
	});
	const listed = (path: string) => (view?.directories ?? []).some((d) => d.scope === GLOBAL && samePath(d.path, path));

	// ---------- rules ----------
	// Rows being written (no prefix yet) stay here until they have one.
	let drafts = $state<{ prefix: string; action: RuleAction }[]>([]);
	const ruleRows = $derived([
		...(view?.rules ?? []).map((r) => ({ ...r, badge: scopeLabel(r.scope), badgeTitle: scopeTitle(r.scope) })),
		...drafts.map((r) => ({ ...r, badge: scopeLabel(GLOBAL), badgeTitle: scopeTitle(GLOBAL) }))
	]);
	async function changeRule(index: number, rule: { prefix: string; action: RuleAction }) {
		const saved = view?.rules ?? [];
		if (index >= saved.length) {
			const at = index - saved.length;
			if (!rule.prefix.trim()) {
				drafts[at] = rule;
				return;
			}
			if (await apply((cfg) => addRulePatch(cfg, GLOBAL, rule.prefix, rule.action))) drafts = drafts.filter((_, i) => i !== at);
			return;
		}
		const was = saved[index];
		// Emptied: the rule goes, as an incomplete one is never kept.
		if (!rule.prefix.trim()) await apply((cfg) => removeRulePatch(cfg, was.scope, was));
		else await apply((cfg) => updateRulePatch(cfg, was.scope, was, rule));
	}
	async function removeRule(index: number) {
		const saved = view?.rules ?? [];
		if (index >= saved.length) {
			drafts = drafts.filter((_, i) => i !== index - saved.length);
			return;
		}
		const was = saved[index];
		await apply((cfg) => removeRulePatch(cfg, was.scope, was));
	}
</script>

{#if windows}
	<div class="top"><Notice tone="warn">{t('settings.sandbox.windows')}</Notice></div>
{/if}
{#each unavailable as text (text)}
	<div class="top"><Notice tone="warn" mono>{text}</Notice></div>
{/each}
{#if error}
	<div class="top"><Notice>{t('settings.sandbox.readFailed', { msg: error })}</Notice></div>
{:else if view}
	<SettingsSection title={t('settings.sandbox.sandboxTitle')}>
		<SettingsRow id="sandbox-mode" title={t('settings.sandbox.modeTitle')} description={t(`settings.sandbox.modeHint.${view.mode}`)}>
			{#key modeKey}
				<Segmented value={view.mode} options={MODES} onChange={setMode} />
			{/key}
		</SettingsRow>
		<SettingsRow id="sandbox-network" title={t('settings.sandbox.network')} description={t('settings.sandbox.networkHint')}>
			<Switch checked={view.network} label={t('settings.sandbox.network')} onChange={setNetwork} />
		</SettingsRow>
		<SettingsRow id="sandbox-always" title={t('settings.sandbox.always')} description={t(`settings.sandbox.alwaysHint.${view.alwaysScope}`)}>
			<Segmented value={view.alwaysScope} options={ALWAYS} onChange={setAlways} />
		</SettingsRow>
	</SettingsSection>

	<SettingsSection id="sandbox-directories" title={t('settings.sandbox.dirsTitle')} description={t('settings.sandbox.dirsHint')}>
		{#snippet action()}
			<span class="acts">
				{#each known as k (k.key)}
					<Button size="sm" disabled={listed(k.path)} title={listed(k.path) ? t('settings.sandbox.listed', { path: k.path }) : k.path} onclick={() => addDir(k.path)}
						><PlusIcon size={12} />{t(`settings.sandbox.known.${k.key}`)}</Button
					>
				{/each}
				<Button size="sm" onclick={pickDir}><FolderPlusIcon size={13} />{t('settings.sandbox.addDir')}</Button>
			</span>
		{/snippet}
		<DirectoryList items={dirItems} empty={t('settings.sandbox.noDirs')} onMode={setDirMode} onRemove={removeDir} />
	</SettingsSection>

	<SettingsSection id="sandbox-rules" title={t('settings.sandbox.rulesTitle')} description={t('settings.sandbox.rulesHint')}>
		{#snippet action()}
			<Button size="sm" onclick={() => (drafts = [...drafts, { prefix: '', action: 'ask' }])}><PlusIcon size={13} />{t('shell.agentPage.addRule')}</Button>
		{/snippet}
		<CommandRuleList rules={ruleRows} empty={t('settings.sandbox.noRules')} onChange={changeRule} onRemove={removeRule} />
	</SettingsSection>
{/if}

<style>
	.top {
		margin-top: 20px;
	}
	.acts {
		display: inline-flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 6px;
	}
</style>
