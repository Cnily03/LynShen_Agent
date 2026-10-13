// Click-away for a scrim that contains its sheet (Modal, the image viewer).
// A press that starts in the sheet and ends over the scrim fires `click` on
// their common ancestor, which is the scrim itself: dragging to select the
// text of a field past the sheet's edge closed the dialog. A press that
// starts on the scrim and ends in the sheet does the same. The scrim closes
// only when the press both started and ended on it.

type Press = { target: EventTarget | null; currentTarget: EventTarget | null };

export function scrimClick(close: () => void) {
	let pressed = false;
	let released = false;
	return {
		onpointerdown(e: Press) {
			pressed = e.target === e.currentTarget;
			released = false;
		},
		onpointerup(e: Press) {
			released = pressed && e.target === e.currentTarget;
		},
		onclick(e: Press) {
			const hit = pressed && released && e.target === e.currentTarget;
			pressed = released = false;
			if (hit) close();
		}
	};
}
