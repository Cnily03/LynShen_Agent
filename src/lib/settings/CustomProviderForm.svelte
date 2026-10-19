<script lang="ts">
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import ArrowCounterClockwiseIcon from 'phosphor-svelte/lib/ArrowCounterClockwiseIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	import Checkbox from '$lib/ui/Checkbox.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { effortLabel } from '$lib/composer/effort';
	import { anthropicV1Suggestion, requestUrl } from '$lib/providers/endpoint';
	import { diffModel } from '$lib/providers/overrides';
	import { configureModel, knownFromListed, mergeKnown, modelFromListed, staysThinking, type KnownModel } from '$lib/providers/discovery';
	import type { ListedModel } from '$lib/protocol';
	import {
		DEFAULT_EFFORTS,
		EFFORT_TIERS,
		MODALITIES,
		SAFE_EFFORTS,
		draftFromModel,
		formatTokens,
		modelEfforts,
		modelFromDraft,
		newModelDraft,
		validBaseUrl,
		validateModel,
		validateProvider,
		type ModelDraft,
		type ModelErrors,
		type ProviderErrors,
		type ProviderModel
	} from './providerFields';

	// The add / edit form of a provider the user configures: its id, wire
	// format, base URL and key, and its models with their window, output cap,
	// thinking, effort tiers and input kinds (providerFields.ts holds the
	// rules). The dialog's footer calls `submit()`.
	// mode 'builtin' sets up a built-in provider (Anthropic, OpenAI…): its id
	// and format are the engine's, an empty base URL or token field keeps the
	// built-in value, its own models cannot be removed (each can go back to
	// its built-in values), and models can be added. The page stores what
	// differs (providers/overrides.ts).
	interface FormState {
		id: string;
		base_url: string;
		format: string;
		key: string;
		models: ProviderModel[];
	}

	let {
		form = $bindable(),
		formats,
		mode = 'create',
		taken = [],
		keyRequired = false,
		keyed = false,
		builtinDefaults,
		showKey = true,
		discover,
		lookup,
		onSubmit
	}: {
		form: FormState;
		formats: { value: string; label: string }[];
		/** 'edit' and 'builtin': the id is fixed and an empty key keeps the saved one. */
		mode?: 'create' | 'edit' | 'builtin';
		/** Ids of the other providers. */
		taken?: string[];
		keyRequired?: boolean;
		/** Edit: a key is saved for this provider. */
		keyed?: boolean;
		/** 'builtin': the provider's built-in base URL and models. */
		builtinDefaults?: { base_url: string; models: ProviderModel[] };
		/** False when the key field is elsewhere (the add dialog's key step). */
		showKey?: boolean;
		/** 获取可用模型: the models the endpoint lists (the page reads them
		 *  through the app, with the typed or the saved key). */
		discover?: (request: { id: string; base_url: string; format: string; key: string }) => Promise<{ models: ListedModel[] }>;
		/** What the model catalogs know about a model name (自动配置). */
		lookup?: (name: string) => KnownModel | undefined;
		onSubmit: (form: FormState) => void;
	} = $props();

	const builtin = $derived(mode === 'builtin');
	/** Tiers for a model that thinks and has none stated. A built-in Chat
	 *  Completions provider gets its default or off, never the generic list:
	 *  the engine lists the tiers each such endpoint documents, and a setting
	 *  it does not take can be a 400. */
	const fallbackTiers = $derived(builtin && form.format === 'chat' ? SAFE_EFFORTS : DEFAULT_EFFORTS);
	/** The built-in version of a model; none for a model the user added. */
	const builtinModel = (name: string) => (builtin ? builtinDefaults?.models.find((m) => m.name === name) : undefined);
	/** A built-in model whose fields the user changed. */
	const changed = (m: ProviderModel) => {
		const original = builtinModel(m.name);
		return !!original && Object.keys(diffModel(original, m)).length > 0;
	};
	const checks = () => ({ taken: mode === 'create' ? taken : [], keyRequired, builtin });

	// The model editor under the list: a new model, or the row at `editAt`.
	let draft = $state<ModelDraft>(newModelDraft());
	let editAt = $state<number | null>(null);
	let modelErrors = $state<ModelErrors>({});
	let tried = $state(false);
	const providerErrors = $derived<ProviderErrors>(tried ? validateProvider(form, checks()) : {});
	const otherNames = $derived(form.models.filter((_, i) => i !== editAt).map((m) => m.name));
	/** The model in the editor is one of the provider's built-in models. */
	const editingBuiltin = $derived(editAt !== null && !!builtinModel(form.models[editAt]?.name ?? ''));

	// Where the engine sends requests for this base URL and format, and the
	// /v1 base to offer when an Anthropic-format URL is only a host. A
	// built-in provider's empty field is its built-in URL.
	const baseUrl = $derived(form.base_url.trim() || (builtin ? (builtinDefaults?.base_url ?? '') : ''));
	const shownUrl = $derived(validBaseUrl(baseUrl) ? requestUrl(form.format, baseUrl) : '');
	const v1Url = $derived(shownUrl ? anthropicV1Suggestion(form.format, baseUrl) : null);

	// 获取可用模型: the endpoint's list, the names picked to add, and a
	// filter for long lists. `note`: what the last 添加 / 自动配置 did.
	let found = $state<{ models: ListedModel[]; picked: string[] } | null>(null);
	/** What the last list said about each model, for 自动配置 after 添加. */
	let listed: Record<string, ListedModel> = {};
	/** What the list and the catalogs know about a model, the list first. */
	const knownAbout = (name: string, m: ListedModel | undefined = listed[name]) => mergeKnown([m && knownFromListed(m), lookup?.(name)]);
	let finding = $state(false);
	let findError = $state('');
	let findFilter = $state('');
	let note = $state('');
	/** 自动配置 left thinking on where a catalog says the model does not think. */
	let keptNote = $state('');
	const inList = (id: string) => form.models.some((m) => m.name === id);
	const shownFound = $derived(
		(found?.models ?? []).filter((m) => !findFilter.trim() || m.id.toLowerCase().includes(findFilter.trim().toLowerCase()))
	);
	const fresh = $derived(shownFound.filter((m) => !inList(m.id)));
	const allPicked = $derived(fresh.length > 0 && fresh.every((m) => found?.picked.includes(m.id)));

	async function findModels() {
		if (!discover || finding) return;
		note = '';
		keptNote = '';
		findError = '';
		if (!validBaseUrl(baseUrl)) {
			findError = t('settings.custom.error.url');
			return;
		}
		finding = true;
		try {
			const { models } = await discover({ id: form.id.trim(), base_url: baseUrl, format: form.format, key: form.key.trim() });
			listed = Object.fromEntries(models.map((m) => [m.id, m]));
			const add = models.filter((m) => !inList(m.id));
			// A short list is picked whole; a long one (OpenRouter) is chosen from.
			found = { models, picked: add.length <= 20 ? add.map((m) => m.id) : [] };
			findFilter = '';
		} catch (e) {
			findError = t('settings.discover.failed', { msg: String(e) });
			found = null;
		} finally {
			finding = false;
		}
	}
	function pick(id: string, on: boolean) {
		if (!found) return;
		found.picked = on ? [...found.picked.filter((p) => p !== id), id] : found.picked.filter((p) => p !== id);
	}
	function pickAll() {
		if (!found) return;
		const ids = fresh.map((m) => m.id);
		found.picked = allPicked ? found.picked.filter((p) => !ids.includes(p)) : [...new Set([...found.picked, ...ids])];
	}
	function addFound() {
		if (!found) return;
		const picked = found.models.filter((m) => found!.picked.includes(m.id) && !inList(m.id));
		form.models = [...form.models, ...picked.map((m) => modelFromListed(m, knownAbout(m.id, m), fallbackTiers))];
		note = t('settings.discover.added', { n: picked.length });
		keptNote = '';
		found = null;
	}
	/** 自动配置: what the last list and the catalogs say, over every model in
	 *  the list they know. Thinking is never turned off here: a model the
	 *  catalog says does not think keeps it, and the note says how many. */
	function autoConfigure() {
		if (!lookup) return;
		let knownCount = 0;
		let changedCount = 0;
		let keptCount = 0;
		form.models = form.models.map((m) => {
			const known = knownAbout(m.name);
			if (known) knownCount++;
			if (staysThinking(m, known)) keptCount++;
			const next = known ? configureModel(m, known, fallbackTiers) : null;
			if (next) changedCount++;
			return next ?? m;
		});
		if (changedCount && editAt !== null) resetEditor();
		note = changedCount
			? t('settings.discover.configured', { n: changedCount })
			: knownCount
				? t('settings.discover.upToDate')
				: t('settings.discover.nothingKnown');
		keptNote = keptCount ? t('settings.discover.keptThinking', { n: keptCount }) : '';
	}
	/** The second line of a listed model: what adding it would give. */
	function foundDesc(m: ListedModel): string {
		if (inList(m.id)) return t('settings.discover.inList');
		const known = knownAbout(m.id, m);
		if (!known) return t('settings.discover.unknown');
		return summary(modelFromListed(m, known, fallbackTiers));
	}

	const err = (key?: string) => (key ? t(`settings.custom.error.${key}`) : '');
	const tierLabel = (tier: string) =>
		tier === 'none' ? t('settings.custom.effortNone') : tier === 'default' ? t('settings.custom.effortDefault') : effortLabel(tier);

	/** The quiet second line of a model row: window · output · thinking · input,
	 *  after 已修改 / 自己添加 on a built-in provider. */
	function summary(m: ProviderModel): string {
		const efforts = modelEfforts(m);
		const kinds = m.input_modalities?.length ? m.input_modalities : [...MODALITIES];
		return [
			builtin ? (builtinModel(m.name) ? (changed(m) ? t('settings.builtin.changed') : '') : t('settings.builtin.added')) : '',
			m.context_window ? t('settings.custom.summary.window', { n: formatTokens(m.context_window) }) : '',
			m.max_output_tokens ? t('settings.custom.summary.output', { n: formatTokens(m.max_output_tokens) }) : '',
			m.reasoning === false
				? t('settings.custom.summary.noThinking')
				: t('settings.custom.summary.thinking', { tiers: (efforts.length ? efforts : ['—']).map(tierLabel).join(' / ') }),
			kinds.map((kind) => t(`settings.custom.modality.${kind}`)).join(t('settings.custom.summary.and'))
		]
			.filter(Boolean)
			.join(' · ');
	}

	function toggle(list: string[], value: string, on: boolean): string[] {
		return on ? [...list.filter((v) => v !== value), value] : list.filter((v) => v !== value);
	}

	function editModel(i: number) {
		editAt = i;
		draft = draftFromModel(form.models[i], fallbackTiers);
		modelErrors = {};
	}
	function resetEditor() {
		editAt = null;
		draft = newModelDraft();
		modelErrors = {};
	}
	/** A built-in model back to its built-in values. */
	function resetModel(i: number) {
		const original = builtinModel(form.models[i].name);
		if (!original) return;
		form.models = form.models.map((m, j) => (j === i ? { ...original } : m));
		if (editAt === i) resetEditor();
	}
	/** The built-in base URL and models (the dialog's 恢复默认). */
	export function resetDefaults() {
		if (!builtinDefaults) return;
		form.base_url = builtinDefaults.base_url;
		form.models = builtinDefaults.models.map((m) => ({ ...m }));
		resetEditor();
	}
	function removeModel(i: number) {
		form.models = form.models.filter((_, j) => j !== i);
		if (editAt === i) resetEditor();
		else if (editAt !== null && editAt > i) editAt -= 1;
	}
	/** Puts the editor's model into the list; false when it is not valid. */
	function commitModel(): boolean {
		// An empty token field of a built-in model keeps its built-in value.
		const fallback = builtinModel(draft.name.trim());
		modelErrors = validateModel(draft, otherNames, fallback);
		if (Object.keys(modelErrors).length) return false;
		const model = modelFromDraft(draft, editAt === null ? undefined : form.models[editAt], fallback);
		form.models = editAt === null ? [...form.models, model] : form.models.map((m, j) => (j === editAt ? model : m));
		resetEditor();
		return true;
	}

	/** The footer's create / save: a model left in the editor is added first. */
	export function submit() {
		tried = true;
		const pending = draft.name.trim() !== '' || editAt !== null;
		if (pending && !commitModel()) return;
		if (Object.keys(validateProvider(form, checks())).length) return;
		onSubmit(form);
	}
