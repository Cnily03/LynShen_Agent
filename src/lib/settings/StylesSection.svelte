<script lang="ts">
	// Settings → 回复风格: the style of new conversations (`reply_style` in
	// config.json) and every style the engine finds — the built-ins, the
	// personal ones in ~/.lynshen/styles and, once the project is trusted,
	// the project's. Personal styles are written and deleted here; a single
	// conversation picks its own from the composer's "+" menu. A daemon
	// before the style ops cannot list them: the page says so.
	import { onMount } from 'svelte';
	import { revealItemInDir } from '@tauri-apps/plugin-opener';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import EyeIcon from 'phosphor-svelte/lib/EyeIcon';
	import NotePencilIcon from 'phosphor-svelte/lib/NotePencilIcon';
	import CopySimpleIcon from 'phosphor-svelte/lib/CopySimpleIcon';
	import FolderOpenIcon from 'phosphor-svelte/lib/FolderOpenIcon';
	import TrashIcon from 'phosphor-svelte/lib/TrashIcon';
	import Button from '$lib/ui/Button.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import Select from '$lib/ui/Select.svelte';
	import { confirm } from '$lib/ui/confirm.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { t } from '$lib/i18n';
	import { tildePath } from '$lib/skills';
	import { replyStyles } from '$lib/styles.svelte';
	import {
		copyDraft,
		editable,
		problemText,
		styleDescription,
		styleErrorText,
		styleHome,
		styleName,
		type ReplyStyle,
		type StyleDraft
	} from '$lib/styles';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import StyleDialog from './StyleDialog.svelte';

	/** The project of the conversation in front ('' for none): its own styles are listed too. */
	let { project = '' }: { project?: string } = $props();

	const list = $derived(replyStyles.list(project));
	const home = $derived(list ? styleHome(list) : '');
	const userDir = $derived(list?.dirs.find((d) => d.scope === 'user')?.path ?? '');
	const options = $derived(
		(list?.styles ?? []).map((s) => ({ value: s.id, label: styleName(s, t) }))
	);
	// The default names a style that is gone: it shows under its id.
	const defaultOptions = $derived(
		list && !list.styles.some((s) => s.id === list.default) ? [...options, { value: list.default, label: list.default }] : options
	);
	let pending = $state<Record<string, boolean>>({});
	/** The dialog: a style shown or edited, or a new draft. */
	let dialog = $state<{ style?: ReplyStyle; draft?: StyleDraft } | null>(null);

	onMount(() => {
		void replyStyles.load(project);
	});

	async function setDefault(id: string) {
		try {
			await replyStyles.setDefault(id);
		} catch (e) {
			console.warn('reply styles: the default was not saved', e);
			toast.error(t('settings.styles.defaultFailed', { msg: styleErrorText(e, t) }));
		}
	}

	async function save(draft: StyleDraft, style?: ReplyStyle) {
		await replyStyles.save(draft, style?.id);
		toast.success(t('settings.styles.saved', { name: draft.name.trim() }));
	}

	async function remove(style: ReplyStyle) {
		const name = styleName(style, t);
		const ok = await confirm({
			title: t('settings.styles.removeTitle', { name }),
			message: t('settings.styles.removeMessage', { path: tildePath(style.path ?? '', home) }),
			confirmLabel: t('settings.styles.remove'),
			danger: true
		});
		if (!ok) return;
		pending[style.id] = true;
		try {
			await replyStyles.remove(style.id);
			toast.success(t('settings.styles.removed', { name }));
		} catch (e) {
			console.warn('reply styles: style_delete failed', e);
			toast.error(t('settings.styles.removeFailed', { msg: styleErrorText(e, t) }));
		} finally {
			delete pending[style.id];
		}
	}

	const reveal = (path: string) => revealItemInDir(path).catch((e) => toast.error(String(e)));
	// Description, where it comes from, and whether it was cut: one line.
	const rowMeta = (s: ReplyStyle) =>
		[styleDescription(s, t), t(`settings.styles.source.${s.source}`), s.truncated ? t('settings.styles.truncated') : ''].filter(Boolean).join(' · ');
</script>

