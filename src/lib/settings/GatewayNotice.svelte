<script lang="ts">
	// The reason a device-key page (邀请好友, 授权设备) could not load, with the
	// way out: verify an email on the console (EV-G2), sign in, or retry.
	import { onMount } from 'svelte';
	import Button from '$lib/ui/Button.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { t } from '$lib/i18n';
	import { openExternal } from '$lib/openExternal';
	import { GatewayError, readConfig } from '$lib/protocol';

	let {
		error,
		fallback,
		onRetry,
		onSignIn
	}: {
		error: unknown;
		/** What failed, when the gateway gave no specific reason. */
		fallback: string;
		onRetry: () => void;
		onSignIn: () => void;
	} = $props();

	let web = $state('https://www.lynshen.org');
	onMount(() => {
		readConfig()
			.then((cfg) => (web = String(cfg.lynshen_web_url || web).replace(/\/+$/, '')))
			.catch(() => {});
	});

	const code = $derived(error instanceof GatewayError ? error.code : null);
	const unauthorized = $derived(code === 'not_signed_in' || code === 'invalid_token' || (error instanceof GatewayError && error.status === 401));
</script>

{#if code === 'email_unverified'}
	<Notice tone="warn">
		<span class="line">
			{t('settings.accountGate.emailUnverified')}
			<Button size="sm" variant="primary" onclick={() => openExternal(`${web}/dashboard`)}>{t('settings.accountGate.openConsole')}</Button>
		</span>
	</Notice>
{:else if unauthorized}
	<Notice tone="info">
		<span class="line">
			{t('settings.accountGate.signIn')}
			<Button size="sm" variant="primary" onclick={onSignIn}>{t('settings.monoize.loginRegister')}</Button>
		</span>
	</Notice>
{:else}
	<Notice>
		<span class="line">
			{fallback}
			<Button size="sm" onclick={onRetry}>{t('settings.invite.retry')}</Button>
		</span>
		{#if error instanceof Error && error.message}<span class="why">{error.message}</span>{/if}
	</Notice>
{/if}

<style>
	.why {
		display: block;
		margin-top: 4px;
		opacity: 0.8;
		word-break: break-word;
	}
	.line {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px;
	}
</style>
