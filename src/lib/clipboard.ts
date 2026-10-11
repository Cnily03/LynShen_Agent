// Puts text on the clipboard from a click: the clipboard plugin inside the
// app (as ContextMenuHost does), the browser's clipboard on the remote page,
// and, where the page is not a secure context (a phone on plain http), a
// hidden textarea and the copy command.
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

function copyBySelection(text: string): boolean {
	const area = document.createElement('textarea');
	area.value = text;
	area.setAttribute('readonly', '');
	area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
	document.body.append(area);
	area.select();
	try {
		return document.execCommand('copy');
	} catch {
		return false;
	} finally {
		area.remove();
	}
}

/** Copies `text`; resolves false when nothing reached the clipboard. */
export async function copyText(text: string): Promise<boolean> {
	if (inApp()) {
		try {
			await writeText(text);
			return true;
		} catch {
			// Fall through to the webview's own clipboard.
		}
	}
	if (navigator.clipboard?.writeText) {
		try {
			await navigator.clipboard.writeText(text);
			return true;
		} catch {
			// A browser that refuses (no permission): try the copy command.
		}
	}
	return copyBySelection(text);
}
