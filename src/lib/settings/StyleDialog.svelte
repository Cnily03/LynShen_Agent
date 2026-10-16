<script lang="ts">
	// Settings → 回复风格: one style in a dialog. A personal style is edited
	// (or a new one written); a built-in or a project's style is shown read
	// only, with 复制为自定义 to start a personal copy of it.
	import { onMount, tick, untrack } from 'svelte';
	import ChatCenteredTextIcon from 'phosphor-svelte/lib/ChatCenteredTextIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Button from '$lib/ui/Button.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import { t } from '$lib/i18n';
	import {
		STYLE_INSTRUCTIONS_MAX_BYTES,
		codeText,
		editable,
		styleDescription,
		styleDraftError,
		styleErrorText,
		styleName,
		type ReplyStyle,
		type StyleDraft
	} from '$lib/styles';

	let {
		style,
		draft: initial,
		onSave,
		onCopy,
		onClose
	}: {
		/** The style shown; omitted for a new one. */
		style?: ReplyStyle;
		/** What a new style starts with (a copy of another). */
		draft?: StyleDraft;
		/** Saves the draft (as `style` when editing); rejects with the reason. */
		onSave: (draft: StyleDraft) => Promise<void>;
		/** Starts a personal copy of a read-only style. */
		onCopy?: (style: ReplyStyle) => void;
		onClose: () => void;
	} = $props();

	const readOnly = $derived(!!style && !editable(style));
	let draft = $state<StyleDraft>(
		untrack(() =>
			style
				? { name: styleName(style, t), description: styleDescription(style, t), instructions: style.instructions }
				: (initial ?? { name: '', description: '', instructions: '' })
		)
	);
	let busy = $state(false);
	/** Why the save failed, in the app's language. */
	let error = $state('');
	let tried = $state(false);
	let nameEl = $state<HTMLDivElement | null>(null);
	const problem = $derived(styleDraftError(draft));
	const used = $derived(new TextEncoder().encode(draft.instructions.trim()).length);

	onMount(() => {
		if (!readOnly) tick().then(() => nameEl?.querySelector('input')?.focus());
	});

	async function save() {
		tried = true;
		if (problem || busy) return;
		busy = true;
		error = '';
		try {
			await onSave(draft);
			onClose();
		} catch (e) {
			console.warn('reply styles: style_save failed', e);
			error = styleErrorText(e, t);
			busy = false;
		}
	}
</script>

<Modal
	title={readOnly ? t('settings.styles.dialog.viewTitle') : style ? t('settings.styles.dialog.editTitle') : t('settings.styles.dialog.newTitle')}
	width={560}
	dismissible={!busy}
	{onClose}
>
	{#snippet icon()}<ChatCenteredTextIcon size={15} />{/snippet}
	<form class="form" onsubmit={(e) => (e.preventDefault(), save())}>
		{#if readOnly && style}
			<p class="note">{t(style.source === 'project' ? 'settings.styles.dialog.readOnlyProject' : 'settings.styles.dialog.readOnlyBuiltin')}</p>
		{/if}
		<label class="field">
			<span class="flabel">{t('settings.styles.dialog.name')}</span>
			<div bind:this={nameEl}>
				<TextField bind:value={draft.name} placeholder={t('settings.styles.dialog.namePlaceholder')} disabled={readOnly} />
			</div>
		</label>
		<label class="field">
			<span class="flabel">{t('settings.styles.dialog.description')}</span>
			<TextField bind:value={draft.description} placeholder={t('settings.styles.dialog.descriptionPlaceholder')} disabled={readOnly} />
		</label>
		<label class="field">
			<span class="flabel">{t('settings.styles.dialog.instructions')}</span>
			<textarea
				class="ta"
				rows="10"
				bind:value={draft.instructions}
				readonly={readOnly}
				placeholder={t('settings.styles.dialog.instructionsPlaceholder')}
			></textarea>
			<span class="fhint" class:bad={used > STYLE_INSTRUCTIONS_MAX_BYTES}>
				{t('settings.styles.dialog.instructionsHint', { n: used, max: STYLE_INSTRUCTIONS_MAX_BYTES })}
			</span>
		</label>
		{#if tried && problem}<Notice>{codeText(problem, t)}</Notice>{/if}
		{#if error}<Notice>{t('settings.styles.saveFailed', { msg: error })}</Notice>{/if}
	</form>
	{#snippet footer()}
		{#if readOnly && style}
			<Button variant="ghost" onclick={onClose}>{t('common.close')}</Button>
			{#if onCopy}<Button variant="primary" onclick={() => onCopy?.(style)}>{t('settings.styles.copy')}</Button>{/if}
		{:else}
			<Button variant="ghost" disabled={busy} onclick={onClose}>{t('common.cancel')}</Button>
			<Button variant="primary" disabled={busy} onclick={save}>
				{#if busy}<CircleNotchIcon size={14} class="spin" /> {t('settings.styles.dialog.saving')}{:else}{t('settings.styles.dialog.save')}{/if}
			</Button>
		{/if}
	{/snippet}
</Modal>

<style>
	.form {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.note {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 16px;
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
		line-height: 16px;
	}
	.fhint.bad {
		color: var(--err);
	}
	.ta {
		width: 100%;
		min-width: 0;
		min-height: 180px;
		resize: vertical;
		background: var(--surface2);
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		color: var(--text);
		padding: 8px 10px;
		font-family: var(--font-sans);
		font-size: var(--fs-sm);
		line-height: 20px;
		outline: none;
		transition: border-color var(--t-fast) var(--ease-base);
	}
	.ta::placeholder {
		color: var(--dim2);
	}
	.ta:focus {
		border-color: var(--border-strong);
	}
	.ta[readonly] {
		color: var(--dim);
	}
</style>
