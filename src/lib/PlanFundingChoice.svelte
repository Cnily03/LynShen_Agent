<script lang="ts">
	// Who pays this device's requests (gateway GET / PUT
	// /api/desktop/oauth/plan): the plan only, or the balance only
	// (notes/plan-balance-separation.md 3.8). On the plan, a used-up window, an
	// ended plan or a model outside the plan stops the request and the user
	// decides; the balance is never used instead. Shown with a plan in force,
	// or while the device still pays with a plan that ended, as a row of
	// Settings → 账户 and 套餐与充值.
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Segmented from '$lib/ui/Segmented.svelte';
	import SettingsRow from '$lib/settings/SettingsRow.svelte';
	import { t } from '$lib/i18n';
	import { trial } from '$lib/trial.svelte';
	import type { PlanFunding } from '$lib/trial';

	let { id = 'account-funding' }: { id?: string } = $props();

	const plan = $derived(trial.plan);
	// The latest pick shows at once; trial.svelte.ts sends it (one change at
	// a time, the last pick wins) and falls back to the gateway's choice when
	// a change fails.
	const funding = $derived(trial.funding);
	const error = $derived(trial.fundingError ? t('shell.trial.fundingFailed', { error: trial.fundingError }) : '');
	const hint = $derived(
		funding === 'balance' ? t('shell.trial.fundingBalanceHint') : plan ? t('shell.trial.fundingPlanHint') : t('shell.trial.fundingEndedHint')
	);

	function pick(value: string) {
		if (value === funding) return;
		void trial.setFunding(value as PlanFunding);
	}
</script>

{#if trial.choiceShown && funding}
	<div class="funding">
		<SettingsRow {id} title={t('shell.trial.funding')} description={hint}>
			{#snippet detail()}
				{#if error}<p class="err" role="alert">{error}</p>{/if}
			{/snippet}
			{#if trial.saving}<span class="saving" role="status" aria-label={t('shell.trial.fundingSaving')}><CircleNotchIcon size={13} class="spin" /></span>{/if}
			<Segmented
				value={funding}
				options={[
					// Without a plan in force the plan cannot be picked, only left.
					{ value: 'plan', label: plan ? t('shell.trial.fundingPlan', { name: plan.name.trim() || t('shell.trial.label') }) : t('shell.trial.fundingPlanNone'), disabled: !plan && funding !== 'plan' },
					{ value: 'balance', label: t('shell.trial.fundingBalance') }
				]}
				onChange={pick}
			/>
		</SettingsRow>
	</div>
{/if}

<style>
	.saving {
		display: inline-flex;
		color: var(--dim);
	}
	.err {
		margin: 2px 0 0;
		color: var(--err);
		font-size: var(--fs-xs);
	}
</style>
