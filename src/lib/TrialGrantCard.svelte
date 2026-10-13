<script lang="ts">
	// The one-time card of a granted trial plan (trial.svelte.ts): what the
	// gateway gave and until when. "知道了" dismisses it for good; until then it
	// shows again at the next start.
	import GiftIcon from 'phosphor-svelte/lib/GiftIcon';
	import Button from '$lib/ui/Button.svelte';
	import { t } from '$lib/i18n';
	import { grantText } from '$lib/trial';
	import { trial } from '$lib/trial.svelte';

	const plan = $derived(trial.grant);
	const text = $derived(plan ? grantText(plan, trial.record?.at ?? Date.now()) : null);
</script>

{#if text}
	<section class="trial-grant" aria-label={t('shell.trial.label')}>
		<span class="ico" aria-hidden="true"><GiftIcon size={18} /></span>
		<div class="txt">
			<h2>{text.title}</h2>
			<p>{#each text.parts as part, i (i)}{#if i}{' · '}{/if}<span class="part">{part}</span>{/each}</p>
			<div class="acts">
				<Button variant="primary" size="sm" onclick={() => trial.acknowledge()}>{t('shell.trial.ok')}</Button>
			</div>
		</div>
	</section>
{/if}

<style>
	/* Under the title bar, at the right of the canvas: beside the conversation,
	   not over its column's start or the composer. */
	.trial-grant {
		position: fixed;
		top: 60px;
		right: 16px;
		z-index: 80;
		display: flex;
		gap: 12px;
		width: 340px;
		max-width: calc(100vw - 32px);
		padding: 14px 16px;
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: var(--shadow-float);
		animation: drop-in var(--t-med) var(--ease-enter);
	}
	.ico {
		display: inline-flex;
		flex-shrink: 0;
		padding-top: 2px;
		color: var(--ok);
	}
	.txt {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	h2 {
		margin: 0;
		color: var(--text);
		font-size: var(--fs-md);
		font-weight: 600;
	}
	p {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.55;
	}
	/* A line breaks between the parts, not inside one ("4 积分"). */
	.part {
		white-space: nowrap;
	}
	.acts {
		display: flex;
		justify-content: flex-end;
		margin-top: 8px;
	}
</style>
