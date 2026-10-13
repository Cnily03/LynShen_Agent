// The first-use trial plan for the app: claims it after a sign-in (once per
// installation and account, see trial.ts), and holds what the grant card and
// the account card show. +page.svelte calls signedIn() when the LynShen
// account is signed in (at start and after each sign-in) and signedOut()
// when it is not.
import { claimTrial, desktopInstallationId, monoizeSession } from '$lib/protocol';
import {
	RETRY_DELAYS_MS,
	TrialClaims,
	activePlan,
	claimKey,
	grantToAnnounce,
	outcomeOfFailure,
	outcomeOfReply,
	type ClaimOutcome,
	type TrialPlan,
	type TrialRecord
} from '$lib/trial';

async function claimOutcome(): Promise<ClaimOutcome> {
	try {
		return outcomeOfReply(await claimTrial());
	} catch (error) {
		return outcomeOfFailure(error);
	}
}

class Trial {
	/** The signed-in account's record on this installation; null when signed
	 *  out or not known yet. */
	record = $state<TrialRecord | null>(null);
	#key: string | null = null;
	#claims: TrialClaims | null = null;
	#generation = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** Timed retries in this run of the app (RETRY_DELAYS_MS). */
	#retries = 0;

	/** The trial plan in force, for the account card.
	 *  TODO(trial-plan-status): its windows are those of the claim's answer
	 *  (used as of the grant). Refresh them from a device-key status read once
	 *  the gateway has one; the contract defines none, and the claim is not
	 *  asked again to refresh. */
	get plan(): TrialPlan | null {
		return activePlan(this.record, Date.now());
	}
	/** The plan the one-time grant card announces. */
	get grant(): TrialPlan | null {
		return grantToAnnounce(this.record, Date.now());
	}

	#store(): TrialClaims {
		this.#claims ??= new TrialClaims(localStorage, claimOutcome);
		return this.#claims;
	}

	/** The account is signed in: claim when due (no request when an outcome is
	 *  remembered). A network failure retries a few times in this run. */
	async signedIn(): Promise<void> {
		const generation = ++this.#generation;
		clearTimeout(this.#timer);
		let key: string | null = null;
		try {
			const [installation, session] = await Promise.all([desktopInstallationId(), monoizeSession()]);
			const user = session.logged_in ? session.session?.user?.id : null;
			if (installation && user) key = claimKey(installation, user);
		} catch {
			// Who is signed in could not be read (offline): as a network failure.
			if (generation === this.#generation) this.#retryLater(generation);
			return;
		}
		if (generation !== this.#generation) return;
		this.#key = key;
		if (!key) {
			this.record = null;
			return;
		}
		const claims = this.#store();
		this.record = claims.get(key) ?? null;
		const record = await claims.run(key);
		if (generation !== this.#generation) return;
		this.record = record ?? null;
		if (record?.status === 'network') this.#retryLater(generation);
	}

	#retryLater(generation: number) {
		const delay = RETRY_DELAYS_MS[this.#retries];
		if (delay == null) return;
		this.#retries++;
		this.#timer = setTimeout(() => {
			if (generation === this.#generation) void this.signedIn();
		}, delay);
	}

	/** Signed out: nothing to show, no retry pending. */
	signedOut() {
		this.#generation++;
		clearTimeout(this.#timer);
		this.#key = null;
		this.#retries = 0;
		this.record = null;
	}

	/** The grant card's "知道了": it does not show again. */
	acknowledge() {
		if (!this.#key) return;
		this.record = this.#store().acknowledge(this.#key) ?? null;
	}
}

export const trial = new Trial();
