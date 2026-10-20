<script lang="ts">
	import { popOut } from '$lib/ui/motion';
	import { onMount, tick } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import CaretLeftIcon from 'phosphor-svelte/lib/CaretLeftIcon';
	import IconButton from '$lib/ui/IconButton.svelte';
	import SessionSwitches, { type SessionSwitch } from '$lib/composer/SessionSwitches.svelte';
	import BackendIcon from '$lib/BackendIcon.svelte';
	import QuickSwitcher from '$lib/models/QuickSwitcher.svelte';
	import ModelBrowser from '$lib/models/ModelBrowser.svelte';
	import { itemsFromRows } from '$lib/models/items';
	import { gatewayCatalog } from '$lib/models/catalogStore.svelte';
	import { factsOptions, onTrial, refreshCatalog } from '$lib/models/pickerState.svelte';
	import { pick } from '$lib/models/pick';
	import type { PickItem } from '$lib/models/catalog';
	import { acpAgentsList, checkBackend, type AcpAgent } from '$lib/protocol';
	import { loadBackendSettings, versionLabel } from '$lib/backends/settings';
	import { isOpencodeAgent } from '$lib/backends/acp-agents';
	import { CAPS, NATIVE_BACKEND_IDS, BACKEND_LABELS, type AcpAgentRef, type BackendId } from '$lib/backends';
	import { t } from '$lib/i18n';
	import type { ChatState } from '$lib/chat.svelte';
	import { stripGroupSuffix, type ModelRow } from './modelRows';
	import GroupPicker, { loadGroups, type ToolProvider } from './GroupPicker.svelte';
	import { readConfig, writeConfig, type LynShenGroup } from '$lib/protocol';
	import { toast } from '$lib/ui/toast.svelte';
	import { modelSetup } from '$lib/modelSetupState.svelte';

	// The composer's model menu, opened from the model button: everything about
	// "who answers and how hard it thinks" in one place. On top, the quick
	// switcher (src/lib/models): the few models the user is likely to want,
	// and 全部模型… for the full browser (a dialog; typing opens it with the
	// text). Under it the session switches, the provider (gateway group or
	// this machine) and, while the session can still switch, the coding agent.
	// A model several gateway Providers serve has a route page.
	// (The plan quota is in the context ring's card.)
	let {
		chat,
		canPickModel = false,
		rows = [],
		backendLocked = true,
		toolProvider,
		effortDisabled = false,
		anchor,
		onClose,
		onSelect,
		onEffort,
		onSwitch,
		onBackend,
		onRefreshModels,
		onContinueOnLynShen,
		gateway = null
	}: {
		chat: ChatState;
		/** The engine has a model catalog (not ACP agents). */
		canPickModel?: boolean;
		rows?: ModelRow[];
		/** Locked sessions (restored / first user turn sent) can't change agent. */
		backendLocked?: boolean;
		/** A Claude Code / Codex session: where its model runs (`model` is the
		 *  gateway's name for it) and how to change that. */
		toolProvider?: ToolProvider & { model: string };
		effortDisabled?: boolean;
		anchor?: HTMLElement;
		onClose: () => void;
		onSelect: (command: string) => void;
		onEffort: (effort: string) => void;
		onSwitch: (name: SessionSwitch, on: boolean) => void;
		onBackend?: (b: BackendId, acpAgent?: AcpAgentRef) => void | Promise<void>;
		/** Re-request the model catalog (after an agent switch). */
		onRefreshModels: () => void;
		/** A Claude Code / Codex conversation that has started: continue it in
		 *  a new LynShen conversation (ticket #40). */
		onContinueOnLynShen?: () => void;
		/** An OpenCode session: whether it runs on the LynShen gateway (null:
		 *  no gateway switch here). */
		gateway?: boolean | null;
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
	// Rows arrive after the catalog request; keep the menu anchored as it
	// grows. The popover is drawn anew when the browser closes for a route
	// page: the new one is observed.
	$effect(() => {
		const el = popEl;
		if (!el) return;
		tick().then(position);
		const ro = new ResizeObserver(position);
		ro.observe(el);
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
			await onBackend?.('acp', { id: agent.id, name: agent.name, ...(isOpencodeAgent(agent) ? { opencode: true } : {}) });
		} finally {
			switching = false;
		}
	}

	let page = $state<'main' | 'routes'>('main');
	/** The full browser is open, with this query. */
	let browsing = $state<string | null>(null);
	// The rows as the model components list them, described by the gateway
	// catalog where it knows the model (read again when older than a minute).
	// A chat picker lists models that chat: image models are set in
	// Settings → 图片生成 (one already in use still shows).
	const items = $derived(itemsFromRows(rows, gatewayCatalog.lookup).filter((i) => !i.drawsImages || i.active));
	const facts = $derived(factsOptions());
	const trial = $derived(onTrial());
	onMount(refreshCatalog);
	const rowOf = (item: PickItem) => rows.find((r) => r.command === item.value);
	function pickItem(item: PickItem) {
		void pick(item, (picked) => {
			const row = rowOf(picked);
			// A row with routes picks its chosen one; its page offers the others.
			onSelect(row?.command ?? picked.value);
		});
	}
	function routesOf(item: PickItem) {
		const row = rowOf(item);
		if (!row) return;
		browsing = null;
		openRow(row);
	}
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
	/** The route page's model, by its full name. */
	const routeName = $derived(routeRow ? (items.find((i) => i.value === routeRow?.command)?.name ?? routeRow.label) : '');
	const modelName = $derived(rows.find(row => row.active)?.label || stripGroupSuffix(chat.modelLabel || '') || chat.model || BACKEND_LABELS[chat.backendId]);
</script>

{#if browsing !== null}
	<ModelBrowser
		{items}
		{trial}
		{facts}
		query={browsing}
		onPick={pickItem}
		onRoutes={routesOf}
		{onClose}
		manage={chat.backendId === 'lynshen'
			? {
					label: t('chat.manageModels'),
					onClick: () => {
						modelSetup.open = true;
						onClose();
					}
				}
			: undefined}
	/>
{:else}
<button class="mm-backdrop" aria-label={t('common.close')} tabindex="-1" onclick={onClose}></button>
<div class="pop mm" role="dialog" out:popOut|global aria-label={t('chat.switchModel')} bind:this={popEl} style:left="{popLeft}px" style:top="{popTop}px">
	{#if page === 'main'}
		<section class="current">
			{#if canPickModel}
				<QuickSwitcher {items} {trial} {facts} onPick={pickItem} onBrowse={(q) => (browsing = q)} onRoutes={routesOf} />
			{:else}
				<div class="pop-row static">
					<span class="pop-ico"><BackendIcon backend={chat.backendId} size={15} /></span>
					<span class="pop-txt"><span class="pop-label">{modelName}</span></span>
				</div>
			{/if}
		</section>


		<SessionSwitches {chat} {onSwitch} thinking={false} {gateway} />

		{#if chat.backendId === 'lynshen' && chat.provider === 'lynshen' && chat.model}
			{#key chat.model}<GroupPicker model={chat.model} />{/key}
		{:else if toolProvider}
			{#key toolProvider.model}<GroupPicker model={toolProvider.model} tool={toolProvider} />{/key}
		{/if}

		{#if backendLocked && onContinueOnLynShen}
			<section class="carry" role="group" aria-label={t('chat.continueOnLynShen')}>
				<button class="agent" onclick={() => (onClose(), onContinueOnLynShen())} title={t('chat.continueOnLynShenHint')}>
					<BackendIcon backend="lynshen" size={15} /><span>{t('chat.continueOnLynShen')}</span>
				</button>
			</section>
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
	{:else if routeRow}
		<section class="models routes">
			<div class="mhead">
				<IconButton size="sm" label={t('shell.remote.back')} title={t('shell.remote.back')} onclick={() => (page = 'main')}>
					<CaretLeftIcon size={14} />
				</IconButton>
				<span class="mtitle">{t('chat.routeTitle', { model: routeName })}</span>
			</div>
			<div class="list" role="listbox" aria-label={t('chat.routeTitle', { model: routeName })}>
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
{/if}

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
		/* Wide enough for most names on one line; a longer one wraps. */
		width: min(380px, calc(100vw - 24px));
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
	.carry {
		display: flex;
		padding: 2px;
		border-top: 1px solid var(--hairline);
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
	.list {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-height: 0;
		overflow-y: auto;
	}
	/* Keep the check's column so names and context line up on every row. */
	.pop-check.off {
		visibility: hidden;
	}
	/* The check lands on a newly picked model. */
	.pop-check:not(.off) :global(svg) {
		animation: pop-in var(--t-pop) var(--ease-enter);
	}
</style>
