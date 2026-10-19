// Lightweight user preferences (localStorage-backed, reactive). Kept separate
// from engine/backend settings — these are pure UI choices.
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { leastVeil, parseColor, sampleImage, softImage, SECONDARY_CONTRAST, TEXT_CONTRAST, type RGB } from './readability';
import { isChatWidthMode, type ChatWidthMode } from './chatWidth';

const KEY = 'lynshen-prefs';
/** The stored shape's version. 2 turned the window frost off for everyone,
 *  once: until then it was on by default and written out with every other
 *  preference, so a stored `true` was not a choice (design.md, "Surfaces
 *  and depth"). 3 did the same for the cache-miss notice (ticket #52). */
export const PREFS_VERSION = 3;

type PrefsShape = {
	/** Clicking an .html/.htm link in chat opens it in the built-in browser
	 *  (rendered). When false it opens in the editor (source). Non-HTML files
	 *  always open in the editor. */
	htmlOpenInBrowser: boolean;
	/** 窗口磨砂: frost the sidebar and window chrome with the native window
	 *  effect (macOS vibrancy, Windows 11 Mica). Off by default. The app
	 *  keeps a copy (set_window_frost) and reads it before it creates the
	 *  window: off, the window has no native effect and on Windows is
	 *  opaque; macOS applies a change at once, Windows at the next start. */
	sidebarVibrancy: boolean;
	/** Which per-turn figures the reply footer shows (see TurnStats). */
	turnStats: TurnStatKey[];
	/** 对话宽度: how the conversation column follows its pane (chatWidth.ts). */
	chatWidth: ChatWidthMode;
	/** Offer to stop a running turn when one of its requests misses the
	 *  prompt cache (see cacheMiss.ts). */
	cacheMissAlert: boolean;
	/** Send anonymous usage counts (telemetry.svelte.ts). */
	telemetry: boolean;
	/** Terminal font family (CSS list) tried before the built-in ones; empty
	 *  for the defaults. */
	terminalFont: string;
	terminalFontSize: number;
	/** The view an existing conversation opens in: the chat, or its
	 *  engine's own TUI. */
	defaultSurface: 'gui' | 'tui';
	/** The currency a USD balance is shown in (the website's CNY/USD switch). */
	balanceCurrency: 'CNY' | 'USD';
	/** Custom image behind the chat canvas: the copy in the app data dir
	 *  (set_background_image), or empty for none. */
	backgroundImage: string;
	/** How strongly the image shows through the theme's background. */
	backgroundStrength: BackgroundStrength;
	/** Bumped on each pick: the stored file keeps its name, so the image URL
	 *  needs a new query to reload. */
	backgroundStamp: number;
	/** How much the large chrome surfaces (sidebar, title bar, composer,
	 *  menus, floating cards) let through, 0–100: 0 is solid, higher is
	 *  clearer glass with more blur. */
	glass: number;
	/** This machine's switch for agent team v2 (Beta); the engine gets it
	 *  together with LynShen's remote switch (agents/teamSwitch.svelte.ts). */
	teamV2: boolean;
	/** Where subagents and tool windows (agents, changes, files…) open: in a
	 *  column beside the chat, or as a tab next to it. */
	openElsewhere: 'side' | 'tab';
	/** Sending a message scrolls the conversation to its end. */
	scrollOnSend: boolean;
	/** Under the composer: the context in use (else only once it nears the limit) and the session's cost. */
	footContext: boolean;
	footCost: boolean;
	/** Engines that can summarize their thinking (Claude, Codex) do, before replying. */
	thinkingSummaries: boolean;
};

export const BACKGROUND_STRENGTHS = ['faint', 'medium', 'strong'] as const;
export type BackgroundStrength = (typeof BACKGROUND_STRENGTHS)[number];

export const TURN_STAT_KEYS = ['elapsed', 'ttft', 'tokens', 'files', 'tools', 'cost', 'model'] as const;
export type TurnStatKey = (typeof TURN_STAT_KEYS)[number];

