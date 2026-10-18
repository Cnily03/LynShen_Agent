// The launch screen (design.md, "Launch screen"): the logo over the whole
// window while the desktop app starts. src/app.html draws it and plays its
// entrance in CSS from the first frame (the main window of the desktop app,
// at /); this module decides when it leaves:
//
// - on every cold start, once the whole entrance has played and the finished
//   logo has held (LAUNCH.sequenceMs + LAUNCH.holdMs after the entrance
//   started), or when the app is ready (launchReady, once the canvas is
//   built), whichever is later;
// - with reduced motion (no entrance, the still logo) as soon as the app is
//   ready;
// - at LAUNCH.capMs after the page started, ready or not;
// - at once on a click or a key.
//
// It leaves by fading out over the app, which is drawn under it all along,
// and takes no clicks while it fades.

/** The timing, in ms. The entrance's keyframes are in app.html (brand.test.ts
 *  holds the two together). */
export const LAUNCH = {
	/** The entrance ends: both trunks up, the light in, its glow gone, the wordmark in. */
	sequenceMs: 2050,
	/** The finished logo holds this long before it leaves. */
	holdMs: 450,
	/** The screen leaves by then, from navigation start, ready or not. */
	capMs: 3400,
	/** The crossfade into the app. */
	fadeMs: 320,
	/** After a click or a key. */
	skipFadeMs: 140,
	/** With reduced motion: the still logo fades this fast. */
	reducedFadeMs: 120
} as const;

/** --ease-base (app.css), which app.css has not brought yet at this point. */
export const LAUNCH_EASE = 'cubic-bezier(0.24, 0.42, 0.42, 0.92)';

export type LaunchExit = 'ready' | 'cap' | 'skip';

/** When the screen starts to leave, in ms from navigation start: when the app
 *  is ready, but not before the whole entrance (started at `entranceAt`) and
 *  its hold, and never after the cap. `readyAt` null: not ready yet. */
export function exitAt(readyAt: number | null, reduced: boolean, entranceAt = 0): number {
	if (readyAt == null) return LAUNCH.capMs;
	const floor = reduced ? 0 : entranceAt + LAUNCH.sequenceMs + LAUNCH.holdMs;
	return Math.min(LAUNCH.capMs, Math.max(readyAt, floor));
}

/** How long the fade-out takes. */
export function fadeFor(why: LaunchExit, reduced: boolean): number {
	if (why === 'skip') return LAUNCH.skipFadeMs;
	return reduced ? LAUNCH.reducedFadeMs : LAUNCH.fadeMs;
}

/** What the launch screen works with (the page's, or a test's stand-ins). */
export interface LaunchEnv {
	/** #launch, or null where app.html did not show it. */
	el: HTMLElement | null;
	/** <html>, which carries the `launching` class. */
	root: { classList: { contains(c: string): boolean; remove(c: string): void } };
	/** ms since navigation start. */
	now(): number;
	/** When the entrance started on screen (its first frame), on now()'s
	 *  clock; null while that is not known. */
	entranceAt(): number | null;
	reduced: boolean;
	setTimer(run: () => void, ms: number): unknown;
	clearTimer(timer: unknown): void;
	listen(type: 'pointerdown' | 'keydown', run: () => void): () => void;
}

export class LaunchScreen {
	/** Why it left, once it has. */
	left: LaunchExit | null = null;
	/** When it started to leave (ms from navigation start). */
	leftAt: number | null = null;
	/** When the entrance started, once known (ms from navigation start). */
	entranceAt: number | null = null;
	#env: LaunchEnv;
	#timers: unknown[] = [];
	#unlisten: Array<() => void> = [];

	constructor(env: LaunchEnv) {
		this.#env = env;
	}

	/** Whether app.html is showing the screen. */
	get shown(): boolean {
		return !!this.#env.el && this.#env.root.classList.contains('launching');
	}

	/** Arms the cap and the skip; nothing where the screen is not shown. */
	start(): void {
		if (!this.shown || this.left) return;
		const env = this.#env;
		this.#entrance();
		this.#timers.push(env.setTimer(() => this.leave('cap'), Math.max(0, LAUNCH.capMs - env.now())));
		for (const type of ['pointerdown', 'keydown'] as const) this.#unlisten.push(env.listen(type, () => this.leave('skip')));
	}

	/** The app is ready: leave now, or once the entrance has played and held. */
	ready(): void {
		if (!this.shown || this.left) return;
		const env = this.#env;
		const now = env.now();
		const wait = exitAt(now, env.reduced, this.#entrance() ?? 0) - now;
		if (wait <= 0) this.leave('ready');
		else this.#timers.push(env.setTimer(() => this.leave('ready'), wait));
	}

	/** The entrance's start, read once it is known. */
	#entrance(): number | null {
		this.entranceAt ??= this.#env.entranceAt();
		return this.entranceAt;
	}

	leave(why: LaunchExit): void {
		if (this.left) return;
		const env = this.#env;
		this.left = why;
		this.leftAt = env.now();
		for (const timer of this.#timers) env.clearTimer(timer);
		for (const off of this.#unlisten) off();
		this.#timers = [];
		this.#unlisten = [];
		const el = env.el;
		if (!el) return;
		el.style.pointerEvents = 'none';
		el.dataset.exit = why;
		const gone = () => {
			el.remove();
			env.root.classList.remove('launching');
		};
		if (typeof el.animate !== 'function') return gone();
		// WAAPI, not a CSS transition: app.css's reduced-motion rule would cut a
		// transition to nothing, and the still logo should still fade.
		const fade = el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fadeFor(why, env.reduced), easing: LAUNCH_EASE, fill: 'forwards' });
		fade.finished.then(gone, gone);
	}
}

/** The page's own: #launch, <html>, the clock, timers, the window's pointer
 *  and key events. `clock`: ms since navigation start. */
export function pageEnv(clock: () => number = () => performance.now()): LaunchEnv {
	const el = document.getElementById('launch');
	return {
		el,
		root: document.documentElement,
		now: clock,
		// The entrance's CSS animations all start on the first frame that
		// draws the screen; their start time is on the document's timeline,
		// whose origin performance.now() shares. Null before that frame, after
		// the entrance, and where the webview cannot tell.
		entranceAt: () => {
			try {
				const starts = (el?.getAnimations({ subtree: true }) ?? []).map((a) => a.startTime).filter((t) => typeof t === 'number');
				return starts.length ? clock() - (performance.now() - Math.min(...starts)) : null;
			} catch {
				return null;
			}
		},
		reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
		setTimer: (run, ms) => setTimeout(run, ms),
		clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
		listen: (type, run) => {
			window.addEventListener(type, run, { capture: true, passive: true });
			return () => window.removeEventListener(type, run, { capture: true });
		}
	};
}

let current: LaunchScreen | null = null;

/** The page's launch screen, armed (from +layout.svelte, as the scripts start). */
export function initLaunch(): LaunchScreen | null {
	if (typeof document === 'undefined') return null;
	if (!current) {
		current = new LaunchScreen(pageEnv());
		current.start();
	}
	return current;
}

/** The app is ready to use (from +page.svelte, once the canvas is built). */
export function launchReady(): void {
	current?.ready();
}
