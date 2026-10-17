import type { MonoizeUser } from '$lib/protocol';

/** Time between token polls. The gateway answers `slow_down` to a pending grant polled sooner. */
export const POLL_INTERVAL_MS = 5000;

const linkListeners = new Set<() => void>();

/**
 * A `lynshen://auth/...` link arrived. The website's consent page opens it after the
 * user approves (gateway spec DA-7a). The link carries no code or secret: it only makes
 * a pending browser sign-in poll now instead of at the end of its wait. Returns whether
 * a sign-in was pending; without one the link does nothing.
 */
export function authLinkOpened(): boolean {
	const pending = linkListeners.size > 0;
	for (const listener of [...linkListeners]) listener();
	return pending;
}

export interface SignInPoll {
	/** The signed-in user; null once stopped. Rejects with the error of a failed poll. */
	done: Promise<MonoizeUser | null>;
	stop(): void;
}

/**
 * Polls every POLL_INTERVAL_MS until `poll` returns a user, throws, or `stop()` is called.
 * An auth link (`authLinkOpened`) adds one poll at once, at most one per interval. That
 * extra poll leaves the regular schedule as it was: a gateway without DA-4b answers it
 * `slow_down` without counting it, and the regular poll must still go out on time.
 */
export function pollForSignIn(poll: () => Promise<{ user?: MonoizeUser }>): SignInPoll {
	let stopped = false;
	let due = Date.now() + POLL_INTERVAL_MS;
	// The `due` an extra poll already went out for; a link arriving mid-poll waits in `linked`.
	let linkedDue = -1;
	let linked = false;
	let interrupt: ((byLink: boolean) => void) | undefined;
	const onLink = () => {
		if (linkedDue === due) return;
		if (interrupt) interrupt(true);
		else linked = true;
	};
	const wait = () =>
		new Promise<boolean>((resolve) => {
			if (linked) return resolve(true);
			const timer = setTimeout(() => resolve(false), Math.max(0, due - Date.now()));
			interrupt = (byLink) => {
				clearTimeout(timer);
				resolve(byLink);
			};
		});
	linkListeners.add(onLink);
	const done = (async () => {
		try {
			while (!stopped) {
				const byLink = await wait();
				interrupt = undefined;
				linked = false;
				if (stopped) break;
				if (byLink) linkedDue = due;
				const sent = Date.now();
				const result = await poll();
				if (stopped) break;
				if (result.user) return result.user;
				if (!byLink) due = sent + POLL_INTERVAL_MS;
			}
			return null;
		} finally {
			linkListeners.delete(onLink);
		}
	})();
	return {
		done,
		stop() {
			stopped = true;
			linkListeners.delete(onLink);
			interrupt?.(false);
		}
	};
}
