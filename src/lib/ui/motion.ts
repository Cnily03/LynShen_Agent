// Svelte transitions on the app's motion tokens (app.css: --t-*, --ease-*,
// --time-scale), for elements that also need an exit animation. CSS-only
// entrances use the keyframes in app.css. The family follows hark.com's web
// app: enters decelerate (EASE_ENTER), exits are shorter and accelerate
// (EASE_EXIT), size and colour share EASE_BASE. Pages only fade and move a
// few pixels; menus and dialogs may also scale a little and unblur. Reduced
// motion makes every one instant.
import type { TransitionConfig } from 'svelte/transition';
import type { AnimationConfig } from 'svelte/animate';

/** A CSS cubic-bezier(x1, y1, x2, y2) as an easing function. */
export function bezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
	const at = (s: number, a: number, b: number) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
	const slope = (s: number, a: number, b: number) => 3 * a * (1 - s) ** 2 + 6 * (b - a) * s * (1 - s) + 3 * (1 - b) * s * s;
	return (t) => {
		if (t <= 0) return 0;
		if (t >= 1) return 1;
		let s = t;
		for (let i = 0; i < 8; i++) {
			const dx = at(s, x1, x2) - t;
			const d = slope(s, x1, x2);
			if (Math.abs(dx) < 1e-6 || d === 0) break;
			s = Math.min(1, Math.max(0, s - dx / d));
		}
		return at(s, y1, y2);
	};
}

/** --ease-base: size, colour and opacity changes. */
export const EASE_BASE = bezier(0.24, 0.42, 0.42, 0.92);
/** --ease-enter: things coming in. */
export const EASE_ENTER = bezier(0, 0, 0.2, 1);
/** --ease-exit: things going away. */
export const EASE_EXIT = bezier(0.4, 0, 1, 1);
/** --ease-in-out: a row moving to its new place (slow start, so the change
 *  of look is seen before the move). */
export const EASE_IN_OUT = bezier(0.65, 0, 0.35, 1);

export const T_FAST = 120;
export const T_MED = 220;
export const T_BASE = 240;
/** --t-enter. */
export const T_ENTER = 400;

const reduced = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** --time-scale on the root (1 unless a debug session slows everything down). */
export function timeScale(): number {
	if (typeof document === 'undefined') return 1;
	const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--time-scale'));
	return Number.isFinite(v) && v >= 0 ? v : 1;
}

/** `ms` scaled by --time-scale, or 0 under reduced motion (for svelte/transition's own). */
export const motionMs = (ms: number) => (reduced() ? 0 : ms * timeScale());

type Direction = { direction?: 'in' | 'out' | 'both' };

/** Backdrops behind dialogs: in 200 ms, out 140 ms. */
export function scrim(_node: Element, _params = {}, { direction }: Direction = {}): TransitionConfig {
	const out = direction === 'out';
	return {
		duration: motionMs(out ? 140 : 200),
		easing: out ? EASE_EXIT : EASE_ENTER,
		css: (t) => `opacity: ${t}`
	};
}

/** Dialogs: in 220 ms from a little lower and smaller; out 160 ms. Only
 *  opacity and transform, which the GPU composites (a dialog can be large). */
export function sheet(_node: Element, { y = 8 } = {}, { direction }: Direction = {}): TransitionConfig {
	const out = direction === 'out';
	return {
		duration: motionMs(out ? 160 : 220),
		easing: out ? EASE_EXIT : EASE_ENTER,
		css: (t, u) => `opacity: ${t}; transform: translateY(${u * (out ? y / 2 : y)}px) scale(${0.96 + 0.04 * t})`
	};
}

/** Menus, popovers and the account card closing: 100 ms, shrink a little and blur away. */
export function popOut(_node: Element, { duration = 100 } = {}): TransitionConfig {
	return {
		duration: motionMs(duration),
		easing: EASE_EXIT,
		css: (t, u) => `opacity: ${t}; transform: scale(${0.95 + 0.05 * t}); filter: blur(${u * 8}px)`
	};
}

/** A page or section coming in (settings sections): fade and rise a little. */
export function paneIn(_node: Element, { y = 4, duration = T_MED } = {}): TransitionConfig {
	return {
		duration: motionMs(duration),
		easing: EASE_ENTER,
		css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`
	};
}

/** A page leaving (settings, home, project page), or a settings section
 *  giving way to the next: fade and sink a little. */
export function paneOut(_node: Element, { y = 4, duration = 140 } = {}): TransitionConfig {
	return {
		duration: motionMs(duration),
		easing: EASE_EXIT,
		css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`
	};
}