</script>

<div class="newprov">
	{#if !builtin}
	<div class="np-grid">
		<div class="np-f">
			<label class="np-f">
				<span class="cap">{t('settings.custom.providerId')}</span>
				<TextField bind:value={form.id} disabled={mode === 'edit'} placeholder={t('settings.custom.providerIdPlaceholder')} />
			</label>
			{#if providerErrors.id}<span class="np-err" role="alert">{err(providerErrors.id)}</span>{/if}
		</div>
		<div class="np-f">
			<span class="cap">{t('settings.custom.format')}</span>
			<Segmented bind:value={form.format} options={formats} />
		</div>
	</div>
	{/if}
	<div class="np-f">
		<label class="np-f">
			<span class="cap">{t('settings.custom.baseUrl')}</span>
			<TextField bind:value={form.base_url} mono placeholder={builtin ? builtinDefaults?.base_url : 'https://api.example.com/v1'} />
		</label>
		{#if providerErrors.base_url}<span class="np-err" role="alert">{err(providerErrors.base_url)}</span>{/if}
		{#if shownUrl}<span class="np-hint" data-testid="request-url">{t('settings.custom.requestUrl')} <span class="url">{shownUrl}</span></span>{/if}
		{#if builtin && builtinDefaults && baseUrl !== builtinDefaults.base_url}
			<span class="np-hint">{t('settings.builtin.defaultUrl')} <span class="url">{builtinDefaults.base_url}</span></span>
		{/if}
		{#if v1Url}
			<Notice tone="warn">
				<span class="v1">
					<span>{t('settings.custom.bareHost')}</span>
					<Button variant="secondary" size="sm" onclick={() => v1Url && (form.base_url = v1Url)}>{t('settings.custom.useV1', { url: v1Url })}</Button>
				</span>
			</Notice>
		{/if}
	</div>
	{#if showKey}
	<div class="np-f">
		<label class="np-f">
			<span class="cap">{t('settings.custom.apiKey')}</span>
			<TextField bind:value={form.key} type="password" mono placeholder={mode !== 'create' && keyed ? t('settings.custom.apiKeyKeep') : 'sk-…'} />
		</label>
		{#if providerErrors.key}<span class="np-err" role="alert">{err(providerErrors.key)}</span>{/if}
	</div>
	{/if}

	<div class="np-models">
		<div class="mhead">
			<span class="np-label">{t('settings.custom.models')}</span>
			{#if lookup && form.models.length}
				<Button variant="ghost" size="sm" title={t('settings.discover.autoHint')} onclick={autoConfigure}>{t('settings.discover.auto')}</Button>
			{/if}
			{#if discover}
				<Button variant="ghost" size="sm" disabled={finding} onclick={findModels}>
					{#if finding}<CircleNotchIcon size={13} class="spin" />{/if}
					{t('settings.discover.fetch')}
				</Button>
			{/if}
		</div>
		{#if findError}<span class="np-err" role="alert">{findError}</span>{/if}
		{#if note}<span class="np-hint" role="status">{note}</span>{/if}
		{#if keptNote}<span class="np-hint" role="status">{keptNote}</span>{/if}
		{#if found}
			<section class="found" aria-label={t('settings.discover.title')}>
				<span class="np-hint">
					{found.models.length
						? t('settings.discover.count', { n: found.models.length, m: found.models.filter((m) => !!lookup?.(m.id)).length })
						: t('settings.discover.none')}
				</span>
				{#if found.models.length > 12}
					<TextField bind:value={findFilter} placeholder={t('settings.discover.filter')} />
				{/if}
				{#if shownFound.length}
					<ul class="flist">
						{#each shownFound as m (m.id)}
							<li class="frow">
								<Checkbox checked={inList(m.id) || found.picked.includes(m.id)} disabled={inList(m.id)} onchange={(on) => pick(m.id, on)}>
									<span class="mname">{m.id}</span>
								</Checkbox>
								<span class="mdesc">{foundDesc(m)}</span>
							</li>
						{/each}
					</ul>
				{/if}
				<div class="ed-foot">
					<Button variant="ghost" size="sm" onclick={() => (found = null)}>{t('common.cancel')}</Button>
					{#if fresh.length}
						<Button variant="ghost" size="sm" onclick={pickAll}>{allPicked ? t('settings.discover.pickNone') : t('settings.discover.pickAll')}</Button>
					{/if}
					<Button variant="secondary" size="sm" disabled={!found.picked.some((id) => !inList(id))} onclick={addFound}>
						{t('settings.discover.add', { n: found.picked.filter((id) => !inList(id)).length })}
					</Button>
				</div>
			</section>
		{/if}
		{#if form.models.length}
			<ul class="mlist">
				{#each form.models as m, i (`${i}:${m.name}`)}
					<li class="mrow" class:on={editAt === i}>
						<span class="mtxt">
							<span class="mname">{m.name}</span>
							<span class="mdesc">{summary(m)}</span>
						</span>
						<IconButton size="sm" label={t('settings.custom.editModel', { model: m.name })} title={t('settings.custom.editModel', { model: m.name })} onclick={() => editModel(i)}>
							<PencilSimpleIcon size={14} />
						</IconButton>
						{#if builtinModel(m.name)}
							{#if changed(m)}
								<IconButton size="sm" label={t('settings.builtin.resetModel', { model: m.name })} title={t('settings.builtin.resetModel', { model: m.name })} onclick={() => resetModel(i)}>
									<ArrowCounterClockwiseIcon size={14} />
								</IconButton>
							{/if}
						{:else}
							<IconButton size="sm" label={t('settings.custom.removeModel', { model: m.name })} title={t('settings.custom.removeModel', { model: m.name })} onclick={() => removeModel(i)}>
								<XIcon size={14} />
							</IconButton>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<span class="np-empty">{t('settings.custom.noModels')}</span>
		{/if}
		{#if providerErrors.models && editAt === null && !draft.name.trim()}<span class="np-err" role="alert">{err(providerErrors.models)}</span>{/if}
	</div>

	<section class="editor" aria-label={editAt === null ? t('settings.custom.newModel') : t('settings.custom.editModel', { model: form.models[editAt]?.name ?? '' })}>
		<span class="np-label">{editAt === null ? t('settings.custom.newModel') : t('settings.custom.editModel', { model: form.models[editAt]?.name ?? '' })}</span>
		<div class="np-grid even">
			<div class="np-f">
				<label class="np-f">
					<span class="cap">{t('settings.custom.modelName')}</span>
					<TextField bind:value={draft.name} mono placeholder="my-model" disabled={editingBuiltin} />
				</label>
				{#if modelErrors.name}<span class="np-err" role="alert">{err(modelErrors.name)}</span>{/if}
			</div>
			<label class="np-f">
				<span class="cap">{t('settings.custom.displayName')}</span>
				<TextField bind:value={draft.display_name} placeholder={draft.name.trim() || t('settings.custom.displayNamePlaceholder')} />
			</label>
		</div>
		<div class="np-grid even">
			<div class="np-f">
				<label class="np-f">
					<span class="cap">{t('settings.custom.contextWindow')}</span>
					<TextField bind:value={draft.context} mono placeholder="128k" />
				</label>
				{#if modelErrors.context}<span class="np-err" role="alert">{err(modelErrors.context)}</span>{/if}
			</div>
			<div class="np-f">
				<label class="np-f">
					<span class="cap">{t('settings.custom.maxOutput')}</span>
					<TextField bind:value={draft.maxOutput} mono placeholder={draft.reasoning ? '32k' : '8k'} />
				</label>
				{#if modelErrors.maxOutput}<span class="np-err" role="alert">{err(modelErrors.maxOutput)}</span>{/if}
			</div>
		</div>
		<span class="np-hint">{editingBuiltin ? t('settings.builtin.tokensHint') : t('settings.custom.tokensHint')}</span>

		<div class="np-f" role="group" aria-label={t('settings.custom.input')}>
			<span class="cap">{t('settings.custom.input')}</span>
			<div class="checks">
				{#each MODALITIES as kind (kind)}
					<Checkbox checked={draft.modalities.includes(kind)} onchange={(on) => (draft.modalities = MODALITIES.filter((k) => (k === kind ? on : draft.modalities.includes(k))))}>
						{t(`settings.custom.modality.${kind}`)}
					</Checkbox>
				{/each}
			</div>
			{#if modelErrors.modalities}<span class="np-err" role="alert">{err(modelErrors.modalities)}</span>{/if}
		</div>

		<div class="checks">
			<Checkbox bind:checked={draft.reasoning}>{t('settings.custom.thinking')}</Checkbox>
		</div>
		{#if draft.reasoning}
			<div class="np-f" role="group" aria-label={t('settings.custom.efforts')}>
				<span class="cap">{t('settings.custom.efforts')}</span>
				<div class="checks">
					{#each EFFORT_TIERS as tier (tier)}
						<Checkbox checked={draft.efforts.includes(tier)} onchange={(on) => (draft.efforts = toggle(draft.efforts, tier, on))}>
							{tierLabel(tier)}
						</Checkbox>
					{/each}
				</div>
				{#if modelErrors.efforts}<span class="np-err" role="alert">{err(modelErrors.efforts)}</span>{/if}
				<span class="np-hint">{t('settings.custom.ultraHint')}</span>
			</div>
		{/if}

		<div class="ed-foot">
			{#if editAt !== null}<Button variant="ghost" size="sm" onclick={resetEditor}>{t('common.cancel')}</Button>{/if}
			<Button variant="secondary" size="sm" onclick={commitModel}>{editAt === null ? t('settings.custom.addModel') : t('settings.custom.updateModel')}</Button>
		</div>
	</section>
</div>

<style>
	.newprov {
		padding: 8px 22px 16px;
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.np-grid {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 12px;
		align-items: start;
	}
	.np-grid.even {
		grid-template-columns: 1fr 1fr;
	}
	.np-f {
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.cap,
	.np-label {
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.np-hint,
	.np-empty {
		font-size: var(--fs-xs);
		color: var(--dim2);
		line-height: 16px;
	}
	.url {
		font-family: var(--font-mono);
		color: var(--dim);
		overflow-wrap: anywhere;
	}
	.v1 {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 8px;
	}
	.np-err {
		font-size: var(--fs-xs);
		color: var(--err);
		line-height: 16px;
	}
	.np-models {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.mlist {
		display: flex;
		flex-direction: column;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.mrow {
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 44px;
		padding: 6px 4px 6px 10px;
		border-radius: var(--r-sm);
	}
	.mrow + .mrow {
		border-top: 1px solid var(--hairline);
	}
	.mrow.on {
		background: var(--surface2);
	}
	.mtxt {
		display: flex;
		flex: 1;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
	}
	.mname {
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		color: var(--text);
		overflow-wrap: anywhere;
	}
	.mdesc {
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 16px;
	}
	.mhead {
		display: flex;
		align-items: center;
		gap: 4px;
		min-height: 28px;
	}
	.mhead .np-label {
		flex: 1;
	}
	.found {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.flist {
		display: flex;
		flex-direction: column;
		max-height: 260px;
		margin: 0;
		padding: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
		list-style: none;
	}
	.frow {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 6px 4px;
	}
	.frow + .frow {
		border-top: 1px solid var(--hairline);
	}
	.frow .mdesc {
		padding-left: 26px;
	}
	.editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.checks {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 16px;
		font-size: var(--fs-sm);
	}
	.ed-foot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}
</style>
