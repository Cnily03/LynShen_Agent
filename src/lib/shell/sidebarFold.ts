// What the session list has folded: its 对话 and 项目 sections (from their
// heads) and each project folder. Kept across restarts.

const KEY = 'lynshen-sidebar-fold';

type Store = Pick<Storage, 'getItem' | 'setItem'>;

export type FoldSection = 'chats' | 'projects';

export interface SidebarFold {
	/** Folded sections. */
	sections: Partial<Record<FoldSection, boolean>>;
	/** Folded project folders, by project id. */
	folders: Record<string, boolean>;
}

const empty = (): SidebarFold => ({ sections: {}, folders: {} });

const flags = (value: unknown): Record<string, boolean> =>
	value && typeof value === 'object'
		? Object.fromEntries(Object.entries(value).filter(([, v]) => v === true))
		: {};

export function readSidebarFold(store: Store): SidebarFold {
	try {
		const saved = JSON.parse(store.getItem(KEY) ?? 'null') as Partial<SidebarFold> | null;
		if (!saved || typeof saved !== 'object') return empty();
		return { sections: flags(saved.sections), folders: flags(saved.folders) };
	} catch {
		return empty();
	}
}

/** Saves the fold; folders of projects no longer listed (`ids`) are dropped. */
export function writeSidebarFold(store: Store, fold: SidebarFold, ids?: string[]): void {
	const keep = ids ? new Set(ids) : null;
	const folders = Object.fromEntries(Object.entries(fold.folders).filter(([id, v]) => v && (!keep || keep.has(id))));
	store.setItem(KEY, JSON.stringify({ sections: flags(fold.sections), folders }));
}

export function toggleSection(fold: SidebarFold, section: FoldSection): SidebarFold {
	return { ...fold, sections: { ...fold.sections, [section]: !fold.sections[section] } };
}

export function toggleFolder(fold: SidebarFold, id: string): SidebarFold {
	return { ...fold, folders: { ...fold.folders, [id]: !fold.folders[id] } };
}

/** Whether no project shows its conversations: the 项目 section is folded,
 *  or every one of these folders is (no projects: false). */
export function allFolded(fold: SidebarFold, ids: string[]): boolean {
	return ids.length > 0 && (!!fold.sections.projects || ids.every((id) => fold.folders[id]));
}

/** The toolbar's 全部折叠 / 全部展开: every project folder folded, or every
 *  one open with the 项目 section open too, so the result shows. */
export function foldAll(fold: SidebarFold, ids: string[], folded: boolean): SidebarFold {
	const folders = folded ? Object.fromEntries(ids.map((id) => [id, true])) : {};
	const sections = folded ? fold.sections : { ...fold.sections, projects: false };
	return { sections, folders };
}
