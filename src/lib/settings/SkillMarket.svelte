<script lang="ts">
	// Settings → 技能 → 技能市场: the daemon's catalog (Anthropic's skills and
	// community repositories) on the page itself. Sources and tags filter it,
	// the page's search box narrows it, and each skill installs into or
	// uninstalls from the chosen engine's personal folder. A failed install or
	// uninstall shows on its own item.
	//
	// The engine answers at once from its cache and reads stale sources again
	// in the background (`refreshing`); the page shows what it has, then asks
	// again with `wait` for the refreshed catalog. A source that cannot be
	// read is a warning of its own. A first answer that takes too long (an
	// older engine reads every source first) turns into an error with a retry;
	// if it still comes, it is shown.
	import { onMount, untrack } from 'svelte';
	import DownloadSimpleIcon from 'phosphor-svelte/lib/DownloadSimpleIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import ArrowSquareOutIcon from 'phosphor-svelte/lib/ArrowSquareOutIcon';
	import {
		fetchMarketplace,
		installMarketplaceSkill,
		isUnknownOp,
		uninstallSkill,
		type MarketSkill,
		type MarketSourceState,
		type SkillBackend,
		type SkillCatalog
	} from '$lib/protocol';
	import {
		CATALOG_REFRESH_TIMEOUT_MS,
		CATALOG_TIMEOUT_MS,
		filterMarket,
		homeOf,
		marketKey,
		marketSources,
		marketTags,
		pendingSources,
		sourceProblems,
		tildePath,
		withTimeout
	} from '$lib/skills';
	import { when } from '$lib/time';
	import { openExternal } from '$lib/openExternal';
	import { confirm } from '$lib/ui/confirm.svelte';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Chip from '$lib/ui/Chip.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { getLocale, t } from '$lib/i18n';

	let {
		backend,
		query,
		onChange
	}: {
		backend: SkillBackend;
		/** The page's search text. */
		query: string;
		/** A skill was installed or uninstalled (the installed list is stale). */
		onChange?: () => void;
	} = $props();

	let skills = $state<MarketSkill[]>([]);
	/** The first answer is awaited. */
	let loading = $state(true);
	/** The engine is reading sources again; a `wait` request is out. */
	let refreshing = $state(false);
	let error = $state('');
	let warnings = $state<string[]>([]);
	/** Per-source state; undefined from an engine that does not report it. */
	let sourceStates = $state<MarketSourceState[] | undefined>(undefined);
	let installDir = $state('');
	let source = $state('all');
	let tag = $state('');
	/** In-flight installs and uninstalls, and the last failure of each item. */
	let busy = $state<Record<string, boolean>>({});
	let failed = $state<Record<string, string>>({});

	const sources = $derived(marketSources(skills));
	const tags = $derived(marketTags(skills, source));
	const installedCount = $derived(skills.filter((s) => s.installed).length);
	const shown = $derived(filterMarket(skills, { query, source, tag }));
	// With every source shown, one block per source (Anthropic first), as a
	// store groups its shelves; a chosen source or the installed ones are one.
	const blocks = $derived(
		source === 'all'
			? sources.map((src) => ({ key: src.key, name: src.name, items: shown.filter((s) => s.source === src.key) })).filter((b) => b.items.length)
			: [{ key: source, name: '', items: shown }]
	);
	const restricted = $derived(shown.some((s) => !s.redistributable));
	const problems = $derived(sourceProblems(sourceStates));
	const pending = $derived(pendingSources(sourceStates, refreshing));

	/** Answers for an earlier engine or load are dropped. */
	let generation = 0;

	function show(catalog: SkillCatalog) {
		skills = catalog.skills;
		warnings = catalog.warnings ?? [];
		sourceStates = catalog.sources;
		installDir = catalog.installDir;
		if (source !== 'all' && source !== 'installed' && !catalog.skills.some((s) => s.source === source)) source = 'all';
	}

	/** The catalog as the engine has it; `refresh` reads every source again. */
	async function load(refresh = false) {
		const run = ++generation;
		loading = true;
		refreshing = false;
		error = '';
		const timer = setTimeout(() => {
			if (run !== generation || !loading) return;
			loading = false;
			error = t('settings.marketplace.timeout');
		}, CATALOG_TIMEOUT_MS);
		try {
			const catalog = await fetchMarketplace(backend, { refresh });
			if (run !== generation) return;
			show(catalog);
			error = '';
			if (catalog.refreshing) void follow(run);
		} catch (e) {
			if (run === generation) error = t('settings.marketplace.loadFailed', { error: e instanceof Error ? e.message : String(e) });
		} finally {
			clearTimeout(timer);
			if (run === generation) loading = false;
		}
	}

	/** Waits for the engine's background refresh, then shows its result. */
	async function follow(run: number) {
		refreshing = true;
		try {
			const catalog = await withTimeout(fetchMarketplace(backend, { wait: true }), CATALOG_REFRESH_TIMEOUT_MS);
			if (run === generation) show(catalog);
		} catch {
			// What is shown stays; each source's own state says the rest.
		} finally {
			if (run === generation) refreshing = false;
		}
	}
	onMount(() => void load());
	// The target engine changed: its folder decides what counts as installed.
	let loadedFor = untrack(() => backend);
	$effect(() => {
		if (backend !== loadedFor) {
			loadedFor = backend;
			untrack(() => void load());
		}
	});

	function pickSource(key: string) {
		source = key;
		if (tag && !marketTags(skills, key).includes(tag)) tag = '';
	}

	async function install(s: MarketSkill) {
		const key = marketKey(s);
		busy[key] = true;
		delete failed[key];
		try {
			await installMarketplaceSkill(s.source, s.id, backend);
			s.installed = true;
			onChange?.();
		} catch (e) {
			failed[key] = t('settings.marketplace.installFailed', { msg: e instanceof Error ? e.message : String(e) });
		} finally {
			busy[key] = false;
		}
	}

	async function uninstall(s: MarketSkill) {
		const ok = await confirm({
			title: t('settings.marketplace.uninstallTitle', { name: s.name }),
			message: t('settings.marketplace.uninstallMessage', { path: installDir }),
			confirmLabel: t('settings.marketplace.uninstall'),
			danger: true
		});
		if (!ok) return;
		const key = marketKey(s);
		busy[key] = true;
		delete failed[key];
		try {
			await uninstallSkill({ skill: s.id }, backend);
			s.installed = false;
			onChange?.();
		} catch (e) {
			failed[key] = isUnknownOp(e, 'skill_uninstall')
				? t('settings.marketplace.needsEngine')
				: t('settings.marketplace.uninstallFailed', { msg: e instanceof Error ? e.message : String(e) });
		} finally {
			busy[key] = false;
		}
	}

	function problemText(p: (typeof problems)[number]) {
		return p.kind === 'cached' && p.fetchedAt
			? t('settings.marketplace.sourceCached', { source: p.name, time: when(p.fetchedAt) })
			: t('settings.marketplace.sourceEmpty', { source: p.name });
	}

	/** `Ikaleio: <error>` from an engine without per-source state → a
	 *  sentence naming the source. */
	function warningText(w: string) {
		if (w.includes('401') || w.toLowerCase().includes('unauth')) return t('settings.marketplace.needLogin');
		const at = w.indexOf(': ');
		return at > 0 ? t('settings.marketplace.sourceFailed', { source: w.slice(0, at), error: w.slice(at + 2) }) : w;
	}
