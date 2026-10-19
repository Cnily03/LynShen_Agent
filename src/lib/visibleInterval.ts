// A timer for what only matters on screen (a clock that ticks, a poll that
// refreshes what is shown): it stops while the page is hidden (the window
// minimized, on another Space, or the page in the background) and, when it
// shows again, runs once at once and then on its interval.

/** Calls `fn` every `ms` while the page is visible; returns the stop. */
export function visibleInterval(fn: () => void, ms: number): () => void {
	if (typeof document === 'undefined') {
		const timer = setInterval(fn, ms);
		return () => clearInterval(timer);
	}
	let timer: ReturnType<typeof setInterval> | null = null;
	const start = () => {
		if (timer === null && !document.hidden) timer = setInterval(fn, ms);
	};
	const stop = () => {
		if (timer !== null) clearInterval(timer);
		timer = null;
	};
	const onVisibility = () => {
		if (document.hidden) stop();
		else if (timer === null) {
			fn();
			start();
		}
	};
	document.addEventListener('visibilitychange', onVisibility);
	start();
	return () => {
		stop();
		document.removeEventListener('visibilitychange', onVisibility);
	};
}
