import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCOUNT_KEY, AccountSession, keptIdentity } from './accountSession.svelte';
import type { MonoizeUser } from './protocol';

const ANN: MonoizeUser = { id: 'u1', username: 'Ann', role: 'user', email: 'ann@example.com', balance_usd: '3.20' };
type Session = { logged_in: boolean; session?: { user: MonoizeUser } };
const signedIn = (user: MonoizeUser): Session => ({ logged_in: true, session: { user } });

/** A read the test answers when it wants. */
function deferred() {
	let answer!: (v: Session) => void;
	let fail!: (e: unknown) => void;
	const promise = new Promise<Session>((res, rej) => ((answer = res), (fail = rej)));
	return { promise, answer, fail };
}

let data: Map<string, string>;
beforeEach(() => {
	data = new Map();
	vi.stubGlobal('localStorage', {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k)
	});
});
afterEach(() => vi.unstubAllGlobals());

describe('the account session', () => {
	it('is loading, not logged out, until the first read answers', async () => {
		const read = deferred();
		const account = new AccountSession(() => read.promise);
		expect(account.state).toBe('loading');
		const done = account.read();
		expect(account.state).toBe('loading');
		expect(account.user).toBeNull();
		read.answer(signedIn(ANN));
		await done;
		expect(account.state).toBe('in');
		expect(account.user?.username).toBe('Ann');
	});

	it('shows the account kept from the last run at once, and keeps only who it is', async () => {
		const first = new AccountSession(async () => signedIn(ANN));
		await first.read();
		expect(JSON.parse(data.get(ACCOUNT_KEY)!)).toEqual({ id: 'u1', username: 'Ann', role: 'user', email: 'ann@example.com' });
		const read = deferred();
		const next = new AccountSession(() => read.promise);
		expect(next.user?.username).toBe('Ann');
		void next.read();
		expect(next.user?.username).toBe('Ann');
		read.answer({ logged_in: false });
		await Promise.resolve();
		await Promise.resolve();
		expect(next.state).toBe('out');
		expect(next.user).toBeNull();
		expect(data.has(ACCOUNT_KEY)).toBe(false);
	});

	it('keeps the account when the read fails on the way, and says so without one', async () => {
		const kept = new AccountSession(async () => signedIn(ANN));
		await kept.read();
		const offline = new AccountSession(async () => {
			throw new Error('network down');
		});
		await offline.read();
		expect(offline.state).toBe('in');
		expect(offline.user?.username).toBe('Ann');
		data.clear();
		const none = new AccountSession(async () => {
			throw new Error('network down');
		});
		await none.read();
		expect(none.state).toBe('error');
		expect(none.error).toBe('network down');
	});

	it('reads a revoked key (401) as logged out', async () => {
		await new AccountSession(async () => signedIn(ANN)).read();
		const revoked = new AccountSession(async () => {
			throw JSON.stringify({ status: 401, code: 'invalid_token', message: 'revoked' });
		});
		await revoked.read();
		expect(revoked.state).toBe('out');
		expect(revoked.user).toBeNull();
	});

	it('shares one read between callers, and a sign-in or log-out wins over a read under way', async () => {
		const reads: ReturnType<typeof deferred>[] = [];
		const account = new AccountSession(() => {
			reads.push(deferred());
			return reads.at(-1)!.promise;
		});
		const a = account.read();
		const b = account.read();
		expect(reads).toHaveLength(1);
		account.signedIn({ ...ANN, username: 'Ann B' });
		reads[0].answer({ logged_in: false });
		await Promise.all([a, b]);
		expect(account.user?.username).toBe('Ann B');
		void account.read();
		account.signedOut();
		reads[1].answer(signedIn(ANN));
		await Promise.resolve();
		expect(account.state).toBe('out');
	});

	it('keeps nothing that is not a user', () => {
		expect(keptIdentity(null)).toBeNull();
		expect(keptIdentity({ username: 'x' })).toBeNull();
		expect(keptIdentity({ id: 'u', username: 'x', balance_usd: '1' })).toEqual({ id: 'u', username: 'x', role: 'user' });
	});
});
