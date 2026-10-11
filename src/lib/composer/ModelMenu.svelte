<script lang="ts">
	import { popOut } from '$lib/ui/motion';
	import { onMount, tick } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import CaretRightIcon from 'phosphor-svelte/lib/CaretRightIcon';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeftIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import SessionSwitches, { type SessionSwitch } from '$lib/composer/SessionSwitches.svelte';
	import Vendor from '$lib/Vendor.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import { acpAgentsList, checkBackend, type AcpAgent } from '$lib/protocol';
	import { loadBackendSettings, versionLabel } from '$lib/backends/settings';
	import { CAPS, NATIVE_BACKEND_IDS, BACKEND_LABELS, type BackendId } from '$lib/backends';
	import { t } from '$lib/i18n';
	import type { ChatState } from '$lib/chat.svelte';
	import { stripGroupSuffix, type ModelRow } from './modelRows';
	import GroupPicker, { loadGroups, type ToolProvider } from './GroupPicker.svelte';
	import { readConfig, writeConfig, type LynShenGroup } from '$lib/protocol';
	import { toast } from '$lib/ui/toast.svelte';
	import { modelSetup } from '$lib/modelSetupState.svelte';

	// The composer's model menu, opened from the model button: everything about
	// "who answers and how hard it thinks" in one place. The first page shows
	// the current model (a row that opens the model list), the thinking effort,
	// the provider (gateway group or this machine) and, while the session can still switch, the coding
	// agent. The second page is the model list, searchable when it is long.
	// (The plan quota is in the context ring's card.)
	let {
		chat,
		canPickModel = false,
		rows = [],
		showSearch = false,
		backendLocked = true,
		toolProvider,
		effortDisabled = false,
		anchor,
		query = $bindable(''),
		selIdx = $bindable(0),
		onClose,
		onSelect,
		onEffort,
		onSwitch,
		onBackend,
		onRefreshModels
	}: {
		chat: ChatState;
		/** The engine has a model catalog (not ACP agents). */
		canPickModel?: boolean;
		rows?: ModelRow[];
		showSearch?: boolean;
		/** Locked sessions (restored / first user turn sent) can't change agent. */
		backendLocked?: boolean;
		/** A Claude Code / Codex session: where its model runs (`model` is the
		 *  gateway's name for it) and how to change that. */
		toolProvider?: ToolProvider & { model: string };
		effortDisabled?: boolean;
		anchor?: HTMLElement;
		query?: string;
		selIdx?: number;
		onClose: () => void;
		onSelect: (command: string) => void;
		onEffort: (effort: string) => void;
		onSwitch: (name: SessionSwitch, on: boolean) => void;
		onBackend?: (b: BackendId, acpAgent?: { id: string; name: string }) => void | Promise<void>;
		/** Re-request the model catalog (after an agent switch). */
		onRefreshModels: () => void;
	} = $props();

	// Opens above the model button, right edges aligned (the button sits at the
	// right of the composer); below it when there is no room above.
	let popEl = $state<HTMLDivElement>();
	let popTop = $state(0);
	let popLeft = $state(0);
	function position() {
		if (!anchor || !popEl) return;
		const r = anchor.getBoundingClientRect();
		const margin = 12;
		const top = r.top - popEl.offsetHeight - 8;
		popLeft = Math.min(Math.max(r.right - popEl.offsetWidth, margin), window.innerWidth - popEl.offsetWidth - margin);
		popTop = top >= margin ? top : Math.min(r.bottom + 8, window.innerHeight - popEl.offsetHeight - margin);
	}
	onMount(() => {
		tick().then(position);
		// Rows arrive after the catalog request; keep the menu anchored as it grows.
		const ro = new ResizeObserver(position);
		if (popEl) ro.observe(popEl);
		return () => ro.disconnect();
	});

	// Agent availability (best-effort) and the registered ACP agents.
	let probe = $state<Partial<Record<BackendId, { found: boolean; usable: boolean; version: string }>>>({});
	let acpAgents = $state<AcpAgent[]>([]);
	onMount(() => {
		if (backendLocked) return;
		const settings = loadBackendSettings();
		for (const id of NATIVE_BACKEND_IDS) {
			checkBackend(id, settings.paths[id])
				.then((s) => (probe[id] = { found: s.found, usable: s.found && s.signed_in !== false, version: versionLabel(s) }))
				.catch(() => {});
		}
		acpAgentsList()
			.then((a) => (acpAgents = a))
			.catch(() => {});
	});
	// Only agents that can run here: Claude Code / Codex show once installed
	// and signed in to an account of their own (the session's own always
	// shows). One agent alone is nothing to switch between, so the section goes.
	const shownNative = $derived(NATIVE_BACKEND_IDS.filter((id) => id === 'lynshen' || id === chat.backendId || probe[id]?.usable));
	const canSwitchAgent = $derived(shownNative.length + acpAgents.length > 1);
	const agentTitle = (id: BackendId) => {
		const p = probe[id];
		if (!p) return BACKEND_LABELS[id];
		if (!p.found) return `${BACKEND_LABELS[id]} · ${t('shell.backend.notFound')}`;
		return p.version ? `${BACKEND_LABELS[id]} · ${p.version}` : BACKEND_LABELS[id];
	};

	// An agent switch tears down and respawns the session's engine — a second
	// click while one is in flight would race it.
	let switching = $state(false);
	async function pickNative(id: BackendId) {
		if (switching || id === chat.backendId) return;
		switching = true;
		try {
			await onBackend?.(id);
			if (CAPS[id].modelPicker) onRefreshModels();
		} finally {
			switching = false;
		}
	}
	async function pickAcp(agent: AcpAgent) {
		if (switching || (chat.backendId === 'acp' && chat.acpAgentId === agent.id)) return;
		switching = true;
		try {
			await onBackend?.('acp', { id: agent.id, name: agent.name });
		} finally {
			switching = false;
		}
	}

	let page = $state<'main' | 'models' | 'routes'>('main');
	/** The model whose lines the route page lists. */
	let routeRow = $state<ModelRow | null>(null);
	// A LynShen model several groups serve: its groups, cheapest first, and
	// the one pinned for it (`lynshen_groups`; '' = auto).
	let modelGroups = $state<LynShenGroup[]>([]);
	let pinned = $state('');
	const rowModel = (row: ModelRow) => row.command.replace(/^\/model\s+/, '').split(/\s+/)[0];
	function openRow(row: ModelRow) {
		if (row.choices?.length || row.groupsPage) {
			routeRow = row;
			page = 'routes';
			if (row.groupsPage) {
				const name = rowModel(row);
				Promise.all([loadGroups(), readConfig()])
					.then(([list, cfg]) => {
						modelGroups = list
							.filter((g) => g.models?.includes(name))
							.sort((a, b) => a.rate_multiplier - b.rate_multiplier);
						pinned = ((cfg.lynshen_groups ?? {}) as Record<string, string>)[name] ?? '';
					})
					.catch(() => (modelGroups = []));
			}
			return;
		}
		onSelect(row.command);
	}
	async function pickGroup(row: ModelRow, id: string) {
		const name = rowModel(row);
		try {
			const cfg = await readConfig();
			const map = { ...((cfg.lynshen_groups ?? {}) as Record<string, string>) };
			if (id) map[name] = id;
			else delete map[name];
			await writeConfig({ lynshen_groups: map });
		} catch (e) {
			toast.error(t('chat.groupSaveFailed', { error: String(e) }));
			return;
		}
		onSelect(row.command);
	}
	const mult = (n: number) => `×${Number(n.toFixed(3))}`;
	const billing = (g: LynShenGroup) =>
		g.billing_source === 'plan_only' ? t('chat.groupPlan') : g.billing_source === 'balance_only' ? t('chat.groupBalance') : '';
	const modelName = $derived(rows.find(row => row.active)?.label || stripGroupSuffix(chat.modelLabel || '') || chat.model || BACKEND_LABELS[chat.backendId]);
	// On the first page the list's keys (arrows, Enter) open the list instead
	// of picking a row nobody can see. Capture phase, ahead of the pane.
	function onKeyCapture(e: KeyboardEvent) {
		if (page !== 'main' || !canPickModel) return;
		if (['ArrowDown', 'ArrowUp', 'ArrowRight', 'Enter'].includes(e.key)) {
			e.preventDefault();
			e.stopPropagation();
			page = 'models';
		}
	}

	// Group headers only help when the list spans more than one source.
	const grouped = $derived(new Set(rows.map((r) => r.group)).size > 1);
