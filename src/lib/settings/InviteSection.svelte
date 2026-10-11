<script lang="ts">
	// Settings → 邀请好友 (gateway DA-9): who invited the user (or a field to add
	// the inviter's code while that is still allowed), the user's own code and
	// link, the rules, and the people they invited.
	import { onMount } from 'svelte';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import GiftIcon from 'phosphor-svelte/lib/GiftIcon';
	import UserCheckIcon from 'phosphor-svelte/lib/UserCheckIcon';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import { t } from '$lib/i18n';
	import { prefs } from '$lib/prefs.svelte';
	import { shownBalanceText } from '$lib/money';
	import { bindReferral, fetchReferrals, GatewayError, type ReferralOverview } from '$lib/protocol';
	import SettingsSection from './SettingsSection.svelte';
	import GatewayNotice from './GatewayNotice.svelte';

	let { onSignIn }: { onSignIn: () => void } = $props();

	/** Refusals of RF-B1 explained in the user's language. */
	const BIND_ERRORS = new Set(['invite_code_invalid', 'referral_bind_closed', 'referral_disabled']);

	let data = $state<ReferralOverview | null>(null);
	let error = $state<unknown>(null);
	let loading = $state(true);
	let code = $state('');
	let binding = $state(false);
	let bindError = $state('');

	async function load() {
		loading = true;
		error = null;
		try {
			data = await fetchReferrals();
		} catch (e) {
			error = e;
		} finally {
			loading = false;
		}
	}
	onMount(load);

	const yuan = (fen: number) => shownBalanceText((fen / 100).toFixed(2), 'CNY', prefs.balanceCurrency);
	const day = (ms: number) => new Date(ms).toLocaleDateString();
	const link = $derived(data ? (data.invite_url ?? `https://www.lynshen.org/login?mode=register&invite=${data.code}`) : '');

	function copy(text: string) {
		navigator.clipboard
			?.writeText(text)
			.then(() => toast.success(t('settings.invite.copied')))
			.catch(() => {});
	}

	async function bind(e: SubmitEvent) {
		e.preventDefault();
		bindError = '';
		binding = true;
		try {
			data = await bindReferral(code.trim().toUpperCase());
			code = '';
			toast.success(t('settings.invite.bindDone'));
		} catch (err) {
			const known = err instanceof GatewayError && err.code && BIND_ERRORS.has(err.code);
			bindError = known ? t(`settings.invite.errors.${(err as GatewayError).code}`) : err instanceof Error ? err.message : String(err);
		} finally {
			binding = false;
		}
	}
</script>

