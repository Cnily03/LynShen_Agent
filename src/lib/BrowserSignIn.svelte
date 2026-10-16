<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { invoke } from '@tauri-apps/api/core';
	import { openUrl } from '@tauri-apps/plugin-opener';
	import type { MonoizeUser } from '$lib/protocol';
	import { pollForSignIn, type SignInPoll } from '$lib/signInPoll';
	import { t } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	let { onSuccess, autoStart = false }: { autoStart?: boolean; onSuccess: (user: MonoizeUser) => void } = $props();
	let busy = $state(false);
	let code = $state('');
	let error = $state('');
	// The same page on the other domains, in case the browser cannot open
	// the first; offered after a few seconds without approval.
	let alternates = $state<string[]>([]);
	let showAlternates = $state(false);
	let altTimer: ReturnType<typeof setTimeout> | undefined;
	let generation = 0;
	let polling: SignInPoll | undefined;
	function cancel() {
		generation++;
		clearTimeout(altTimer); polling?.stop(); polling = undefined;
		if (code) void invoke('monoize_oauth_cancel', { userCode: code }).catch(() => {});
		busy = false; code = ''; alternates = []; showAlternates = false;
	}
	onDestroy(cancel);
	onMount(() => { if (autoStart) void start(); });
	async function start() {
		if (busy) return;
		busy = true; error = '';
		const current = ++generation;
		try {
			const attempt = await invoke<{ user_code: string; verification_uri_complete: string; alternates?: string[] }>('monoize_oauth_start');
			if (current !== generation) {
				void invoke('monoize_oauth_cancel', { userCode: attempt.user_code }).catch(() => {});
				return;
			}
			code = attempt.user_code;
			alternates = attempt.alternates ?? [];
			altTimer = setTimeout(() => (showAlternates = true), 10_000);
			await openUrl(attempt.verification_uri_complete);
			if (current !== generation) return;
			// The consent page's lynshen://auth link makes it poll at once (authLinkOpened).
			polling = pollForSignIn(() => invoke<{ pending?: boolean; user?: MonoizeUser }>('monoize_oauth_poll', { userCode: attempt.user_code }));
			const user = await polling.done;
			if (current !== generation || !user) return;
			polling = undefined; code = ''; busy = false; onSuccess(user);
		} catch (cause) {
			if (current === generation) { error = String(cause); cancel(); }
		}
	}
</script>

<div class="browser-sign-in">
	<p>{t('settings.monoize.browserHint')}</p>
	{#if code}<p class="code">{code.slice(0, 6)}-{code.slice(6)}</p>{/if}
	{#if error}<p role="alert" class="error">{error}</p>{/if}
	{#if code && showAlternates && alternates.length}
		<p class="alt">
			{t('settings.monoize.browserAlternate')}
			{#each alternates as url, i (url)}<button class="link" onclick={() => void openUrl(url)}>{t('settings.monoize.browserAlternateLink', { n: i + 1 })}</button>{/each}
		</p>
	{/if}
	<Button variant="primary" onclick={start} disabled={busy}>{t(busy ? 'settings.monoize.browserWaiting' : 'settings.monoize.browserLogin')}</Button>
	{#if busy}<Button variant="secondary" onclick={cancel}>{t('settings.monoize.browserCancel')}</Button>{/if}
</div>

<style>
	.browser-sign-in { display: flex; flex-direction: column; gap: 12px; }
	p { margin: 0; color: var(--dim); font-size: var(--fs-sm); line-height: 1.6; }
	.code { color: var(--text); font-family: var(--font-mono); font-size: var(--fs-lg); letter-spacing: .12em; }
	.error { overflow-wrap: anywhere; color: var(--err); }
	.alt { font-size: var(--fs-xs); }
	.link { margin-left: 6px; padding: 0; border: none; background: none; color: var(--accent); font: inherit; cursor: pointer; }
	.link:hover { text-decoration: underline; }
</style>
