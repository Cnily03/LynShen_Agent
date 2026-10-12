// Pasting into the composer (Composer.svelte `onPaste`). A paste event says
// what the page can read: text, the bytes of files, sometimes a list of
// file URLs. Copying a file in Explorer, Finder or a Linux file manager
// gives the page its bytes or nothing, never its path, so such a paste asks
// the system clipboard for the paths first (clipboard_file_paths).

/** What a paste carries, read while its event lasts. */
export interface PasteData {
	/** `text/plain`. */
	text: string;
	/** `text/uri-list` (Linux web views list copied files there). */
	uriList: string;
	/** The paste's file items, by MIME type ('' when the system gave none). */
	files: { type: string }[];
}

/**
 * How the composer takes a paste:
 * - `files`: it has files (copied in a file manager or an app, a
 *   screenshot): attach the paths the system clipboard names, else write
 *   the bytes to files (images as before, as `[图片 #N]`).
 * - `text`: plain text, inserted as text.
 * - `clipboard`: nothing the page can read (some copies of files show the
 *   page nothing): the system clipboard may still name files.
 */
export type PasteRoute = 'files' | 'text' | 'clipboard';

export function pasteRoute(paste: PasteData): PasteRoute {
	if (paste.files.length || fileUris(paste.uriList).length) return 'files';
	if (paste.text) return 'text';
	return 'clipboard';
}

/** The local paths in a `text/uri-list`: its `file:` URLs decoded, comments
 *  and other schemes left out. A Windows drive keeps its letter (`C:/…`). */
export function fileUris(uriList: string): string[] {
	const out: string[] = [];
	for (const raw of uriList.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line.startsWith('file:') || line.startsWith('#')) continue;
		let url: URL;
		try {
			url = new URL(line);
		} catch {
			continue;
		}
		if (url.host && url.host !== 'localhost') continue;
		let path: string;
		try {
			path = decodeURIComponent(url.pathname);
		} catch {
			continue;
		}
		if (/^\/[A-Za-z]:\//.test(path)) path = path.slice(1);
		if (path && !out.includes(path)) out.push(path);
	}
	return out;
}

/** The file extension a pasted image is saved with: its MIME subtype, as
 *  before (`image/svg+xml` → `svgxml`), `png` when there is none. */
export function imageExt(type: string): string {
	return (type.split('/')[1] || 'png').replace(/[^a-z0-9]/gi, '') || 'png';
}

/** Files larger than this are not read into the page to paste; dragging
 *  them in or picking them attaches their path instead. */
export const MAX_PASTE_BYTES = 100 * 1024 * 1024;
