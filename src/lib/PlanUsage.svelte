<script lang="ts">
	// The desktop plan's windows as Settings → 账户 shows them (moved there
	// from the account card): per window used / quota with a slim bar and
	// when it recovers. The plan's end is on the row above.
	import { t } from '$lib/i18n';
	import { credits, planDate, sortedWindows, usedShare, windowLabel, type TrialPlan } from '$lib/trial';

	let { plan }: { plan: TrialPlan } = $props();
</script>

<div class="usage" aria-label={t('shell.trial.label')}>
	{#each sortedWindows(plan) as w (w.kind)}
		{@const share = usedShare(w)}
		<div class="win">
			<div class="kv">
				<span>{windowLabel(w.kind)}</span>
				<span class="num">{t('shell.trial.used', { used: credits(w.used_cny, true), quota: credits(w.quota_cny, true) })}</span>
			</div>
			<div class="meter" aria-hidden="true"><span class:full={share >= 1} style:width="{share * 100}%"></span></div>
			{#if w.resets_at}<span class="small">{t('shell.trial.resets', { time: planDate(w.resets_at, true) })}</span>{/if}
		</div>
	{/each}
</div>

<style>
	.usage {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.win {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.kv {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.num {
		color: var(--text);
		font-family: var(--font-mono);
		font-variant-numeric: tabular-nums;
	}
	.meter {
		height: 4px;
		overflow: hidden;
		border-radius: var(--r-full);
		background: var(--surface2);
	}
	.meter > span {
		display: block;
		height: 100%;
		border-radius: inherit;
		background: var(--accent);
	}
	.meter > span.full {
		background: var(--warn);
	}
	.small {
		color: var(--dim);
		font-size: var(--fs-2xs);
	}
</style>
