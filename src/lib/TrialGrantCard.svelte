<script lang="ts">
	// The one-time card of a granted trial plan (trial.svelte.ts): what the
	// gateway gave and until when, and who pays this device's requests. A
	// device on the balance is asked whether the trial should pay (the plan
	// only by an explicit choice); "知道了" or an answer dismisses it for good,
	// until then it shows again at the next start. In the same place, once:
	// a plan new to this device (bought on the website, given by an admin)
	// with who pays now: the plan (the default after a purchase) with 改用余额,
	// or, for a device left on the balance, the question.
	import GiftIcon from 'phosphor-svelte/lib/GiftIcon';
	import CreditCardIcon from 'phosphor-svelte/lib/CreditCardIcon';
	import Button from '$lib/ui/Button.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { t } from '$lib/i18n';
	import { grantText, planDate } from '$lib/trial';
	import { trial } from '$lib/trial.svelte';

	// Once the device's choice is known (or known to be unknown: an older
	// gateway), so the card does not change its question as it shows.
	const plan = $derived(trial.statusRead ? trial.grant : null);
	const text = $derived(plan ? grantText(plan, trial.record?.at ?? Date.now()) : null);
	const offer = $derived(plan ? null : trial.offer);
	let busy = $state(false);

	/** Sends the answer; says so when it changed who pays (`switched`). */
	async function choose(usePlan: boolean, answer: () => void | Promise<string>, switched = usePlan) {
		busy = true;
		const error = (await answer()) || '';
		busy = false;
		if (error) toast.error(t('shell.trial.fundingFailed', { error }));
		else if (switched) toast.success(t(usePlan ? 'shell.funding.toPlan' : 'shell.trial.fundingToBalance'));
	}
	// The claim put this device on the trial (contract v1.2): the balance instead.
	const useBalance = () =>
		choose(
			false,
			async () => {
				const error = await trial.setFunding('balance');
				if (!error) trial.acknowledge();
				return error;
			},
			true
		);
	const useTrial = () =>
		choose(true, async () => {
			const error = await trial.setFunding('plan');
			if (!error) trial.acknowledge();
			return error;
		});
</script>

{#if text}
	<section class="trial-grant" aria-label={t('shell.trial.label')}>
		<span class="ico" aria-hidden="true"><GiftIcon size={18} /></span>
		<div class="txt">
			<h2>{text.title}</h2>
			<p>{#each text.parts as part, i (i)}{#if i}{' · '}{/if}<span class="part">{part}</span>{/each}</p>
			{#if trial.funding === 'balance'}
				<p class="ask">{t('shell.trial.grantAsk')}</p>
				<div class="acts">
					<Button size="sm" disabled={busy} onclick={() => trial.acknowledge()}>{t('shell.trial.grantKeep')}</Button>
					<Button variant="primary" size="sm" disabled={busy} onclick={useTrial}>{t('shell.trial.grantUse')}</Button>
				</div>
			{:else}
				{#if trial.funding === 'plan'}<p class="ask">{t('shell.trial.grantOnPlan')}</p>{/if}
				<div class="acts">
					{#if trial.funding === 'plan'}
						<Button size="sm" disabled={busy} onclick={useBalance}>{t('shell.funding.toBalance')}</Button>
					{/if}
					<Button variant="primary" size="sm" disabled={busy} onclick={() => trial.acknowledge()}>{t('shell.trial.ok')}</Button>
				</div>
			{/if}
		</div>
	</section>
{:else if offer}
	{@const name = offer.name.trim() || t('shell.trial.label')}
	<section class="trial-grant" aria-label={t('shell.funding.label')}>
		<span class="ico" aria-hidden="true"><CreditCardIcon size={18} /></span>
		<div class="txt">
			{#if trial.funding === 'plan'}
				<!-- The plan pays (the default after a purchase): said once, the balance one tap away. -->
				<h2>{t('shell.funding.nowTitle', { name })}</h2>
				<p>{t('shell.trial.until', { date: planDate(offer.expires_at) })}</p>
				<p class="ask">{t('shell.funding.nowBody')}</p>
				<div class="acts">
					<Button size="sm" disabled={busy} onclick={() => choose(false, () => trial.answerOffer(false), true)}>{t('shell.funding.toBalance')}</Button>
					<Button variant="primary" size="sm" disabled={busy} onclick={() => trial.markOffered(offer)}>{t('shell.trial.ok')}</Button>
				</div>
			{:else}
				<h2>{t('shell.funding.offerTitle', { name })}</h2>
				<p>{t('shell.trial.until', { date: planDate(offer.expires_at) })}</p>
				<p class="ask">{t('shell.funding.offerBody')}</p>
				<div class="acts">
					<Button size="sm" disabled={busy} onclick={() => choose(false, () => trial.answerOffer(false))}>{t('shell.funding.offerKeep')}</Button>
					<Button variant="primary" size="sm" disabled={busy} onclick={() => choose(true, () => trial.answerOffer(true))}>{t('shell.funding.offerUse')}</Button>
				</div>
			{/if}
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
	.ask {
		margin-top: 4px;
		color: var(--text);
	}
	.acts {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 8px;
	}
</style>
