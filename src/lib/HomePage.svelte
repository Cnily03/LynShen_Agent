<script lang="ts">
	import { paneOut } from '$lib/ui/motion';
	// The home page, as in Codex: a box to start a new conversation, then the
	// agents, the projects and the most recent conversations (in a project or
	// not). It covers the canvas; the sidebar stays.
	import ArrowUpIcon from 'phosphor-svelte/lib/ArrowUpIcon';
	import FolderIcon from 'phosphor-svelte/lib/FolderIcon';
	import FolderPlusIcon from 'phosphor-svelte/lib/FolderPlusIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import ChatCircleIcon from 'phosphor-svelte/lib/ChatCircleIcon';
	import { t } from '$lib/i18n';
	import { shownTitle } from '$lib/chat.svelte';
	import { listedSessions } from '$lib/session.svelte';
	import { lastActive, type Project, type Session } from '$lib/types';
	import type { AgentView } from '$lib/agents.svelte';
	import AgentAvatar from '$lib/AgentAvatar.svelte';
	import SessionMark from '$lib/SessionMark.svelte';
	import { sessionStatus } from '$lib/sessionStatus';
	import CaretDownIcon from 'phosphor-svelte/lib/CaretDownIcon';
	import Vendor from '$lib/Vendor.svelte';
	import { readConfig } from '$lib/protocol';
	import { configModelList } from '$lib/configModels';
	import { isImageModel } from '$lib/providers/monoize';
	import QuickSwitcher from '$lib/models/QuickSwitcher.svelte';
	import ModelBrowser from '$lib/models/ModelBrowser.svelte';
	import { itemsFromOptions } from '$lib/models/items';
	import { gatewayCatalog } from '$lib/models/catalogStore.svelte';
	import { factsOptions, onTrial } from '$lib/models/pickerState.svelte';
	import { pick as pickModel } from '$lib/models/pick';

	let {
		projects,
		agents = [],
		agentsOn = false,
		onStart,
		onOpenSession,
		onOpenProject,
		onAddProject,
		onOpenAgent,
		modelPicker = false
	}: {
		projects: Project[];
		agents?: AgentView[];
		/** The daemon is reachable, so agents can be listed and made. */
		agentsOn?: boolean;
		/** A new conversation outside any project, with its first message
		 *  and the model picked for it (none: the engine's current one). */
		onStart: (text: string, model?: string) => void;
		onOpenSession: (id: string) => void;
		onOpenProject: (p: Project) => void;
		onAddProject: () => void;
		onOpenAgent: (agent: AgentView) => void;
		/** New conversations run on the native engine: its models can be
		 *  picked here, before there is a conversation to pick them in. */
		modelPicker?: boolean;
	} = $props();

	// The engine's models as config.json lists them (what its model menu
	// shows), the current one first chosen. Reread each time the page shows.
	type HomeModel = { name: string; label: string; window: number; efforts?: string[] };
	let models = $state<HomeModel[]>([]);
	let provider = $state('');
	let model = $state('');
	let picked = $state(false);
	let menuOpen = $state(false);
	$effect(() => {
		if (!modelPicker) return;
		readConfig()
			.then((cfg) => {
				models = configModelList(cfg)
					.filter((m) => !isImageModel(String(m.name)))
					.map((m) => ({
						name: String(m.name),
						label: typeof m.display_name === 'string' && m.display_name ? m.display_name : String(m.name),
						window: typeof m.context_window === 'number' ? m.context_window : 0,
						efforts: Array.isArray(m.reasoning_efforts) ? (m.reasoning_efforts as string[]) : undefined
					}));
				provider = typeof cfg.provider === 'string' ? cfg.provider : '';
				const current = typeof cfg.model === 'string' ? cfg.model : '';
				if (!picked || !models.some((m) => m.name === model))
					model = models.some((m) => m.name === current) ? current : (models[0]?.name ?? '');
			})
			.catch(() => {});
	});
	const shownModel = $derived(models.find((m) => m.name === model));
	// The same pickers as the composer's (src/lib/models): the quick
	// switcher, and the full browser from it.
	const items = $derived(
		itemsFromOptions(
			models.map((m) => ({ provider, name: m.name, display_name: m.label, context_window: m.window, reasoning_efforts: m.efforts })),
			model,
			gatewayCatalog.lookup
		)
	);
	const shownItem = $derived(items.find((i) => i.value === model));
	let browsing = $state<string | null>(null);
	// Escape closes the model list (the browser dialog closes itself).
	function onWindowKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || !menuOpen || browsing !== null) return;
		e.preventDefault();
		menuOpen = false;
		box?.focus();
	}
	function chooseModel(item: (typeof items)[number]) {
		void pickModel(item, (chosen) => {
			model = chosen.value;
			picked = true;
			menuOpen = false;
			browsing = null;
			box?.focus();
		});
	}

	let text = $state('');
	let box = $state<HTMLTextAreaElement | null>(null);
	$effect(() => {
		box?.focus();
	});
	function start() {
		const message = text.trim();
		if (!message) return;
		text = '';
		onStart(message, modelPicker && picked && model ? model : undefined);
	}
	function onKey(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
			e.preventDefault();
			start();
		}
	}

	const codeProjects = $derived(projects.filter((p) => !p.chats && !p.home));
	const RECENT = 8;
	const recent = $derived(
		projects
			.filter((p) => !p.chats && !p.stale)
			.flatMap((p) => listedSessions(p).map((s) => ({ s, p })))
			.filter((x) => !x.s.draft || x.s.chat.messages.length > 0)
			.map((x, i) => ({ ...x, i, at: lastActive(x.s) }))
			.sort((a, b) => b.at - a.at || a.i - b.i)
			.slice(0, RECENT)
	);

	/** "3 分钟前" style, from the session's last activity. */
	function ago(at: number): string {
		if (!at) return '';
		const minutes = Math.round((Date.now() - at) / 60_000);
		if (minutes < 1) return t('shell.home.justNow');
		if (minutes < 60) return t('shell.home.minutesAgo', { n: minutes });
		const hours = Math.round(minutes / 60);
		if (hours < 24) return t('shell.home.hoursAgo', { n: hours });
		return new Date(at).toLocaleDateString();
	}
	const count = (p: Project) => p.sessions.filter((s: Session) => !s.archived).length;
