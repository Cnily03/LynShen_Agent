import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PREFS_VERSION, migratePrefs, prefs } from './prefs.svelte';

const KEY = 'lynshen-prefs';

describe('migratePrefs', () => {
	it('turns the window frost off for preferences stored before version 2', () => {
		// The old default, written out with every other preference.
		const old = { sidebarVibrancy: true, glass: 60, turnStats: ['elapsed'] };
		expect(migratePrefs(old)).toEqual({ sidebarVibrancy: false, glass: 60, turnStats: ['elapsed'], version: 2 });
		expect(migratePrefs({ version: 1, sidebarVibrancy: true }).sidebarVibrancy).toBe(false);
		expect(migratePrefs({}).sidebarVibrancy).toBe(false);
	});

	it('keeps a choice stored at the current version', () => {
		expect(migratePrefs({ version: PREFS_VERSION, sidebarVibrancy: true })).toEqual({ version: PREFS_VERSION, sidebarVibrancy: true });
		expect(migratePrefs({ version: PREFS_VERSION, sidebarVibrancy: false }).sidebarVibrancy).toBe(false);
	});

	it('runs once: its result is at the current version', () => {
		const once = migratePrefs({ sidebarVibrancy: true });
		expect(once.version).toBe(PREFS_VERSION);
		expect(migratePrefs({ ...once, sidebarVibrancy: true }).sidebarVibrancy).toBe(true);
	});

	it('leaves the stored object alone', () => {
		const old = { sidebarVibrancy: true };
		migratePrefs(old);
		expect(old).toEqual({ sidebarVibrancy: true });
	});
});

describe('prefs', () => {
	let store: Map<string, string>;
	const stored = () => JSON.parse(store.get(KEY) ?? 'null') as Record<string, unknown> | null;

	beforeEach(() => {
		store = new Map();
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
			removeItem: (key: string) => void store.delete(key)
		});
	});
	afterEach(() => vi.unstubAllGlobals());

	it('a new install has the frost off and the adaptive conversation width', () => {
		prefs.init();
		expect(prefs.sidebarVibrancy).toBe(false);
		expect(prefs.chatWidth).toBe('auto');
		// Nothing to bring up to date: nothing is written.
		expect(stored()).toBeNull();
	});

	it('an install with the old default frost is switched off once, and says so in storage', () => {
		store.set(KEY, JSON.stringify({ sidebarVibrancy: true, glass: 60, chatWidth: 844 }));
		prefs.init();
		expect(prefs.sidebarVibrancy).toBe(false);
		expect(prefs.glass).toBe(60);
		expect(stored()).toMatchObject({ version: PREFS_VERSION, sidebarVibrancy: false, glass: 60 });
	});

	it('a later choice to turn the frost on is kept across starts', () => {
		store.set(KEY, JSON.stringify({ sidebarVibrancy: true }));
		prefs.init();
		prefs.setSidebarVibrancy(true);
		expect(stored()).toMatchObject({ version: PREFS_VERSION, sidebarVibrancy: true });
		prefs.init();
		expect(prefs.sidebarVibrancy).toBe(true);
		prefs.setSidebarVibrancy(false);
		prefs.init();
		expect(prefs.sidebarVibrancy).toBe(false);
	});

	it('the old conversation width in pixels becomes the adaptive setting; a choice is kept', () => {
		store.set(KEY, JSON.stringify({ version: PREFS_VERSION, chatWidth: 844 }));
		prefs.init();
		expect(prefs.chatWidth).toBe('auto');
		prefs.setChatWidth('full');
		expect(stored()).toMatchObject({ chatWidth: 'full' });
		prefs.init();
		expect(prefs.chatWidth).toBe('full');
		prefs.setChatWidth('standard');
		prefs.init();
		expect(prefs.chatWidth).toBe('standard');
	});

	it('unreadable storage counts as a new install', () => {
		for (const text of ['not json', '[1,2]', '"x"', 'null']) {
			store.set(KEY, text);
			prefs.init();
			expect(prefs.sidebarVibrancy).toBe(false);
			expect(prefs.chatWidth).toBe('auto');
		}
	});
});
