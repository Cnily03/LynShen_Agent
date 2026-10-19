/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
// The phone PWA's offline shell. Install caches only the /remote page, the
// manifest and icons; the build is shared with the desktop app, so its files
// are cached as the phone first loads them (cache first, names are hashed)
// instead of all ~5 MB up front. After one online visit the home-screen app
// opens without a network (it then waits for the relay). Registered only by
// the /remote page outside Tauri (svelte.config.js turns automatic
// registration off).
import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `lynshen-shell-${version}`;
const SHELL = '/remote';
const PRECACHE = [SHELL, ...files.filter((f) => /^\/(manifest\.webmanifest|icon-(maskable-)?\d+\.png|apple-touch-icon\.png|favicon\.png)$/.test(f))];
const BUILD = new Set(build);

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches
			.open(CACHE)
			.then((cache) => cache.addAll(PRECACHE))
			.then(() => sw.skipWaiting())
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => sw.clients.claim())
	);
});

// Notifications the computers send through the relay (lib/remote/push.ts):
// `{title, body, tag, url, kind, level, session}`, encrypted for this
// browser by the computer. A tap opens (or focuses) the remote page at
// `url`: a session's page with its approval card, a requirement, or the
// list. `level` `silent` (quiet hours) shows without a sound or vibration.
// Nothing is shown while the page itself is on screen with that session
// open (the computer also skips it; this covers a burst in flight).
// The session each open page shows (its `lynshen-viewing` messages). Lost
// when the browser stops this worker; the computer skips it anyway.
const viewing = new Map<string, string>();
sw.addEventListener('message', (event) => {
	const message = event.data as { type?: string; session?: string | null } | null;
	const source = event.source as Client | null;
	if (message?.type !== 'lynshen-viewing' || !source) return;
	if (message.session) viewing.set(source.id, message.session);
	else viewing.delete(source.id);
});

type PushData = { title?: string; body?: string; tag?: string; url?: string; kind?: string; level?: string; session?: string };

sw.addEventListener('push', (event) => {
	let data: PushData = {};
	try {
		data = event.data?.json() ?? {};
	} catch {
		data = { body: event.data?.text() };
	}
	event.waitUntil(
		(async () => {
			if (data.session) {
				const windows = await sw.clients.matchAll({ type: 'window' });
				const looking = windows.some((w) => w.visibilityState === 'visible' && viewing.get(w.id) === data.session);
				if (looking) return;
			}
			const options: NotificationOptions & { renotify?: boolean; silent?: boolean } = {
				body: data.body ?? '',
				tag: data.tag,
				// A later notice about the same thing replaces it, and still alerts.
				renotify: Boolean(data.tag) && data.level !== 'silent',
				silent: data.level === 'silent',
				// An approval stays until it is tapped or dismissed.
				requireInteraction: data.kind === 'approval',
				icon: '/icon-192.png',
				badge: '/icon-192.png',
				data: { url: data.url || SHELL }
			};
			await sw.registration.showNotification(data.title || 'Aogiri', options);
		})()
	);
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = new URL((event.notification.data as { url?: string } | null)?.url || SHELL, sw.location.origin).href;
	event.waitUntil(
		sw.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
			const open = windows.find((w) => new URL(w.url).pathname.startsWith(SHELL));
			if (!open) return sw.clients.openWindow(url);
			// The open page shows what the notification is about.
			open.postMessage({ type: 'lynshen-open', url });
			return open.focus();
		})
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/relay/'))
		return;
	// Pages: network first, the cached shell offline (the app is an SPA).
	if (request.mode === 'navigate') {
		event.respondWith(fetch(request).catch(async () => (await caches.match(SHELL)) ?? Response.error()));
		return;
	}
	// Build files: cache first, stored on first use (file names are hashed).
	if (BUILD.has(url.pathname) || PRECACHE.includes(url.pathname)) {
		event.respondWith(
			caches.match(url.pathname).then(
				(hit) =>
					hit ??
					fetch(request).then((res) => {
						if (res.ok) {
							const copy = res.clone();
							event.waitUntil(caches.open(CACHE).then((cache) => cache.put(url.pathname, copy)));
						}
						return res;
					})
			)
		);
	}
});
