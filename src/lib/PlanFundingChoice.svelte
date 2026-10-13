<script lang="ts">
	// Who pays this device key's requests in the desktop plan's groups (gateway
	// GET / PUT /api/desktop/oauth/plan): the plan first, or the balance. With
	// the plan first, a used-up window fails requests (402) and never falls back
	// to the balance, so a payer who wants to keep working picks 用余额. Shown
	// with the plan in force, in the account card and on the account page.
	import Segmented from '$lib/ui/Segmented.svelte';
	import { t } from '$lib/i18n';
	import { trial } from '$lib/trial.svelte';
	import type { PlanFunding } from '$lib/trial';

	let { compact = false }: { compact?: boolean } = $props();

	const plan = $derived(trial.plan);
	const funding = $derived(trial.funding);
	let error = $state('');
	/** Bumped after a failed change, so the control shows the choice in force again. */
	let resets = $state(0);

	async function pick(value: string) {
		if (value === funding || trial.saving) {
			resets++;
			return;
		}
		error = '';
		const failed = await trial.setFunding(value as PlanFunding);
		if (failed) {
			error = t('shell.trial.fundingFailed', { error: failed });
			resets++;
		}
	}
</script>

{#if plan && funding}
	<div class="funding" class:compact>
		<div class="row">
			<span class="label">{t('shell.trial.funding')}</span>
			{#key `${funding}:${resets}`}
				<Segmented
					value={funding}
					options={[
						{ value: 'plan', label: t(plan.trial === false ? 'shell.trial.fundingPaid' : 'shell.trial.fundingTrial') },
						{ value: 'balance', label: t('shell.trial.fundingBalance') }
					]}
					onChange={pick}
				/>
			{/key}
		</div>
		<p class="hint">
			{funding === 'plan'
				? t('shell.trial.fundingPlanHint', { group: plan.group.trim() || t('shell.trial.domestic') })
				: t('shell.trial.fundingBalanceHint')}
		</p>
		{#if error}<p class="err" role="alert">{error}</p>{/if}
	</div>
{/if}

<style>
	.funding {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 6px 10px;
	}
	.label {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.compact .row :global(.opt) {
		padding: 4px 10px;
		font-size: var(--fs-xs);
	}
	.hint,
	.err {
		margin: 0;
		font-size: var(--fs-2xs);
		line-height: 1.45;
	}
	.hint {
		color: var(--dim);
	}
	.err {
		color: var(--err);
	}
</style>
