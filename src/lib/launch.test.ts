// When the launch screen leaves (launch.ts; design.md, "Launch screen").
import { describe, expect, it } from 'vitest';
import { LAUNCH, LAUNCH_EASE, LaunchScreen, SEEN_KEY, exitAt, fadeFor, type LaunchEnv } from './launch';

/** A page with the launch screen on show, a clock and timers the test moves. */
function page({ seen = true, reduced = false, shown = true, animate = false, storageFails = false } = {}) {
	let t = 0;
	const timers: { at: number; run: () => void }[] = [];
	const listeners = new Map<string, () => void>();
	const classes = new Set(shown ? ['launching'] : []);
	const store = new Map<string, string>(seen ? [[SEEN_KEY, '1']] : []);
	const fades: { keyframes: unknown; options: KeyframeAnimationOptions }[] = [];
	const el = {
		style: {} as Record<string, string>,
		dataset: {} as Record<string, string>,
		removed: false,
		remove() {
			this.removed = true;
		},
		animate: animate
			? (keyframes: unknown, options: KeyframeAnimationOptions) => {
					fades.push({ keyframes, options });
					return { finished: Promise.resolve() };
				}
			: undefined
	};
	const env: LaunchEnv = {
		el: el as unknown as HTMLElement,
		root: { classList: { contains: (c) => classes.has(c), remove: (c) => void classes.delete(c) } },
		now: () => t,
		storage: {
			getItem: (k) => {
				if (storageFails) throw new Error('no storage');
				return store.get(k) ?? null;
			},
			setItem: (k, v) => {
				if (storageFails) throw new Error('no storage');
				store.set(k, v);
			}
		},
		reduced,
		setTimer: (run, ms) => {
			const timer = { at: t + ms, run };
			timers.push(timer);
			return timer;
		},
		clearTimer: (timer) => {
			const i = timers.indexOf(timer as (typeof timers)[number]);
			if (i >= 0) timers.splice(i, 1);
		},
		listen: (type, run) => {
			listeners.set(type, run);
			return () => listeners.delete(type);
		}
	};
	/** Runs the clock to `to` ms, firing what falls due on the way. */
	const advance = (to: number) => {
		for (;;) {
			const due = timers.filter((x) => x.at <= to).sort((a, b) => a.at - b.at)[0];
			if (!due) break;
			timers.splice(timers.indexOf(due), 1);
			t = due.at;
			due.run();
		}
		t = to;
	};
	return { env, advance, el, classes, store, listeners, timers, fades };
}

describe('exitAt', () => {
	it('leaves as soon as the app is ready: no wait added', () => {
		expect(exitAt(300, false, false)).toBe(300);
		expect(exitAt(0, false, false)).toBe(0);
	});
	it('a first run shows the whole entrance once', () => {
		expect(exitAt(300, true, false)).toBe(LAUNCH.sequenceMs + LAUNCH.firstRunHoldMs);
		expect(exitAt(1800, true, false)).toBe(1800);
	});
	it('with reduced motion there is no entrance to wait for', () => {
		expect(exitAt(300, true, true)).toBe(300);
	});
	it('never stays past the cap', () => {
		expect(exitAt(null, false, false)).toBe(LAUNCH.capMs);
		expect(exitAt(5000, true, false)).toBe(LAUNCH.capMs);
	});
	it('the cap leaves room for the whole entrance; every fade is short', () => {
		expect(LAUNCH.capMs).toBeGreaterThan(LAUNCH.sequenceMs + LAUNCH.firstRunHoldMs);
		expect(LAUNCH.sequenceMs).toBeGreaterThanOrEqual(1200);
		expect(LAUNCH.sequenceMs).toBeLessThanOrEqual(1600);
		for (const why of ['ready', 'cap', 'skip'] as const)
			for (const reduced of [false, true]) expect(fadeFor(why, reduced)).toBeLessThanOrEqual(240);
		expect(fadeFor('skip', false)).toBeLessThan(fadeFor('ready', false));
		expect(fadeFor('ready', true)).toBeLessThan(fadeFor('ready', false));
	});
});

