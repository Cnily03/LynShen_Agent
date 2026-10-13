<script lang="ts">
	// A sandbox crossing that ran without asking (`escalated`: 全自动, an
	// allow rule or the safety model let it through), as one quiet line in
	// the conversation: 越界记录, the reason, then the command (or the paths
	// written). The full record is the line's title.
	import ShieldWarningIcon from 'phosphor-svelte/lib/ShieldWarningIcon';
	import { t } from '$lib/i18n';
	import { firstLine, type EscalationRecord } from './request';

	let { record }: { record: EscalationRecord } = $props();

	const reason = $derived(firstLine(record.justification));
	const what = $derived(firstLine(record.command) || record.paths.join(', '));
	const by = $derived(record.by ? t(`chat.escalation.by.${record.by}`) : '');
	const title = $derived(
		[
			t('chat.escalation.label') + (by ? ` · ${by}` : ''),
			record.justification && t('chat.escalation.reason', { text: record.justification }),
			record.command && `$ ${record.command}`,
			record.paths.length ? t('chat.escalation.paths', { paths: record.paths.join('\n') }) : '',
			record.cwd && t('chat.escalation.cwd', { cwd: record.cwd })
		]
			.filter(Boolean)
			.join('\n')
	);
</script>

<div class="esc" {title}>
	<span class="ico" aria-hidden="true"><ShieldWarningIcon size={13} /></span>
	<span class="label">{t('chat.escalation.label')}</span>
	{#if reason}<span class="reason">{reason}</span>{/if}
	{#if what}<code class="what">{record.command ? `$ ${what}` : what}</code>{/if}
	{#if by}<span class="by">{by}</span>{/if}
</div>

<style>
	.esc {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		min-height: 22px;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.ico {
		display: inline-flex;
		flex: none;
		color: var(--warn);
	}
	.label {
		flex: none;
		font-weight: 500;
	}
	.reason {
		flex: 0 1 auto;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.what {
		flex: 1 1 0;
		min-width: 60px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--text);
	}
	.by {
		flex: none;
		color: var(--dim2);
		font-size: var(--fs-2xs);
	}
</style>
