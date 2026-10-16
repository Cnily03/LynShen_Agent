// The first-use trial plan for the app: claims it after a sign-in (per
// installation and account, at most once per run; see trial.ts), right after
// a fresh sign-in as well as at later starts, and holds what the grant card and
// the account card show. +page.svelte calls signedIn() when the LynShen
// account is signed in (at start and after each sign-in) and signedOut()
// when it is not. The account card and page read the plan in force and who
// pays this device's requests from GET /api/desktop/oauth/plan
// (refreshStatus), and the user changes that (setFunding): the plan only or
// the balance only, never both, never switched for the user
// (notes/plan-balance-separation.md 3.4, 3.6, 3.8). A plan new to this
// device is shown once with who pays (`offer`). A used-up window can move
// the device to the balance until it recovers (setFunding mode
// `until_reset`): the gateway returns it to the plan then, and the app says
// 已恢复使用套餐 when it reads that (also after a restart).
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
/** localStorage: a move to the balance until the window recovers, by
 *  `${installation}:${user}` (until when, ms): its end is announced. */
const TEMP_KEY = 'lynshen-funding-until-reset';

/** How a choice is sent: for good, or until the plan's window recovers. */
export type FundingMode = 'permanent' | 'until_reset';

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
	#tempTimer: ReturnType<typeof setTimeout> | undefined;
	/** How the latest pick is to be sent, and which pick it is (a pick that
	 *  differs only in its mode is still a new pick). */
	#mode: FundingMode = 'permanent';
	#pick = 0;
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

	/** A plan in force not yet put to the user on this device (bought on the
	 *  website, given by an admin, or in force when the app updated): shown
	 *  once, with who pays now. A plan bought pays by default (the gateway
	 *  moves the devices to it), and the card offers the balance; a device
	 *  left on the balance is asked whether the plan should pay. Not while
	 *  the trial's card or the step after a purchase says the same. */
	get offer(): TrialPlan | null {
		void this.#offered;
		const plan = this.plan;
		if (!plan || !this.status || this.desired != null || this.saving) return null;
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
	/** The card's answer: who pays from now on (nothing is sent when it
	 *  stays as it is). */
	async answerOffer(usePlan: boolean): Promise<string> {
		this.markOffered();
		const want: PlanFunding = usePlan ? 'plan' : 'balance';
		return this.status?.funding === want ? '' : this.setFunding(want);
	}

	/** On the balance until then (ms) because the plan's window was used up;
	 *  the gateway returns the device to the plan after it. Null otherwise. */
	get balanceUntil(): number | null {
		const until = this.desired == null && this.status?.funding === 'balance' ? this.status.balanceUntil : null;
		return until ? Date.parse(until) : null;
	}

	/** After each status the gateway sent: a move to the balance until the
	 *  window recovers is remembered, and read again when it should end; its
	 *  end found (the device back on the plan) is said once. `byUser`: the
	 *  status answers the user's own change (nothing to announce). */
	#followTemporary(byUser: boolean) {
		if (!this.#key || !this.status) return;
		const all = readJson<Record<string, number>>(TEMP_KEY, {});
		const kept = all[this.#key];
		clearTimeout(this.#tempTimer);
		if (this.status.funding === 'balance' && this.status.balanceUntil) {
			const until = Date.parse(this.status.balanceUntil);
			all[this.#key] = until;
			writeJson(TEMP_KEY, all);
			const delay = Math.min(2_147_000_000, Math.max(0, until - Date.now()) + 5_000);
			this.#tempTimer = setTimeout(() => void this.refreshStatus(), delay);
			return;
		}
		if (kept == null) return;
		delete all[this.#key];
		writeJson(TEMP_KEY, all);
		if (!byUser && this.status.funding === 'plan') toast.info(t('shell.funding.backOnPlan'));
	}

	/** Reads the plan in force and the funding choice again. A failure keeps
	 *  what was known; a gateway without the endpoint (404) leaves the claim's
	 *  plan to show. */
	async refreshStatus(): Promise<void> {
		const generation = ++this.#statusGeneration;
		const account = this.#account;
		try {
			const status = parseDesktopPlan(await fetchDesktopPlan());
			if (generation === this.#statusGeneration && status && account === this.#account) {
				this.status = status;
				this.#followTemporary(false);
			}
		} catch (error) {
			const code = (error as { status?: unknown } | null)?.status;
			if (generation === this.#statusGeneration && (code === 404 || code === 401 || code === 403)) this.status = null;
		} finally {
			if (account === this.#account) this.statusRead = true;
		}
	}

	#soon: ReturnType<typeof setTimeout> | undefined;
	/** Reads the plan again shortly (a gateway request just ran on the plan:
	 *  its windows moved); calls within the wait share one read. */
	refreshSoon(delay = 2_000) {
		if (this.#soon) return;
		this.#soon = setTimeout(() => {
			this.#soon = undefined;
			void this.refreshStatus();
		}, delay);
	}

	/** Sets who pays; answers what went wrong, or '' once the gateway has
	 *  the latest choice. The choice shows at once. One change is sent at a
	 *  time: a pick made meanwhile is sent when the gateway answers, if it
	 *  still differs, so the last pick wins and none is dropped. A failure
	 *  shows the gateway's last known choice again. */
	setFunding(funding: PlanFunding, mode: FundingMode = 'permanent'): Promise<string> {
		this.fundingError = '';
		this.desired = funding;
		this.#mode = funding === 'balance' ? mode : 'permanent';
		this.#pick++;
		// The user chose: the plan in force needs no offer any more.
		this.markOffered();
		this.#sending ??= this.#sendFunding().finally(() => (this.#sending = null));
		return this.#sending;
	}

	/** The gateway already has the latest pick: the same payer, and for the
	 *  balance the same mode (a move until the window recovers, or for good). */
	#matches(): boolean {
		const s = this.status;
		if (!s || this.desired == null || s.funding !== this.desired) return false;
		return this.desired === 'plan' || (this.#mode === 'until_reset') === !!s.balanceUntil;
	}

	async #sendFunding(): Promise<string> {
		const account = this.#account;
		this.saving = true;
		// The pick last sent: each pick is sent once, whatever the gateway made
		// of it (an older gateway without `until_reset` answers for good).
		let sent = -1;
		try {
			while (this.desired != null && this.#pick !== sent && !this.#matches()) {
				const want = this.desired;
				const mode = this.#mode;
				sent = this.#pick;
				let reply: DesktopPlanStatus | null;
				try {
					reply = parseDesktopPlan(await setPlanFunding(want, mode === 'until_reset' ? mode : null));
				} catch (error) {
					if (account !== this.#account) return '';
					this.desired = null;
					this.fundingError = error instanceof Error ? error.message : String(error);
					return this.fundingError;
				}
				if (account !== this.#account) return '';
				// The answer to the change is newer than any read sent before it.
				this.#statusGeneration++;
				if (reply) {
					this.status = reply;
					this.#followTemporary(true);
				}
				// Nothing picked meanwhile: done (whatever the gateway made of it).
				if (this.#pick === sent) this.desired = null;
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
		clearTimeout(this.#tempTimer);
		clearTimeout(this.#soon);
		this.#soon = undefined;
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
