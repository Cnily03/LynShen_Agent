import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authLinkOpened, pollForSignIn, POLL_INTERVAL_MS } from './signInPoll';
import type { MonoizeUser } from './protocol';

const user = { id: 'u1', username: 'alice' } as unknown as MonoizeUser;

/** A poll that answers pending until `approve()`, recording the time of each call. */
function gateway() {
	const calls: number[] = [];
	let approved = false;
	const poll = vi.fn(async () => {
		calls.push(Date.now());
		return approved ? { user } : { pending: true };
	});
	return { calls, poll, approve: () => (approved = true) };
}

describe('browser sign-in polling', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(0);
	});
	afterEach(() => vi.useRealTimers());

	it('polls every interval until the browser approves', async () => {
		const g = gateway();
		const run = pollForSignIn(g.poll);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
		expect(g.calls).toEqual([5000, 10000]);
		g.approve();
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
		await expect(run.done).resolves.toBe(user);
		expect(g.calls).toEqual([5000, 10000, 15000]);
	});

	it('polls at once when the consent page opens the auth link', async () => {
		const g = gateway();
		const run = pollForSignIn(g.poll);
		await vi.advanceTimersByTimeAsync(6200);
		g.approve();
		expect(authLinkOpened()).toBe(true);
		await expect(run.done).resolves.toBe(user);
		expect(g.calls).toEqual([5000, 6200]);
	});

	it('keeps the regular schedule after a link poll that found nothing', async () => {
		// A gateway without DA-4b answers the early poll slow_down (pending) and does not count it.
		const g = gateway();
		const run = pollForSignIn(g.poll);
		await vi.advanceTimersByTimeAsync(7000);
		authLinkOpened();
		await vi.advanceTimersByTimeAsync(0);
		expect(g.calls).toEqual([5000, 7000]);
		g.approve();
		await vi.advanceTimersByTimeAsync(3000);
		await expect(run.done).resolves.toBe(user);
		expect(g.calls).toEqual([5000, 7000, 10000]);
	});

	it('adds at most one link poll per interval', async () => {
		const g = gateway();
		const run = pollForSignIn(g.poll);
		await vi.advanceTimersByTimeAsync(1000);
		for (let i = 0; i < 5; i++) {
			authLinkOpened();
			await vi.advanceTimersByTimeAsync(100);
		}
		expect(g.calls).toEqual([1000]);
		await vi.advanceTimersByTimeAsync(3500);
		expect(g.calls).toEqual([1000, 5000]);
		run.stop();
	});

	it('answers a link that arrives during a poll right after that poll', async () => {
		let release: (() => void) | undefined;
		const calls: number[] = [];
		let approved = false;
		const run = pollForSignIn(() => {
			calls.push(Date.now());
			if (calls.length === 1) return new Promise((resolve) => (release = () => resolve({}))); // in flight
			return Promise.resolve(approved ? { user } : {});
		});
		await vi.advanceTimersByTimeAsync(5000);
		expect(calls).toEqual([5000]);
		approved = true;
		authLinkOpened();
		await vi.advanceTimersByTimeAsync(300);
		release!();
		await expect(run.done).resolves.toBe(user);
		expect(calls).toEqual([5000, 5300]);
	});

	it('a stray auth link with no sign-in pending does nothing', async () => {
		expect(authLinkOpened()).toBe(false);
		const g = gateway();
		const run = pollForSignIn(g.poll);
		run.stop();
		await expect(run.done).resolves.toBeNull();
		expect(authLinkOpened()).toBe(false);
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
		expect(g.poll).not.toHaveBeenCalled();
	});

	it('stops listening when a poll fails', async () => {
		const run = pollForSignIn(() => Promise.reject(new Error('Authorization was declined in the browser')));
		const failed = expect(run.done).rejects.toThrow('declined');
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
		await failed;
		expect(authLinkOpened()).toBe(false);
	});

	it('stopping during a poll discards its result', async () => {
		let release: (() => void) | undefined;
		const run = pollForSignIn(() => new Promise((resolve) => (release = () => resolve({ user }))));
		await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
		run.stop();
		release!();
		await expect(run.done).resolves.toBeNull();
	});
});
