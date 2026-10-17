// How many conversations wait for the reader (an action to allow, a question,
// a folder to trust: `sessionStatus` "input", the amber dot in the navigator),
// shown outside the window, so it is seen while the window is behind others:
// the Dock badge on macOS (the launcher's on Linux), an overlay icon on the
// Windows taskbar button, and "(2) " before the window's title. At 0 all
// three are cleared.
import { untrack } from 'svelte';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Image } from '@tauri-apps/api/image';
import { sessionStatus } from '$lib/sessionStatus';
import type { ChatState } from '$lib/chat.svelte';

/** The window's title (tauri.*.conf.json, app.html). */
export const WINDOW_TITLE = 'Aogiri';

/** Conversations that wait for the reader; archived ones do not count. */
export function waitingCount(sessions: readonly { archived?: boolean; chat: ChatState }[]): number {
	let n = 0;
	for (const s of sessions) if (!s.archived && sessionStatus(s.chat)?.kind === 'input') n++;
	return n;
}

/** The title with the count before it: "(2) Aogiri". */
export const countedTitle = (title: string, n: number) => (n > 0 ? `(${n}) ${title}` : title);

/** What the Windows overlay shows: the count, or 9+. */
export const overlayText = (n: number) => (n > 9 ? '9+' : String(n));

const inApp = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const onWindows = () => typeof document !== 'undefined' && document.documentElement.dataset.os === 'windows';

/** The overlay icon: a 32px disc in --warn with the count in --on-accent,
 *  as raw RGBA (no image decoder needed in the app). */
async function overlayIcon(n: number): Promise<Image | null> {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 32;
	const g = canvas.getContext('2d');
	if (!g) return null;
	const root = getComputedStyle(document.documentElement);
	g.fillStyle = root.getPropertyValue('--warn').trim();
	g.beginPath();
	g.arc(16, 16, 15, 0, Math.PI * 2);
	g.fill();
	const text = overlayText(n);
	g.fillStyle = root.getPropertyValue('--on-accent').trim();
	g.font = `600 ${text.length > 1 ? 16 : 20}px ${root.getPropertyValue('--font-sans')}`;
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.fillText(text, 16, 17);
	// A plain array: a typed array would not survive the IPC's JSON.
	return Image.new(Array.from(g.getImageData(0, 0, 32, 32).data), 32, 32);
}

let shown = 0;
let wanted = 0;
let queue: Promise<void> = Promise.resolve();

/** Show `wanted` (one change at a time, in order; a later count wins). */
async function apply() {
	const n = wanted;
	if (n === shown) return;
	shown = n;
	document.title = countedTitle(WINDOW_TITLE, n);
	if (!inApp()) return;
	const win = getCurrentWindow();
	const done: Promise<unknown>[] = [win.setTitle(countedTitle(WINDOW_TITLE, n))];
	if (onWindows()) {
		done.push(
			(n > 0 ? overlayIcon(n) : Promise.resolve(null)).then(async (icon) => {
				await win.setOverlayIcon(icon ?? undefined);
				await icon?.close();
			})
		);
	} else done.push(win.setBadgeCount(n > 0 ? n : undefined));
	await Promise.allSettled(done);
}

/** Keep the count shown for the conversations `sessions` lists (call while
 *  a component initialises: the page). */
export function showWaiting(sessions: () => readonly { archived?: boolean; chat: ChatState }[]) {
	$effect(() => {
		const n = waitingCount(sessions());
		untrack(() => {
			wanted = n;
			queue = queue.then(apply, apply);
		});
	});
}
