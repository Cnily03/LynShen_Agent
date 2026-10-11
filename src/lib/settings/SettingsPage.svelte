<script lang="ts">
	import { paneOut } from '$lib/ui/motion';
	// The settings page: covers the content panel (session list + canvas stay
	// mounted underneath) with a nav column on the left — a flat list of
	// sections and a search over every row — and the selected section's page
	// on the right. Config fields apply as they change (debounced writeConfig);
	// keys, logins and new providers keep their explicit buttons.
	import { onDestroy, onMount, tick } from 'svelte';
	import { open as openDialog } from '@tauri-apps/plugin-dialog';
	import { convertFileSrc } from '@tauri-apps/api/core';
	import BrowserSignIn from '$lib/BrowserSignIn.svelte';
	import ProviderSignIn from '$lib/ProviderSignIn.svelte';
	import { refreshMonoizeCatalog } from '$lib/providers/monoize';
	import ArrowLeftIcon from 'phosphor-svelte/lib/ArrowLeftIcon';
	import MagnifyingGlassIcon from 'phosphor-svelte/lib/MagnifyingGlassIcon';
	import GearSixIcon from 'phosphor-svelte/lib/GearSixIcon';
	import KeyboardIcon from 'phosphor-svelte/lib/KeyboardIcon';
	import UserCircleIcon from 'phosphor-svelte/lib/UserCircleIcon';
	import GiftIcon from 'phosphor-svelte/lib/GiftIcon';
	import DesktopTowerIcon from 'phosphor-svelte/lib/DesktopTowerIcon';
	import ChartBarIcon from 'phosphor-svelte/lib/ChartBarIcon';
	import MicrophoneIcon from 'phosphor-svelte/lib/MicrophoneIcon';
	import PlugsIcon from 'phosphor-svelte/lib/PlugsIcon';
	import BrainIcon from 'phosphor-svelte/lib/BrainIcon';
	import GlobeIcon from 'phosphor-svelte/lib/GlobeIcon';
	import HardDrivesIcon from 'phosphor-svelte/lib/HardDrivesIcon';
	import StorefrontIcon from 'phosphor-svelte/lib/StorefrontIcon';
	import RobotIcon from 'phosphor-svelte/lib/RobotIcon';
	import UsersThreeIcon from 'phosphor-svelte/lib/UsersThreeIcon';
	import PlugsConnectedIcon from 'phosphor-svelte/lib/PlugsConnectedIcon';
	import TrayArrowDownIcon from 'phosphor-svelte/lib/TrayArrowDownIcon';
	import InfoIcon from 'phosphor-svelte/lib/InfoIcon';
	import DeviceMobileIcon from 'phosphor-svelte/lib/DeviceMobileIcon';
	import SignInIcon from 'phosphor-svelte/lib/SignInIcon';
	import SignOutIcon from 'phosphor-svelte/lib/SignOutIcon';
	import PlusIcon from 'phosphor-svelte/lib/PlusIcon';
	import CheckCircleIcon from 'phosphor-svelte/lib/CheckCircleIcon';
	import ListChecksIcon from 'phosphor-svelte/lib/ListChecksIcon';
	import CopyIcon from 'phosphor-svelte/lib/CopyIcon';
	import ImageIcon from 'phosphor-svelte/lib/ImageIcon';
	import ArrowsClockwiseIcon from 'phosphor-svelte/lib/ArrowsClockwiseIcon';
	import CircleNotchIcon from 'phosphor-svelte/lib/CircleNotchIcon';
	import {
		readConfig,
		writeConfig,
		readAuthProviders,
		setAuthKey,
		removeAuthKey,
		listProviders,
		fetchAccountInfo,
		fetchDeepseekBalance,
		fetchMonoizeBalance,
		fetchMonoizeModels,
		monoizeLogout,
		monoizeSession,
		monoizeMarketplace,
		setBackgroundImage,
		clearBackgroundImage,
		type AccountInfo,
		type DeepseekBalance,
		type MonoizeUser,
		type MonoizeMarketplaceModel,
		monoizeModelEntries
	} from '$lib/protocol';
	import { monoizeEntries } from '$lib/providers/monoize';
	import { dispatch } from '$lib/backends/router';
	import { caps } from '$lib/backends';
	import { prefs, TURN_STAT_KEYS, BACKGROUND_STRENGTHS, vibrancySupported } from '$lib/prefs.svelte';
	import { turnParts } from '$lib/turnStats';
	import { themeState, setTheme, type ThemePref } from '$lib/theme.svelte';
	import type { ChatState, TurnStats } from '$lib/chat.svelte';
	import { modelSetup } from '$lib/modelSetupState.svelte';
	import { loginErrorSince } from '$lib/loginWatch';
	import { t, setLocale, getLocale, LOCALES, LOCALE_LABELS } from '$lib/i18n';
	import { ASR_PROVIDERS, asrProvider, resolveAsrSettings, type AsrSettings } from '$lib/audio';
	import { PROVIDER_CATALOG, providerFormPrefill, type CatalogProvider } from '$lib/providers/catalog';
	import Vendor from '$lib/Vendor.svelte';
	import OverviewPanel from '$lib/OverviewPanel.svelte';
	import { cloudSync } from '$lib/cloudSync.svelte';
	import Dependencies from '$lib/Dependencies.svelte';
	import { deps, recheckDeps } from '$lib/deps.svelte';
	import Button from '$lib/ui/Button.svelte';
	import TextField from '$lib/ui/TextField.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Checkbox from '$lib/ui/Checkbox.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { shownBalanceText } from '$lib/money';
	import AccountPage from './AccountPage.svelte';
	import InviteSection from './InviteSection.svelte';
	import DevicesSection from './DevicesSection.svelte';
	import Notice from '$lib/ui/Notice.svelte';
	import { toast } from '$lib/ui/toast.svelte';
	import SettingsSection from './SettingsSection.svelte';
	import SettingsRow from './SettingsRow.svelte';
	import BackendSection from './BackendSection.svelte';
	import AcpSection from './AcpSection.svelte';
	import DaemonSection from './DaemonSection.svelte';
	import McpSection from './McpSection.svelte';
	import ImportSection from './ImportSection.svelte';
	import ShortcutsSection from './ShortcutsSection.svelte';
	import TeamSection from './TeamSection.svelte';
	import PermissionRulesSection from './PermissionRulesSection.svelte';
	import UpdateCard from './UpdateCard.svelte';
	import ThirdPartyNotices from './ThirdPartyNotices.svelte';
	import ProviderAccountCard from './ProviderAccountCard.svelte';
	import ProviderCatalogPicker from './ProviderCatalogPicker.svelte';
	import CustomProviderForm from './CustomProviderForm.svelte';
	import Modal from '$lib/ui/Modal.svelte';
	import { GROUPS, resolveSection, searchRows, type SearchRow, type SectionKey } from './nav';

	let {
		sessionId,
		chat,
		section = $bindable('general'),
		navWidth,
		onClose,
		onAuthChange,
		onAccountLogout,
		onMarket,
		onFeedback,
		onAddFolders
	}: {
		sessionId: string;
		/** The active session's ChatState — source of the live `mcp_servers` view.
		 *  The engine's MCP config is global, so any live session's engine works. */
		chat?: ChatState;
		/** Open section (a SectionKey; legacy keys such as 'overview' map via resolveSection). */
		section?: string;
		/** Width of the nav column — the session list's width, so the page lines up with it. */
		navWidth: number;
		onClose: () => void;
		onAuthChange?: () => void;
		onAccountLogout?: () => void;
		/** Open the skill marketplace (closes the settings page). */
		onMarket?: () => void;
		/** Open 反馈问题. */
		onFeedback?: () => void;
		/** Show these folders as projects in the sidebar (导入); how many were new. */
		onAddFolders?: (paths: string[]) => number;
	} = $props();

	const ICONS: Record<SectionKey, typeof GearSixIcon> = {
		general: GearSixIcon,
		shortcuts: KeyboardIcon,
		account: UserCircleIcon,
		invite: GiftIcon,
		devices: DesktopTowerIcon,
		usage: ChartBarIcon,
		voice: MicrophoneIcon,
		providers: PlugsIcon,
		models: BrainIcon,
		network: GlobeIcon,
		mcp: HardDrivesIcon,
		market: StorefrontIcon,
		agents: RobotIcon,
		team: UsersThreeIcon,
		acp: PlugsConnectedIcon,
		import: TrayArrowDownIcon,
		daemon: DeviceMobileIcon,
		updates: InfoIcon
	};
	const current = $derived(resolveSection(section));

	// Made-up turn for the reply-stats preview, so every figure has a value.
	const SAMPLE_TURN: TurnStats = {
		elapsed: 48300,
		ttft: 1200,
		segments: 2,
		inTokens: 18400,
		outTokens: 2100,
		files: 3,
		added: 42,
		removed: 7,
		tools: 6,
		cost: 0.084,
		model: 'claude-sonnet-5-5'
	};
	const previewParts = $derived(turnParts(SAMPLE_TURN, prefs.turnStats));

	// ---------- search ----------
	let query = $state('');
	const hits = $derived(searchRows(query, t));

	async function goTo(r: SearchRow) {
		section = r.section;
		await tick();
		const el = document.getElementById(`set-${r.id}`);
		if (!el) return;
		el.scrollIntoView({ block: 'center', behavior: 'smooth' });
		el.classList.remove('flash');
		void el.offsetWidth; // restart the animation on a repeat hit
		el.classList.add('flash');
		setTimeout(() => el.classList.remove('flash'), 1700);
	}

	/** The account page's Manage: the provider card lives under Providers, so go
	 *  there, open it and bring it into view. */
	async function openProviderCard(id: string) {
		section = 'providers';
		editing = id;
		await tick();
		document.getElementById(`pcard-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
	}

	/** Providers page with `p`'s key entry open: its card when it is listed,
	 *  else the add dialog's key step for it. */
	async function openProviderKey(p: Provider) {
		if (addedProviders.some((x) => x.id === p.id)) return openProviderCard(p.id);
		section = 'providers';
		keyTarget = p;
		keyInput = '';
		editing = '__key__';
	}

	function onSearchKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && query) {
			e.preventDefault();
			query = '';
		} else if (e.key === 'Enter' && hits[0]) {
			goTo(hits[0]);
		}
	}

	// Escape leaves settings, unless something on top of it (a dialog or a
	// menu) takes the key first.
	function onWindowKey(e: KeyboardEvent) {
		if (e.key !== 'Escape' || e.defaultPrevented) return;
		if (document.querySelector('[aria-modal="true"], [role="menu"]')) return;
		e.preventDefault();
		onClose();
	}

	// ---------- engine config + providers ----------
	interface ModelCfg {
		name: string;
		display_name?: string | null;
		context_window?: number;
		max_output_tokens?: number;
		reasoning_efforts?: string[];
	}
	interface Provider {
		id: string;
		name?: string;
		base_url: string;
		format: string;
		models: ModelCfg[];
		builtin: boolean;
		source?: 'catalog' | 'custom';
	}
	const CUSTOM_KEY = 'lynshen-custom-providers';
	const FORMATS = [
		{ value: 'responses', label: 'Responses' },
		{ value: 'anthropic', label: 'Anthropic' },
		{ value: 'chat', label: 'Chat Completions' }
	];

	let cfg = $state<Record<string, any>>({});
	let keyed = $state<string[]>([]);
	let builtin = $state<{ id: string; base_url: string; protocol: string; models: ModelCfg[] }[]>([]);
	let custom = $state<Provider[]>([]);
	let asr = $state<AsrSettings>(resolveAsrSettings(null));
	let asrKey = $state('');

	// inline editor state
	// A provider id (its card open), or a step of the add dialog: '__catalog__'
	// (pick), '__key__' (key for a built-in, `keyTarget`), '__new__' (form).
	let editing = $state<string | null>(null);
	let keyTarget = $state<Provider | null>(null);
	let keyInput = $state('');
	let form = $state<{ id: string; base_url: string; format: string; key: string; models: ModelCfg[] }>({ id: '', base_url: '', format: 'responses', key: '', models: [] });
	let selectedCatalog = $state<CatalogProvider | null>(null);
	let mName = $state('');
	let mCtx = $state<number | undefined>();

	const models = $derived<ModelCfg[]>(Array.isArray(cfg.models) ? cfg.models : []);
	const efforts = $derived(models.find((m) => m.name === cfg.model)?.reasoning_efforts ?? []);
	const fmt = (n?: number) => (!n ? '' : n >= 1_000_000 ? `${(n / 1e6).toFixed(2)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);
	const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

	const allProviders = $derived<Provider[]>([
		...builtin
			// The builtin `lynshen` entry is the dead account gateway
			// (api.lynshen.org); with no login there it is pure noise next
			// to the monoize entry that serves the same models.
			.filter((b) => b.id !== 'lynshen' || keyed.includes('lynshen'))
			.map((b) => ({ id: b.id, base_url: b.base_url, models: b.models, format: b.protocol, builtin: true })),
		...custom
	]);
	// Usable: has a key / login, or is a custom endpoint (which may need none).
	const usable = (p: Provider) => keyed.includes(p.id) || !p.builtin;
	// The page lists what the user has added (plus the login entry and
	// whatever is the default); the rest is offered by the add dialog.
	const addedProviders = $derived(allProviders.filter((p) => usable(p) || p.id === 'lynshen' || p.id === cfg.provider));
	const addable = $derived<CatalogProvider[]>([
		...allProviders
			.filter((p) => !addedProviders.includes(p))
			.map((p) => ({
				id: p.id,
				name: cap(p.id),
				description: '',
				base_url: p.base_url,
				protocol: p.format as CatalogProvider['protocol'],
				models: p.models,
				featured: false
			})),
		...PROVIDER_CATALOG.providers.filter((entry) => !allProviders.some((provider) => provider.id === entry.id))
	]);
	const providerOpts = $derived(allProviders.filter(usable).map((p) => ({ value: p.id, label: p.name ?? cap(p.id) })));
	const modelOpts = $derived(models.map((m) => ({ value: m.name, label: m.display_name || m.name, ...m })));
	// Empty = the main model (the engine's `Config::title`).
	const titleModelOpts = $derived([{ value: '', label: t('settings.behavior.followMainModel') }, ...modelOpts]);
	// Empty = the engine picks the first model named like an image model.
	const imageModelOpts = $derived([
		{ value: '', label: t('settings.behavior.imageModelAuto') },
		...modelOpts.filter((m) => /image/i.test(m.value)),
		...modelOpts.filter((m) => !/image/i.test(m.value))
	]);
	const effortOpts = $derived(efforts.map((e) => ({ value: e, label: cap(e) })));
	// All providers' models in one list (provider-qualified), so the default-model
	// picker isn't limited to whichever provider is currently the default.
	// Only providers that can run (a login or a key), and the LynShen gateway
	// once: monoize is it, the old lynshen login a second copy.
	const hasGateway = $derived(allProviders.some((p) => p.id === 'monoize' && usable(p)));
	const allModelOpts = $derived(
		allProviders
			.filter((p) => usable(p) && !(p.id === 'lynshen' && hasGateway))
			.flatMap((p) =>
			p.models.map((m) => ({
				value: `${p.id}::${m.name}`,
				label: m.display_name || m.name,
				provider: p.id,
				group: p.id === 'lynshen' || p.id === 'monoize' ? t('settings.behavior.groupLynShen') : p.name || p.id,
				context_window: m.context_window,
				authed: usable(p)
			}))
		)
	);
	// Bridge the composite picker value (provider::model) to cfg.provider + cfg.model.
	let modelKey = $state('');
	$effect(() => {
		modelKey = `${cfg.provider ?? ''}::${cfg.model ?? ''}`;
	});
	function applyModel(key: string) {
		const i = key.indexOf('::');
		if (i < 0) return;
		const p = allProviders.find((x) => x.id === key.slice(0, i));
		if (!p) return;
		const name = key.slice(i + 2);
		// A builtin provider without a key would strand the engine: keep the
		// current default and send the user to that provider's key instead.
		if (p.builtin && !keyed.includes(p.id)) {
			modelKey = `${cfg.provider ?? ''}::${cfg.model ?? ''}`;
			toast.error(t('settings.page.providerNeedsKey', { provider: p.name ?? cap(p.id) }));
			void openProviderKey(p);
			return;
		}
		selectProvider(p);
		cfg.model = name;
		// A gateway model the stored list has not synced yet still works:
		// keep it as a name-only entry so the effort/window logic sees it.
		if (!p.models.some((m) => m.name === cfg.model)) {
			p.models = [...p.models, { name: cfg.model }];
			custom = [...custom];
			persistCustom();
		}
	}

	// Keep reasoning effort valid for the selected model.
	function normalizeEffort() {
		const efs = models.find((m) => m.name === cfg.model)?.reasoning_efforts ?? [];
		if (efs.length && !efs.includes(cfg.reasoning_effort)) cfg.reasoning_effort = efs.includes('high') ? 'high' : efs[Math.floor(efs.length / 2)];
	}
	$effect(normalizeEffort);

	// ---------- instant apply ----------
	// The engine-config patch the old footer "save" wrote; now written ~500 ms
	// after the last change. `written` is the last patch sent (or loaded), so the
	// load itself and no-op edits don't write.
	function patch() {
		return {
			provider: cfg.provider,
			base_url: cfg.base_url,
			protocol: cfg.protocol ?? '',
			models: cfg.models,
			model: cfg.model,
			reasoning_effort: cfg.reasoning_effort,
			compact_model: cfg.compact_model,
			title_model: cfg.title_model ?? '',
			image_model: cfg.image_model ?? '',
			compaction_threshold_percent: Number(cfg.compaction_threshold_percent) || 75,
			retry_attempts: Number(cfg.retry_attempts) || 0,
			connect_timeout_seconds: Number(cfg.connect_timeout_seconds) || 0,
			read_timeout_seconds: Number(cfg.read_timeout_seconds) || 0,
			include_project_instructions: !!cfg.include_project_instructions,
			// The agent picks its subagents' models itself now (no list to keep).
			subagent_models: [],
			asr
		};
	}
	let loaded = $state(false);
	// Last value written (or loaded) per key. Only keys that changed here are
	// written, so a stale copy never overwrites what something else saved
	// meanwhile (e.g. the model picker rewriting `models`).
	let written: Record<string, string> = {};
	let pending: Record<string, unknown> | null = null;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const snapshot = (p: Record<string, unknown>) =>
		Object.fromEntries(Object.entries(p).map(([k, v]) => [k, JSON.stringify(v)]));
	function flush() {
		clearTimeout(timer);
		if (!pending) return;
		const p = pending;
		pending = null;
		Object.assign(written, snapshot(p));
		writeConfig(p).catch((e) => toast.error(t('settings.page.saveFailed', { msg: String(e) })));
	}
	$effect(() => {
		if (!loaded) return;
		const snap = snapshot(patch());
		const changed = Object.keys(snap).filter((k) => snap[k] !== written[k]);
		if (!changed.length) return;
		const p = patch() as Record<string, unknown>;
		pending = Object.fromEntries(changed.map((k) => [k, p[k]]));
		clearTimeout(timer);
		timer = setTimeout(flush, 500);
	});
	// Leaving settings mid-debounce still saves; then the synced settings
	// go to the account (after the config write lands).
	onDestroy(() => {
		flush();
		setTimeout(() => void cloudSync.sync(), 1000);
	});

	onMount(async () => {
		cfg = (await readConfig()) ?? {};
		asr = resolveAsrSettings(cfg.asr);
		if (cfg.compaction_threshold_percent == null) cfg.compaction_threshold_percent = 75;
		normalizeEffort();
		written = snapshot(patch());
		loaded = true;
		keyed = (await readAuthProviders()) ?? [];
		loadBalances();
		loadMonoizeSession();
		builtin = (await listProviders().catch(() => [])) ?? [];
		try {
			custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
		} catch {
			custom = [];
		}
		// The gateway login provisions providers.monoize directly; without a
		// stored entry the dropdowns and model groups would not offer it.
		// Materialize it from the vendored catalog once, keyed and absent.
		if (keyed.includes('monoize') && !custom.some((c) => c.id === 'monoize')) {
			const entry = PROVIDER_CATALOG.providers.find((p) => p.id === 'monoize');
			if (entry) {
				custom = [
					...custom,
					{
						id: entry.id,
						name: entry.name,
						base_url: entry.base_url,
						format: entry.protocol,
						models: entry.models.map((m) => ({ ...m })),
						builtin: false,
						source: 'catalog' as const
					}
				];
				persistCustom();
			}
		}
		if (keyed.includes('monoize')) await refreshMonoizeModels();
	});

	function selectProvider(p: Provider) {
		cfg.provider = p.id;
		cfg.base_url = p.base_url;
		cfg.protocol = p.format;
		cfg.models = p.models;
		const first = p.models[0];
		if (first) cfg.model = first.name;
	}
	function setDefaultId(id: string) {
		const p = allProviders.find((x) => x.id === id);
		if (p) selectProvider(p);
	}

	function toggleEdit(id: string) {
		editing = editing === id ? null : id;
		keyInput = '';
	}
	function openCreate() {
		editing = '__catalog__';
		selectedCatalog = null;
	}
	function openCustom() {
		editing = '__new__';
		selectedCatalog = null;
		form = { id: '', base_url: '', format: 'responses', key: '', models: [] };
		mName = '';
		mCtx = undefined;
	}
	function selectCatalogProvider(provider: CatalogProvider) {
		// A built-in provider only needs its key.
		const known = allProviders.find((p) => p.id === provider.id);
		if (known) {
			keyTarget = known;
			keyInput = '';
			editing = '__key__';
			return;
		}
		selectedCatalog = provider;
		form = providerFormPrefill(provider);
		editing = '__new__';
		mName = '';
		mCtx = undefined;
	}
	function persistCustom() {
		localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
	}
	async function saveKey(id: string) {
		if (!keyInput.trim()) return;
		await setAuthKey(id, keyInput.trim());
		keyed = await readAuthProviders();
		loadBalances();
		keyInput = '';
		editing = null;
		onAuthChange?.();
	}
	// Logout (lynshen) / clear stored key (other providers).
	async function logout(id: string) {
		await removeAuthKey(id);
		keyed = await readAuthProviders();
		loadBalances();
		onAuthChange?.();
	}
	function addFormModel() {
		if (!mName.trim()) return;
		form.models = [...form.models, { name: mName.trim(), context_window: Number(mCtx) || 128000, max_output_tokens: 8192, reasoning_efforts: [] }];
		mName = '';
		mCtx = undefined;
	}
	async function createProvider() {
		const id = form.id.trim();
		if (!id || !form.base_url.trim() || form.models.length === 0 || (selectedCatalog && !form.key.trim())) return;
		custom = [
			...custom.filter((c) => c.id !== id),
			{
				id,
				name: selectedCatalog?.name,
				base_url: form.base_url.trim(),
				format: form.format,
				models: form.models,
				builtin: false,
				source: selectedCatalog ? 'catalog' : 'custom'
			}
		];
		persistCustom();
		if (form.key.trim()) {
			await setAuthKey(id, form.key.trim());
			keyed = await readAuthProviders();
			onAuthChange?.();
		}
		editing = null;
		selectedCatalog = null;
	}
	function deleteProvider(id: string) {
		custom = custom.filter((c) => c.id !== id);
		persistCustom();
		editing = null;
	}

	// ---------- LynShen login ----------
	let loggingIn = $state(false);
	let loginError = $state('');
	let loginMark = 0;
	const lynshenAuthed = $derived(keyed.includes('lynshen'));
	function login() {
		loginError = '';
		loginMark = chat?.messages.length ?? 0;
		// A bare /login answers with a provider picker; name the provider so the
		// engine starts the OAuth flow (and opens the browser) directly.
		dispatch(sessionId, { op: 'command', input: '/login lynshen' });
		loggingIn = true;
	}
	// While a login is in flight, poll auth state so the page flips to 已登录
	// (and reveals the account panel) the moment the browser flow completes.
	$effect(() => {
		if (!loggingIn) return;
		const failed = loginErrorSince(chat, loginMark);
		if (failed) {
			loginError = failed;
			loggingIn = false;
			return;
		}
		if (keyed.includes('lynshen')) {
			loggingIn = false;
			return;
		}
		const timer = setInterval(async () => {
			keyed = await readAuthProviders();
			if (keyed.includes('lynshen')) {
				loggingIn = false;
				loadBalances();
				onAuthChange?.();
				modelSetup.open = true;
			}
		}, 2000);
		return () => clearInterval(timer);
	});

	// Per-provider balances shown on the cards — independent of which provider is
	// the default, so several can be logged in and show balances at once.
	let lynshenBal = $state<AccountInfo | null>(null);
	let deepseekBal = $state<DeepseekBalance | null>(null);
	const deepseekTotal = $derived(deepseekBal?.balance_infos?.[0] ?? null);
	let monoizeBal = $state<DeepseekBalance | null>(null);
	const monoizeTotal = $derived(monoizeBal?.balance_infos?.[0] ?? null);
	let monoizeModelsMsg = $state('');
	function loadBalances() {
		if (keyed.includes('lynshen')) fetchAccountInfo().then((a) => (lynshenBal = a)).catch(() => (lynshenBal = null));
		else lynshenBal = null;
		if (keyed.includes('deepseek')) fetchDeepseekBalance().then((b) => (deepseekBal = b)).catch(() => (deepseekBal = null));
		else deepseekBal = null;
		if (keyed.includes('monoize')) fetchMonoizeBalance().then((b) => (monoizeBal = b)).catch(() => (monoizeBal = null));
		else monoizeBal = null;
	}

	// Monoize: pull the gateway's live model list (/v1/models) into the stored
	// provider entry, keeping the catalog's window/effort metadata where the id
	// matches and adding new ids as name-only models.
	async function refreshMonoizeModels() {
		monoizeModelsMsg = t('settings.account.refreshing');
		try {
			const list = await fetchMonoizeModels();
			const entry = custom.find((c) => c.id === 'monoize');
			if (!entry) {
				monoizeModelsMsg = t('settings.account.refreshNeedProvider');
				return;
			}
			entry.models = monoizeEntries(list, entry.models);
			custom = [...custom];
			persistCustom();
			if (cfg.provider === 'monoize') cfg.models = entry.models;
			onAuthChange?.();
			monoizeModelsMsg = t('settings.account.refreshed', { count: entry.models.length });
		} catch (e) {
			monoizeModelsMsg = String(e);
		}
	}

	// ---------- Monoize account: login / register / model square ----------
	// 登录成功后由 Rust 侧自动创建仅客户端使用的 key（providers.monoize），
	// 界面不展示也不可复制；退出登录时在网关侧吊销。
	let monoizeUser = $state<MonoizeUser | null>(null);
	let monoizeLogoutError = $state('');
	let squareOpen = $state(false);
	let squareModels = $state<MonoizeMarketplaceModel[] | null>(null);
	let squareBusy = $state(false);
	let squareSyncMsg = $state('');

	async function loadMonoizeSession() {
		try {
			const s = await monoizeSession();
			monoizeUser = s.logged_in && s.session ? s.session.user : null;
		} catch {
			monoizeUser = null;
		}
	}

	async function doMonoizeLogout() {
		try {
			await monoizeLogout();
		} catch {
			monoizeLogoutError = t('settings.monoize.revokeFailed');
			return;
		}
		monoizeLogoutError = '';
		monoizeUser = null;
		squareModels = null;
		keyed = (await readAuthProviders()) ?? [];
		loadBalances();
		onAuthChange?.();
		onAccountLogout?.();
	}
	async function onMonoizeAuthorized(user: MonoizeUser) {
		monoizeUser = user;
		keyed = (await readAuthProviders()) ?? [];
		loadBalances();
		editing = null;
		try {
			await refreshMonoizeCatalog();
			custom = JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]');
			if (cfg.provider === 'monoize') cfg.models = custom.find(p => p.id === 'monoize')?.models ?? [];
		} catch (e) { monoizeModelsMsg = String(e); }
		onAuthChange?.();
	}

	async function openMonoizeSquare() {
		squareOpen = true;
		squareSyncMsg = '';
		if (!squareModels) {
			squareBusy = true;
			try {
				squareModels = await monoizeMarketplace();
			} catch (e) {
				squareModels = [];
				squareSyncMsg = String(e);
			} finally {
				squareBusy = false;
			}
		}
	}

	// 把模型广场的分组内模型同步为 provider 的模型列表（保留已有的窗口/efforts）。
	// Display labels never change the model ID sent to the gateway.
	async function syncSquareModels() {
		if (!squareModels?.length) return;
		const entry = custom.find((c) => c.id === 'monoize');
		if (!entry) {
			squareSyncMsg = t('settings.account.refreshNeedProvider');
			return;
		}
		const windows = new Map(squareModels.map((m) => [m.model_id, m]));
		entry.models = monoizeEntries(
			squareModels.map((m) => ({ id: m.model_id, groups: m.groups, routing_status: m.routing_status, providers: m.providers })),
			entry.models
		).map((m) => {
			const square = windows.get(m.name);
			return {
				...m,
				...(square?.max_input_tokens ? { context_window: square.max_input_tokens } : {}),
				...(square?.max_output_tokens ? { max_output_tokens: square.max_output_tokens } : {})
			};
		});
		custom = [...custom];
		persistCustom();
		squareSyncMsg = t('settings.account.refreshed', { count: entry.models.length });
	}

	// Card click: not-logged-in lynshen kicks off OAuth directly (no expand); other
	// (key-based) providers expand to reveal the key input. Logged-in cards expand
	// to show details.
	function cardClick(p: Provider, authed: boolean) {
		// LynShen 账号卡的登录走 Monoize 网关表单（旧浏览器 OAuth 已废弃）。
		if (p.id === 'lynshen' && !authed && !monoizeUser) {
			editing = '__monoize__';
			return;
		}
		if (p.id === 'monoize' && !authed && !monoizeUser) {
			editing = '__monoize__';
			return;
		}
		toggleEdit(p.id);
	}

	// ---------- voice ----------
	// ASR keys are separate from chat-provider keys, except the historical MiMo
	// key which stays at providers.mimo for backward compatibility.
	const selectedAsr = $derived(asrProvider(asr.provider));
	const asrOptions = ASR_PROVIDERS.map((provider) => ({ value: provider.id, label: provider.name }));
	function selectAsr(id: string) {
		const provider = asrProvider(id);
		asr = { provider: provider.id, base_url: provider.baseUrl, model: provider.model };
		asrKey = '';
	}
	async function saveAsrKey() {
		if (!asrKey.trim()) return;
		await setAuthKey(selectedAsr.authKey, asrKey.trim());
		keyed = await readAuthProviders();
		asrKey = '';
	}

	// ---------- custom background ----------
	// The picked image is copied into the app data dir (set_background_image);
	// prefs keep only the stored path. See prefs.applyBackground.
	const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif'];
	let bgBusy = $state(false);
	const bgThumb = $derived(prefs.backgroundImage ? `${convertFileSrc(prefs.backgroundImage)}?v=${prefs.backgroundStamp}` : '');
	async function pickBackground() {
		const picked = await openDialog({
			multiple: false,
			directory: false,
			filters: [{ name: t('settings.behavior.backgroundFilter'), extensions: IMAGE_EXTS }]
		}).catch(() => null);
		if (typeof picked !== 'string') return;
		bgBusy = true;
		try {
			prefs.setBackgroundImage(await setBackgroundImage(picked));
		} catch (e) {
			toast.error(String(e));
		} finally {
			bgBusy = false;
		}
	}
	async function removeBackground() {
		prefs.setBackgroundImage('');
		await clearBackgroundImage().catch(() => {});
	}
	const strengthOpts = $derived(
		BACKGROUND_STRENGTHS.map((s) => ({ value: s, label: t(`settings.behavior.backgroundStrength.${s}`) }))
	);

	// The dependency check's refresh sits on the section heading.
	const depIds = ['node', 'ffmpeg', 'git', 'gh'];
</script>

<svelte:window onkeydown={onWindowKey} />

{#snippet loginNotice()}
	{#if loginError}<div class="notice"><Notice onDismiss={() => (loginError = '')}>{loginError}</Notice></div>{/if}
{/snippet}

<div class="settings" out:paneOut|global>
	<nav class="nav" style:width="{navWidth}px" aria-label={t('settings.title')}>
		<div class="nav-head">
			<button class="back" title={t('settings.page.back')} aria-label={t('settings.page.back')} onclick={onClose}>
				<ArrowLeftIcon size={18} />
			</button>
			<h2>{t('settings.title')}</h2>
		</div>
		<label class="search">
			<MagnifyingGlassIcon size={16} />
			<input bind:value={query} placeholder={t('settings.page.search')} spellcheck="false" onkeydown={onSearchKey} />
		</label>
		<div class="nav-list">
			{#if query.trim()}
				{#each hits as r (r.id)}
					{@const Icon = ICONS[r.section]}
					<button class="item hit" class:on={current === r.section} onclick={() => goTo(r)}>
						<Icon size={18} />
						<span class="hit-txt">
							<span class="label">{t(r.titleKey)}</span>
							<span class="where">{t(`settings.section.${r.section}`)}</span>
						</span>
					</button>
				{:else}
					<p class="none">{t('settings.page.noResults')}</p>
				{/each}
			{:else}
				{#each GROUPS as g, gi (g.key)}
					{#if gi > 0}<div class="sep" role="separator"></div>{/if}
					{#each g.sections as key (key)}
						{@const Icon = ICONS[key]}
						<button class="item" class:on={current === key} aria-current={current === key ? 'page' : undefined} onclick={() => (section = key)}>
							<Icon size={18} weight={current === key ? 'fill' : 'regular'} />
							<span class="label">{t(`settings.section.${key}`)}</span>
						</button>
					{/each}
				{/each}
			{/if}
		</div>
	</nav>

	<!-- Sections cross-fade: the leaving one fades out in the same grid cell
	     while the next rises in. -->
	<div class="stage">
	{#key current}
		<div class="main" out:paneOut>
			<div class="col">
				<h1>{t(`settings.section.${current}`)}</h1>

				{#if current === 'general'}
					<SettingsSection title={t('settings.page.appearance')}>
						<SettingsRow id="language" title={t('settings.language')}>
							<Segmented value={getLocale()} options={LOCALES.map((l) => ({ value: l, label: LOCALE_LABELS[l] }))} onChange={(v) => setLocale(v as (typeof LOCALES)[number])} />
						</SettingsRow>
						<SettingsRow id="theme" title={t('settings.theme')}>
							<Segmented
								value={themeState.pref}
								options={[
									{ value: 'system', label: t('settings.themeSystem') },
									{ value: 'light', label: t('settings.themeLight') },
									{ value: 'dark', label: t('settings.themeDark') }
								]}
								onChange={(v) => setTheme(v as ThemePref)}
							/>
						</SettingsRow>
						<SettingsRow id="background" title={t('settings.behavior.background')}>
							{#if prefs.backgroundImage}
								<span class="bg-thumb" style:background-image="url('{bgThumb}')" aria-hidden="true"></span>
								<Button size="sm" disabled={bgBusy} onclick={pickBackground}>{t('settings.behavior.backgroundChange')}</Button>
								<Button size="sm" variant="ghost" onclick={removeBackground}>{t('settings.behavior.backgroundRemove')}</Button>
							{:else}
								<Button size="sm" disabled={bgBusy} onclick={pickBackground}><ImageIcon size={14} /> {t('settings.behavior.backgroundPick')}</Button>
							{/if}
						</SettingsRow>
						{#if prefs.backgroundImage}
							<SettingsRow id="background-strength" title={t('settings.behavior.backgroundVisibility')}>
								<Segmented value={prefs.backgroundStrength} options={strengthOpts} onChange={(v) => prefs.setBackgroundStrength(v as (typeof BACKGROUND_STRENGTHS)[number])} />
							</SettingsRow>
						{/if}
						<SettingsRow id="glass" title={t('settings.behavior.glass')} description={t('settings.behavior.glassHint')}>
							<div class="glass-ctl">
								<input
									type="range"
									min="0"
									max="100"
									step="5"
									value={prefs.glass}
									aria-label={t('settings.behavior.glass')}
									style:--fill="{prefs.glass}%"
									oninput={(e) => prefs.setGlass(Number(e.currentTarget.value))}
								/>
								<span class="glass-val">{prefs.glass}</span>
							</div>
						</SettingsRow>
						{#if vibrancySupported()}
							<SettingsRow id="vibrancy" title={t('settings.behavior.vibrancy')} description={t('settings.behavior.vibrancyHint')}>
								<Switch checked={prefs.sidebarVibrancy} label={t('settings.behavior.vibrancy')} onChange={(on) => prefs.setSidebarVibrancy(on)} />
							</SettingsRow>
						{/if}
						<SettingsRow id="default-surface" title={t('settings.behavior.defaultSurface')} description={t('settings.behavior.defaultSurfaceHint')}>
							<Segmented
								value={prefs.defaultSurface}
								options={[
									{ value: 'gui', label: 'GUI' },
									{ value: 'tui', label: 'TUI' }
								]}
								onChange={(v) => prefs.setDefaultSurface(v === 'tui' ? 'tui' : 'gui')}
							/>
						</SettingsRow>
						<SettingsRow id="open-elsewhere" title={t('settings.behavior.openElsewhere')} description={t('settings.behavior.openElsewhereHint')}>
							<Segmented
								value={prefs.openElsewhere}
								options={[
									{ value: 'side', label: t('settings.behavior.placeSide') },
									{ value: 'tab', label: t('settings.behavior.placeTab') }
								]}
								onChange={(v) => prefs.setOpenElsewhere(v === 'tab' ? 'tab' : 'side')}
							/>
						</SettingsRow>
						<SettingsRow id="terminal-font" title={t('settings.behavior.terminalFont')}>
							<div class="w-md"><TextField mono placeholder="MesloLGS NF" bind:value={() => prefs.terminalFont, (v) => prefs.setTerminalFont(String(v ?? ''))} /></div>
						</SettingsRow>
						<SettingsRow id="terminal-font-size" title={t('settings.behavior.terminalFontSize')}>
							<Select
								value={String(prefs.terminalFontSize)}
								options={[10, 11, 12, 12.5, 13, 14, 15, 16, 18, 20].map((n) => ({ value: String(n) }))}
								onChange={(v) => prefs.setTerminalFontSize(Number(v))}
							/>
						</SettingsRow>
					</SettingsSection>
					<SettingsSection title={t('settings.page.conversation')}>
						<SettingsRow id="turn-stats" title={t('settings.behavior.turnStats')} stacked>
							<div class="stat-preview" aria-label={t('settings.behavior.turnStatsPreview')}>
								<span class="sp-label">{t('settings.behavior.turnStatsPreview')}</span>
								<div class="sp-line"></div>
								<div class="sp-line short"></div>
								<div class="sp-foot">
									{#each previewParts as part, j (j)}
										<span class="sp-stat" class:sp-mono={part.mono} title={part.title}>{part.text}</span>
									{:else}
										<span class="sp-none">{t('settings.behavior.turnStatsNone')}</span>
									{/each}
									<span class="sp-copy" title={t('chat.copyTurn')}><CopyIcon size={13} /></span>
								</div>
							</div>
							<div class="stat-picks">
								{#each TURN_STAT_KEYS as key (key)}
									<Checkbox checked={prefs.turnStats.includes(key)} onchange={(on) => prefs.setTurnStat(key, on)}>
										{t(`settings.behavior.turnStat.${key}`)}
									</Checkbox>
								{/each}
							</div>
						</SettingsRow>
						<SettingsRow id="scroll-on-send" title={t('settings.behavior.scrollOnSend')} description={t('settings.behavior.scrollOnSendHint')}>
							<Switch checked={prefs.scrollOnSend} label={t('settings.behavior.scrollOnSend')} onChange={(on) => prefs.setScrollOnSend(on)} />
						</SettingsRow>
						<SettingsRow id="foot-context" title={t('settings.behavior.footContext')} description={t('settings.behavior.footContextHint')}>
							<Switch checked={prefs.footContext} label={t('settings.behavior.footContext')} onChange={(on) => prefs.setFlag('footContext', on)} />
						</SettingsRow>
						<SettingsRow id="foot-cost" title={t('settings.behavior.footCost')} description={t('settings.behavior.footCostHint')}>
							<Switch checked={prefs.footCost} label={t('settings.behavior.footCost')} onChange={(on) => prefs.setFlag('footCost', on)} />
						</SettingsRow>
						<SettingsRow id="thinking-summaries" title={t('settings.behavior.thinkingSummaries')} description={t('settings.behavior.thinkingSummariesHint')}>
							<Switch checked={prefs.thinkingSummaries} label={t('settings.behavior.thinkingSummaries')} onChange={(on) => prefs.setFlag('thinkingSummaries', on)} />
						</SettingsRow>
						<SettingsRow id="cache-miss" title={t('settings.behavior.cacheMissAlert')} description={t('settings.behavior.cacheMissAlertHint')}>
							<Switch checked={prefs.cacheMissAlert} label={t('settings.behavior.cacheMissAlert')} onChange={(on) => prefs.setCacheMissAlert(on)} />
						</SettingsRow>
						<SettingsRow id="html-open" title={t('settings.behavior.htmlOpen')}>
							<Segmented
								value={prefs.htmlOpenInBrowser ? 'browser' : 'editor'}
								options={[
									{ value: 'browser', label: t('settings.behavior.htmlOpenBrowser') },
									{ value: 'editor', label: t('settings.behavior.htmlOpenEditor') }
								]}
								onChange={(v) => prefs.setHtmlOpenInBrowser(v === 'browser')}
							/>
						</SettingsRow>
					</SettingsSection>
					<SettingsSection title={t('settings.page.help')}>
						<SettingsRow id="feedback" title={t('settings.help.feedback')}>
							<Button size="sm" disabled={!onFeedback} onclick={() => onFeedback?.()}>{t('settings.help.feedbackOpen')}</Button>
						</SettingsRow>
						<SettingsRow id="telemetry" title={t('settings.help.telemetry')} description={t('settings.help.telemetryHint')}>
							<Switch checked={prefs.telemetry} label={t('settings.help.telemetry')} onChange={(on) => prefs.setTelemetry(on)} />
						</SettingsRow>
					</SettingsSection>
				{:else if current === 'shortcuts'}
					<ShortcutsSection />
				{:else if current === 'account'}
					{@render loginNotice()}
					<!-- 账户区：登录/余额/模型广场全部走 Monoize 网关（LynShen Console），
					     旧 LynShen 账号 OAuth 已废弃。 -->
					{#if monoizeUser}
						<AccountPage
							user={monoizeUser}
							balance={monoizeTotal}
							logoutError={monoizeLogoutError}
							onRelogin={() => (editing = '__monoize__')}
							onLogout={doMonoizeLogout}
							onSquare={openMonoizeSquare}
							onApiKey={() => openProviderCard('monoize')}
							onUsage={() => (section = 'usage')}
							onInvite={() => (section = 'invite')}
							onDevices={() => (section = 'devices')}
						/>
					{:else}
						<SettingsSection>
							<SettingsRow id="account-login" title={t('settings.page.lynshenAccount')} description={t('settings.account.notLoggedIn')}>
								<Button variant="primary" size="sm" onclick={() => { editing = '__monoize__'; }}><SignInIcon size={14} /> {t('settings.monoize.loginRegister')}</Button>
							</SettingsRow>
						</SettingsSection>
					{/if}
				{:else if current === 'invite'}
					<div id="set-invite"><InviteSection onSignIn={() => { section = 'account'; editing = '__monoize__'; }} /></div>
				{:else if current === 'devices'}
					<div id="set-devices"><DevicesSection onSignIn={() => { section = 'account'; editing = '__monoize__'; }} /></div>
				{:else if current === 'usage'}
					<OverviewPanel />
				{:else if current === 'voice'}
					<SettingsSection title={t('settings.voice.groupLabel')}>
						<SettingsRow id="voice-provider" title={t('settings.voice.provider')}>
							<div class="w-md"><Select value={asr.provider} options={asrOptions} onChange={selectAsr} /></div>
						</SettingsRow>
						<SettingsRow id="voice-base-url" title={t('settings.voice.baseUrl')}>
							<div class="w-lg"><TextField bind:value={asr.base_url} mono placeholder={selectedAsr.baseUrl} /></div>
						</SettingsRow>
						<SettingsRow id="voice-model" title={t('settings.voice.model')}>
							<div class="w-lg"><TextField bind:value={asr.model} mono placeholder={selectedAsr.model} /></div>
						</SettingsRow>
						<SettingsRow id="voice-key" title={t('settings.page.voiceKey')}>
							{#snippet detail()}
								{#if keyed.includes(selectedAsr.authKey)}<span class="keyok"><CheckCircleIcon size={13} /> {t('settings.account.keyed')}</span>{/if}
							{/snippet}
							<div class="w-md"><TextField bind:value={asrKey} type="password" placeholder={t('settings.voice.keyPlaceholder', { provider: selectedAsr.name })} /></div>
							<Button variant="primary" size="sm" disabled={!asrKey.trim()} onclick={saveAsrKey}>{t('settings.account.saveKey')}</Button>
							{#if keyed.includes(selectedAsr.authKey)}
								<Button variant="ghost" size="sm" onclick={() => logout(selectedAsr.authKey)}>{t('settings.account.clearKey')}</Button>
							{/if}
						</SettingsRow>
					</SettingsSection>
				{:else if current === 'providers'}
					{@render loginNotice()}
					<SettingsSection>
						<SettingsRow id="default-provider" title={t('settings.page.defaultProvider')}>
							<div class="w-md">
								<Select value={cfg.provider ?? ''} options={providerOpts} onChange={setDefaultId} placeholder={t('settings.page.selectProvider')}>
									{#snippet item(o)}
										<span class="tile sm"><Vendor provider={o.value} size={15} /></span>
										<span class="ell">{o.label}</span>
									{/snippet}
								</Select>
							</div>
						</SettingsRow>
					</SettingsSection>
					<SettingsSection id="provider-list" title={t('settings.account.groupLabel')}>
						{#each addedProviders as p (p.id)}
							<ProviderAccountCard
								provider={p}
								authed={keyed.includes(p.id) || (p.id === 'lynshen' && !!monoizeUser)}
								isDefault={cfg.provider === p.id}
								open={editing === p.id}
								{loggingIn}
								{lynshenBal}
								{deepseekBal}
								{deepseekTotal}
								{monoizeBal}
								{monoizeTotal}
								{monoizeModelsMsg}
								{monoizeUser}
								bind:keyInput
								{cap}
								onCardClick={cardClick}
								onLogin={login}
								onAuthChange={async () => { keyed = await readAuthProviders(); onAuthChange?.(); }}
								onLogout={logout}
								onSaveKey={saveKey}
								onSetDefault={selectProvider}
								onDelete={deleteProvider}
								onRefreshModels={refreshMonoizeModels}
								onOpenMonoizeLogin={() => {
									editing = '__monoize__';
								}}
								onMonoizeLogout={doMonoizeLogout}
								onOpenSquare={openMonoizeSquare}
							/>
						{/each}
						<button class="addrow" id="set-provider-add" onclick={openCreate}><PlusIcon size={16} /> {t('settings.custom.add')}</button>
					</SettingsSection>
					{#if editing === '__catalog__' || editing === '__key__' || editing === '__new__'}
						<Modal title={t('settings.custom.add')} width={540} padded={false} onClose={() => (editing = null)}>
							{#if editing === '__catalog__'}
								<ProviderCatalogPicker
									providers={addable}
									onSelect={selectCatalogProvider}
									onCustom={openCustom}
									onCancel={() => (editing = null)}
								/>
							{:else if editing === '__key__' && keyTarget}
								<div class="keystep">
									<div class="keyhead">
										<span class="tile"><Vendor provider={keyTarget.id} size={18} /></span>
										<span class="keyname">{t('settings.catalog.connect', { provider: cap(keyTarget.id) })}</span>
									</div>
									{#if ['openai', 'openai-codex'].includes(keyTarget.id)}
										<ProviderSignIn provider={keyTarget.id === 'openai' ? 'openai-codex' : keyTarget.id} onSuccess={async () => { keyed = await readAuthProviders(); editing = null; onAuthChange?.(); }} />
									{/if}
									<TextField bind:value={keyInput} type="password" mono placeholder={t('settings.account.keyPlaceholder', { id: keyTarget.id })} />
									<div class="keyfoot">
										<Button variant="ghost" size="sm" onclick={() => (editing = '__catalog__')}>{t('settings.page.back')}</Button>
										<Button variant="primary" size="sm" disabled={!keyInput.trim()} onclick={() => keyTarget && saveKey(keyTarget.id)}>{t('settings.catalog.addProvider')}</Button>
									</div>
								</div>
							{:else if editing === '__new__'}
								<CustomProviderForm
									bind:form
									bind:mName
									bind:mCtx
									formats={FORMATS}
									{fmt}
									title={selectedCatalog ? t('settings.catalog.connect', { provider: selectedCatalog.name }) : undefined}
									submitLabel={selectedCatalog ? t('settings.catalog.addProvider') : undefined}
									createDisabled={!!selectedCatalog && !form.key.trim()}
									onAddModel={addFormModel}
									onCreate={createProvider}
									onCancel={() => (editing = '__catalog__')}
								/>
							{/if}
						</Modal>
					{/if}
				{:else if current === 'models'}
					<SettingsSection title={t('settings.page.defaults')}>
						<SettingsRow id="default-model" title={t('settings.behavior.defaultModel')} description={allModelOpts.length ? undefined : t('settings.behavior.noModels')}>
							<div class="w-lg">
								<Select bind:value={modelKey} onChange={applyModel} options={allModelOpts} placeholder={t('settings.behavior.selectModel')}>
									{#snippet item(o)}
										<span class="tile sm"><Vendor model={o.label ?? ''} size={15} /></span>
										<span class="mono ell">{o.label}</span>
										<span class="optprov">{o.provider as string}</span>
										{#if o.context_window}<span class="pill">{fmt(o.context_window as number)}</span>{/if}
										{#if !o.authed}<span class="optlock">{t('settings.behavior.notConfigured')}</span>{/if}
									{/snippet}
								</Select>
							</div>
						</SettingsRow>
						{#if effortOpts.length}
							<SettingsRow id="reasoning-effort" title={t('settings.behavior.reasoningEffort')} description={t('settings.page.reasoningEffortDesc')}>
								<Segmented bind:value={cfg.reasoning_effort} options={effortOpts} />
							</SettingsRow>
						{/if}
						<SettingsRow id="project-instructions" title={t('settings.behavior.includeProjectInstructions')} description={t('settings.behavior.includeProjectInstructionsSub')}>
							<Switch bind:checked={cfg.include_project_instructions} label={t('settings.behavior.includeProjectInstructions')} />
						</SettingsRow>
					</SettingsSection>
					<SettingsSection title={t('settings.behavior.compaction')}>
						<SettingsRow id="compact-model" title={t('settings.behavior.compactModel')}>
							<div class="w-lg">
								<Select bind:value={cfg.compact_model} options={modelOpts} placeholder={t('settings.behavior.selectModel')}>
									{#snippet item(o)}
										<span class="tile sm"><Vendor model={o.label ?? ''} size={15} /></span>
										<span class="mono ell">{o.label}</span>
									{/snippet}
								</Select>
							</div>
						</SettingsRow>
						<SettingsRow id="compaction-threshold" title={t('settings.behavior.compactionThreshold')} description={t('settings.behavior.compactionThresholdSub')}>
							<div class="w-num"><TextField bind:value={cfg.compaction_threshold_percent} type="number" align="right" /></div>
							<span class="unit">%</span>
						</SettingsRow>
					</SettingsSection>
					<SettingsSection title={t('settings.behavior.titles')}>
						<SettingsRow id="title-model" title={t('settings.behavior.titleModel')} description={t('settings.behavior.titleModelHint')}>
							<div class="w-lg">
								<Select value={cfg.title_model ?? ''} options={titleModelOpts} onChange={(v) => (cfg.title_model = v)}>
									{#snippet item(o)}
										{#if o.value}<span class="tile sm"><Vendor model={o.label ?? ''} size={15} /></span>{/if}
										<span class="ell" class:mono={!!o.value}>{o.label}</span>
									{/snippet}
								</Select>
							</div>
						</SettingsRow>
					</SettingsSection>
					<SettingsSection title={t('settings.behavior.images')}>
						<SettingsRow id="image-model" title={t('settings.behavior.imageModel')} description={t('settings.behavior.imageModelHint')}>
							<div class="w-lg">
								<Select value={cfg.image_model ?? ''} options={imageModelOpts} onChange={(v) => (cfg.image_model = v)}>
									{#snippet item(o)}
										{#if o.value}<span class="tile sm"><Vendor model={o.label ?? ''} size={15} /></span>{/if}
										<span class="ell" class:mono={!!o.value}>{o.label}</span>
									{/snippet}
								</Select>
							</div>
						</SettingsRow>
					</SettingsSection>
				{:else if current === 'network'}
					<SettingsSection title={t('settings.page.requests')}>
						<SettingsRow id="retry-attempts" title={t('settings.behavior.retryAttempts')}>
							<div class="w-num"><TextField bind:value={cfg.retry_attempts} type="number" align="right" /></div>
						</SettingsRow>
						<SettingsRow id="connect-timeout" title={t('settings.behavior.connectTimeout')} description={t('settings.page.zeroDefault')}>
							<div class="w-num"><TextField bind:value={cfg.connect_timeout_seconds} type="number" align="right" /></div>
							<span class="unit">{t('settings.behavior.seconds')}</span>
						</SettingsRow>
						<SettingsRow id="read-timeout" title={t('settings.behavior.readTimeout')} description={t('settings.page.zeroDefault')}>
							<div class="w-num"><TextField bind:value={cfg.read_timeout_seconds} type="number" align="right" /></div>
							<span class="unit">{t('settings.behavior.seconds')}</span>
						</SettingsRow>
					</SettingsSection>
				{:else if current === 'mcp'}
					<!-- The LynShen CLI's servers; only a LynShen session can apply edits live. -->
					<McpSection {sessionId} chat={caps(chat).mcpManage ? chat : undefined} />
				{:else if current === 'market'}
					<SettingsSection>
						<SettingsRow id="market-open" title={t('settings.market.groupLabel')}>
							<Button size="sm" disabled={!onMarket} onclick={() => onMarket?.()}><StorefrontIcon size={14} /> {t('settings.market.open')}</Button>
						</SettingsRow>
					</SettingsSection>
				{:else if current === 'agents'}
					<BackendSection />
					{#if chat && caps(chat).ruleScopes}<PermissionRulesSection {sessionId} {chat} />{/if}
					<SettingsSection id="dependencies" title={t('setup.deps.title')}>
						{#snippet action()}
							<button class="iconbtn" title={t('setup.deps.recheck')} aria-label={t('setup.deps.recheck')} disabled={deps.loading} onclick={recheckDeps}>
								{#if deps.loading}<CircleNotchIcon size={14} class="spin" />{:else}<ArrowsClockwiseIcon size={14} />{/if}
							</button>
						{/snippet}
						<Dependencies ids={depIds} heading={false} flat />
					</SettingsSection>
				{:else if current === 'team'}
					<TeamSection project={chat && !chat.isChatMode ? chat.cwd : ''} />
				{:else if current === 'acp'}
					<AcpSection />
				{:else if current === 'import'}
					<ImportSection {onAddFolders} />
				{:else if current === 'daemon'}
					<DaemonSection />
				{:else if current === 'updates'}
					<UpdateCard />
					<ThirdPartyNotices />
				{/if}

				{#if squareOpen}
					<Modal title={t('settings.monoize.squareTitle')} width={620} padded={false} onClose={() => (squareOpen = false)}>
						<div class="square">
							{#if squareBusy}
								<p class="mfhint">{t('settings.account.refreshing')}</p>
							{:else if squareModels?.length}
								<div class="sqhead">
									<span>{t('settings.monoize.modelCount', { count: squareModels.reduce((n, m) => n + monoizeModelEntries(m).length, 0) })}</span>
									<span class="sqactions">
										<Button variant="secondary" size="sm" onclick={syncSquareModels}>{t('settings.monoize.syncModels')}</Button>
									</span>
								</div>
								<div class="sqgrid">
									{#each squareModels as m (m.model_id)}
										{#each monoizeModelEntries(m) as name}
											<div class="sqrow">
												<span class="sqname"><Vendor model={m.model_id} size={14} /> {name}</span>
												<span class="sqmeta">
													{#if m.max_input_tokens}{fmt(m.max_input_tokens)}{/if}
													{#if m.input_cost_per_token_nano != null && m.output_cost_per_token_nano != null}
														 · ${(Number(m.input_cost_per_token_nano) / 1e9 * 1e6).toFixed(2)} / ${(Number(m.output_cost_per_token_nano) / 1e9 * 1e6).toFixed(2)} /M
													{/if}
												</span>
											</div>
										{/each}
									{/each}
								</div>
							{:else}
								<p class="mfhint">{squareSyncMsg || t('settings.account.noBalance')}</p>
							{/if}
							{#if squareSyncMsg && squareModels?.length}<p class="mfhint">{squareSyncMsg}</p>{/if}
						</div>
					</Modal>
				{/if}
			</div>
		</div>
	{/key}
	</div>
</div>

{#if editing === '__monoize__'}
	<Modal title={t('settings.monoize.browserLogin')} width={440} onClose={() => (editing = null)}>
		<BrowserSignIn autoStart onSuccess={onMonoizeAuthorized} />
	</Modal>
{/if}

<style>
	.stat-preview {
		position: relative;
		padding: 16px 18px 14px;
		border-radius: var(--r-md);
		background: var(--surface);
	}
	.sp-label {
		position: absolute;
		top: 10px;
		right: 14px;
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.sp-line {
		height: 8px;
		width: 72%;
		margin-bottom: 8px;
		border-radius: var(--r-full);
		background: var(--surface2);
	}
	.sp-line.short {
		width: 46%;
	}
	/* Mirrors the reply footer in MessageList. */
	.sp-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 12px;
		min-height: 20px;
		margin-top: 12px;
		font-size: var(--fs-2xs);
		color: var(--dim2);
	}
	.sp-stat + .sp-stat::before {
		content: '·';
		margin-right: 10px;
		opacity: 0.6;
	}
	.sp-stat + .sp-stat {
		margin-left: -2px;
	}
	.sp-mono {
		font-family: var(--font-mono);
	}
	.sp-none {
		font-style: italic;
	}
	.sp-copy {
		display: inline-flex;
		align-items: center;
		padding: 2px 0;
	}
	.stat-picks {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(132px, 1fr));
		gap: 10px 24px;
		margin-top: 14px;
	}

	/* Covers the content panel; the rail and title bar stay around it. */
	.settings {
		position: absolute;
		inset: 0;
		z-index: 20;
		display: flex;
		min-width: 0;
		animation: pane-in var(--t-med) var(--ease-out);
	}

	/* ---------- nav column (the session list's place and fill) ---------- */
	.nav {
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--sidebar);
	}
	:global(:root[data-vibrancy='on']) .nav {
		background: var(--vibrancy-tint);
	}
	/* Over a custom background the image shows through, at --chrome-tint,
	   blurred when glass is on (app.css, prefs.svelte.ts). */
	:global(:root[data-canvas-bg]) .nav {
		background: color-mix(in oklab, var(--sidebar) var(--chrome-tint), transparent);
	}
	:global(:root[data-canvas-bg][data-glass]) .nav {
		-webkit-backdrop-filter: var(--glass-filter);
		backdrop-filter: var(--glass-filter);
	}
	.nav-head {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 40px;
		margin: 14px 12px 8px;
	}
	.nav-head h2 {
		margin: 0;
		font-size: var(--fs-lg);
		font-weight: 600;
		color: var(--text);
	}
	.back {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 32px;
		height: 32px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		cursor: pointer;
		transition:
			background var(--t-fast) var(--ease-out),
			color var(--t-fast) var(--ease-out);
	}
	.back:hover {
		background: var(--surface2);
		color: var(--text);
	}
	.search {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 36px;
		margin: 0 12px 10px;
		padding: 0 12px;
		border-radius: var(--r-md);
		background: var(--surface2);
		color: var(--dim2);
		cursor: text;
	}
	.search input {
		flex: 1;
		min-width: 0;
		height: 100%;
		padding: 0;
		border: none;
		background: none;
		color: var(--text);
		font: inherit;
		font-size: var(--fs-sm);
		outline: none;
	}
	.search input::placeholder {
		color: var(--dim2);
	}
	.nav-list {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 0 12px 16px;
	}
	/* Between groups of sections: space and a faint rule, no heading. */
	.sep {
		height: 1px;
		margin: 8px 12px;
		background: var(--hairline);
	}
	.item {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		min-height: 34px;
		padding: 0 12px;
		border: none;
		border-radius: var(--r-md);
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		transition: background var(--t-fast) var(--ease-out);
	}
	.item > :global(svg) {
		flex-shrink: 0;
		color: var(--dim);
	}
	.item:hover,
	.item.on {
		background: var(--surface2);
		color: var(--text);
	}
	.item.on > :global(svg) {
		color: var(--text);
	}
	.label {
		min-width: 0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.item.hit {
		padding-top: 7px;
		padding-bottom: 7px;
	}
	.hit-txt {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}
	.where {
		font-size: var(--fs-xs);
		color: var(--dim2);
	}
	.none {
		margin: 8px 12px;
		font-size: var(--fs-sm);
		color: var(--dim2);
	}

	/* ---------- page ---------- */
	.glass-ctl {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 240px;
	}
	.glass-ctl input {
		flex: 1;
		height: 20px;
		margin: 0;
		background: none;
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
	}
	.glass-ctl input::-webkit-slider-runnable-track {
		height: 4px;
		border-radius: var(--r-full);
		background: linear-gradient(to right, var(--accent) var(--fill), var(--surface2) var(--fill));
	}
	.glass-ctl input::-webkit-slider-thumb {
		width: 16px;
		height: 16px;
		margin-top: -6px;
		border-radius: var(--r-full);
		background: var(--panel);
		box-shadow:
			0 0 0 1px var(--border-strong),
			var(--shadow-sm);
		-webkit-appearance: none;
		transition: transform var(--t-fast) var(--ease-out);
	}
	.glass-ctl input:active::-webkit-slider-thumb {
		transform: scale(1.1);
	}
	.glass-val {
		width: 3ch;
		color: var(--dim);
		font-family: var(--font-mono);
		font-size: var(--fs-xs);
		font-variant-numeric: tabular-nums;
		text-align: right;
	}
	.stage {
		flex: 1;
		min-width: 0;
		display: grid;
		grid-template: minmax(0, 1fr) / minmax(0, 1fr);
		background: var(--bg);
	}
	.main {
		grid-area: 1 / 1;
		min-width: 0;
		overflow-y: auto;
	}
	/* Left-aligned next to the nav, like the Claude and ChatGPT settings. */
	.col {
		max-width: calc(680px + 2 * 48px);
		padding: 30px 48px 80px;
		animation: rise var(--t-med) var(--ease-out);
	}
	h1 {
		margin: 0;
		font-family: var(--font-sans);
		font-size: var(--fs-lg);
		font-weight: 600;
		line-height: 32px;
		color: var(--text);
	}
	/* The first section sits closer under the title. */
	.col > h1 + :global(.sec) {
		margin-top: 16px;
	}
	.notice {
		margin-top: 20px;
	}
	.iconbtn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border: none;
		border-radius: var(--r-sm);
		background: none;
		color: var(--dim);
		cursor: pointer;
	}
	.iconbtn:hover:not(:disabled) {
		background: var(--surface2);
		color: var(--text);
	}
	.iconbtn:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.bg-thumb {
		width: 44px;
		height: 28px;
		border-radius: var(--r-xs);
		background-color: var(--surface2);
		background-size: cover;
		background-position: center;
		box-shadow: inset 0 0 0 1px var(--hairline);
	}

	/* control widths on the right of a row */
	.w-md {
		width: 220px;
	}
	.w-lg {
		width: 300px;
	}
	.w-num {
		width: 96px;
	}
	.unit {
		min-width: 1.5em;
		font-size: var(--fs-sm);
		color: var(--dim);
	}
	.keyok {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		margin-top: 2px;
		font-size: var(--fs-xs);
		color: var(--ok);
	}

	/* "+ Add provider" as the last row of the providers list */
	.addrow {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		min-height: 52px;
		padding: 0;
		border: none;
		background: none;
		color: var(--dim);
		font: inherit;
		font-size: var(--fs-sm);
		text-align: left;
		cursor: pointer;
		scroll-margin: 24px;
	}
	.addrow:hover {
		color: var(--text);
	}

	/* add dialog: the key step for a built-in provider */
	.keystep {
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 16px 18px;
	}
	.keyhead {
		display: flex;
		align-items: center;
		gap: 11px;
	}
	.keyhead .tile {
		width: 34px;
		height: 34px;
		border-radius: var(--r-sm);
	}
	.keyname {
		font-size: var(--fs-sm);
		font-weight: 600;
	}
	.keyfoot {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
	}

	/* Monoize 登录 / 模型广场 */
	.mfhint {
		margin: 0;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.square {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 14px 18px 16px;
	}
	.sqhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: var(--fs-xs);
		color: var(--dim);
	}
	.sqgrid {
		display: flex;
		flex-direction: column;
		max-height: 340px;
		overflow: auto;
		border: 1px solid var(--hairline);
		border-radius: var(--r-md);
	}
	.sqrow {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 7px 12px;
		border-bottom: 1px solid var(--hairline);
		font-size: var(--fs-sm);
	}
	.sqrow:last-child {
		border-bottom: none;
	}
	.sqname {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-family: var(--font-mono);
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sqmeta {
		font-size: var(--fs-2xs);
		color: var(--dim);
		white-space: nowrap;
		font-variant-numeric: tabular-nums;
	}

	/* option rows in the model / provider pickers */
	.tile {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		border: 1px solid var(--hairline);
		background: var(--surface2);
		flex-shrink: 0;
	}
	.tile.sm {
		width: 22px;
		height: 22px;
		border-radius: var(--r-sm);
	}
	.mono {
		font-family: var(--font-mono);
		font-size: var(--fs-sm);
	}
	.ell {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.pill {
		font-family: var(--font-mono);
		font-size: var(--fs-2xs);
		color: var(--accent-bright);
		background: var(--accent-soft);
		border-radius: var(--r-full);
		padding: 2px 8px;
		flex-shrink: 0;
		margin-left: auto;
	}
	.optprov {
		font-size: var(--fs-2xs);
		color: var(--dim2);
		flex-shrink: 0;
	}
	.optlock {
		font-size: var(--fs-2xs);
		color: var(--dim);
		border: 1px solid var(--border);
		border-radius: var(--r-xs);
		padding: 0 5px;
		flex-shrink: 0;
	}
</style>
