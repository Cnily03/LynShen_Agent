// Extra items a part of the page offers in the app's context menu
// (ContextMenuHost) when the user right-clicks it with no text selected,
// e.g. a reply's "copy the whole reply". The innermost element with items
// wins; an item list may be empty (nothing to offer right now).
import type { Action } from 'svelte/action';

export type ContextItem = { key: string; label: string; run: () => void };
export type ContextItems = () => ContextItem[];

const offered = new WeakMap<Element, ContextItems>();

/** `use:contextItems={() => [...]}`: the items are read at right-click time. */
export const contextItems: Action<HTMLElement, ContextItems> = (node, items) => {
	offered.set(node, items);
	return {
		update(next) {
			offered.set(node, next);
		},
		destroy() {
			offered.delete(node);
		}
	};
};

/** The items offered for a right-click on `target`. */
export function contextItemsAt(target: Element | null): ContextItem[] {
	for (let el = target; el; el = el.parentElement) {
		const items = offered.get(el);
		if (items) return items();
	}
	return [];
}
