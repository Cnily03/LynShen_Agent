// The first-use trial plan for the app: claims it after a sign-in (once per
// installation and account, see trial.ts), and holds what the grant card and
// the account card show. +page.svelte calls signedIn() when the LynShen
// account is signed in (at start and after each sign-in) and signedOut()
// when it is not. The account card and page read the plan in force and the
// funding choice from GET /api/desktop/oauth/plan (refreshStatus) and change
// the choice (setFunding).
import { claimTrial, desktopInstallationId, fetchDesktopPlan, monoizeSession, setPlanFunding } from '$lib/protocol';
import {
	RETRY_DELAYS_MS,
	TrialClaims,
	activePlan,
	claimKey,
	grantToAnnounce,
	outcomeOfFailure,
	outcomeOfReply,
	parseDesktopPlan,
	planInForce,
	type ClaimOutcome,
	type DesktopPlanStatus,
	type PlanFunding,
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
	/** The plan in force and the funding choice as the gateway last said;
	 *  null before that, signed out, or from a gateway without the endpoint. */
	status = $state<DesktopPlanStatus | null>(null);
	/** A funding change is being sent. */
	saving = $state(false);
	#statusGeneration = 0;
	#key: string | null = null;
	#claims: TrialClaims | null = null;
	#generation = 0;
	#timer: ReturnType<typeof setTimeout> | undefined;
	/** Timed retries in this run of the app (RETRY_DELAYS_MS). */
	#retries = 0;

	/** The desktop plan in force, for the account card and page: the
	 *  gateway's (live windows; also a paid plan), else the trial as the claim
	 *  answered it (an older gateway, or not read yet). */
	get plan(): TrialPlan | null {
		const now = Date.now();
		return this.status ? planInForce(this.status.plan, now) : activePlan(this.record, now);
	}
	/** Who pays this key's requests in the plan's groups; null while unknown. */
	get funding(): PlanFunding | null {
		return this.status && this.plan ? this.status.funding : null;
	}

	/** Reads the plan in force and the funding choice again. A failure keeps
	 *  what was known; a gateway without the endpoint (404) leaves the claim's
	 *  plan to show. */
	async refreshStatus(): Promise<void> {
		const generation = ++this.#statusGeneration;
		try {
			const status = parseDesktopPlan(await fetchDesktopPlan());
			if (generation === this.#statusGeneration && status) this.status = status;
		} catch (error) {
			const code = (error as { status?: unknown } | null)?.status;
			if (generation === this.#statusGeneration && (code === 404 || code === 401 || code === 403)) this.status = null;
		}
	}

	/** Sets who pays; answers what went wrong, or '' when it is done. */
	async setFunding(funding: PlanFunding): Promise<string> {
		const generation = ++this.#statusGeneration;
		this.saving = true;
		try {
			const status = parseDesktopPlan(await setPlanFunding(funding));
			if (generation === this.#statusGeneration && status) this.status = status;
			return '';
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		} finally {
			this.saving = false;
		}
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
		else void this.refreshStatus();
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
		this.#statusGeneration++;
		this.record = null;
		this.status = null;
	}

	/** The grant card's "知道了": it does not show again. */
	acknowledge() {
		if (!this.#key) return;
		this.record = this.#store().acknowledge(this.#key) ?? null;
	}
}

export const trial = new Trial();