</script>

<div class="market">
	<div class="intro">
		<p>{installDir ? t('settings.marketplace.intro', { path: tildePath(installDir, homeOf({ dirs: [{ scope: 'user', path: installDir }] })) }) : ''}</p>
		<IconButton size="sm" title={t('settings.skills.refresh')} disabled={loading || refreshing} onclick={() => load(true)}>
			{#if loading || refreshing}<CircleNotchIcon size={16} class="spin" />{:else}<ArrowsClockwiseIcon size={16} />{/if}
		</IconButton>
	</div>

	{#if error}
		<Notice>
			<span class="err-line">
				<span>{error}</span>
				<Button size="sm" variant="secondary" onclick={() => load()}>{t('common.retry')}</Button>
			</span>
		</Notice>
	{/if}
	{#if refreshing}
		<p class="refreshing" role="status">
			<CircleNotchIcon size={13} class="spin" />
			{pending.length ? t('settings.marketplace.pending', { sources: pending.join(getLocale() === 'zh' ? '、' : ', ') }) : t('settings.marketplace.refreshing')}
		</p>
	{/if}
	{#if sourceStates}
		{#each problems as p (p.key)}
			<Notice tone="warn">
				{problemText(p)}
				<span class="detail">{p.error}</span>
			</Notice>
		{/each}
	{:else}
		{#each warnings as w (w)}
			<Notice tone="warn">{warningText(w)}</Notice>
		{/each}
	{/if}

	{#if skills.length}
		<div class="filters">
			<div class="chips" role="group" aria-label={t('settings.marketplace.sourceFilter')}>
				<Chip selected={source === 'all'} onclick={() => pickSource('all')}>{t('settings.marketplace.all')}<span class="n">{skills.length}</span></Chip>
				{#each sources as src (src.key)}
					<Chip selected={source === src.key} onclick={() => pickSource(src.key)}>{src.name}<span class="n">{src.count}</span></Chip>
				{/each}
				<Chip selected={source === 'installed'} onclick={() => pickSource('installed')}>{t('settings.marketplace.installed')}<span class="n">{installedCount}</span></Chip>
			</div>
			{#if tags.length}
				<div class="chips tags" role="group" aria-label={t('settings.marketplace.tagFilter')}>
					<Chip selected={tag === ''} onclick={() => (tag = '')}>{t('settings.marketplace.allTags')}</Chip>
					{#each tags as tg (tg)}
						<Chip selected={tag === tg} onclick={() => (tag = tag === tg ? '' : tg)}>{tg}</Chip>
					{/each}
				</div>
			{/if}
		</div>
	{/if}

	{#if loading && !skills.length}
		<div class="state"><CircleNotchIcon size={18} class="spin" /> {t('common.loading')}</div>
	{:else if !shown.length && !error}
		<div class="state">{t('settings.marketplace.noMatch')}</div>
	{:else}
		{#each blocks as b (b.key)}
			<section class="block">
				{#if b.name}<h3>{b.name}<span class="n">{b.items.length}</span></h3>{/if}
				<div class="grid">
					{#each b.items as s (marketKey(s))}
						{@const key = marketKey(s)}
						<div class="item" class:installed={s.installed}>
							<div class="text">
								<div class="top">
									<span class="name" title={s.id}>{s.name}</span>
									{#if source !== 'all'}<span class="src">{s.sourceName || s.source}</span>{/if}
								</div>
								<p class="desc" title={s.description}>{s.description}</p>
								{#if failed[key]}
									<p class="fail" role="alert">{failed[key]}</p>
								{:else if !s.redistributable}
									<p class="restricted">{t('settings.marketplace.sourceAvailable')}</p>
								{:else if s.tags.length}
									<p class="tagline">{s.tags.slice(0, 3).join(' · ')}</p>
								{/if}
							</div>
							<div class="acts">
								{#if s.homepage}
									<span class="hover-act">
										<IconButton size="sm" title={t('settings.marketplace.homepage')} onclick={() => openExternal(s.homepage)}><ArrowSquareOutIcon size={15} /></IconButton>
									</span>
								{/if}
								{#if busy[key]}
									<Button size="sm" variant="secondary" disabled><CircleNotchIcon size={14} class="spin" /> {t('settings.marketplace.installing')}</Button>
								{:else if s.installed}
									<span class="hover-act">
										<IconButton size="sm" title={t('settings.marketplace.uninstall')} onclick={() => uninstall(s)}><TrashIcon size={15} /></IconButton>
									</span>
									<span class="done"><CheckIcon size={14} /> {t('settings.marketplace.installed')}</span>
								{:else if !s.redistributable}
									<Button size="sm" variant="ghost" disabled>{t('settings.marketplace.notOffered')}</Button>
								{:else}
									<Button size="sm" variant="secondary" onclick={() => install(s)}><DownloadSimpleIcon size={14} /> {t('settings.marketplace.install')}</Button>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/each}
		{#if restricted}<p class="license">{t('settings.marketplace.licenseNotice')}</p>{/if}
	{/if}
</div>

<style>
	.market {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.intro {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.intro p {
		flex: 1;
		min-width: 0;
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.45;
		overflow-wrap: anywhere;
	}
	.err-line {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px 12px;
	}
	.refreshing {
		display: flex;
		align-items: center;
		gap: 6px;
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.detail {
		display: block;
		margin-top: 2px;
		color: var(--dim2);
		font-size: var(--fs-2xs);
		overflow-wrap: anywhere;
	}
	.filters {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.n {
		margin-left: 6px;
		color: var(--dim2);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		font-variant-numeric: tabular-nums;
	}
	.block {
		margin-top: 18px;
	}
	h3 {
		display: flex;
		align-items: baseline;
		margin: 0 0 6px;
		padding-bottom: 8px;
		border-bottom: 1px solid var(--hairline);
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		column-gap: 16px;
		row-gap: 2px;
	}
	.item {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		padding: 10px 10px;
		margin: 0 -10px;
		border-radius: var(--r-md);
		transition: background var(--t-fast) var(--ease-out);
	}
	.item:hover,
	.item:focus-within {
		background: var(--surface2);
	}
	.text {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.top {
		display: flex;
		align-items: baseline;
		gap: 8px;
		min-width: 0;
	}
	.name {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		color: var(--text);
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.src {
		flex-shrink: 0;
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
	.desc {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.45;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}
	.tagline,
	.restricted,
	.fail {
		margin: 2px 0 0;
		font-size: var(--fs-2xs);
		line-height: 1.4;
	}
	.tagline {
		color: var(--dim2);
		font-family: var(--font-mono);
	}
	.restricted {
		color: var(--warn);
	}
	.fail {
		color: var(--err);
		overflow-wrap: anywhere;
	}
	.acts {
		display: flex;
		align-items: center;
		gap: 4px;
		flex-shrink: 0;
	}
	/* Secondary actions show on hover or keyboard focus (design.md). */
	.hover-act {
		display: inline-flex;
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-out);
	}
	.item:hover .hover-act,
	.item:focus-within .hover-act {
		opacity: 1;
	}
	.done {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 0 6px;
		color: var(--dim);
		font-size: var(--fs-xs);
		white-space: nowrap;
	}
	.state {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 40px 0;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	.license {
		margin: 14px 0 0;
		color: var(--dim2);
		font-size: var(--fs-xs);
		line-height: 1.45;
	}
	@media (max-width: 760px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
	}
</style>