const DEFAULTS: PrefsShape = {
	htmlOpenInBrowser: true,
	sidebarVibrancy: false,
	turnStats: ['elapsed', 'tokens', 'files'],
	chatWidth: 'auto',
	// Off unless asked for (ticket #52): the notice interrupts, and the turn
	// goes on whatever the user does.
	cacheMissAlert: false,
	telemetry: true,
	terminalFont: '',
	terminalFontSize: 12.5,
	defaultSurface: 'gui',
	balanceCurrency: 'CNY',
	backgroundImage: '',
	backgroundStrength: 'medium',
	backgroundStamp: 0,
	glass: 40,
	teamV2: true,
	openElsewhere: 'side',
	scrollOnSend: true,
	footContext: true,
	footCost: true,
	thinkingSummaries: true
};

/** A glass level within 0–100 (whole numbers); anything else is the default. */
const glassLevel = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(Math.min(100, Math.max(0, v))) : DEFAULTS.glass);

/** How opaque the chrome (sidebar, title bar) stays over a custom background
 *  without glass: the canvas's veil for that strength (app.css --canvas-veil). */
const CHROME_OVER_IMAGE: Record<BackgroundStrength, number> = { faint: 90, medium: 80, strong: 62 };

/**
 * The CSS the glass level and the background resolve to. `glass` is 0–100;
 * `blur` is false where the webview cannot blur (or the user asked for less
 * transparency), and the surfaces then stay solid.
 */
export function glassStyle(glass: number, background: BackgroundStrength | null, blur: boolean, readableChrome = 0) {
	const g = blur ? glassLevel(glass) / 100 : 0;
	// Glass thins the chrome over the image toward 50%, where the blur keeps
	// its secondary text readable; without an image the chrome stays solid.
	// It never goes below what keeps the text readable over this image.
	const chrome = background
		? Math.max(readableChrome, CHROME_OVER_IMAGE[background] - (CHROME_OVER_IMAGE[background] - 50) * g)
		: 100;
	return {
		on: g > 0,
		vars: {
			'--chrome-tint': `${Math.round(chrome)}%`,
			'--float-tint': `${Math.round(100 - 40 * g)}%`,
			'--glass-filter': g > 0 ? `blur(${Math.round(8 + 42 * g)}px) saturate(${Math.round(100 + 50 * g)}%)` : 'none',
			'--glass-rim-dark': `rgba(255, 255, 255, ${(0.04 + 0.12 * g).toFixed(3)})`,
			'--glass-rim-light': `rgba(255, 255, 255, ${(0.3 + 0.4 * g).toFixed(3)})`
		}
	};
}

/** A terminal font size within 8–32 px; anything else is the default. */
const fontSize = (v: unknown) => (typeof v === 'number' && v >= 8 && v <= 32 ? v : DEFAULTS.terminalFontSize);

/** Stored preferences brought up to PREFS_VERSION (see there). What is
 *  saved afterwards carries the version, so a later choice is kept. */
export function migratePrefs(stored: Record<string, unknown>): Record<string, unknown> {
	const version = typeof stored.version === 'number' ? stored.version : 1;
	const next: Record<string, unknown> = { ...stored, version: PREFS_VERSION };
	if (version < 2) next.sidebarVibrancy = false;
	if (version < 3) next.cacheMissAlert = false;
	return next;
}

/** The stored preferences over the defaults, and whether they were stored
 *  by an older version (and so are to be written back). */
function load(): { prefs: PrefsShape; outdated: boolean } {
	try {
		const raw = localStorage.getItem(KEY);
		const parsed: unknown = raw ? JSON.parse(raw) : null;
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { prefs: { ...DEFAULTS }, outdated: false };
		const stored = parsed as Record<string, unknown>;
		return { prefs: { ...DEFAULTS, ...(migratePrefs(stored) as Partial<PrefsShape>) }, outdated: stored.version !== PREFS_VERSION };
	} catch {
		return { prefs: { ...DEFAULTS }, outdated: false };
	}
}

/** Reflects the host OS onto `<html data-os>` so platform-specific window chrome
 *  can be styled in CSS: macOS uses an overlay title bar (traffic lights inset the
 *  top-left), while Windows/Linux get a native title bar and no traffic lights.
 *  Call once, synchronously, before first paint. */
export function applyPlatformClass() {
	if (typeof document === 'undefined' || typeof navigator === 'undefined') return;
	const ua = navigator.userAgent;
	const os = /Macintosh|Mac OS X/.test(ua)
		? 'macos'
		: /Windows/.test(ua)
			? 'windows'
			: 'linux';
	document.documentElement.dataset.os = os;
}

