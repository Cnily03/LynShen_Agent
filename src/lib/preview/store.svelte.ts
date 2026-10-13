// Which files the user asked to preview in this run, and the last ask. A
// chip above a sent message (SentFiles.svelte) asks; the page shell opens
// the tab beside that message's conversation (src/routes/+page.svelte),
// and the tab (FilePreview.svelte) reads only a file asked for here.

import { SvelteSet } from 'svelte/reactivity';
import { canPreview } from './kinds';

class FilePreviews {
	/** The last preview asked for; the page shell opens (or shows) its tab. */
	request = $state<{ sessionId: string; path: string; n: number } | null>(null);
	#asked = new SvelteSet<string>();

	/**
	 * A click on `path` in the list of files a message of `sessionId` was
	 * sent with (`attached`). False, and nothing opens, for a path that is
	 * not in that list.
	 */
	open(sessionId: string, path: string, attached: readonly string[]): boolean {
		if (!canPreview(path, attached)) return false;
		this.#asked.add(path);
		this.request = { sessionId, path, n: (this.request?.n ?? 0) + 1 };
		return true;
	}

	/** Whether a click asked for `path` in this run (only such a file is read). */
	asked(path: string): boolean {
		return this.#asked.has(path);
	}
}

export const filePreviews = new FilePreviews();
