<script lang="ts">
	// A session's status mark (sessionStatus.ts), for sidebar rows, home-page
	// rows and canvas tabs (design.md, "Status, attention and emphasis"). A
	// status colour shows only as one 6px dot: --warn while the session waits
	// for the reader, --err after a failure, --text for a reply not seen yet.
	// A session at work shows the spinner, in --dim, on home rows and tabs;
	// the navigator shows no mark for it and sweeps a light across the title
	// instead (ui/shimmer.ts). The words go in the title (and, in the
	// sidebar, on the line under the session's title).
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import { t } from '$lib/i18n';
	import type { SessionStatus } from '$lib/sessionStatus';
	import { describeError, stripEngineHint } from '$lib/errorInfo';

	let { status, compact = false }: { status: SessionStatus; compact?: boolean } = $props();
</script>

{#if status?.kind === 'input'}
	{@const label = status.ask === 'answer' ? t('shell.status.answer') : t('shell.status.approve')}
	<span class="dot input" class:compact title={label} role="img" aria-label={label}></span>
{:else if status?.kind === 'failed'}
	{@const known = describeError(status.message)}
	{@const tip = known ? t(`chat.err.${known.kind}.title`, { subject: known.subject ?? t('chat.err.thisTool') }) : stripEngineHint(status.message)}
	<span class="dot failed" class:compact title={tip || t('shell.status.failed')} role="img" aria-label={t('shell.status.failed')}></span>
{:else if status?.kind === 'running'}
	<span class="mark running" title={t('shell.status.running')} aria-label={t('shell.status.running')}>
		<CircleNotchIcon size={compact ? 12 : 14} class="spin" />
	</span>
{:else if status?.kind === 'unread'}
	<span class="dot unread" class:compact title={t('shell.unread')} role="img" aria-label={t('shell.unread')}></span>
{/if}

<style>
	.mark {
		display: inline-flex;
		align-items: center;
		flex-shrink: 0;
	}
	.running {
		color: var(--dim);
	}
	.dot {
		flex-shrink: 0;
		width: 6px;
		height: 6px;
		border-radius: var(--r-full);
	}
	.dot.compact {
		margin: 0 2px;
	}
	.input {
		background: var(--warn);
	}
	.failed {
		background: var(--err);
	}
	.unread {
		background: var(--text);
	}
</style>
