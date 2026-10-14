// The first-use trial plan for the app: claims it after a sign-in (per
// installation and account, at most once per run; see trial.ts), right after
// a fresh sign-in as well as at later starts, and holds what the grant card and
// the account card show. +page.svelte calls signedIn() when the LynShen
// account is signed in (at start and after each sign-in) and signedOut()
// when it is not. The account card and page read the plan in force and the
// funding choice from GET /api/desktop/oauth/plan (refreshStatus) and change
// the choice (setFunding).
import { claimTrial, desktopInstallationId, fetchDesktopPlan, monoizeSession, setPlanFunding } from '$lib/protocol';
import {
	RETRY_DELAYS_MS,
	TrialClaims,
	accountCreatedAt,
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
	/** The funding the user picked last and the gateway has not confirmed
	 *  yet: shown at once (the latest click wins). */
	desired = $state<PlanFunding | null>(null);
	/** Why the last funding change failed ('' when it did not). */
	fundingError = $state('');
	#statusGeneration = 0;
	#sending: Promise<string> | null = null;
	/** Bumped at each sign-out: an answer for the account before is dropped. */
	#account = 0;
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
	/** Who pays this key's requests in the plan's groups: the latest pick
	 *  while it is being sent, else the gateway's; null while unknown. */
	get funding(): PlanFunding | null {
		return this.status && this.plan ? (this.desired ?? this.status.funding) : null;
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

	/** Sets who pays; answers what went wrong, or '' once the gateway has
	 *  the latest choice. The choice shows at once. One change is sent at a
	 *  time: a pick made meanwhile is sent when the gateway answers, if it
	 *  still differs, so the last pick wins and none is dropped. A failure
	 *  shows the gateway's last known choice again. */
	setFunding(funding: PlanFunding): Promise<string> {
		this.fundingError = '';
		this.desired = funding;
		this.#sending ??= this.#sendFunding().finally(() => (this.#sending = null));
		return this.#sending;
	}

	async #sendFunding(): Promise<string> {
		const account = this.#account;
		this.saving = true;
		try {
			while (this.desired != null && this.desired !== this.status?.funding) {
				const want = this.desired;
				let reply: DesktopPlanStatus | null;
				try {
					reply = parseDesktopPlan(await setPlanFunding(want));
				} catch (error) {
					if (account !== this.#account) return '';
					this.desired = null;
					this.fundingError = error instanceof Error ? error.message : String(error);
					return this.fundingError;
				}
				if (account !== this.#account) return '';
				// The answer to the change is newer than any read sent before it.
				this.#statusGeneration++;
				if (reply) this.status = reply;
				// Nothing picked meanwhile: done (whatever the gateway made of it).
				if (this.desired === want) this.desired = null;
			}
			this.desired = null;
			return '';
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

	/** The account is signed in: claim when due (trial.ts needsClaim; no
	 *  request when a grant is remembered, or this run asked already). A
	 *  network failure retries a few times in this run. */
	async signedIn(): Promise<void> {
		const generation = ++this.#generation;
		clearTimeout(this.#timer);
		let key: string | null = null;
		let accountSince: number | null = null;
		try {
			const [installation, session] = await Promise.all([desktopInstallationId(), monoizeSession()]);
			const user = session.logged_in ? session.session?.user : null;
			if (installation && user?.id) key = claimKey(installation, user.id);
			accountSince = accountCreatedAt(user);
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
		const record = await claims.run(key, accountSince);
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
		this.#account++;
		this.desired = null;
		this.fundingError = '';
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
