<script lang="ts">
	// The welcome page over the whole window. On a first run it is the sign-in
	// (over the website's Signal Raster): the LynShen account by device
	// authorization, after which the app is ready on the LynShen engine and
	// the account's models and plan. 跳过，稍后登录 leads to one optional page
	// to pick another agent (Claude Code, Codex) or an API key. The
	// walkthrough in the manner of VS Code's Get Started (account, agent,
	// model, appearance, basics; each writing the same settings as the
	// Settings page) opens from the command palette; every step of it can be
	// skipped. Node, Git and the agents' tools are asked for only by the agent
	// that needs them (flow.ts).
	import { onMount, untrack } from 'svelte';
	import CheckIcon from 'phosphor-svelte/lib/CheckIcon';
	import SignInIcon from 'phosphor-svelte/lib/SignInIcon';
	import KeyIcon from 'phosphor-svelte/lib/KeyIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import UserCircleIcon from 'phosphor-svelte/lib/UserCircleIcon';
	import ArrowRightIcon from 'phosphor-svelte/lib/ArrowRightIcon';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import type { MonoizeUser } from '$lib/protocol';
	import { account } from '$lib/accountSession.svelte';
	import { recheckDeps } from '$lib/deps.svelte';
	import { STEPS, type StepKey } from './flow';
	import { loadBackendSettings } from '$lib/backends/settings';
	import type { BackendId } from '$lib/backends';
	import type { SectionKey } from '$lib/settings/nav';
	import type { ChatState } from '$lib/chat.svelte';
	import { LEGAL, type LegalDocId } from '$lib/legal';
	import LegalDoc from '$lib/LegalDoc.svelte';
	import { shortcutLabel } from '$lib/shortcuts';
	import { themeState, setTheme, type ThemePref } from '$lib/theme.svelte';
	import { t, getLocale, setLocale, LOCALES, LOCALE_LABELS } from '$lib/i18n';
	import Button from '$lib/ui/Button.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import BrowserSignIn from '$lib/BrowserSignIn.svelte';
	import SignalRaster from './SignalRaster.svelte';
	import AgentStep from './AgentStep.svelte';
	import ModelStep from './ModelStep.svelte';

	let {
		sessionId,
		chat,
		loggedIn,
		configured,
		startAt,
		firstRun = false,
		hidden = false,
		onRefreshAuth,
		onOpenSettings,
		onSignedIn,
		onDismiss,
		onClose
	}: {
		/** The session the /login runs in, to catch a failed login. */
		sessionId: string;
		chat?: ChatState;
		/** Signed in to a LynShen account. */
		loggedIn: boolean;
		/** Any provider has a login or key (LynShen or the user's own). */
		configured: boolean;
		/** The first view: the sign-in (a first run, after logging out) or the
		 *  walkthrough (the command palette). */
		startAt?: 'login' | 'guide';
		/** No first run finished yet: 跳过，稍后登录 opens the agent page. */
		firstRun?: boolean;
		hidden?: boolean;
		onRefreshAuth: () => void;
		onOpenSettings: (section: SectionKey) => void;
		/** A sign-in here finished (or one was found): the page closes. */
		onSignedIn: (user: MonoizeUser) => Promise<void> | void;
		/** Closed without a choice (跳过 after logging out, 稍后设置, Escape). */
		onDismiss: () => void;
		/** 开始使用: the agent (and the model, when one was confirmed). */
		onClose: (choice: { backend: BackendId; model: string; effort: string; gateway: boolean }) => Promise<void> | void;
	} = $props();

	let view = $state<'login' | 'agents' | 'guide'>(untrack(() => startAt ?? 'login'));
	let step = $state<StepKey>('account');
	let visited = $state<StepKey[]>([]);
	$effect(() => {
		if (view === 'guide' && !visited.includes(step)) visited.push(step);
	});

	let backend = $state<BackendId>(loadBackendSettings().default);
	let agentReady = $state(false);
	let modelReady = $state(false);
	let selectedModel = $state('');
	let selectedEffort = $state('');
	let selectedGateway = $state(false);
	let modelBackend = $state<BackendId>(untrack(() => backend));
	let refreshToken = $state(0);
	let finishing = $state(false);
	let finishError = $state('');
	let wasHidden = false;
	$effect(() => {
		if (wasHidden && !hidden) { refreshToken++; void recheckDeps(); onRefreshAuth(); }
		wasHidden = hidden;
	});
	$effect(() => {
		if (backend !== modelBackend) {
			selectedModel = '';
			modelReady = false;
			modelBackend = backend;
		}
	});

	const monoizeUser = $derived(account.user);

	// Nothing is required: a step is marked done when it is, and every step
	// opens and can be left as it is.
	const done = $derived<Record<StepKey, boolean>>({
		account: loggedIn || !!monoizeUser || configured,
		agent: agentReady,
		model: modelReady,
		appearance: visited.includes('appearance'),
		basics: visited.includes('basics')
	});
	const doneCount = $derived(STEPS.filter((s) => done[s]).length);
	function next() {
		const following = STEPS[STEPS.indexOf(step) + 1];
		if (following) step = following;
	}

	// Signed in already (the sign-in was opened while signed in): straight back.
	let touched = false;
	onMount(async () => {
		if (view !== 'login') return;
		const user = await account.read().catch(() => null);
		if (user && !touched && view === 'login') void signedIn(user);
	});

	let signingIn = $state(false);
	async function signedIn(user: MonoizeUser) {
		account.signedIn(user);
		signingIn = true;
		try {
			await onSignedIn(user);
		} finally {
			signingIn = false;
		}
	}
	function skip() {
		touched = true;
		if (firstRun) view = 'agents';
		else onDismiss();
	}

	let legal = $state<LegalDocId | null>(null);
	const legalTitle = (doc: LegalDocId) => LEGAL[doc][getLocale() === 'zh' ? 'zh' : 'en'].title;

	function openSettings(section: SectionKey) {
		onOpenSettings(section);
	}
	async function finish() {
		if (finishing) return;
		finishing = true;
		finishError = '';
		try {
			// A model counts only once it was confirmed (the model step).
			const model = view === 'guide' && modelReady ? selectedModel : '';
			await onClose({ backend, model, effort: model ? selectedEffort : '', gateway: !!model && selectedGateway });
		} catch (e) {
			finishError = t('settings.page.saveFailed', { msg: String(e) });
		} finally {
			finishing = false;
		}
	}
	// Escape leaves the optional pages (not the sign-in, where it would skip
	// by accident); a dialog over the page (legal text, settings) takes it first.
	function onKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || hidden || legal || e.defaultPrevented || view === 'login') return;
		e.preventDefault();
		if (view === 'agents') void finish();
		else onDismiss();
	}

	const KEYS: { label: string; key: string }[] = $derived([
		{ label: t('setup.welcome.basics.palette'), key: shortcutLabel('palette') },
		{ label: t('setup.welcome.basics.newSession'), key: shortcutLabel('newSession') },
		{ label: t('setup.welcome.basics.slash'), key: '/' },
		{ label: t('setup.welcome.basics.mention'), key: '@' }
	].filter((k) => k.key));
	const themeOpts = $derived([
		{ value: 'system', label: t('settings.themeSystem') },
		{ value: 'light', label: t('settings.themeLight') },
		{ value: 'dark', label: t('settings.themeDark') }
	]);
