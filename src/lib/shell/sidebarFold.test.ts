import { describe, expect, it } from 'vitest';
import { allFolded, foldAll, readSidebarFold, toggleFolder, toggleSection, writeSidebarFold } from './sidebarFold';

function memory(init: Record<string, string> = {}) {
	const data = new Map(Object.entries(init));
	return {
		data,
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v)
	};
}

describe('sidebar fold', () => {
	it('starts with everything open', () => {
		expect(readSidebarFold(memory())).toEqual({ sections: {}, folders: {} });
	});

	it('survives a restart: sections and project folders', () => {
		const store = memory();
		let fold = readSidebarFold(store);
		fold = toggleSection(fold, 'chats');
		fold = toggleFolder(fold, 'p1');
		writeSidebarFold(store, fold, ['p1', 'p2']);
		expect(readSidebarFold(store)).toEqual({ sections: { chats: true }, folders: { p1: true } });
		// Unfolding again leaves nothing behind.
		writeSidebarFold(store, toggleFolder(toggleSection(fold, 'chats'), 'p1'), ['p1']);
		expect(readSidebarFold(store)).toEqual({ sections: {}, folders: {} });
	});

	it('forgets the folders of projects no longer listed', () => {
		const store = memory();
		writeSidebarFold(store, { sections: {}, folders: { gone: true, kept: true } }, ['kept']);
		expect(readSidebarFold(store).folders).toEqual({ kept: true });
	});

	it('reads a damaged value as nothing folded', () => {
		expect(readSidebarFold(memory({ 'lynshen-sidebar-fold': '{nope' }))).toEqual({ sections: {}, folders: {} });
		expect(readSidebarFold(memory({ 'lynshen-sidebar-fold': '{"sections":{"chats":"yes"},"folders":[1]}' }))).toEqual({
			sections: {},
			folders: {}
		});
	});

	it('folds every project, and unfolding all opens the projects section too', () => {
		const ids = ['a', 'b'];
		let fold = toggleFolder(readSidebarFold(memory()), 'a');
		expect(allFolded(fold, ids)).toBe(false);
		fold = foldAll(fold, ids, true);
		expect(allFolded(fold, ids)).toBe(true);
		fold = foldAll(fold, ids, false);
		// A folded 项目 section counts as all folded; unfolding opens it too.
		fold = toggleSection(fold, 'projects');
		expect(allFolded(fold, ids)).toBe(true);
		fold = foldAll(fold, ids, false);
		expect(fold).toEqual({ sections: { projects: false }, folders: {} });
		expect(allFolded(fold, [])).toBe(false);
	});
});
