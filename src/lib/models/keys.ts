// The keys of the model lists: the arrows move, Enter picks, ⌘D (Ctrl+D)
// pins the row, → and ← open and close a family's older versions.
import { matchCombo, type Combo } from '$lib/shortcuts';

export const PIN_COMBO: Combo = { key: 'd', mod: true };

/** A key the list acts on; IME composition keys are never one. */
export function listKey(e: KeyboardEvent): 'up' | 'down' | 'home' | 'end' | 'pick' | 'pin' | 'open' | 'close' | 'pageUp' | 'pageDown' | null {
	if (e.isComposing || e.keyCode === 229) return null;
	if (matchCombo(e, PIN_COMBO)) return 'pin';
	if (e.metaKey || e.ctrlKey || e.altKey) return null;
	switch (e.key) {
		case 'ArrowUp':
			return 'up';
		case 'ArrowDown':
			return 'down';
		case 'PageUp':
			return 'pageUp';
		case 'PageDown':
			return 'pageDown';
		case 'Enter':
			return 'pick';
		case 'ArrowRight':
			return 'open';
		case 'ArrowLeft':
			return 'close';
		default:
			return null;
	}
}

const LIST_KEYS = new Set(['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', 'Home', 'End']);

/** Keys the list's search field keeps to itself: the pane's own picker keys
 *  (ChatPane) must not act on them too, least of all an Enter that ends an
 *  input method's composition. Escape still reaches whoever closes the list. */
export function ownsKey(e: KeyboardEvent): boolean {
	return LIST_KEYS.has(e.key) || !!matchCombo(e, PIN_COMBO);
}
