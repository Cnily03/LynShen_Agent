import { describe, it, expect } from 'vitest';
import { planSync, stableJson, SYNC_KEYS } from './cloudSync.svelte';

const at = (value: unknown, updated_at: number) => ({ value, updated_at });

describe('stableJson', () => {
	it('ignores key order', () => {
		expect(stableJson({ b: 1, a: [{ d: 1, c: 2 }] })).toBe(stableJson({ a: [{ c: 2, d: 1 }], b: 1 }));
	});
});

describe('planSync', () => {
	it('a computer syncing first takes the cloud and uploads what it lacks', () => {
		const plan = planSync({ 'ui.theme': 'dark', 'ui.locale': 'en' }, { 'ui.theme': at('light', 5) }, {});
		expect(plan).toEqual({ apply: { 'ui.theme': 'light' }, push: { 'ui.locale': 'en' } });
	});

	it('a value changed here is pushed', () => {
		const state = { 'ui.theme': { value: stableJson('light'), at: 5 } };
		const plan = planSync({ 'ui.theme': 'dark' }, { 'ui.theme': at('light', 5) }, state);
		expect(plan).toEqual({ apply: {}, push: { 'ui.theme': 'dark' } });
	});

	it('a newer cloud value is applied when nothing changed here', () => {
		const state = { 'ui.theme': { value: stableJson('light'), at: 5 } };
		const plan = planSync({ 'ui.theme': 'light' }, { 'ui.theme': at('dark', 9) }, state);
		expect(plan).toEqual({ apply: { 'ui.theme': 'dark' }, push: {} });
	});

	it('nothing moves when both sides agree', () => {
		const state = { 'ui.theme': { value: stableJson('dark'), at: 9 } };
		expect(planSync({ 'ui.theme': 'dark' }, { 'ui.theme': at('dark', 9) }, state)).toEqual({ apply: {}, push: {} });
	});

	it('a key the cloud lost is uploaded again', () => {
		const state = { 'ui.theme': { value: stableJson('dark'), at: 9 } };
		expect(planSync({ 'ui.theme': 'dark' }, {}, state)).toEqual({ apply: {}, push: { 'ui.theme': 'dark' } });
	});
});

describe('SYNC_KEYS', () => {
	it('the window frost syncs under its own key, not the one that carried the old default', () => {
		// Versions whose frost was on by default uploaded `ui.vibrancy: true`
		// without anyone choosing it: no spec reads that key any more.
		expect(SYNC_KEYS).toContain('ui.windowFrost');
		expect(SYNC_KEYS).not.toContain('ui.vibrancy');
	});

	it('an old frost value in the cloud reaches no setting here', () => {
		// The plan still lists the unknown key; only keys with a spec are applied.
		const plan = planSync({ 'ui.windowFrost': false }, { 'ui.vibrancy': at(true, 5), 'ui.windowFrost': at(false, 9) }, {});
		expect(Object.keys(plan.apply).filter((key) => SYNC_KEYS.includes(key))).toEqual([]);
		expect(plan.push).toEqual({});
	});

	it('a frost choice made on another computer after the change is applied', () => {
		const state = { 'ui.windowFrost': { value: stableJson(false), at: 9 } };
		const plan = planSync({ 'ui.windowFrost': false }, { 'ui.windowFrost': at(true, 12) }, state);
		expect(plan.apply).toEqual({ 'ui.windowFrost': true });
	});

	it('the conversation width syncs', () => {
		expect(SYNC_KEYS).toContain('ui.chatWidth');
	});

	it('has no key twice', () => {
		expect(new Set(SYNC_KEYS).size).toBe(SYNC_KEYS.length);
	});
});
