// The app's side of in-app purchases (purchase.ts): a signal that an order
// paid in the app is complete, so the sidebar's balance and the plan read
// again without waiting for the next window focus.

class Purchases {
	/** Bumped once per completed order. */
	completed = $state(0);

	done() {
		this.completed++;
	}
}

export const purchases = new Purchases();