{#if replyStyles.unsupported}
	<SettingsSection>
		<SettingsRow id="reply-style-default" title={t('settings.styles.default')} description={t('settings.styles.oldDaemon')} />
	</SettingsSection>
{:else if !list}
	<SettingsSection>
		<SettingsRow
			id="reply-style-default"
			title={t('settings.styles.default')}
			description={replyStyles.error ? t('settings.styles.loadFailed', { msg: styleErrorText(replyStyles.error, t) }) : t('settings.styles.loading')}
		/>
	</SettingsSection>
{:else}
	<SettingsSection title={t('settings.styles.defaultSection')}>
		<SettingsRow id="reply-style-default" title={t('settings.styles.default')} description={t('settings.styles.defaultHint')}>
			<div class="selw">
				<Select value={list.default} options={defaultOptions} onChange={setDefault} />
			</div>
		</SettingsRow>
	</SettingsSection>

	<SettingsSection id="reply-style-list" title={t('settings.styles.listTitle')}>
		{#snippet action()}
			<Button size="sm" onclick={() => (dialog = { draft: { name: '', description: '', instructions: '' } })}>
				<PlusIcon size={14} />
				{t('settings.styles.new')}
			</Button>
		{/snippet}
		<!-- One block: the section draws no lines between its parts. -->
		<div class="block">
		<p class="lede">{t('settings.styles.listHint')}</p>
		<div class="rows">
			{#each list.styles as s (s.id)}
				<div class="srow">
					<div class="stext">
						<div class="sname">{styleName(s, t)}</div>
						<div class="sdesc" title={styleDescription(s, t)}>{rowMeta(s)}</div>
					</div>
					<div class="sacts">
						{#if editable(s)}
							<IconButton size="sm" title={t('settings.styles.edit')} onclick={() => (dialog = { style: s })}><NotePencilIcon size={16} /></IconButton>
						{:else}
							<IconButton size="sm" title={t('settings.styles.view')} onclick={() => (dialog = { style: s })}><EyeIcon size={16} /></IconButton>
						{/if}
						{#if s.id !== 'default'}
							<IconButton size="sm" title={t('settings.styles.copy')} onclick={() => (dialog = { draft: copyDraft(s, t) })}><CopySimpleIcon size={16} /></IconButton>
						{/if}
						{#if s.path}
							<IconButton size="sm" title={t('settings.styles.openFolder')} onclick={() => reveal(s.path ?? '')}><FolderOpenIcon size={16} /></IconButton>
						{/if}
						{#if editable(s)}
							<IconButton size="sm" title={t('settings.styles.remove')} disabled={pending[s.id]} onclick={() => remove(s)}><TrashIcon size={16} /></IconButton>
						{/if}
					</div>
				</div>
			{/each}
		</div>
		{#if list.problems.length}
			<div class="problems">
				<Notice tone="warn">
					{#each list.problems as p (p.path)}
						<div>{problemText(p, home, t)}</div>
					{/each}
				</Notice>
			</div>
		{/if}
		{#if list.projectTrusted === false}<p class="note">{t('settings.styles.untrusted')}</p>{/if}
		{#if userDir}<p class="note">{t('settings.styles.folder', { path: tildePath(userDir, home) })}</p>{/if}
		</div>
	</SettingsSection>
{/if}

<!-- Keyed: 复制为自定义 in a read-only dialog opens a new one on the copy. -->
{#key dialog}
	{#if dialog}
		{@const shown = dialog}
		<StyleDialog
			style={shown.style}
			draft={shown.draft}
			onSave={(draft) => save(draft, shown.style)}
			onCopy={(s) => (dialog = { draft: copyDraft(s, t) })}
			onClose={() => (dialog = null)}
		/>
	{/if}
{/key}

<style>
	.selw {
		width: 260px;
		max-width: 100%;
	}
	.lede {
		margin: 0;
		padding: 0 0 8px;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 16px;
	}
	.rows > * + * {
		border-top: 1px solid var(--hairline);
	}
	.srow {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 48px;
		padding: 6px 0;
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
		line-height: 16px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	/* Row actions on hover or keyboard focus (design.md). */
	.sacts {
		display: flex;
		gap: 2px;
		opacity: 0;
		transition: opacity var(--t-fast) var(--ease-base);
	}
	.srow:hover .sacts,
	.srow:focus-within .sacts {
		opacity: 1;
	}
	.problems {
		padding-top: 12px;
	}
	.note {
		margin: 0;
		padding-top: 12px;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 16px;
	}
</style>
