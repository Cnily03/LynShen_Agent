// The models the user pinned (favorites) and picked lately (recent), shared
// by every model picker and kept on this computer. Keys are PickItem keys
// (`provider::id`).

const STORAGE_KEY = 'lynshen-model-picks';
/** Recents kept; the quick switcher shows fewer. */
const RECENT_MAX = 12;

interface Stored {
	favorites?: unknown;
	recent?: unknown;
}

const keys = (v: unknown): string[] => (Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && k.includes('::')) : []);

class ModelPicks {
	favorites = $state<string[]>([]);
	recent = $state<string[]>([]);

	constructor() {
		try {
			const stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}') as Stored;
			this.favorites = keys(stored.favorites);
			this.recent = keys(stored.recent).slice(0, RECENT_MAX);
		} catch {
			/* nothing stored, or unreadable: start empty */
		}
	}

	#save() {
		try {
			globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ favorites: this.favorites, recent: this.recent }));
		} catch {
			/* no storage: kept for this run only */
		}
	}

	isFavorite(key: string): boolean {
		return this.favorites.includes(key);
	}

	toggleFavorite(key: string) {
		this.favorites = this.isFavorite(key) ? this.favorites.filter((k) => k !== key) : [...this.favorites, key];
		this.#save();
	}

	/** A model was picked: it leads the recents. */
	used(key: string) {
		if (this.recent[0] === key) return;
		this.recent = [key, ...this.recent.filter((k) => k !== key)].slice(0, RECENT_MAX);
		this.#save();
	}
}

export const modelPicks = new ModelPicks();
