import { describe, expect, it } from 'vitest';
import { savedEmpty } from './savedEmpty';

describe('savedEmpty', () => {
	it('is a conversation saved with no entry and no name', () => {
		expect(savedEmpty({ session: 's1', entries: 0, title: null })).toBe(true);
		expect(savedEmpty({ session: 's1', entries: 0, title: '' })).toBe(true);
		// Older daemons label one without a title by its id.
		expect(savedEmpty({ session: 's1', entries: 0, title: 's1' })).toBe(true);
	});

	it('is never one with entries, a name, or an unknown count', () => {
		expect(savedEmpty({ session: 's1', entries: 3, title: null })).toBe(false);
		expect(savedEmpty({ session: 's1', entries: 0, title: 'named by the user' })).toBe(false);
		expect(savedEmpty({ session: 's1', entries: null, title: null })).toBe(false);
		expect(savedEmpty({ session: 's1', title: null })).toBe(false);
	});
});