</script>

<svelte:window onkeydowncapture={onKeyCapture} />
<button class="mm-backdrop" aria-label={t('common.close')} tabindex="-1" onclick={onClose}></button>
<div class="pop mm" role="dialog" out:popOut|global aria-label={t('chat.switchModel')} bind:this={popEl} style:left="{popLeft}px" style:top="{popTop}px">
	{#if page === 'main'}
		<section class="current">
			{#if canPickModel}
				<button class="pop-row" onclick={() => (page = 'models')} title={t('chat.pickModel')}>
					<span class="pop-ico"><Vendor model={chat.model || modelName} size={16} /></span>
					<span class="pop-txt">
						<span class="pop-label">{modelName}</span>
					</span>
					<span class="pop-ico caret"><CaretRightIcon size={14} /></span>
				</button>
			{:else}
				<div class="pop-row static">
					<span class="pop-ico"><BackendIcon backend={chat.backendId} size={15} /></span>
					<span class="pop-txt"><span class="pop-label">{modelName}</span></span>
				</div>
			{/if}
		</section>


		<SessionSwitches {chat} {onSwitch} thinking={false} />

		{#if chat.backendId === 'lynshen' && chat.provider === 'lynshen' && chat.model}
			{#key chat.model}<GroupPicker model={chat.model} />{/key}
		{:else if toolProvider}
			{#key toolProvider.model}<GroupPicker model={toolProvider.model} tool={toolProvider} />{/key}
		{/if}

		{#if !backendLocked && canSwitchAgent}
			<section class="agents" role="group" aria-label={t('chat.switchBackend')}>
				{#each shownNative as id (id)}
					<button
						class="agent"
						class:on={chat.backendId === id}
						disabled={switching}
						title={agentTitle(id)}
						onclick={() => pickNative(id)}
					>
						<BackendIcon backend={id} size={15} /><span>{BACKEND_LABELS[id]}</span>
					</button>
				{/each}
				{#each acpAgents as agent (agent.id)}
					<button
						class="agent"
						class:on={chat.backendId === 'acp' && chat.acpAgentId === agent.id}
						disabled={switching}
						title={agent.name}
						onclick={() => pickAcp(agent)}
					>
						<BackendIcon backend="acp" size={15} /><span>{agent.name}</span>
					</button>
				{/each}
			</section>
		{/if}
	{:else if page === 'models'}
		<section class="models">
			<div class="mhead">
				<IconButton size="sm" label={t('shell.remote.back')} title={t('shell.remote.back')} onclick={() => (page = 'main')}>
					<CaretLeftIcon size={14} />
				</IconButton>
				<span class="mtitle">{t('chat.pickModel')}</span>
				{#if chat.backendId === 'lynshen'}
					<!-- Which LynShen models show, and their context windows. -->
					<button
						class="manage"
						onclick={() => {
							modelSetup.open = true;
							onClose();
						}}>{t('chat.manageModels')}</button
					>
				{/if}
			</div>
			{#if showSearch}
				<label class="search">
					<MagnifyingGlassIcon size={15} />
					<!-- svelte-ignore a11y_autofocus -->
					<input bind:value={query} placeholder={t('shell.pickerSearchPlaceholder')} autofocus />
				</label>
			{/if}
			<div class="list" role="listbox" aria-label={t('chat.switchModel')}>
				{#each rows as row, i (row.id)}
					{#if grouped && row.group && (i === 0 || rows[i - 1]?.group !== row.group)}
						<div class="group">{row.group}</div>
					{/if}
					<button
						class="pop-row"
						class:sel={i === selIdx}
						role="option"
						aria-selected={row.active}
						onclick={() => openRow(row)}
						onmouseenter={() => (selIdx = i)}
					>
						<span class="pop-ico"><Vendor model={row.vendor ?? row.label} size={16} /></span>
						<span class="pop-txt">
							<span class="pop-label">{row.label || t('shell.empty')}</span>
						</span>
						{#if row.choices?.length}
							<span class="routes-n">{t('chat.routeCount', { n: row.choices.length })}</span>
						{/if}
						<span class="pop-check" class:off={!row.active}><CheckIcon size={16} /></span>
						{#if row.choices?.length || row.groupsPage}<span class="pop-ico caret"><CaretRightIcon size={14} /></span>{/if}
					</button>
				{/each}
				{#if rows.length === 0}
					<div class="empty">{query.trim() ? t('shell.noMatch') : t('shell.noOptions')}</div>
				{/if}
			</div>
		</section>
	{:else if routeRow}
		<section class="models routes">
			<div class="mhead">
				<IconButton size="sm" label={t('shell.remote.back')} title={t('shell.remote.back')} onclick={() => (page = 'models')}>
					<CaretLeftIcon size={14} />
				</IconButton>
				<span class="mtitle">{t('chat.routeTitle', { model: routeRow.label })}</span>
			</div>
			<div class="list" role="listbox" aria-label={t('chat.routeTitle', { model: routeRow.label })}>
				{#if routeRow.groupsPage}
					{@const row = routeRow}
					<button class="pop-row" role="option" aria-selected={!pinned} onclick={() => pickGroup(row, '')}>
						<span class="pop-txt">
							<span class="pop-label">{t('chat.groupAuto')}</span>
							<span class="pop-desc">{t('chat.groupAutoDesc')}</span>
						</span>
						<span class="pop-check" class:off={!!pinned}><CheckIcon size={16} /></span>
					</button>
					{#each modelGroups as g (g.id)}
						{@const desc = [billing(g), g.description].filter(Boolean).join(' · ')}
						<button class="pop-row" role="option" aria-selected={pinned === g.id} onclick={() => pickGroup(row, g.id)}>
							<span class="pop-txt">
								<span class="pop-label">{g.name}</span>
								{#if desc}<span class="pop-desc" title={desc}>{desc}</span>{/if}
							</span>
							<span class="routes-n">{mult(g.rate_multiplier)}</span>
							<span class="pop-check" class:off={pinned !== g.id}><CheckIcon size={16} /></span>
						</button>
					{/each}
				{/if}
				{#each routeRow.choices ?? [] as c (c.id)}
					<button class="pop-row" role="option" aria-selected={c.active} onclick={() => onSelect(c.command)}>
						<span class="pop-txt">
							<span class="pop-label">{c.label}</span>
							{#if c.detail}<span class="pop-desc" title={c.detail}>{c.detail}</span>{/if}
						</span>
						<span class="pop-check" class:off={!c.active}><CheckIcon size={16} /></span>
					</button>
				{/each}
			</div>
			<p class="routes-note">{routeRow.groupsPage ? t('chat.groupRouteNote') : t('chat.routeNote')}</p>
		</section>
	{/if}
</div>

<style>
	.mm-backdrop {
		position: fixed;
		inset: 0;
		z-index: 20;
		border: none;
		background: none;
		cursor: default;
	}
	/* Fixed to the viewport: tiles clip their content, so an anchored child
	   would be cut at split boundaries. */
	.mm {
		position: fixed;
		z-index: 21;
		width: min(340px, calc(100vw - 24px));
		max-height: min(72vh, 620px);
		/* Taller than that (switches, providers): the menu scrolls rather than
		   running over the composer. */
		overflow-y: auto;
		overscroll-behavior: contain;
		/* It sits in the composer's bar, which keeps its own row on one line. */
		white-space: normal;
		gap: 0;
		padding: 6px;
		transform-origin: bottom right;
		animation: pop-in var(--t-pop) var(--ease-enter);
	}
	/* GroupPicker renders its own section, hence :global. */
	.mm > :global(section + section) {
		margin-top: 4px;
		padding-top: 5px;
		border-top: 1px solid var(--hairline);
	}
	.routes-n {
		flex-shrink: 0;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.routes .pop-label {
		font-weight: 600;
	}
	.routes-note {
		margin: 4px 8px 2px;
		color: var(--dim2);
		font-size: var(--fs-xs);
		line-height: 1.5;
	}
	.current .pop-row {
		font-weight: 500;
	}
	.pop-row.static {
		cursor: default;
	}
	.caret {
		width: auto;
		color: var(--dim2);
	}
	.mhead {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0 2px 6px;
	}
	.mtitle {
		color: var(--dim);
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.manage {
		margin-left: auto;
		padding: 2px 6px;
		border: none;
		border-radius: var(--r-xs);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.manage:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.agents {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 2px;
	}
	.agent {
		display: inline-flex;
		flex: 1 1 auto;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: 32px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		white-space: nowrap;
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.agent:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.agent.on {
		background: var(--surface2);
		color: var(--text);
		font-weight: 500;
	}
	.agent:disabled {
		cursor: default;
	}
	.models {
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0 2px 6px;
		padding: 0 10px;
		height: 34px;
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--dim2);
	}
	.search input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		outline: none;
	}
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 0;
		overflow-y: auto;
	}
	.group {
		padding: 8px 12px 4px;
		color: var(--dim2);
		font-size: var(--fs-2xs);
		font-weight: 500;
	}
	/* Name and detail ("This machine · LynShen · 258K") share one line. WebKit
	   (the macOS app) does not wrap text inside the row button, so both
	   truncate instead of overlapping; the detail gives way before the name. */
	.mm .pop-txt {
		flex: 1 1 auto;
	}
	.mm .pop-label {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	/* Second line of a model row: group · channel · window. */
	/* Keep the check's column so names and context line up on every row. */
	.pop-check.off {
		visibility: hidden;
	}
	/* The check lands on a newly picked model. */
	.pop-check:not(.off) :global(svg) {
		animation: pop-in var(--t-pop) var(--ease-enter);
	}
	.empty {
		padding: 14px 12px;
		color: var(--dim2);
		font-size: var(--fs-sm);
	}
</style>
