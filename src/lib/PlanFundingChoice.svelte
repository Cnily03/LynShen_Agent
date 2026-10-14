<script lang="ts">
	// Who pays this device key's requests in the desktop plan's groups (gateway
	// GET / PUT /api/desktop/oauth/plan): the plan first, or the balance. With
	// the plan first, a used-up window fails requests (402) and never falls back
	// to the balance, so a payer who wants to keep working picks 用余额. Shown
	// with the plan in force, as a row of Settings → 账户.
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import Segmented from '$lib/ui/Segmented.svelte';
	import SettingsRow from '$lib/settings/SettingsRow.svelte';
	import { t } from '$lib/i18n';
	import { trial } from '$lib/trial.svelte';
	import type { PlanFunding } from '$lib/trial';

	const plan = $derived(trial.plan);
	// The latest pick shows at once; trial.svelte.ts sends it (one change at
	// a time, the last pick wins) and falls back to the gateway's choice when
	// a change fails.
	const funding = $derived(trial.funding);
	const error = $derived(trial.fundingError ? t('shell.trial.fundingFailed', { error: trial.fundingError }) : '');

	function pick(value: string) {
		if (value === funding) return;
		void trial.setFunding(value as PlanFunding);
	}
</script>

{#if plan && funding}
	<!-- A row of Settings → 账户's 套餐与余额 group. -->
	<div class="funding">
		<SettingsRow
			id="account-funding"
			title={t('shell.trial.funding')}
			description={funding === 'plan'
				? t('shell.trial.fundingPlanHint', { group: plan.group.trim() || t('shell.trial.domestic') })
				: t('shell.trial.fundingBalanceHint')}
		>
			{#snippet detail()}
				{#if error}<p class="err" role="alert">{error}</p>{/if}
			{/snippet}
			{#if trial.saving}<span class="saving" role="status" aria-label={t('shell.trial.fundingSaving')}><CircleNotchIcon size={13} class="spin" /></span>{/if}
			<Segmented
				value={funding}
				options={[
					{ value: 'plan', label: t(plan.trial === false ? 'shell.trial.fundingPaid' : 'shell.trial.fundingTrial') },
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
