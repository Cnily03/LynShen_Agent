// How the retry notice (RetryNotice.svelte) shows a request's attempts. The
// count comes from the engine's settings, where it can be anything (a user
// who wants it to never give up sets 1000000): the card draws one bar
// segment per attempt only for a few, and leaves out a total too large to
// mean anything.

/** Attempts up to which the card draws one bar segment each. */
export const RETRY_SEGMENTS_MAX = 10;
/** Totals above this show as the attempt number alone. */
export const RETRY_TOTAL_SHOWN_MAX = 100;

/** Bar segments for `max` attempts: one each, or none when there are too
 *  many to draw (a segment per attempt of a million is a million elements). */
export function retrySegments(max: number): number {
	return Number.isFinite(max) && max > 0 && max <= RETRY_SEGMENTS_MAX ? Math.floor(max) : 0;
}

/** The attempt and, when it reads as a total, the number of attempts. */
export function retryCount(attempt: number, max: number): { n: number; max: number | null } {
	const shown = Number.isFinite(max) && max > 0 && max <= RETRY_TOTAL_SHOWN_MAX;
	return { n: attempt, max: shown ? max : null };
}

