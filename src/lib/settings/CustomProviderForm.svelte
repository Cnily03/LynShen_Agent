<script lang="ts">
	import XIcon from 'phosphor-svelte/lib/XIcon';
	import PencilSimpleIcon from 'phosphor-svelte/lib/PencilSimpleIcon';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	import Checkbox from '$lib/ui/Checkbox.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { effortLabel } from '$lib/composer/effort';
	import {
		EFFORT_TIERS,
		MODALITIES,
		draftFromModel,
		formatTokens,
		modelEfforts,
		modelFromDraft,
		newModelDraft,
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
		onSubmit
	}: {
		form: FormState;
		formats: { value: string; label: string }[];
		/** 'edit': the id is fixed and an empty key keeps the saved one. */
		mode?: 'create' | 'edit';
		/** Ids of the other providers. */
		taken?: string[];
		keyRequired?: boolean;
		/** Edit: a key is saved for this provider. */
		keyed?: boolean;
		onSubmit: (form: FormState) => void;
	} = $props();

	// The model editor under the list: a new model, or the row at `editAt`.
	let draft = $state<ModelDraft>(newModelDraft());
	let editAt = $state<number | null>(null);
	let modelErrors = $state<ModelErrors>({});
	let tried = $state(false);
	const providerErrors = $derived<ProviderErrors>(
		tried ? validateProvider(form, { taken: mode === 'edit' ? [] : taken, keyRequired }) : {}
	);
	const otherNames = $derived(form.models.filter((_, i) => i !== editAt).map((m) => m.name));

	const err = (key?: string) => (key ? t(`settings.custom.error.${key}`) : '');
	const tierLabel = (tier: string) => (tier === 'none' ? t('settings.custom.effortNone') : effortLabel(tier));

	/** The quiet second line of a model row: window · output · thinking · input. */
	function summary(m: ProviderModel): string {
		const efforts = modelEfforts(m);
		const kinds = m.input_modalities?.length ? m.input_modalities : [...MODALITIES];
		return [
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
		draft = draftFromModel(form.models[i]);
		modelErrors = {};
	}
	function resetEditor() {
		editAt = null;
		draft = newModelDraft();
		modelErrors = {};
	}
	function removeModel(i: number) {
		form.models = form.models.filter((_, j) => j !== i);
		if (editAt === i) resetEditor();
		else if (editAt !== null && editAt > i) editAt -= 1;
	}
	/** Puts the editor's model into the list; false when it is not valid. */
	function commitModel(): boolean {
		modelErrors = validateModel(draft, otherNames);
		if (Object.keys(modelErrors).length) return false;
		const model = modelFromDraft(draft, editAt === null ? undefined : form.models[editAt]);
		form.models = editAt === null ? [...form.models, model] : form.models.map((m, j) => (j === editAt ? model : m));
		resetEditor();
		return true;
	}

	/** The footer's create / save: a model left in the editor is added first. */
	export function submit() {
		tried = true;
		const pending = draft.name.trim() !== '' || editAt !== null;
		if (pending && !commitModel()) return;
		if (Object.keys(validateProvider(form, { taken: mode === 'edit' ? [] : taken, keyRequired })).length) return;
		onSubmit(form);
	}
</script>

<div class="newprov">
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
	<div class="np-f">
		<label class="np-f">
			<span class="cap">{t('settings.custom.baseUrl')}</span>
			<TextField bind:value={form.base_url} mono placeholder="https://api.example.com/v1" />
		</label>
		{#if providerErrors.base_url}<span class="np-err" role="alert">{err(providerErrors.base_url)}</span>{/if}
	</div>
	<div class="np-f">
		<label class="np-f">
			<span class="cap">{t('settings.custom.apiKey')}</span>
			<TextField bind:value={form.key} type="password" mono placeholder={mode === 'edit' && keyed ? t('settings.custom.apiKeyKeep') : 'sk-…'} />
		</label>
		{#if providerErrors.key}<span class="np-err" role="alert">{err(providerErrors.key)}</span>{/if}
	</div>

	<div class="np-models">
		<span class="np-label">{t('settings.custom.models')}</span>
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
						<IconButton size="sm" label={t('settings.custom.removeModel', { model: m.name })} title={t('settings.custom.removeModel', { model: m.name })} onclick={() => removeModel(i)}>
							<XIcon size={14} />
						</IconButton>
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
					<TextField bind:value={draft.name} mono placeholder="my-model" />
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
					<TextField bind:value={draft.maxOutput} mono placeholder="8k" />
				</label>
				{#if modelErrors.maxOutput}<span class="np-err" role="alert">{err(modelErrors.maxOutput)}</span>{/if}
			</div>
		</div>
		<span class="np-hint">{t('settings.custom.tokensHint')}</span>

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