</script>

<svelte:window onkeydown={onWindowKey} />
<div class="home-page" out:paneOut|global>
	<div class="col">
		<h1>{t('shell.home.greeting')}</h1>
		<div class="start">
			<textarea
				bind:this={box}
				bind:value={text}
				class:below={modelPicker && !!shownModel}
				rows="3"
				placeholder={t('chat.composerPlaceholder')}
				onkeydown={onKey}
			></textarea>
			{#if modelPicker && shownModel}
				<div class="model-anchor">
					<button
						class="model"
						class:on={menuOpen}
						onclick={() => {
							menuOpen = !menuOpen;
							if (menuOpen) void gatewayCatalog.refreshIfStale();
						}}
						title={t('shell.home.model')}
						aria-haspopup="dialog"
						aria-expanded={menuOpen}
					>
						<Vendor model={shownModel.name} size={14} />
						<span class="mname">{shownItem?.name ?? shownModel.label}</span>
						<CaretDownIcon size={12} />
					</button>
					{#if menuOpen && browsing === null}
						<button class="model-backdrop" aria-label={t('common.close')} tabindex="-1" onclick={() => (menuOpen = false)}></button>
						<div class="pop model-menu" role="dialog" aria-label={t('shell.home.model')}>
							<QuickSwitcher {items} trial={onTrial()} facts={factsOptions()} onPick={chooseModel} onBrowse={(q) => (browsing = q)} />
						</div>
					{/if}
					{#if menuOpen && browsing !== null}
						<ModelBrowser
							{items}
							trial={onTrial()}
							facts={factsOptions()}
							query={browsing}
							onPick={chooseModel}
							onClose={() => {
								menuOpen = false;
								browsing = null;
							}}
						/>
					{/if}
				</div>
			{/if}
			<button class="send" disabled={!text.trim()} onclick={start} aria-label={t('chat.sendTitle')} title={t('chat.sendTitle')}>
				<ArrowUpIcon size={16} weight="bold" />
			</button>
		</div>

		{#if agentsOn && agents.length}
			<section>
				<div class="head">
					<h2>{t('shell.home.agents')}</h2>
				</div>
				{#if agents.length}
					<div class="grid">
						{#each agents as a (a.id)}
							<button class="card" onclick={() => onOpenAgent(a)}>
								<AgentAvatar agent={a} size={22} />
								<span class="card-txt">
									<span class="card-title">{a.name}</span>
									{#if a.summary}<span class="card-sub">{a.summary}</span>{/if}
								</span>
							</button>
						{/each}
					</div>
				{:else}
					<p class="empty">{t('shell.home.empty')}</p>
				{/if}
			</section>
		{/if}

		<section>
			<div class="head">
				<h2>{t('shell.home.projects')}</h2>
				<button class="act" onclick={onAddProject}><FolderPlusIcon size={14} />{t('shell.home.openProject')}</button>
			</div>
			{#if codeProjects.length}
				<div class="grid">
					{#each codeProjects as p (p.id)}
						<button class="card" class:stale={p.stale} onclick={() => onOpenProject(p)} title={p.path}>
							<FolderIcon size={20} color={p.color} />
							<span class="card-txt">
								<span class="card-title">{p.name}</span>
								<span class="card-sub">{t('shell.home.sessions', { n: count(p) })}</span>
							</span>
						</button>
					{/each}
				</div>
			{:else}
				<p class="empty">{t('shell.home.empty')}</p>
			{/if}
		</section>

		<section>
			<div class="head"><h2>{t('shell.home.recent')}</h2></div>
			{#if recent.length}
				<div class="list">
					{#each recent as x (x.s.id)}
						<button class="item" onclick={() => onOpenSession(x.s.id)}>
							<ChatCircleIcon size={16} />
							<span class="item-title">{shownTitle(x.s.chat.title)}</span>
							<SessionMark status={sessionStatus(x.s.chat)} />
							<span class="item-where">{x.p.home ? t('shell.home.standalone') : x.p.name}</span>
							<span class="item-at">{ago(x.at)}</span>
						</button>
					{/each}
				</div>
			{:else}
				<p class="empty">{t('shell.home.noChats')}</p>
			{/if}
		</section>
	</div>
</div>

<style>
	.home-page {
		position: absolute;
		inset: 0;
		z-index: 10;
		overflow-y: auto;
		background: var(--bg);
		animation: pane-in var(--t-med) var(--ease-out);
	}
	.col {
		max-width: 760px;
		margin: 0 auto;
		padding: 72px 32px 80px;
	}
	h1 {
		margin: 0 0 20px;
		font-size: var(--fs-xl);
		font-weight: 600;
		letter-spacing: -0.01em;
		color: var(--text);
		text-align: center;
	}
	.start {
		position: relative;
		border: 1px solid var(--border);
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: var(--shadow-sm, none);
	}
	.start:focus-within {
		border-color: var(--border-strong, var(--border));
	}
	textarea {
		display: block;
		width: 100%;
		min-height: 88px;
		padding: 14px 52px 14px 16px;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-md);
		line-height: 1.5;
		resize: none;
		outline: none;
	}
	textarea::placeholder {
		color: var(--dim2);
	}
	textarea.below {
		padding-bottom: 48px;
	}
	/* The model, at the box's bottom left (the send button is at the right). */
	.model-anchor {
		position: absolute;
		left: 10px;
		bottom: 10px;
	}
	.model {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		max-width: 320px;
		height: 30px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r-full);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-base), color var(--t-fast) var(--ease-base);
	}
	.model:hover,
	.model.on {
		background: var(--accent-soft);
		color: var(--text);
	}
	.mname {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.model-backdrop {
		position: fixed;
		inset: 0;
		z-index: 80;
		border: none;
		background: none;
		cursor: default;
	}
	.model-menu {
		position: absolute;
		left: 0;
		top: calc(100% + 6px);
		z-index: 81;
		width: min(380px, calc(100vw - 32px));
		max-height: min(440px, 60vh);
		overflow-y: auto;
		overscroll-behavior: contain;
		transform-origin: top left;
		animation: pop-in var(--t-pop) var(--ease-enter);
	}
	.send {
		position: absolute;
		right: 10px;
		bottom: 10px;
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--r-full);
		background: var(--text);
		color: var(--bg);
		cursor: pointer;
	}
	.send:disabled {
		opacity: 0.3;
		cursor: default;
	}
	section {
		margin-top: 36px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 10px;
	}
	h2 {
		margin: 0;
		font-size: var(--fs-sm);
		font-weight: 600;
		color: var(--dim);
	}
	.act {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-xs);
		cursor: pointer;
	}
	.act:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 8px;
	}
	.card {
		display: flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		padding: 12px 14px;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.card:hover {
		background: var(--surface);
	}
	.card.stale {
		opacity: 0.55;
	}
	.card > :global(svg) {
		flex-shrink: 0;
		color: var(--dim);
	}
	.card-txt {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.card-title,
	.card-sub,
	.item-title {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.card-title {
		font-size: var(--fs-sm);
	}
	.card-sub {
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.list {
		display: flex;
		flex-direction: column;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		min-height: 40px;
		padding: 0 10px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
	}
	.item:hover {
		background: var(--surface);
	}
	.item > :global(svg) {
		flex-shrink: 0;
		color: var(--dim);
	}
	.item-title {
		flex: 1;
		min-width: 0;
	}
	.item-where,
	.item-at {
		flex-shrink: 0;
		color: var(--dim2);
		font-size: var(--fs-xs);
	}
	.item-where {
		max-width: 30%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.item-at {
		min-width: 64px;
		text-align: right;
	}
	.empty {
		margin: 0;
		padding: 6px 2px;
		color: var(--dim2);
		font-size: var(--fs-sm);
	}
</style>
