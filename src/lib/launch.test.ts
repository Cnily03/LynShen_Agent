// When the launch screen leaves (launch.ts; design.md, "Launch screen").
import { describe, expect, it } from 'vitest';
import { LAUNCH, LAUNCH_EASE, LaunchScreen, exitAt, fadeFor, type LaunchEnv } from './launch';

/** The whole entrance and its hold, from the entrance's start. */
const PLAYED = LAUNCH.sequenceMs + LAUNCH.holdMs;

/** A page with the launch screen on show, a clock and timers the test moves.
 *  `entrance`: when the entrance started (null: not known). */
function page({ reduced = false, shown = true, animate = false, entrance = 0 as number | null } = {}) {
	let t = 0;
	const timers: { at: number; run: () => void }[] = [];
	const listeners = new Map<string, () => void>();
	const classes = new Set(shown ? ['launching'] : []);
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
		entranceAt: () => entrance,
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
	return { env, advance, el, classes, listeners, timers, fades };
}

describe('exitAt', () => {
	it('every cold start plays the whole entrance, holds it, then leaves', () => {
		expect(exitAt(300, false)).toBe(PLAYED);
		expect(exitAt(0, false)).toBe(PLAYED);
	});
	it('counts the entrance from its first frame', () => {
		expect(exitAt(300, false, 120)).toBe(120 + PLAYED);
		expect(exitAt(300, false, -80)).toBe(PLAYED - 80);
	});
	it('an app ready after the hold leaves at readiness', () => {
		expect(exitAt(2900, false)).toBe(2900);
	});
	it('with reduced motion there is no entrance to wait for', () => {
		expect(exitAt(300, true)).toBe(300);
		expect(exitAt(300, true, 120)).toBe(300);
	});
	it('never stays past the cap', () => {
		expect(exitAt(null, false)).toBe(LAUNCH.capMs);
		expect(exitAt(5000, false)).toBe(LAUNCH.capMs);
		expect(exitAt(300, false, 1200)).toBe(LAUNCH.capMs);
	});
	it('the cap leaves room for the entrance and its hold; every fade is short', () => {
		expect(LAUNCH.sequenceMs).toBeGreaterThanOrEqual(1800);
		expect(LAUNCH.sequenceMs).toBeLessThanOrEqual(2400);
		expect(LAUNCH.holdMs).toBeGreaterThanOrEqual(300);
		// A first frame up to this late still sees the whole entrance and hold.
		expect(LAUNCH.capMs - PLAYED).toBeGreaterThanOrEqual(600);
		for (const why of ['ready', 'cap', 'skip'] as const)
			for (const reduced of [false, true]) expect(fadeFor(why, reduced)).toBeLessThanOrEqual(320);
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

	it('a fast start waits for the whole entrance and its hold, then the screen goes', () => {
		const p = page();
		const s = new LaunchScreen(p.env);
		s.start();
		p.advance(300);
		s.ready();
		p.advance(PLAYED - 1);
		expect(s.left).toBeNull();
		p.advance(PLAYED);
		expect(s.left).toBe('ready');
		expect(s.leftAt).toBe(PLAYED);
		expect(p.el.removed).toBe(true);
		expect(p.classes.has('launching')).toBe(false);
		expect(p.el.style.pointerEvents).toBe('none');
		expect(p.listeners.size).toBe(0);
		expect(p.timers).toHaveLength(0);
	});

	it('times the hold from the entrance’s first frame, read when it is known', () => {
		let entrance: number | null = null;
		const p = page();
		const s = new LaunchScreen({ ...p.env, entranceAt: () => entrance });
		s.start();
		expect(s.entranceAt).toBeNull();
		entrance = 140;
		p.advance(400);
		s.ready();
		expect(s.entranceAt).toBe(140);
		p.advance(140 + PLAYED - 1);
		expect(s.left).toBeNull();
		p.advance(4000);
		expect(s.leftAt).toBe(140 + PLAYED);
	});

	it('without the entrance’s start it counts from navigation start', () => {
		const p = page({ entrance: null });
		const s = new LaunchScreen(p.env);
		s.start();
		p.advance(200);
		s.ready();
		p.advance(4000);
		expect(s.left).toBe('ready');
		expect(s.leftAt).toBe(PLAYED);
	});

	it('an app ready after the hold leaves at readiness', () => {
		const p = page();
		const s = new LaunchScreen(p.env);
		s.start();
		p.advance(2900);
		s.ready();
		expect(s.left).toBe('ready');
		expect(s.leftAt).toBe(2900);
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
		p.advance(LAUNCH.capMs + 400);
		const s = new LaunchScreen(p.env);
		s.start();
		p.advance(LAUNCH.capMs + 400);
		expect(s.left).toBe('cap');
	});

	it('a click or a key skips it at once', () => {
		for (const type of ['pointerdown', 'keydown']) {
			const p = page();
			const s = new LaunchScreen(p.env);
			s.start();
			p.advance(400);
			s.ready();
			p.listeners.get(type)!();
			expect(s.left).toBe('skip');
			expect(s.leftAt).toBe(400);
			expect(p.timers).toHaveLength(0);
			expect(p.listeners.size).toBe(0);
		}
	});

	it('reduced motion shows the still logo and leaves at readiness', () => {
		const p = page({ reduced: true });
		const s = new LaunchScreen(p.env);
		s.start();
		p.advance(300);
		s.ready();
		expect(s.left).toBe('ready');
		expect(s.leftAt).toBe(300);
	});

	it('fades out over the app with the base curve; reduced motion fades faster', () => {
		const p = page({ animate: true });
		const s = new LaunchScreen(p.env);
		s.start();
		s.ready();
		p.advance(PLAYED);
		expect(p.fades[0].options).toMatchObject({ duration: LAUNCH.fadeMs, easing: LAUNCH_EASE });
		expect(p.fades[0].keyframes).toEqual([{ opacity: 1 }, { opacity: 0 }]);
		const r = page({ animate: true, reduced: true });
		new LaunchScreen(r.env).ready();
		expect(r.fades[0].options.duration).toBe(LAUNCH.reducedFadeMs);
		const k = page({ animate: true });
		const skip = new LaunchScreen(k.env);
		skip.start();
		k.listeners.get('keydown')!();
		expect(k.fades[0].options.duration).toBe(LAUNCH.skipFadeMs);
	});
});