</script>

<svelte:window onkeydown={onKey} />

<div class="welcome" class:concealed={hidden} role="dialog" aria-modal="true" aria-label={t('setup.welcome.label')}>
	<div class="drag" data-tauri-drag-region></div>

	{#if view === 'login'}
		<section class="login">
			<div class="raster" aria-hidden="true"><SignalRaster /></div>

			<div class="copy">
				<div class="wordmark">Aogiri</div>
				<h1>{t('setup.welcome.login.title')}</h1>
				<p class="lede">{t('setup.welcome.login.sub')}</p>

				<div class="actions">
					{#if signingIn}
						<p class="busy" role="status"><CircleNotchIcon size={15} class="spin" /> {t('setup.welcome.login.finishing')}</p>
					{:else}
						<BrowserSignIn onSuccess={(user) => { touched = true; void signedIn(user); }} />
					{/if}
				</div>

				{#if !signingIn}
					<button class="later" onclick={skip}>
						{t('setup.welcome.login.later')} <ArrowRightIcon size={13} />
					</button>
				{/if}
			</div>

			<p class="agree">
				{t('setup.loginOauth.agreeBefore')}<button class="link" onclick={() => (legal = 'terms')}>{legalTitle('terms')}</button>{t('setup.loginOauth.agreeAnd')}<button class="link" onclick={() => (legal = 'privacy')}>{legalTitle('privacy')}</button>{t('setup.loginOauth.agreeAfter')}
			</p>
		</section>
	{:else if view === 'agents'}
		<!-- 跳过，稍后登录 on a first run: another agent or an API key, all optional. -->
		<section class="login agents">
			<div class="raster" aria-hidden="true"><SignalRaster /></div>

			<div class="copy wide">
				<h1>{t('setup.welcome.agents.title')}</h1>
				<p class="lede">{t('setup.welcome.agents.sub')}</p>

				<div class="pick">
					<AgentStep bind:selected={backend} bind:ready={agentReady} onOpenSettings={() => openSettings('acp')} />
				</div>
				{#if backend === 'lynshen' && !configured}<p class="hint">{t('setup.welcome.agents.lynshenNeeds')}</p>{/if}
				{#if finishError}<Notice>{finishError}</Notice>{/if}

				<div class="actions row">
					<Button variant="primary" onclick={finish} disabled={finishing}>{#if finishing}<CircleNotchIcon size={14} class="spin" />{/if}{t('setup.nav.start')}</Button>
					<Button variant="secondary" onclick={() => openSettings('providers')}><KeyIcon size={15} /> {t('setup.welcome.login.apiKey')}</Button>
					<button class="later back" onclick={() => (view = 'login')}>
						<ArrowLeftIcon size={13} /> {t('setup.welcome.guide.backToLogin')}
					</button>
				</div>
			</div>

			<p class="agree">
				{t('setup.loginOauth.agreeBefore')}<button class="link" onclick={() => (legal = 'terms')}>{legalTitle('terms')}</button>{t('setup.loginOauth.agreeAnd')}<button class="link" onclick={() => (legal = 'privacy')}>{legalTitle('privacy')}</button>{t('setup.loginOauth.agreeAfter')}
			</p>
		</section>
	{:else}
		<section class="guide">
			<header class="ghead">
				<div class="band" aria-hidden="true"><SignalRaster /></div>
				<div class="ghead-copy">
					<div class="wordmark sm">Aogiri</div>
					<h1>{t('setup.welcome.guide.title')}</h1>
					<p class="lede">{t('setup.welcome.guide.sub')}</p>
				</div>
			</header>

			<div class="gbody">
				<nav class="steps" aria-label={t('setup.welcome.guide.title')}>
					{#each STEPS as key (key)}
						<button class="step" class:on={step === key} aria-current={step === key ? 'step' : undefined} onclick={() => (step = key)}>
							<span class="mark" class:done={done[key]} aria-hidden="true">{#if done[key]}<CheckIcon size={11} weight="bold" />{/if}</span>
							<span class="stitle">{t(`setup.welcome.${key}.title`)}</span>
						</button>
					{/each}
					<div class="progress">
						<span class="pbar"><span style:width="{(doneCount / STEPS.length) * 100}%"></span></span>
						<span class="ptext">{t('setup.welcome.guide.progress', { done: doneCount, total: STEPS.length })}</span>
					</div>
				</nav>

				<div class="detail">
					{#key step}
						<div class="pane">
							<h2>{t(`setup.welcome.${step}.title`)}</h2>
							<p class="psub">{t(`setup.welcome.${step}.sub`)}</p>

							{#if step === 'account'}
								{#if monoizeUser}
									<div class="okline"><span class="okico"><UserCircleIcon size={20} /></span>{t('setup.welcome.account.loggedIn')} · {monoizeUser.username}</div>
									<div class="row"><Button size="sm" onclick={() => openSettings('account')}>{t('setup.welcome.account.manage')}</Button></div>
								{:else if loggedIn}
									<div class="okline"><span class="okico"><UserCircleIcon size={20} /></span>{t('setup.welcome.account.loggedIn')}</div>
									<div class="row"><Button size="sm" onclick={() => openSettings('account')}>{t('setup.welcome.account.manage')}</Button></div>
								{:else}
									{#if configured}<div class="okline"><span class="okico"><KeyIcon size={18} /></span>{t('setup.welcome.account.byok')}</div>{/if}
									<p class="hint">{t('settings.monoize.loginHint')}</p>
									<div class="row">
										<Button variant="primary" size="sm" onclick={() => { touched = true; view = 'login'; }}>
											<SignInIcon size={14} /> {t('settings.monoize.loginRegister')}
										</Button>
										<Button variant="ghost" size="sm" onclick={() => openSettings('providers')}><KeyIcon size={14} /> {t('setup.welcome.login.apiKey')}</Button>
									</div>
								{/if}
							{:else if step === 'agent'}
								<AgentStep bind:selected={backend} bind:ready={agentReady} onOpenSettings={() => openSettings('acp')} />
							{:else if step === 'model'}
								<ModelStep
									{loggedIn}
									{backend}
									bind:ready={modelReady}
									bind:selectedModel
									{refreshToken}
									onSelected={(model, effort, gateway) => { selectedModel = model; selectedEffort = effort; selectedGateway = gateway; }}
									onLogin={() => { touched = true; view = 'login'; }}
									onOpenProviders={() => openSettings('providers')}
								/>
							{:else if step === 'appearance'}
								<div class="field">
									<span class="flabel">{t('settings.theme')}</span>
									<Segmented value={themeState.pref} options={themeOpts} onChange={(v) => setTheme(v as ThemePref)} />
								</div>
								<div class="field">
									<span class="flabel">{t('settings.language')}</span>
									<Segmented value={getLocale()} options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))} onChange={(v) => setLocale(v as (typeof LOCALES)[number])} />
								</div>
							{:else}
								<dl class="keys">
									{#each KEYS as k (k.label)}
										<div><dt>{k.label}</dt><dd><kbd>{k.key}</kbd></dd></div>
									{/each}
								</dl>
								{#if shortcutLabel('shortcuts')}<p class="more">{t('setup.welcome.basics.all')} <kbd>{shortcutLabel('shortcuts')}</kbd></p>{/if}
							{/if}
						</div>
					{/key}
				</div>
			</div>

			<footer class="gfoot">
				{#if !loggedIn}<button class="later" onclick={() => { touched = true; view = 'login'; }}>{t('setup.welcome.guide.backToLogin')}</button>{/if}
				{#if finishError}<Notice>{finishError}</Notice>{/if}
				<div class="spacer"></div>
				<Button variant="ghost" onclick={onDismiss}>{t('setup.welcome.guide.later')}</Button>
				{#if step === STEPS[STEPS.length - 1]}
					<Button variant="primary" onclick={finish} disabled={finishing}>{#if finishing}<CircleNotchIcon size={14} class="spin" />{/if}{t('setup.nav.start')}</Button>
				{:else}
					<Button variant="primary" onclick={next}>{t('setup.nav.next')} <ArrowRightIcon size={13} /></Button>
				{/if}
			</footer>
		</section>
	{/if}
</div>

{#if legal}
	<LegalDoc doc={legal} onClose={() => (legal = null)} />
{/if}

<style>
	.welcome.concealed { display: none; }
	/* Under Modal (z 100), so the model picker and legal docs open on top. On
	   Windows/Linux the window controls are drawn in the title bar, which stays
	   visible above the page; macOS keeps its native traffic lights. */
	.welcome {
		position: fixed;
		inset: 48px 0 0;
		z-index: 90;
		display: flex;
		background: var(--bg);
		color: var(--text);
		overflow: hidden;
	}
	:global(html[data-os='macos']) .welcome {
		inset: 0;
	}
	.drag {
		position: absolute;
		inset: 0 0 auto;
		height: 40px;
		z-index: 3;
	}
	.wordmark {
		font-weight: 600;
		font-size: var(--fs-lg);
		letter-spacing: -0.01em;
	}
	h1 {
		margin: 0;
		font-size: var(--fs-2xl);
		font-weight: 600;
		letter-spacing: -0.025em;
		line-height: 1.15;
	}
	.lede {
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-md);
		line-height: 1.65;
	}
	.hint {
		margin: 12px 0 0;
		font-size: var(--fs-xs);
		color: var(--dim);
		line-height: 1.55;
	}
	.later {
		flex-shrink: 0;
		white-space: nowrap;
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		cursor: pointer;
	}
	.later:hover {
		color: var(--text);
	}
	.link {
		padding: 0;
		border: 0;
		background: none;
		color: var(--text);
		font: inherit;
		text-decoration: underline;
		text-decoration-color: var(--border-strong);
		text-underline-offset: 3px;
		cursor: pointer;
	}
	.link:hover {
		text-decoration-color: currentColor;
	}

	/* ---------- sign-in ---------- */
	.login {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 64px clamp(40px, 8vw, 120px) 32px;
	}
	/* The website hero's placement: the field on the right 60%, faded in from
	   the copy column and out at the top and bottom edges. */
	.raster {
		position: absolute;
		inset: 0 0 0 38%;
		z-index: 0;
		--raster-opacity: 0.56;
		mask-image: linear-gradient(90deg, transparent 0, #000 24%), linear-gradient(transparent 0, #000 16%, #000 82%, transparent);
		mask-composite: intersect;
		-webkit-mask-image: linear-gradient(90deg, transparent 0, #000 24%), linear-gradient(transparent 0, #000 16%, #000 82%, transparent);
		-webkit-mask-composite: source-in;
		cursor: crosshair;
	}
	:global([data-theme='light']) .raster {
		--raster-opacity: 0.88;
	}
	.copy {
		position: relative;
		z-index: 1;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		width: min(440px, 100%);
	}
	.copy .wordmark {
		margin-bottom: 40px;
	}
	.copy h1 {
		margin-bottom: 14px;
	}
	.actions {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 10px;
		width: 100%;
		max-width: 320px;
		margin-top: 32px;
	}
	.copy .later {
		margin-top: 22px;
	}
	.busy {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		color: var(--dim);
		font-size: var(--fs-sm);
	}
	/* The agent page: a wider column for the list, the field further right,
	   and room to scroll in a short window. */
	.agents {
		min-height: 0;
		justify-content: safe center;
		overflow-y: auto;
		padding-top: 48px;
		padding-bottom: 28px;
	}
	/* In the page's flow here: the list can be long. */
	.agents .agree {
		position: static;
		margin-top: 28px;
	}
	.copy .actions .back {
		margin: 0 0 0 8px;
	}
	.agents .raster {
		inset: 0 0 0 56%;
	}
	.copy.wide {
		width: min(520px, 100%);
	}
	.agents h1 {
		margin-bottom: 12px;
	}
	.pick {
		width: 100%;
		margin-top: 24px;
	}
	.agents .hint {
		margin: 10px 0 0;
	}
	.actions.row {
		flex-direction: row;
		flex-wrap: wrap;
		align-items: center;
		max-width: none;
		margin-top: 24px;
	}
	.agree {
		position: absolute;
		left: clamp(40px, 8vw, 120px);
		bottom: 28px;
		z-index: 1;
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	/* One rise on first paint, children staggered (the website hero's entrance).
	   Fill backwards: hidden through their delay, nothing held once in (a held
	   end kept each child transformed for good). */
	.copy > :global(*) {
		animation: rise 0.6s cubic-bezier(0.2, 0.7, 0.2, 1) backwards;
	}
	.copy > :global(:nth-child(2)) {
		animation-delay: 60ms;
	}
	.copy > :global(:nth-child(3)) {
		animation-delay: 120ms;
	}
	.copy > :global(:nth-child(n + 4)) {
		animation-delay: 180ms;
	}
	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(16px);
		}
	}

	/* ---------- walkthrough ---------- */
	.guide {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		animation: fade 0.35s ease backwards;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
	.ghead {
		position: relative;
		flex-shrink: 0;
		padding: 56px clamp(32px, 6vw, 88px) 32px;
		border-bottom: 1px solid var(--hairline);
	}
	.band {
		position: absolute;
		inset: 0 0 0 45%;
		--raster-opacity: 0.4;
		mask-image: linear-gradient(90deg, transparent 0, #000 40%);
		-webkit-mask-image: linear-gradient(90deg, transparent 0, #000 40%);
	}
	:global([data-theme='light']) .band {
		--raster-opacity: 0.7;
	}
	.ghead-copy {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-width: 560px;
	}
	.wordmark.sm {
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.gbody {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: clamp(24px, 4vw, 56px);
		padding: 28px clamp(32px, 6vw, 88px) 0;
	}
	.steps {
		flex: 0 0 260px;
		display: flex;
		flex-direction: column;
		gap: 2px;
		overflow-y: auto;
	}
	.step {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 11px 12px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		font: inherit;
		text-align: left;
		cursor: pointer;
		transition: background-color 0.15s ease;
	}
	.step:hover {
		background: var(--surface);
		color: var(--text);
	}
	.step.on {
		background: var(--surface2);
		color: var(--text);
	}
	.step:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: -2px;
	}
	.mark {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 18px;
		height: 18px;
		flex-shrink: 0;
		border-radius: 50%;
		border: 1.5px solid var(--border-strong);
	}
	.mark.done {
		border-color: var(--ok);
		background: var(--ok);
		color: var(--bg);
	}
	.stitle {
		font-size: var(--fs-sm);
		font-weight: 500;
	}
	.progress {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 18px;
		padding: 0 12px;
	}
	.pbar {
		height: 3px;
		border-radius: var(--r-full);
		background: var(--surface2);
		overflow: hidden;
	}
	.pbar span {
		display: block;
		height: 100%;
		background: var(--ok);
		transition: width 0.3s ease;
	}
	.ptext {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.detail {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
		padding-bottom: 32px;
	}
	.pane {
		max-width: 620px;
		animation: fade 0.25s ease backwards;
	}
	h2 {
		margin: 0;
		font-size: var(--fs-xl);
		font-weight: 600;
		letter-spacing: -0.015em;
	}
	.psub {
		margin: 8px 0 24px;
		font-size: var(--fs-sm);
		color: var(--dim);
		line-height: 1.6;
	}
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.okline {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 16px;
		font-size: var(--fs-sm);
	}
	.okico {
		display: inline-flex;
		color: var(--ok);
	}
	.field {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 10px;
		margin-bottom: 24px;
	}
	.flabel {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.keys {
		margin: 0;
		display: flex;
		flex-direction: column;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
	}
	.keys div {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 11px 16px;
	}
	.keys div + div {
		border-top: 1px solid var(--hairline);
	}
	.keys dt {
		font-size: var(--fs-sm);
	}
	.keys dd {
		margin: 0;
	}
	kbd {
		display: inline-block;
		min-width: 24px;
		padding: 2px 7px;
		border: 1px solid var(--border);
		border-bottom-width: 2px;
		border-radius: var(--r-xs);
		background: var(--surface);
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--dim);
		text-align: center;
	}
	.more {
		margin: 14px 0 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}

	.gfoot {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
		padding: 16px clamp(32px, 6vw, 88px);
		border-top: 1px solid var(--hairline);
	}
	.spacer {
		flex: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.copy > :global(*),
		.guide,
		.pane {
			animation: none;
		}
	}
</style>