{#if loading && !data}
	<div class="skeleton" aria-busy="true">
		<div class="sk tall"></div>
		<div class="sk-row"><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>
	</div>
{:else if error && !data}
	<GatewayNotice {error} fallback={t('settings.invite.loadFailed')} onRetry={load} {onSignIn} />
{:else if data}
	{#if !data.enabled}<Notice tone="warn">{t('settings.invite.paused')}</Notice>{/if}

	{#if data.invited_by || data.can_bind}
		<section class="card">
			<h3 class="card-title"><UserCheckIcon size={16} /> {t('settings.invite.inviter')}</h3>
			{#if data.invited_by}
				<p class="plain">{t('settings.invite.invitedBy', { name: data.invited_by })}</p>
			{:else}
				<form class="bind" onsubmit={bind}>
					<label class="field-label" for="inviter-code">{t('settings.invite.bindLabel')}</label>
					<div class="bind-row">
						<input
							id="inviter-code"
							class="code-input"
							bind:value={code}
							maxlength="16"
							autocomplete="off"
							spellcheck="false"
							placeholder={t('settings.invite.bindPlaceholder')}
							aria-invalid={bindError ? true : undefined}
							aria-describedby="inviter-code-hint"
						/>
						<Button variant="primary" size="sm" type="submit" disabled={binding || code.trim().length < 4}>{t('settings.invite.bindSubmit')}</Button>
					</div>
					{#if bindError}<p class="err" role="alert">{bindError}</p>{/if}
					<p class="hint" id="inviter-code-hint">{t('settings.invite.bindHint', { date: new Date(data.bind_until).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
				</form>
			{/if}
		</section>
	{/if}

	<section class="card">
		<h3 class="card-title"><GiftIcon size={16} /> {t('settings.invite.yourCode')}</h3>
		<div class="code-line">
			<span class="code">{data.code}</span>
			<Button size="sm" variant="ghost" aria-label={t('settings.invite.copyCode')} onclick={() => copy(data!.code)}><CopyIcon size={14} /></Button>
		</div>
		<div class="field-label">{t('settings.invite.link')}</div>
		<div class="link-row">
			<code class="link" title={link}>{link}</code>
			<Button size="sm" onclick={() => copy(link)}><CopyIcon size={14} /> {t('settings.invite.copyLink')}</Button>
		</div>
		<div class="rules">
			<div class="rules-title">{t('settings.invite.rules')}</div>
			<ol>
				<li>{t('settings.invite.ruleQualify', { hours: data.rules.min_usage_hours, amount: yuan(data.rules.min_consumption_fen) })}</li>
				<li>{t('settings.invite.ruleBonus', { amount: yuan(data.rules.bonus_fen) })}</li>
				<li>{t('settings.invite.ruleShare', { days: data.rules.window_days, percent: data.rules.share_bp / 100 })}</li>
				<li>{t('settings.invite.ruleBonusPool')}</li>
				<li>{t('settings.invite.ruleReview')}</li>
			</ol>
		</div>
	</section>

	<section class="stats">
		<div class="tile"><span class="tile-label">{t('settings.invite.invited')}</span><span class="num">{data.stats.invited}</span></div>
		<div class="tile">
			<span class="tile-label">{t('settings.invite.qualified')}</span>
			<span class="num">{data.stats.qualified}</span>
			<span class="small">{t('settings.invite.pending', { n: data.stats.pending })}</span>
		</div>
		<div class="tile"><span class="tile-label">{t('settings.invite.earned')}</span><span class="num">{yuan(data.stats.earned_fen)}</span></div>
	</section>

	<SettingsSection title={t('settings.invite.list')}>
		{#if data.invitees.length === 0}
			<p class="empty">{t('settings.invite.empty')}</p>
		{:else}
			<ul class="people">
				{#each data.invitees as row, i (`${row.username}-${row.registered_at}-${i}`)}
					<li>
						<span class="who">
							<span class="name">{row.username}</span>
							<span class="small">
								{day(row.registered_at)}{row.status === 'qualified' && row.window_ends_at && row.window_ends_at > Date.now()
									? ` · ${t('settings.invite.shareUntil', { date: day(row.window_ends_at) })}`
									: ''}
							</span>
						</span>
						<span class="chip {row.status}">{t(`settings.invite.status.${row.status}`)}</span>
						<span class="amount">{yuan(row.earned_fen)}</span>
					</li>
				{/each}
			</ul>
		{/if}
	</SettingsSection>
{/if}

<style>
	.card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-bottom: 14px;
		padding: 16px;
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.card-title {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.card-title :global(svg) {
		color: var(--accent);
	}
	.plain {
		margin: 0;
		font-size: var(--fs-sm);
	}
	.field-label {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.bind {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.bind-row,
	.link-row,
	.code-line {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	/* As ui/TextField (mono), with a code's spacing. */
	.code-input {
		width: 220px;
		max-width: 100%;
		padding: 7px 11px;
		border: 1px solid var(--border);
		border-radius: var(--r-sm);
		outline: none;
		background: var(--surface2);
		color: var(--text);
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
		letter-spacing: 0.12em;
		text-transform: uppercase;
		transition: border-color var(--t-fast) var(--ease-out);
	}
	.code-input::placeholder {
		color: var(--dim2);
		letter-spacing: normal;
		text-transform: none;
	}
	.code-input:focus {
		border-color: color-mix(in oklab, var(--accent) 45%, var(--border));
	}
	.code {
		font-family: var(--font-mono);
		font-size: 22px;
		font-weight: 600;
		letter-spacing: 0.18em;
	}
	.link {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		padding: 6px 10px;
		border-radius: var(--r-md);
		background: color-mix(in oklab, var(--text) 4%, transparent);
		font-size: var(--fs-xs);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.rules {
		margin-top: 4px;
		padding: 12px 14px;
		border-radius: var(--r-md);
		background: color-mix(in oklab, var(--text) 3%, transparent);
	}
	.rules-title {
		margin-bottom: 6px;
		font-size: var(--fs-xs);
		font-weight: 600;
	}
	.rules ol {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin: 0;
		padding-left: 18px;
		color: var(--dim);
		font-size: var(--fs-xs);
		line-height: 1.55;
	}
	.hint,
	.small {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.err {
		margin: 0;
		color: var(--err);
		font-size: var(--fs-xs);
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
		margin-bottom: 18px;
	}
	.tile {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
		padding: 14px 16px;
		border-radius: var(--r-lg);
		background: var(--panel);
		box-shadow: inset 0 0 0 1px var(--hairline);
	}
	.tile-label {
		color: var(--dim);
		font-size: var(--fs-xs);
	}
	.num {
		font-size: 20px;
		font-weight: 600;
		font-variant-numeric: tabular-nums;
	}
	.empty {
		margin: 0;
		padding: 18px 0;
		color: var(--dim);
		font-size: var(--fs-sm);
		text-align: center;
	}
	.people {
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.people li {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 10px 0;
	}
	.people li + li {
		box-shadow: inset 0 1px 0 var(--hairline);
	}
	.who {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.name {
		overflow: hidden;
		font-size: var(--fs-sm);
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip {
		flex-shrink: 0;
		padding: 1px 8px;
		border-radius: var(--r-sm);
		background: color-mix(in oklab, var(--text) 6%, transparent);
		color: var(--dim);
		font-size: var(--fs-2xs);
		white-space: nowrap;
	}
	.chip.qualified {
		background: color-mix(in oklab, var(--ok) 14%, transparent);
		color: var(--ok);
	}
	.chip.rejected {
		background: color-mix(in oklab, var(--err) 12%, transparent);
		color: var(--err);
	}
	.amount {
		flex-shrink: 0;
		min-width: 84px;
		font-variant-numeric: tabular-nums;
		font-size: var(--fs-sm);
		text-align: right;
	}
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	.sk-row {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 10px;
	}
	.sk {
		height: 72px;
		border-radius: var(--r-lg);
		background: color-mix(in oklab, var(--text) 5%, transparent);
		animation: pulse 1.4s ease-in-out infinite;
	}
	.sk.tall {
		height: 180px;
	}
	@keyframes pulse {
		50% {
			opacity: 0.55;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.sk {
			animation: none;
		}
	}
</style>