describe('LaunchScreen', () => {
	it('does nothing where app.html does not show it', () => {
		const p = page({ shown: false });
		const s = new LaunchScreen(p.env);
		s.start();
		s.ready();
		expect(p.listeners.size).toBe(0);
		expect(p.timers).toHaveLength(0);
		expect(s.left).toBeNull();
		expect(p.el.removed).toBe(false);
	});

	it('a fast start leaves at readiness and the screen goes', () => {
		const p = page();
		const s = new LaunchScreen(p.env);
		s.start();
		p.advance(300);
		s.ready();
		expect(s.left).toBe('ready');
		expect(s.leftAt).toBe(300);
		expect(p.el.removed).toBe(true);
		expect(p.classes.has('launching')).toBe(false);
		expect(p.el.style.pointerEvents).toBe('none');
		expect(p.listeners.size).toBe(0);
		expect(p.timers).toHaveLength(0);
	});

	it('a first run waits for the entrance, then remembers it was seen', () => {
		const p = page({ seen: false });
		const s = new LaunchScreen(p.env);
		expect(s.firstRun).toBe(true);
		s.start();
		p.advance(100);
		s.ready();
		p.advance(1000);
		expect(s.left).toBeNull();
		p.advance(3000);
		expect(s.left).toBe('ready');
		expect(s.leftAt).toBe(LAUNCH.sequenceMs + LAUNCH.firstRunHoldMs);
		expect(p.store.get(SEEN_KEY)).toBe('1');
		expect(new LaunchScreen(p.env).firstRun).toBe(false);
	});

	it('a slow start leaves at the cap; readiness after that changes nothing', () => {
		const p = page();
		const s = new LaunchScreen(p.env);
		s.start();
		p.advance(LAUNCH.capMs - 1);
		expect(s.left).toBeNull();
		p.advance(LAUNCH.capMs);
		expect(s.left).toBe('cap');
		s.ready();
		expect(s.left).toBe('cap');
	});

	it('scripts that start late still keep the cap', () => {
		const p = page();
		p.advance(2600);
		const s = new LaunchScreen(p.env);
		s.start();
		p.advance(2600);
		expect(s.left).toBe('cap');
	});

	it('a click or a key skips it at once', () => {
		for (const type of ['pointerdown', 'keydown']) {
			const p = page({ seen: false });
			const s = new LaunchScreen(p.env);
			s.start();
			p.advance(400);
			p.listeners.get(type)!();
			expect(s.left).toBe('skip');
			expect(s.leftAt).toBe(400);
			expect(p.timers).toHaveLength(0);
			expect(p.listeners.size).toBe(0);
		}
	});

	it('fades out over the app with the base curve; reduced motion fades faster', () => {
		const p = page({ animate: true });
		new LaunchScreen(p.env).start();
		const s = new LaunchScreen(p.env);
		s.ready();
		expect(p.fades[0].options).toMatchObject({ duration: LAUNCH.fadeMs, easing: LAUNCH_EASE });
		expect(p.fades[0].keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
		const r = page({ animate: true, reduced: true, seen: false });
		new LaunchScreen(r.env).ready();
		expect(r.fades[0].options.duration).toBe(LAUNCH.reducedFadeMs);
		const k = page({ animate: true });
		const skip = new LaunchScreen(k.env);
		skip.start();
		k.listeners.get('keydown')!();
		expect(k.fades[0].options.duration).toBe(LAUNCH.skipFadeMs);
	});

	it('without storage it does not hold the app for an entrance', () => {
		const p = page({ seen: false, storageFails: true });
		const s = new LaunchScreen(p.env);
		expect(s.firstRun).toBe(false);
		s.start();
		p.advance(200);
		s.ready();
		expect(s.left).toBe('ready');
	});
});
