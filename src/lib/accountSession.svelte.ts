// The LynShen account as last read (monoize_session: the gateway's
// /api/desktop/oauth/me), shared by the sidebar's account row and card,
// Settings → 账户 and the welcome page. Who it is (id, name, email, role) is
// kept between runs, so a signed-in account shows at once while it is read
// again; `state` says how this run's read went. A page shows the logged-out
// view only once a read said so ('out'), never while it runs ('loading').
import { monoizeSession, type MonoizeUser } from '$lib/protocol';

/** localStorage: the account's identity, as last read. */
export const ACCOUNT_KEY = 'lynshen-account';

/** 'loading': not read yet in this run, or being read without a kept
 *  account; 'in' / 'out': the last read's answer; 'error': the read failed
 *  (offline, the gateway down) and no account is kept. */
export type AccountState = 'loading' | 'in' | 'out' | 'error';

/** The identity worth keeping; null for anything that is not a user. */
export function keptIdentity(v: unknown): MonoizeUser | null {
	if (!v || typeof v !== 'object') return null;
	const u = v as Record<string, unknown>;
	if (typeof u.id !== 'string' || !u.id || typeof u.username !== 'string') return null;
	return {
		id: u.id,
		username: u.username,
		role: typeof u.role === 'string' ? u.role : 'user',
		...(typeof u.email === 'string' ? { email: u.email } : {}),
		...(u.billing_plan && typeof u.billing_plan === 'object' ? { billing_plan: u.billing_plan as { name?: string } } : {})
	};
}

function stored(): MonoizeUser | null {
	try {
		return keptIdentity(JSON.parse(localStorage.getItem(ACCOUNT_KEY) ?? 'null'));
	} catch {
		return null;
	}
}

function keep(user: MonoizeUser | null) {
	try {
		const identity = keptIdentity(user);
		if (identity) localStorage.setItem(ACCOUNT_KEY, JSON.stringify(identity));
		else localStorage.removeItem(ACCOUNT_KEY);
	} catch {
		/* no storage: read again next run */
	}
}

/** A refusal that means the device key is gone (revoked, expired). */
function signedOutError(e: unknown): boolean {
	let v: unknown = e;
	if (typeof e === 'string') {
		try {
			v = JSON.parse(e);
		} catch {
			return false;
		}
	}
	const status = v && typeof v === 'object' ? (v as { status?: unknown }).status : null;
	return status === 401;
}

export class AccountSession {
	/** The account: this run's read, else the one kept from the last run. */
	user = $state<MonoizeUser | null>(null);
	state = $state<AccountState>('loading');
	/** Why the last read failed ('' when it did not). */
	error = $state('');
	#reading: Promise<MonoizeUser | null> | null = null;
	#generation = 0;

	constructor(private readonly read_ = monoizeSession) {
		this.user = stored();
	}

	/** Reads who is signed in; calls while one runs share it. The kept
	 *  account stays on screen meanwhile and when the read fails. */
	read(): Promise<MonoizeUser | null> {
		if (this.#reading) return this.#reading;
		const generation = ++this.#generation;
		if (!this.user) this.state = 'loading';
		const reading = this.read_()
			.then(
				(s) => {
					const user = s.logged_in && s.session ? s.session.user : null;
					if (generation === this.#generation) this.#set(user);
					return user;
				},
				(e) => {
					if (generation !== this.#generation) return this.user;
					if (signedOutError(e)) {
						this.#set(null);
						return null;
					}
					this.error = e instanceof Error ? e.message : String(e);
					this.state = this.user ? 'in' : 'error';
					return this.user;
				}
			)
			.finally(() => {
				if (this.#reading === reading) this.#reading = null;
			});
		this.#reading = reading;
		return reading;
	}

	/** A sign-in finished with this user. */
	signedIn(user: MonoizeUser) {
		this.#generation++;
		this.#reading = null;
		this.#set(user);
	}

	/** Logged out (or the key is gone). */
	signedOut() {
		this.#generation++;
		this.#reading = null;
		this.#set(null);
	}

	#set(user: MonoizeUser | null) {
		this.user = user;
		this.state = user ? 'in' : 'out';
		this.error = '';
		keep(user);
	}
}

export const account = new AccountSession();
