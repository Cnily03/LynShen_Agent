// A conversation at work in the navigator: one light sweeps across its title,
// and every running title sweeps on the same clock (design.md, "Status,
// attention and emphasis"). The title keeps --text; a veil in the row's own
// colour lies over it, so it reads as --dim, with a clear window in the veil.
// Only the veil's transform moves, which the compositor runs: a turn of many
// minutes repaints nothing. (A gradient moved by background-position through
// the text, as in 0.7, repainted every row at every frame.)
//
// `use:shimmer` on the veil element. The animation starts at time 0 of the
// document timeline, so all veils are at the same point of the cycle, also
// after a row moves in the list. Without it (reduced motion, or a window frost
// or background image behind the navigator, where the veil cannot match the
// row and the title breathes instead, Sidebar.svelte) the veil stays where its
// style puts it: over the whole title.
import { timeScale } from '$lib/ui/motion';

/** One sweep and the rest after it. */
export const SHIMMER_MS = 1600;
/** The veil is three titles wide; its clear window (42–58% of it) crosses
 *  the title from left to right in 70% of the cycle and rests past its end. */
export const SHIMMER_FRAMES: Keyframe[] = [
	{ transform: 'translateX(-60%)', offset: 0 },
	{ transform: 'translateX(-6.667%)', offset: 0.7 },
	{ transform: 'translateX(-6.667%)', offset: 1 }
];

/** The root attributes under which the navigator is not one solid colour
 *  (prefs.svelte.ts sets them). */
const SEE_THROUGH = ['data-vibrancy', 'data-canvas-bg'];

const veils = new Set<() => void>();
let watching: { observer: MutationObserver; motion: MediaQueryList; sync: () => void } | null = null;

function shouldSweep(): boolean {
	const root = document.documentElement;
	if (SEE_THROUGH.some((a) => root.hasAttribute(a))) return false;
	return !matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** One observer for all veils: the frost, the background and reduced motion
 *  can change while conversations run. */
function watch() {
	if (watching || typeof MutationObserver === 'undefined') return;
	const sync = () => veils.forEach((update) => update());
	const observer = new MutationObserver(sync);
	observer.observe(document.documentElement, { attributes: true, attributeFilter: SEE_THROUGH });
	const motion = matchMedia('(prefers-reduced-motion: reduce)');
	motion.addEventListener('change', sync);
	watching = { observer, motion, sync };
}

function unwatch() {
	if (!watching || veils.size) return;
	watching.observer.disconnect();
	watching.motion.removeEventListener('change', watching.sync);
	watching = null;
}

export function shimmer(node: HTMLElement) {
	let sweep: Animation | null = null;
	const update = () => {
		const want = shouldSweep();
		if (want && !sweep && typeof node.animate === 'function') {
			sweep = node.animate(SHIMMER_FRAMES, { duration: SHIMMER_MS * timeScale(), iterations: Infinity, easing: 'linear' });
			// The shared clock: every veil started at the timeline's origin.
			sweep.startTime = 0;
		} else if (!want && sweep) {
			sweep.cancel();
			sweep = null;
		}
	};
	veils.add(update);
	watch();
	update();
	return {
		destroy() {
			sweep?.cancel();
			veils.delete(update);
			unwatch();
		}
	};
}
