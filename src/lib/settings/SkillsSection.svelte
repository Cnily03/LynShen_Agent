<script lang="ts">
	// Settings → 技能: the skills an engine loads, each with its switch, and
	// the marketplace as the second tab. The engine picker chooses whose
	// skills: LynShen's (its own folder, ~/.agents/skills and the project's,
	// all switchable) or Claude Code's (listed and deletable; Claude Code
	// switches its own). Load problems the engine reports sit in a banner on
	// top. Everything goes through the daemon's skill ops; an engine too old
	// to know them gets a note, and the marketplace still works.
	import { onMount, untrack } from 'svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import WarningIcon from 'phosphor-svelte/lib/WarningIcon';
	import WarningCircleIcon from 'phosphor-svelte/lib/WarningCircleIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';
	import TrayArrowDownIcon from 'phosphor-svelte/lib/TrayArrowDownIcon';
	import StorefrontIcon from 'phosphor-svelte/lib/StorefrontIcon';
	import {
		createSkill,
		isUnknownOp,
		listSkills,
		setSkillEnabled,
		uninstallSkill,
		type InstalledSkill,
		type SkillBackend,
		type SkillList,
		type SkillProblem
	} from '$lib/protocol';
	import {
		duplicateOf,
		enabledCount,
		filterSkills,
		groupSkills,
		homeOf,
		problemCounts,
		skillNameFrom,
		sortProblems,
		tildePath,
		validSkillName,
		withEnabled,
		without
	} from '$lib/skills';
	import { BACKEND_LABELS } from '$lib/backends';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import Collapse from '$lib/ui/Collapse.svelte';
	import PopMenu from '$lib/ui/PopMenu.svelte';
	import { t } from '$lib/i18n';
	import SkillMarket from './SkillMarket.svelte';

	let {
		tab,
		onTab,
		backend: initialBackend = 'lynshen',
		project = '',
		onImport
	}: {
		/** Installed skills, or the marketplace. */
		tab: 'installed' | 'market';
		onTab: (tab: 'installed' | 'market') => void;
		/** The engine to start with (the active conversation's). */
		backend?: SkillBackend;
		/** The active project's folder: its own skills are listed too. */
		project?: string;
		/** Settings → 导入. */
		onImport?: () => void;
	} = $props();

	let backend = $state<SkillBackend>(untrack(() => initialBackend));
	let query = $state('');
	let list = $state<SkillList | null>(null);
	let loading = $state(false);
	let loadError = $state('');
	/** The running engine does not know the skill ops yet. */
	let unsupported = $state(false);
	let diagOpen = $state(false);
	let menuOpen = $state(false);
	/** Skills whose switch or delete is on its way, by folder. */
	let pending = $state<Record<string, boolean>>({});

	const ENGINES: { value: SkillBackend; label: string }[] = [
		{ value: 'lynshen', label: BACKEND_LABELS.lynshen },
		{ value: 'claude', label: BACKEND_LABELS.claude }
	];

	const cwd = $derived(project || undefined);
	const skills = $derived(list?.skills ?? []);
	const shown = $derived(filterSkills(skills, query));
	const groups = $derived(groupSkills(shown));
	const problems = $derived(sortProblems(list?.problems ?? []));
	const counts = $derived(problemCounts(problems));
	const home = $derived(list ? homeOf(list) : '');
	/** Where a group's skills live: the folder, or for a project its root. */
	function placeOf(scope: InstalledSkill['scope']): string {
		const dir = list?.dirs.find((d) => d.scope === scope)?.path ?? '';
		return tildePath(scope === 'project' ? dir.replace(/[\\/]\.(?:lynshen|agents|claude)[\\/]skills$/, '') : dir, home);
	}
	const projectName = $derived(project.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '');

	async function load() {
		loading = true;
		loadError = '';
		try {
			list = await listSkills(backend, cwd);
			unsupported = false;
		} catch (e) {
			if (isUnknownOp(e, 'skills_list')) unsupported = true;
			else loadError = t('settings.skills.loadFailed', { msg: e instanceof Error ? e.message : String(e) });
			list = null;
		} finally {
			loading = false;
		}
	}
	onMount(load);
	// Another engine, or back from the marketplace (an install changed the list).
	let shownFor = '';
	$effect(() => {
		const key = `${backend}|${tab}`;
		if (key === shownFor) return;
		const first = !shownFor;
		shownFor = key;
		if (!first && tab === 'installed') untrack(() => void load());
	});

	async function toggle(s: InstalledSkill, enabled: boolean) {
		if (!list) return;
		pending[s.path] = true;
		list = withEnabled(list, s.path, enabled);
		try {
			list = await setSkillEnabled(s.path, enabled, cwd);
		} catch (e) {
			list = withEnabled(list, s.path, !enabled);
			toast.error(t('settings.skills.toggleFailed', { msg: e instanceof Error ? e.message : String(e) }));
		} finally {
			delete pending[s.path];
		}
	}

	async function remove(s: InstalledSkill) {
		const ok = await confirm({
			title: t('settings.skills.removeTitle', { name: s.name }),
			message: t('settings.skills.removeMessage', { path: tildePath(s.path, home) }),
			confirmLabel: t('settings.skills.remove'),
			danger: true
		});
		if (!ok || !list) return;
		pending[s.path] = true;
		try {
			await uninstallSkill({ path: s.path }, backend);
			list = without(list, s.path);
			toast.success(t('settings.skills.removed', { name: s.name }));
		} catch (e) {
			toast.error(t('settings.skills.removeFailed', { msg: e instanceof Error ? e.message : String(e) }));
		} finally {
			delete pending[s.path];
		}
		void load();
	}

	const reveal = (path: string) => revealItemInDir(path).catch((e) => toast.error(String(e)));

	function problemText(p: SkillProblem): string {
		if (p.kind === 'unreadable') return t(p.level === 'error' ? 'settings.skills.diag.unreadableOn' : 'settings.skills.diag.unreadable');
		if (p.kind === 'duplicate') return t('settings.skills.diag.duplicate', { other: tildePath(duplicateOf(p.message), home) });
		if (p.kind === 'no_description' || p.kind === 'untrusted' || p.kind === 'state') return t(`settings.skills.diag.${p.kind}`);
		return p.message;
	}

	// ---------- 新建 ----------
	let creating = $state(false);
	let newName = $state('');
	let newDesc = $state('');
	let nameTouched = $state(false);
	let createBusy = $state(false);
	let createError = $state('');
	const nameOk = $derived(validSkillName(newName));
	function openCreate() {
		menuOpen = false;
		creating = true;
		newName = '';
		newDesc = '';
		nameTouched = false;
		createError = '';
	}
	async function submitCreate() {
		if (!nameOk || !newDesc.trim() || createBusy) return;
		createBusy = true;
		createError = '';
		try {
			const file = await createSkill(newName, newDesc);
			creating = false;
			const name = newName;
			toast.success(t('settings.skills.create.created', { name }), {
				action: { label: t('settings.skills.create.show'), run: () => void reveal(file) }
			});
			if (backend !== 'lynshen') backend = 'lynshen';
			void load();
		} catch (e) {
			createError = isUnknownOp(e, 'skill_create')
				? t('settings.skills.unsupported')
				: t('settings.skills.create.failed', { msg: e instanceof Error ? e.message : String(e) });
		} finally {
			createBusy = false;
		}
	}

	function onMenu(key: string) {
		menuOpen = false;
		if (key === 'create') openCreate();
		else if (key === 'import') onImport?.();
		else if (key === 'market') onTab('market');
		else if (key === 'folder' && list) {
			const dir = list.dirs.find((d) => d.scope === 'user');
			if (dir) void reveal(dir.path);
		}
	}
	const menuItems = $derived([
		{
			key: 'create',
			label: t('settings.skills.newSkill'),
			desc: backend === 'claude' ? t('settings.skills.newSkillClaude') : t('settings.skills.newSkillDesc'),
			icon: NotePencilIcon,
			disabled: unsupported
		},
		{ key: 'import', label: t('settings.skills.importFrom'), desc: t('settings.skills.importFromDesc'), icon: TrayArrowDownIcon, disabled: !onImport },
		{ key: 'market', label: t('settings.skills.browseMarket'), icon: StorefrontIcon },
		{ key: 'folder', label: t('settings.skills.openFolder'), icon: FolderOpenIcon, disabled: !list }
	]);