/** What the app answers to set_window_frost. */
type WindowFrost = {
	/** This system has a native frost: macOS vibrancy, Windows 11 Mica. */
	supported: boolean;
	/** The one behind the window now (`vibrancy` or `mica`), or null. */
	effect: string | null;
};

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const onMac = () => typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent);

/** This system can frost the window (the app reports it: set_window_frost).
 *  Not on Linux, Windows 10 or in a browser: the setting is not offered. */
export const vibrancySupported = () => prefs.frostSupported;

class PrefsStore {
	htmlOpenInBrowser = $state(DEFAULTS.htmlOpenInBrowser);
	sidebarVibrancy = $state(DEFAULTS.sidebarVibrancy);
	/** The macOS app always can; elsewhere the app's answer says. */
	frostSupported = $state(inApp() && onMac());
	/** The native frost behind the window now: `vibrancy` or `mica`; null
	 *  without one. Only over one may the chrome turn translucent: without
	 *  it the chrome would show the bare desktop (macOS) or nothing at all
	 *  (an opaque Windows window). */
	windowEffect = $state<string | null>(null);
	turnStats = $state<TurnStatKey[]>(DEFAULTS.turnStats);
	chatWidth = $state(DEFAULTS.chatWidth);
	cacheMissAlert = $state(DEFAULTS.cacheMissAlert);
	telemetry = $state(DEFAULTS.telemetry);
	terminalFont = $state(DEFAULTS.terminalFont);
	terminalFontSize = $state(DEFAULTS.terminalFontSize);
	defaultSurface = $state(DEFAULTS.defaultSurface);
	balanceCurrency = $state(DEFAULTS.balanceCurrency);
	backgroundImage = $state(DEFAULTS.backgroundImage);
	backgroundStrength = $state<BackgroundStrength>(DEFAULTS.backgroundStrength);
	backgroundStamp = $state(DEFAULTS.backgroundStamp);
	glass = $state(DEFAULTS.glass);
	teamV2 = $state(DEFAULTS.teamV2);
	openElsewhere = $state(DEFAULTS.openElsewhere);
	scrollOnSend = $state(DEFAULTS.scrollOnSend);
	footContext = $state(DEFAULTS.footContext);
	footCost = $state(DEFAULTS.footCost);
	thinkingSummaries = $state(DEFAULTS.thinkingSummaries);

