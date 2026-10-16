// The first-use trial plan for the app: claims it after a sign-in (per
// installation and account, at most once per run; see trial.ts), right after
// a fresh sign-in as well as at later starts, and holds what the grant card and
// the account card show. +page.svelte calls signedIn() when the LynShen
// account is signed in (at start and after each sign-in) and signedOut()
// when it is not. The account card and page read the plan in force and who
// pays this device's requests from GET /api/desktop/oauth/plan
// (refreshStatus), and the user changes that (setFunding): the plan only or
// the balance only, never both, never switched for the user
// (notes/plan-balance-separation.md 3.4, 3.6, 3.8). A plan this device does
// not pay with is offered once (`offer`), and after the user moved to the
// balance because the plan's window was used up, the plan is offered again
// once the window recovers (remindRecovery).
import { claimTrial, desktopInstallationId, fetchDesktopPlan, monoizeSession, setPlanFunding } from '$lib/protocol';
import { t } from '$lib/i18n';
import { toast } from '$lib/ui/toast.svelte';
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
	planKey,
	type ClaimOutcome,
	type DesktopPlanStatus,
	type PlanFunding,
	type TrialPlan,
	type TrialRecord
} from '$lib/trial';

/** localStorage: the plans already offered to this device, by
 *  `${installation}:${user}|${planKey}` (when, ms). */
const OFFERED_KEY = 'lynshen-funding-offered';
/** localStorage: the plan to offer again once its window recovers. */
const RECOVER_KEY = 'lynshen-funding-recover';

function readJson<T>(key: string, fallback: T): T {
	try {
		const v = JSON.parse(globalThis.localStorage?.getItem(key) ?? 'null');
		return v && typeof v === 'object' ? (v as T) : fallback;
	} catch {
		return fallback;
	}
}
function writeJson(key: string, value: unknown) {
	try {
		globalThis.localStorage?.setItem(key, JSON.stringify(value ?? null));
	} catch {
		/* no storage: asked again next time */
	}
}

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
	/** The plan and the choice were asked for since the sign-in (answered or
	 *  not): what depends on the choice can show without a flicker. */
	statusRead = $state(false);
	/** The funding the user picked last and the gateway has not confirmed
	 *  yet: shown at once (the latest click wins). */
	desired = $state<PlanFunding | null>(null);
	/** Why the last funding change failed ('' when it did not). */
	fundingError = $state('');
	/** Something else asks the user about the plan just now (the step after
	 *  buying one): the one-time offer waits. */
	offerHeld = $state(false);
	/** Bumped when the plans offered change (localStorage is not reactive). */
	#offered = $state(0);
	#recoverTimer: ReturnType<typeof setTimeout> | undefined;
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
	/** Who pays this device's requests: the latest pick while it is being
	 *  sent, else the gateway's; null while unknown (signed out, not read
	 *  yet, a gateway without the endpoint). */
	get funding(): PlanFunding | null {
		return this.status ? (this.desired ?? this.status.funding) : null;
	}
	/** The choice is shown (Settings → 账户, 套餐与充值): with a plan in force,
	 *  or while the device still pays with a plan that ended. */
	get choiceShown(): boolean {
		return this.funding != null && (this.plan != null || this.funding === 'plan');
	}

	/** A plan in force that this device does not pay with and was not offered
	 *  yet (bought on the website, given by an admin): offered once. Not
	 *  while the trial's card or the step after a purchase asks the same. */
	get offer(): TrialPlan | null {
		void this.#offered;
		const plan = this.plan;
		if (!plan || !this.status || this.status.funding !== 'balance' || this.desired != null || this.saving) return null;
		if (this.offerHeld || this.grant || !this.#key) return null;
		return readJson<Record<string, number>>(OFFERED_KEY, {})[`${this.#key}|${planKey(plan)}`] ? null : plan;
	}
	/** The plan in force was put to the user (whatever they answered): it is
	 *  not offered again. */
	markOffered(plan: TrialPlan | null = this.plan) {
		if (!plan || !this.#key) return;
		const all = readJson<Record<string, number>>(OFFERED_KEY, {});
		all[`${this.#key}|${planKey(plan)}`] = Date.now();
		writeJson(OFFERED_KEY, all);
		this.#offered++;
	}
	/** The offer's answer: pay with the plan, or keep the balance. */
	async answerOffer(usePlan: boolean): Promise<string> {
		this.markOffered();
		return usePlan ? this.setFunding('plan') : '';
	}

	/** The device moved to the balance because the plan's window was used up:
	 *  once the window recovers (`at`, ms), the plan is offered again (a
	 *  quiet notice; one tap moves back). */
	remindRecovery(at: number) {
		if (!this.#key || !this.plan) return;
		writeJson(RECOVER_KEY, { key: this.#key, plan: planKey(this.plan), at });
		this.#armRecovery();
	}
	#armRecovery() {
		clearTimeout(this.#recoverTimer);
		const kept = readJson<{ key?: string; plan?: string; at?: number } | null>(RECOVER_KEY, null);
		if (!kept?.at || kept.key !== this.#key) return;
		const delay = Math.min(2_147_000_000, Math.max(0, kept.at - Date.now()) + 5_000);
		this.#recoverTimer = setTimeout(() => void this.#recovered(kept.plan ?? ''), delay);
	}
	async #recovered(key: string) {
		writeJson(RECOVER_KEY, null);
		await this.refreshStatus();
		const plan = this.plan;
		// Offered only if nothing changed: the same plan, still on the balance.
		if (!plan || planKey(plan) !== key || this.funding !== 'balance') return;
		toast.info(t('shell.funding.recovered', { name: plan.name.trim() || t('shell.trial.label') }), {
			duration: 0,
			action: {
				label: t('shell.funding.backToPlan'),
				run: () => {
					void this.setFunding('plan').then((error) => {
						if (error) toast.error(t('shell.trial.fundingFailed', { error }));
						else toast.success(t('shell.funding.toPlan'));
					});
				}
			}
		});
	}

	/** Reads the plan in force and the funding choice again. A failure keeps
	 *  what was known; a gateway without the endpoint (404) leaves the claim's
	 *  plan to show. */
	async refreshStatus(): Promise<void> {
		const generation = ++this.#statusGeneration;
		const account = this.#account;
		try {
			const status = parseDesktopPlan(await fetchDesktopPlan());
			if (generation === this.#statusGeneration && status) this.status = status;
		} catch (error) {
			const code = (error as { status?: unknown } | null)?.status;
			if (generation === this.#statusGeneration && (code === 404 || code === 401 || code === 403)) this.status = null;
		} finally {
			if (account === this.#account) this.statusRead = true;
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
		// The user chose: the plan in force needs no offer any more.
		this.markOffered();
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
		this.#armRecovery();
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
		clearTimeout(this.#recoverTimer);
		this.#key = null;
		this.#retries = 0;
		this.#statusGeneration++;
		this.record = null;
		this.status = null;
		this.statusRead = false;
	}

	/** The grant card was answered: it does not show again, and its plan is
	 *  not offered again either. */
	acknowledge() {
		if (!this.#key) return;
		const plan = this.grant;
		this.record = this.#store().acknowledge(this.#key) ?? null;
		this.markOffered(plan);
	}
}

export const trial = new Trial();