</script>

<div class="bar">
	<div class="engine" title={t('settings.skills.engine')}>
		<Select value={backend} options={ENGINES} onChange={(v) => (backend = v as SkillBackend)} />
	</div>
	<span class="vsep" aria-hidden="true"></span>
	<div class="tabs" role="tablist">
		<button role="tab" class="tab" class:on={tab === 'installed'} aria-selected={tab === 'installed'} onclick={() => onTab('installed')}>
			{t('settings.skills.installedTab')}{#if list}<span class="n">{skills.length}</span>{/if}
		</button>
		<button role="tab" class="tab" class:on={tab === 'market'} aria-selected={tab === 'market'} onclick={() => onTab('market')}>
			{t('settings.skills.marketTab')}
		</button>
	</div>
	<label class="search">
		<MagnifyingGlassIcon size={15} />
		<input bind:value={query} placeholder={t('settings.skills.search')} aria-label={t('settings.skills.search')} spellcheck="false" />
	</label>
</div>

{#if tab === 'market'}
	<div class="body" id="set-skills-market">
		<SkillMarket {backend} {query} />
	</div>
{:else}
	<div class="body" id="set-skills-installed">
		{#if unsupported}
			<Notice tone="info">{t('settings.skills.unsupported')}</Notice>
		{:else if loadError}
			<Notice>{loadError}</Notice>
		{/if}

		{#if problems.length}
			<div class="diag" class:err={counts.errors > 0}>
				<button class="diag-head" aria-expanded={diagOpen} onclick={() => (diagOpen = !diagOpen)}>
					<span class="chev" class:open={diagOpen}><CaretRightIcon size={13} /></span>
					{#if counts.errors}<WarningCircleIcon size={16} />{:else}<WarningIcon size={16} />{/if}
					<span>{t('settings.skills.diag.title', { errors: counts.errors, warnings: counts.warnings })}</span>
				</button>
				<Collapse open={diagOpen}>
					<ul class="diag-list">
						{#each problems as p, i (`${p.path}:${p.kind}:${i}`)}
							<li>
								<span class="lvl" class:error={p.level === 'error'}>{t(p.level === 'error' ? 'settings.skills.diag.error' : 'settings.skills.diag.warning')}</span>
								<span class="what">
									<span>{problemText(p)}</span>
									<code title={p.message}>{tildePath(p.path, home)}</code>
								</span>
							</li>
						{/each}
					</ul>
				</Collapse>
			</div>
		{/if}

		<div class="listhead">
			<h3>
				{t('settings.skills.installed')}{#if list}<span class="n">{query ? `${shown.length} / ${skills.length}` : skills.length}</span>
					{#if !query && backend === 'lynshen' && skills.length}<span class="on-count">{t('settings.skills.enabledCount', { n: enabledCount(skills) })}</span>{/if}{/if}
			</h3>
			<IconButton size="sm" title={t('settings.skills.refresh')} disabled={loading} onclick={load}>
				{#if loading}<CircleNotchIcon size={16} class="spin" />{:else}<ArrowsClockwiseIcon size={16} />{/if}
			</IconButton>
			<div class="menu-anchor">
				<Button size="sm" variant="primary" aria-haspopup="menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
					<PlusIcon size={14} /> {t('settings.skills.new')} <CaretDownIcon size={12} />
				</Button>
				{#if menuOpen}<PopMenu items={menuItems} placement="down-right" onSelect={onMenu} onClose={() => (menuOpen = false)} />{/if}
			</div>
		</div>
		{#if backend === 'claude' && list}
			<p class="note">{t('settings.skills.claudeNote')}</p>
		{:else if list}
			<p class="note">{t('settings.skills.appliesNext')}</p>
		{/if}

		{#if list && !skills.length}
			<div class="empty">
				<p>{t('settings.skills.empty')}</p>
				<div class="empty-acts">
					<Button size="sm" onclick={() => onTab('market')}><StorefrontIcon size={14} /> {t('settings.skills.browseMarket')}</Button>
					{#if onImport}<Button size="sm" onclick={() => onImport?.()}><TrayArrowDownIcon size={14} /> {t('settings.skills.importFrom')}</Button>{/if}
				</div>
			</div>
		{:else if list && !shown.length}
			<p class="empty-line">{t('settings.skills.noMatch')}</p>
		{/if}

		{#each groups as g (g.scope)}
			<section class="group">
				<div class="ghead">
					<span class="gname">{g.scope === 'project' && projectName ? `${t('settings.skills.scope.project')} · ${projectName}` : t(`settings.skills.scope.${g.scope}`)}</span>
					<span class="n">{g.skills.length}</span>
					<span class="ghint">{backend === 'claude' ? t(g.scope === 'project' ? 'settings.skills.scopeHint.claudeProject' : 'settings.skills.scopeHint.claudeUser') : t(`settings.skills.scopeHint.${g.scope}`)}</span>
					<code class="gdir" title={placeOf(g.scope)}>{placeOf(g.scope)}</code>
				</div>
				<div class="rows">
					{#each g.skills as s (s.path)}
						<div class="srow" class:off={!s.enabled}>
							<div class="stext">
								<div class="sname">{s.name}</div>
								<div class="sdesc" title={s.description}>{s.description}</div>
							</div>
							<div class="sacts">
								<IconButton size="sm" title={t('settings.skills.openFolder')} onclick={() => reveal(s.path)}><FolderOpenIcon size={16} /></IconButton>
								{#if s.removable}
									<IconButton size="sm" title={t('settings.skills.remove')} disabled={pending[s.path]} onclick={() => remove(s)}><TrashIcon size={16} /></IconButton>
								{/if}
							</div>
							{#if s.toggleable}
								<Switch checked={s.enabled} label={t('settings.skills.enable', { name: s.name })} disabled={pending[s.path]} onChange={(on) => toggle(s, on)} />
							{/if}
						</div>
					{/each}
				</div>
			</section>
		{/each}

		{#if list && backend === 'lynshen'}
			{#if list.projectTrusted === false}
				<p class="note">{t('settings.skills.untrusted')}</p>
			{:else if list.projectTrusted === null}
				<p class="note">{t('settings.skills.noProject')}</p>
			{/if}
		{/if}
	</div>
{/if}

{#if creating}
	<Modal title={t('settings.skills.create.title')} width={480} dismissible={!createBusy} onClose={() => (creating = false)}>
		<form class="create" onsubmit={(e) => (e.preventDefault(), submitCreate())}>
			<label class="field">
				<span class="flabel">{t('settings.skills.create.name')}</span>
				<TextField bind:value={newName} mono placeholder="release-notes" />
				<span class="fhint" class:bad={nameTouched && newName !== '' && !nameOk}>{t('settings.skills.create.nameHint')}</span>
			</label>
			<label class="field">
				<span class="flabel">{t('settings.skills.create.description')}</span>
				<textarea
					class="ta"
					rows="3"
					bind:value={newDesc}
					placeholder={t('settings.skills.create.descriptionPlaceholder')}
					onfocus={() => {
						nameTouched = true;
						if (!newName && newDesc) newName = skillNameFrom(newDesc);
					}}
				></textarea>
				<span class="fhint">{t('settings.skills.create.descriptionHint')}</span>
			</label>
			{#if createError}<Notice>{createError}</Notice>{/if}
		</form>
		{#snippet footer()}
			<Button variant="ghost" disabled={createBusy} onclick={() => (creating = false)}>{t('common.cancel')}</Button>
			<Button variant="primary" disabled={!nameOk || !newDesc.trim() || createBusy} onclick={submitCreate}>
				{#if createBusy}<CircleNotchIcon size={14} class="spin" /> {t('settings.skills.create.creating')}{:else}{t('settings.skills.create.submit')}{/if}
			</Button>
		{/snippet}
	</Modal>
{/if}

<style>
	/* Engine · tabs · search, under the page title (as ZCode's scope, tabs
	   and search row). */
	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 18px;
	}
	.engine {
		width: 150px;
		flex-shrink: 0;
	}
	.vsep {
		width: 1px;
		height: 20px;
		background: var(--hairline);
		flex-shrink: 0;
	}
	.tabs {
		display: flex;
		gap: 2px;
		flex-shrink: 0;
	}
	.tab {
		display: inline-flex;
		align-items: center;
		height: 34px;
		padding: 0 12px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.tab:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.tab.on {
		background: var(--surface2);
		color: var(--text);
		font-weight: 600;
	}
	.n {
		margin-left: 6px;
		color: var(--dim2);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-weight: 400;
		font-variant-numeric: tabular-nums;
	}
	.search {
		flex: 1;
		min-width: 120px;
		display: flex;
		align-items: center;
		gap: 8px;
		height: 34px;
		margin-left: auto;
		max-width: 260px;
		padding: 0 10px;
		border: 1px solid var(--border);
		border-radius: var(--r-md);
		background: var(--surface);
		color: var(--dim);
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.search:focus-within {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		outline: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
	}
	.search input::placeholder {
		color: var(--dim2);
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 22px;
		scroll-margin: 24px;
	}

	/* Load problems: one line, the list behind it. */
	.diag {
		border-radius: var(--r-md);
		background: color-mix(in oklab, var(--warn) 10%, transparent);
		color: var(--warn);
	}
	.diag.err {
		background: color-mix(in oklab, var(--err) 10%, transparent);
		color: var(--err);
	}
	.diag-head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 40px;
		padding: 0 12px;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		font-size: var(--fs-sm);
		font-weight: 600;
		text-align: left;
		cursor: pointer;
	}
	.chev {
		display: inline-flex;
		transition: transform var(--t-fast) var(--ease-out);
	}
	.chev.open {
		transform: rotate(90deg);
	}
	.diag-list {
		margin: 0;
		padding: 0 12px 10px 33px;
		list-style: none;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.diag-list li {
		display: flex;
		gap: 10px;
		font-size: var(--fs-xs);
		line-height: 1.45;
	}
	.lvl {
		flex-shrink: 0;
		min-width: 2.6em;
		color: var(--warn);
	}
	.lvl.error {
		color: var(--err);
	}
	.what {
		min-width: 0;
		display: flex;
		flex-direction: column;
		color: var(--text);
	}
	.what code {
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		overflow-wrap: anywhere;
	}

	.listhead {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 6px;
	}
	.listhead h3 {
		flex: 1;
		display: flex;
		align-items: baseline;
		margin: 0;
		color: var(--text);
		font-size: var(--fs-md);
		font-weight: 600;
	}
	.on-count {
		margin-left: 10px;
		color: var(--dim);
		font-size: var(--fs-xs);
		font-weight: 400;
	}
	.menu-anchor {
		position: relative;
	}
	.note {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.45;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 12px;
		padding: 18px 0;
	}
	.empty p,
	.empty-line {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.empty-acts {
		display: flex;
		gap: 8px;
	}

	.group {
		margin-top: 12px;
	}
	.ghead {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding-bottom: 6px;
		border-bottom: 1px solid var(--hairline);
		min-width: 0;
	}
	.gname {
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 600;
		white-space: nowrap;
	}
	.ghead .n {
		margin-left: 0;
	}
	.ghint {
		color: var(--dim);
		font-size: var(--fs-xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.gdir {
		margin-left: auto;
		flex-shrink: 1;
		min-width: 0;
		color: var(--dim2);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.rows > * + * {
		border-top: 1px solid var(--hairline);
	}
	.srow {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 58px;
		padding: 8px 4px;
	}
	.stext {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.sname {
		color: var(--text);
		font-size: var(--fs-sm);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.sdesc {
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.45;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.srow.off .sname {
		color: var(--dim);
	}
	.srow.off .sdesc {
		color: var(--dim2);
	}
	/* Row actions on hover or keyboard focus (design.md). */
	.sacts {
		display: flex;
		gap: 2px;
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.srow:hover .sacts,
	.srow:focus-within .sacts {
		opacity: 1;
	}

	.create {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.flabel {
		color: var(--text);
		font-size: var(--fs-sm);
	}
	.fhint {
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.45;
	}
	.fhint.bad {
		color: var(--err);
	}
	.ta {
		width: 100%;
		min-width: 0;
		resize: vertical;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		padding: 9px 11px;
		font: inherit;
		font-size: var(--fs-sm);
		line-height: 1.5;
		outline: none;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.ta::placeholder {
		color: var(--dim2);
	}
	.ta:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
</style>
