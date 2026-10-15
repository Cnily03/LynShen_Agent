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

/** Whether nothing shows its conversations: the 对话 section is folded (when
 *  it lists any), and the 项目 section or every project folder is folded.
 *  With nothing to fold, false. */
export function allFolded(fold: SidebarFold, ids: string[], chats = false): boolean {
	if (!chats && !ids.length) return false;
	const chatsFolded = !chats || !!fold.sections.chats;
	const projectsFolded = !ids.length || !!fold.sections.projects || ids.every((id) => fold.folders[id]);
	return chatsFolded && projectsFolded;
}

/** The toolbar's 全部折叠 / 全部展开: the 对话 section and every project folder
 *  folded, or all of them open with both sections open, so the result shows. */
export function foldAll(fold: SidebarFold, ids: string[], folded: boolean): SidebarFold {
	if (folded) return { sections: { ...fold.sections, chats: true }, folders: Object.fromEntries(ids.map((id) => [id, true])) };
	return { sections: { ...fold.sections, chats: false, projects: false }, folders: {} };
}
