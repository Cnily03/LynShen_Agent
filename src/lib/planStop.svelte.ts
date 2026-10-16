// A turn the plan stopped, waiting for the plan's window to recover because
// the user chose 等待恢复 (planStop.ts): per conversation, when it goes on.
// The error card shows the wait and can call it off; nothing waits unless
// the user asked.
import { SvelteMap } from 'svelte/reactivity';

class PlanWaits {
	#until = new SvelteMap<string, number>();
	#timers = new Map<string, ReturnType<typeof setTimeout>>();

	/** When the conversation's turn goes on (ms); null when it does not wait. */
	until(id: string): number | null {
		return this.#until.get(id) ?? null;
	}

	/** Goes on with the turn (`resume`) at `at`, a little after the window
	 *  recovers; a wait already set for the conversation is replaced. */
	wait(id: string, at: number, resume: () => void) {
		this.cancel(id);
		this.#until.set(id, at);
		// A few seconds late: the gateway counts the window by its own clock.
		const delay = Math.min(2_147_000_000, Math.max(0, at - Date.now()) + 5_000);
		this.#timers.set(
			id,
			setTimeout(() => {
				this.#timers.delete(id);
				this.#until.delete(id);
				resume();
			}, delay)
		);
	}

	/** Calls a wait off (the card's 取消等待, a new message, closing the conversation). */
	cancel(id: string) {
		clearTimeout(this.#timers.get(id));
		this.#timers.delete(id);
		this.#until.delete(id);
	}
}

export const planWaits = new PlanWaits();