// Rows that arrive in the same update: a list loading or filling in, which
// appears at once instead of sliding row by row.
let arriving = 0;

/** A list row arriving (a new session in the sidebar): slide in from the left. */
export function rowIn(_node: Element, { x = -6, duration = 180 } = {}): () => TransitionConfig {
	arriving++;
	// Svelte calls a returned function in the next microtask, after every
	// row of this update has counted itself.
	return () => {
		const together = arriving;
		queueMicrotask(() => (arriving = 0));
		if (together > 2) return { duration: 0 };
		return {
			duration: motionMs(duration),
			easing: EASE_ENTER,
			css: (t, u) => `opacity: ${t}; transform: translateX(${u * x}px)`
		};
	};
}

/** A heading arriving in a list (a group of the navigator that was empty):
 *  fade and settle 4px down, after the rows start to make room. Arriving
 *  with a list that fills in, it appears at once (see rowIn). */
export function groupIn(_node: Element, { y = -4, duration = T_BASE, delay = 80 } = {}): () => TransitionConfig {
	arriving++;
	return () => {
		const together = arriving;
		queueMicrotask(() => (arriving = 0));
		if (together > 2) return { duration: 0 };
		return {
			delay: motionMs(delay),
			duration: motionMs(duration),
			easing: EASE_ENTER,
			css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`
		};
	};
}

/** A row moving to its new place in a keyed list (`animate:moveRow`): its
 *  look changed at once; now it moves, 400ms on --ease-in-out, while the
 *  others make room. The row that changed group (`over`) passes over the
 *  others, on `fill` (the list's own fill, so the rows it passes do not
 *  show through it), and 1px of it around: rows that move together (a
 *  conversation and its sub-agents) leave no seam between them at a
 *  fraction of a pixel. Nothing is kept once it lands. */
export function moveRow(_node: Element, { from, to }: { from: DOMRect; to: DOMRect }, { over = false, fill = 'transparent' } = {}): AnimationConfig {
	const dy = from.top - to.top;
	if (!dy) return { duration: 0 };
	const lift = over ? `; z-index: 2; background-color: ${fill}; box-shadow: 0 0 0 1px ${fill}` : '';
	return {
		duration: motionMs(T_ENTER),
		easing: EASE_IN_OUT,
		css: (_t, u) => `transform: translateY(${u * dy}px)${lift}`
	};
}

/** A sub-agent arriving under its conversation in the navigator: fade and
 *  settle 4px down (240ms, --ease-enter) after `delay` (80ms, then 120ms
 *  more for each one that arrives with it: sidebarSubagents.ts, arrivals),
 *  while the rows below make room. A negative delay: at once (the list
 *  filling in). */
export function childIn(_node: Element, { delay = 80, y = -4, duration = T_BASE } = {}): TransitionConfig {
	if (delay < 0) return { duration: 0 };
	return {
		delay: motionMs(delay),
		duration: motionMs(duration),
		easing: EASE_ENTER,
		css: (t, u) => `opacity: ${t}; transform: translateY(${u * y}px)`
	};
}

/** A sub-agent folding away once its conversation's turn is over: it fades
 *  out, 140ms on --ease-exit (shorter than its entrance), while the rows
 *  below move up into its place. Opacity only. */
export function childOut(_node: Element, { duration = 140 } = {}): TransitionConfig {
	return {
		duration: motionMs(duration),
		easing: EASE_EXIT,
		css: (t) => `opacity: ${t}`
	};
}

/** An item arriving in the navigator's flat list: a row slides in (rowIn),
 *  a group's heading fades in (groupIn), a sub-agent fades in after its
 *  `delay` (childIn). */
export function listIn(node: Element, { head = false, child = false, delay = 80 } = {}): TransitionConfig | (() => TransitionConfig) {
	if (child) return childIn(node, { delay });
	return head ? groupIn(node) : rowIn(node);
}

/** An item leaving the navigator's flat list: a sub-agent fades (childOut);
 *  a row or a heading goes at once (the others move into its place). */
export function listOut(node: Element, { child = false } = {}): TransitionConfig {
	return child ? childOut(node) : { duration: 0 };
}
