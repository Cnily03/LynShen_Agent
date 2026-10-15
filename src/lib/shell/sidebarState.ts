// The navigator's expanded / collapsed state. Collapsed, it is a narrow rail:
// the logo, the primary nav as icons and the account avatar.

/** Width of the collapsed navigator (the icon rail, design.md "Navigator").
 *  Its items centre on 24px. */
export const SIDEBAR_RAIL_WIDTH = 48;

/** The expanded navigator's width before the user drags it (240–460px). */
export const SIDEBAR_DEFAULT_WIDTH = 272;

const KEY = 'lynshen-sidebar-collapsed';
/** Before the rail, ⌘B hid the navigator completely ('0' = hidden). */
const LEGACY_KEY = 'lynshen-sidebar-visible';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Whether the navigator starts collapsed. A navigator hidden under the old
 *  key comes back as the rail; the old key is then dropped. */
export function readSidebarCollapsed(store: Store): boolean {
	const saved = store.getItem(KEY);
	if (saved === '1' || saved === '0') return saved === '1';
	const legacy = store.getItem(LEGACY_KEY);
	if (legacy === null) return false;
	const collapsed = legacy === '0';
	store.setItem(KEY, collapsed ? '1' : '0');
	store.removeItem(LEGACY_KEY);
	return collapsed;
}

export function writeSidebarCollapsed(store: Store, collapsed: boolean): void {
	store.setItem(KEY, collapsed ? '1' : '0');
}
