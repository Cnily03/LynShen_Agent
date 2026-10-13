import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RetryNotice from './RetryNotice.svelte';
import { RETRY_SEGMENTS_MAX, RETRY_TOTAL_SHOWN_MAX, retryCount, retrySegments } from './retryView';

describe('retry notice', () => {
	it('draws one segment per attempt only for a few attempts', () => {
		expect(retrySegments(6)).toBe(6);
		expect(retrySegments(RETRY_SEGMENTS_MAX)).toBe(RETRY_SEGMENTS_MAX);
		expect(retrySegments(RETRY_SEGMENTS_MAX + 1)).toBe(0);
		expect(retrySegments(1_000_000)).toBe(0);
		expect(retrySegments(Number.NaN)).toBe(0);
		expect(retrySegments(0)).toBe(0);
	});

	it('leaves out a total too large to mean anything', () => {
		expect(retryCount(2, 6)).toEqual({ n: 2, max: 6 });
		expect(retryCount(2, RETRY_TOTAL_SHOWN_MAX)).toEqual({ n: 2, max: RETRY_TOTAL_SHOWN_MAX });
		expect(retryCount(2, 1_000_000)).toEqual({ n: 2, max: null });
	});

	// A retry count of 1000000 in the settings drew a million segments: the
	// first retry froze the window for seconds, the next for half a minute,
	// and Stop, which takes them down, for minutes.
	it('renders a handful of elements for a retry count of a million', () => {
		const retry = { attempt: 2, max: 1_000_000, reason: 'Network Error: (os error 10060)', delayMs: 1000, at: Date.now() };
		const { body } = render(RetryNotice, { props: { retry } });
		expect(body).not.toMatch(/class="bar[ "]/);
		expect((body.match(/<span/g) ?? []).length).toBeLessThan(20);
		expect(body).not.toContain('1000000');
	});

	it('still draws the bar for the default retry count', () => {
		const retry = { attempt: 2, max: 6, reason: '', delayMs: 1000, at: Date.now() };
		const { body } = render(RetryNotice, { props: { retry } });
		const bar = body.match(/<div class="bar[^"]*"[^>]*>(.*?)<\/div>/)?.[1] ?? '';
		expect(bar.match(/<span/g)?.length).toBe(6);
	});
});