	init() {
		const { prefs: p, outdated } = load();
		this.htmlOpenInBrowser = p.htmlOpenInBrowser;
		this.sidebarVibrancy = p.sidebarVibrancy === true;
		// The macOS app starts with the frost its copy of the choice says:
		// assume so for the first frame (no flash of an opaque sidebar);
		// set_window_frost confirms it right after.
		if (inApp() && onMac()) this.windowEffect = this.sidebarVibrancy ? 'vibrancy' : null;
		this.turnStats = Array.isArray(p.turnStats)
			? p.turnStats.filter((k): k is TurnStatKey => (TURN_STAT_KEYS as readonly string[]).includes(k))
			: DEFAULTS.turnStats;
		// (An older version kept a number of pixels here.)
		this.chatWidth = isChatWidthMode(p.chatWidth) ? p.chatWidth : DEFAULTS.chatWidth;
		this.cacheMissAlert = p.cacheMissAlert === true;
		this.telemetry = p.telemetry !== false;
		this.terminalFont = typeof p.terminalFont === 'string' ? p.terminalFont : DEFAULTS.terminalFont;
		this.terminalFontSize = fontSize(p.terminalFontSize);
		this.defaultSurface = p.defaultSurface === 'tui' ? 'tui' : 'gui';
		this.balanceCurrency = p.balanceCurrency === 'USD' ? 'USD' : 'CNY';
		this.backgroundImage = typeof p.backgroundImage === 'string' ? p.backgroundImage : '';
		this.backgroundStrength = BACKGROUND_STRENGTHS.includes(p.backgroundStrength) ? p.backgroundStrength : DEFAULTS.backgroundStrength;
		this.backgroundStamp = Number.isFinite(p.backgroundStamp) ? p.backgroundStamp : 0;
		this.glass = glassLevel(p.glass);
		this.teamV2 = p.teamV2 !== false;
		this.openElsewhere = p.openElsewhere === 'tab' ? 'tab' : 'side';
		this.scrollOnSend = p.scrollOnSend !== false;
		this.footContext = p.footContext !== false;
		this.footCost = p.footCost !== false;
		this.thinkingSummaries = p.thinkingSummaries !== false;
		if (outdated) this.#save();
		this.#applyVibrancy();
		this.#applyBackground();
		// Asking the system for less transparency turns the glass solid.
		if (typeof window !== 'undefined')
			window.matchMedia('(prefers-reduced-transparency: reduce)').addEventListener('change', () => this.#applyGlass());
		// The veils follow the theme's text colours.
		if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined')
			new MutationObserver(() => this.#applyGlass()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
		this.#syncFrost();
	}

	/** Hands the frost choice to the app, which keeps it for the next start
	 *  (and on macOS applies it now), and takes what the window has. */
	#syncFrost() {
		if (!inApp()) return;
		invoke<WindowFrost | null>('set_window_frost', { on: this.sidebarVibrancy })
			.then((frost) => {
				if (!frost) return;
				this.frostSupported = frost.supported;
				this.windowEffect = frost.effect;
				this.#applyVibrancy();
			})
			.catch(() => {});
	}

	#save() {
		try {
			localStorage.setItem(
				KEY,
				JSON.stringify({
					version: PREFS_VERSION,
					htmlOpenInBrowser: this.htmlOpenInBrowser,
					sidebarVibrancy: this.sidebarVibrancy,
					turnStats: this.turnStats,
					chatWidth: this.chatWidth,
					cacheMissAlert: this.cacheMissAlert,
					telemetry: this.telemetry,
					terminalFont: this.terminalFont,
					terminalFontSize: this.terminalFontSize,
					defaultSurface: this.defaultSurface,
					balanceCurrency: this.balanceCurrency,
					backgroundImage: this.backgroundImage,
					backgroundStrength: this.backgroundStrength,
					backgroundStamp: this.backgroundStamp,
					glass: this.glass,
					teamV2: this.teamV2,
					openElsewhere: this.openElsewhere,
					scrollOnSend: this.scrollOnSend,
					footContext: this.footContext,
					footCost: this.footCost,
					thinkingSummaries: this.thinkingSummaries
				})
			);
		} catch {
			/* private mode / no storage — in-memory only */
		}
	}

