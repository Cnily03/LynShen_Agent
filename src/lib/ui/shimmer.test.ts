import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SHIMMER_FRAMES, SHIMMER_MS, shimmer } from './shimmer';

// Just enough of a browser for the action: the root's attributes, the
// reduced-motion query, one attribute observer and Element.animate.
type Fake = { cancelled: boolean; startTime: number | null; options: KeyframeAnimationOptions; frames: Keyframe[] };
let attrs: Set<string>;
let reduced: boolean;
let motionListeners: (() => void)[];
let observers: (() => void)[];
let animations: Fake[];

const node = () =>
	({
		animate(frames: Keyframe[], options: KeyframeAnimationOptions) {
			const a: Fake = { cancelled: false, startTime: null, options, frames };
			animations.push(a);
			return Object.assign(a, { cancel: () => (a.cancelled = true) });
		}
	}) as unknown as HTMLElement;
const notify = () => observers.forEach((f) => f());

beforeEach(() => {
	attrs = new Set();
	reduced = false;
	motionListeners = [];
	observers = [];
	animations = [];
	vi.stubGlobal('document', { documentElement: { hasAttribute: (a: string) => attrs.has(a) } });
	vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: () => '1' }));
	vi.stubGlobal('matchMedia', () => ({
		get matches() {
			return reduced;
		},
		addEventListener: (_: string, f: () => void) => motionListeners.push(f),
		removeEventListener: (_: string, f: () => void) => (motionListeners = motionListeners.filter((g) => g !== f))
	}));
	vi.stubGlobal(
		'MutationObserver',
		class {
			#f: () => void;
			constructor(f: () => void) {
				this.#f = f;
			}
			observe() {
				observers.push(this.#f);
			}
			disconnect() {
				observers = observers.filter((g) => g !== this.#f);
			}
		}
	);
});
afterEach(() => vi.unstubAllGlobals());

describe('shimmer', () => {
	it('sweeps every 1600 ms, forever, on the shared clock', () => {
		const a = shimmer(node());
		const b = shimmer(node());
		expect(animations).toHaveLength(2);
		for (const sweep of animations) {
			expect(sweep.options).toMatchObject({ duration: SHIMMER_MS, iterations: Infinity, easing: 'linear' });
			expect(sweep.startTime).toBe(0);
		}
		a.destroy();
		b.destroy();
		expect(animations.every((s) => s.cancelled)).toBe(true);
		// The last veil gone, nothing watches the root any more.
		expect(observers).toHaveLength(0);
		expect(motionListeners).toHaveLength(0);
	});

	it('moves the clear window from before the title to past its end, then rests', () => {
		// The veil is 3 titles wide (W = 1); its clear window spans 42–58% of it.
		const x = (f: Keyframe) => (parseFloat(String(f.transform).slice('translateX('.length)) / 100) * 3;
		const [start, swept, end] = SHIMMER_FRAMES;
		expect(x(start) + 0.58 * 3).toBeLessThanOrEqual(0);
		expect(x(swept) + 0.42 * 3).toBeGreaterThanOrEqual(1);
		expect(end.transform).toBe(swept.transform);
		expect(swept.offset).toBe(0.7);
		// The veil covers the title wherever it is.
		for (const f of SHIMMER_FRAMES) {
			expect(x(f)).toBeLessThanOrEqual(0);
			expect(x(f) + 3).toBeGreaterThanOrEqual(1);
		}
	});

	it('stays still under reduced motion and follows the setting', () => {
		reduced = true;
		const a = shimmer(node());
		expect(animations).toHaveLength(0);
		reduced = false;
		motionListeners.forEach((f) => f());
		expect(animations).toHaveLength(1);
		reduced = true;
		motionListeners.forEach((f) => f());
		expect(animations[0].cancelled).toBe(true);
		a.destroy();
	});

	it('leaves the title to breathe over a window frost or a background image', () => {
		attrs.add('data-vibrancy');
		const a = shimmer(node());
		expect(animations).toHaveLength(0);
		attrs.delete('data-vibrancy');
		notify();
		expect(animations).toHaveLength(1);
		attrs.add('data-canvas-bg');
		notify();
		expect(animations[0].cancelled).toBe(true);
		attrs.delete('data-canvas-bg');
		notify();
		expect(animations).toHaveLength(2);
		expect(animations[1].startTime).toBe(0);
		a.destroy();
	});
});