	/** Reflect the frost onto the root: on while the choice is on and the
	 *  window has the native effect behind it. */
	#applyVibrancy() {
		if (typeof document === 'undefined') return;
		if (this.windowEffect !== null && this.sidebarVibrancy) {
			document.documentElement.setAttribute('data-vibrancy', 'on');
		} else {
			document.documentElement.removeAttribute('data-vibrancy');
		}
	}

	/** Reflect the custom background onto the root: the image URL as
	 *  `--canvas-image` and the strength as `data-canvas-bg` (app.css paints
	 *  the canvas from them). */
	#applyBackground() {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		const tauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
		if (this.backgroundImage && tauri) {
			const src = `${convertFileSrc(this.backgroundImage)}?v=${this.backgroundStamp}`;
			root.style.setProperty('--canvas-image', `url(${JSON.stringify(src)})`);
			root.dataset.canvasBg = this.backgroundStrength;
			this.#sampleBackground(src);
		} else {
			root.style.removeProperty('--canvas-image');
			root.style.removeProperty('--canvas-image-soft');
			delete root.dataset.canvasBg;
			this.#bgSamples = [];
			this.#bgSampled = '';
		}
		this.#applyGlass();
	}

	/** The background's colours, sampled once per image: the veils are
	 *  worked out from them (readability.ts). */
	#bgSamples: RGB[] = [];
	#bgSampled = '';
	#sampleBackground(src: string) {
		if (this.#bgSampled === src) return;
		this.#bgSampled = src;
		this.#bgSamples = [];
		sampleImage(src)
			.then((samples) => {
				if (this.#bgSampled !== src) return;
				this.#bgSamples = samples;
				this.#applyGlass();
			})
			.catch(() => {});
		// The chat column reads on a blurred copy (ChatPane's plate).
		softImage(src)
			.then((soft) => {
				if (this.#bgSampled === src && soft && typeof document !== 'undefined')
					document.documentElement.style.setProperty('--canvas-image-soft', `url(${JSON.stringify(soft)})`);
			})
			.catch(() => {});
	}

	/** The least canvas and chrome veils (percent) that keep the theme's text
	 *  readable over the background; null until it is sampled. */
	#readableVeils(root: HTMLElement): { canvas: number; chrome: number } | null {
		if (!this.#bgSamples.length || !root.dataset.canvasBg) return null;
		const css = getComputedStyle(root);
		const color = (name: string) => parseColor(css.getPropertyValue(name));
		const [bg, sidebar, text, dim] = ['--bg', '--sidebar', '--text', '--dim'].map(color);
		if (!bg || !sidebar || !text || !dim) return null;
		const inks = [
			{ color: text, min: TEXT_CONTRAST },
			{ color: dim, min: SECONDARY_CONTRAST }
		];
		return { canvas: leastVeil(this.#bgSamples, bg, inks), chrome: leastVeil(this.#bgSamples, sidebar, inks) };
	}

	/** Reflect the glass level onto the root: the fills and blur as custom
	 *  properties, and `data-glass` while there is glass to show (app.css). */
	#applyGlass() {
		if (typeof document === 'undefined') return;
		const root = document.documentElement;
		const canBlur =
			typeof CSS !== 'undefined' &&
			(CSS.supports('backdrop-filter', 'blur(1px)') || CSS.supports('-webkit-backdrop-filter', 'blur(1px)')) &&
			!window.matchMedia('(prefers-reduced-transparency: reduce)').matches;
		const readable = this.#readableVeils(root);
		const style = glassStyle(this.glass, root.dataset.canvasBg ? this.backgroundStrength : null, canBlur, readable?.chrome);
		for (const [k, v] of Object.entries(style.vars)) root.style.setProperty(k, v);
		// The canvas veil: the strength's, or more where this image needs it.
		if (readable) root.style.setProperty('--canvas-veil', `${Math.max(CHROME_OVER_IMAGE[this.backgroundStrength], readable.canvas)}%`);
		else root.style.removeProperty('--canvas-veil');
		if (style.on) root.dataset.glass = '';
		else delete root.dataset.glass;
	}

	setGlass(v: number) {
		this.glass = glassLevel(v);
		this.#applyGlass();
		this.#save();
	}

	/** `path`: the stored copy (set_background_image), or '' for none. */
	setBackgroundImage(path: string) {
		this.backgroundImage = path;
		this.backgroundStamp = path ? Date.now() : 0;
		this.#applyBackground();
		this.#save();
	}

	setBackgroundStrength(v: BackgroundStrength) {
		this.backgroundStrength = v;
		this.#applyBackground();
		this.#save();
	}

	setTeamV2(v: boolean) {
		this.teamV2 = v;
		this.#save();
	}

	setChatWidth(v: ChatWidthMode) {
		this.chatWidth = v;
		this.#save();
	}

	setHtmlOpenInBrowser(v: boolean) {
		this.htmlOpenInBrowser = v;
		this.#save();
	}

	setTurnStat(key: TurnStatKey, on: boolean) {
		const rest = this.turnStats.filter((k) => k !== key);
		// Kept in TURN_STAT_KEYS order, the footer's order.
		this.turnStats = on ? TURN_STAT_KEYS.filter((k) => k === key || rest.includes(k)) : rest;
		this.#save();
	}

	setCacheMissAlert(v: boolean) {
		this.cacheMissAlert = v;
		this.#save();
	}

	setScrollOnSend(v: boolean) {
		this.scrollOnSend = v;
		this.#save();
	}

	setTelemetry(v: boolean) {
		this.telemetry = v;
		this.#save();
	}

	setDefaultSurface(v: 'gui' | 'tui') {
		this.defaultSurface = v;
		this.#save();
	}

	setOpenElsewhere(v: 'side' | 'tab') {
		this.openElsewhere = v;
		this.#save();
	}

	/** The switches without side effects of their own. */
	setFlag(name: 'footContext' | 'footCost' | 'thinkingSummaries', v: boolean) {
		this[name] = v;
		this.#save();
	}

	setTerminalFont(v: string) {
		this.terminalFont = v;
		this.#save();
	}

	setTerminalFontSize(v: number) {
		this.terminalFontSize = fontSize(v);
		this.#save();
	}

	setBalanceCurrency(v: 'CNY' | 'USD') {
		this.balanceCurrency = v;
		this.#save();
	}

	setSidebarVibrancy(v: boolean) {
		this.sidebarVibrancy = v;
		this.#applyVibrancy();
		this.#save();
		this.#syncFrost();
	}
}

export const prefs = new PrefsStore();
