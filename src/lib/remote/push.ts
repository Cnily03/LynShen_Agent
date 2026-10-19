// Notifications on this phone (Web Push). The browser's subscription is
// made with the relay's key (the relay sends the notifications, see
// lynshen-relay push.go) and handed to each paired computer, which asks the
// relay to notify it (LynShen-CLI daemon push.rs). The service worker shows
// them.

import type { DaemonClient } from '$lib/daemon';

const ON = 'lynshen-push-on';

/** This browser can be notified (an iPhone only from the Home Screen app). */
export function pushSupported(): boolean {
	return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** The user turned notifications on here and has not turned them off. It
 *  holds for every paired computer: one not yet subscribed gets the
 *  subscription when this phone next connects to it (`resubscribe`). */
export function pushOn(): boolean {
	try {
		return localStorage.getItem(ON) === '1' && Notification.permission === 'granted';
	} catch {
		return false;
	}
}

function urlKey(base64: string): Uint8Array<ArrayBuffer> {
	const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
	return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

/** This browser's subscription, made on first use. */
async function subscription(): Promise<PushSubscription> {
	const registration = await navigator.serviceWorker.ready;
	const existing = await registration.pushManager.getSubscription();
	if (existing) return existing;
	const res = await fetch('/relay/v1/push/key');
	if (!res.ok) throw new Error(`notifications are not available (${res.status})`);
	const { key } = (await res.json()) as { key: string };
	return registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlKey(key) });
}

/** Asks for permission and subscribes this browser on `daemons`. */
export async function enablePush(daemons: DaemonClient[]): Promise<void> {
	if ((await Notification.requestPermission()) !== 'granted') throw new Error('notifications were not allowed');
	const sub = (await subscription()).toJSON();
	await Promise.all(daemons.map((d) => d.request({ op: 'push_subscribe', subscription: sub })));
	localStorage.setItem(ON, '1');
}

/** Shows a notification on this phone now: a request came while the page
 *  was in the background. Only where the user turned notifications on; a
 *  notification the computer sends for the same `tag` (its session)
 *  replaces it rather than adding a second one. */
export async function notifyHere(title: string, body: string, tag: string): Promise<void> {
	if (!pushSupported() || !pushOn()) return;
	const registration = await navigator.serviceWorker.ready;
	const options: NotificationOptions & { renotify?: boolean } = {
		body,
		// A renotify needs a tag.
		tag: tag || 'approval',
		renotify: true,
		icon: '/icon-192.png',
		data: { url: '/remote' }
	};
	await registration.showNotification(title, options);
}

/** Hands the subscription to a computer again (its connection came back;
 *  the browser may have renewed the subscription meanwhile). */
export async function resubscribe(daemon: DaemonClient): Promise<void> {
	if (!pushSupported() || !pushOn()) return;
	const sub = (await subscription()).toJSON();
	await daemon.request({ op: 'push_subscribe', subscription: sub });
}

/** What a tapped notification opens: a requirement, or a session on one
 *  computer (`host`: its relay host id; absent from an older daemon). */
export type OpenTarget = { kind: 'requirement'; requirement: string } | { kind: 'session'; session: string; host?: string };

export function openTarget(url: string): OpenTarget | null {
	let params: URLSearchParams;
	try {
		params = new URL(url, 'https://app.lynshen.org').searchParams;
	} catch {
		return null;
	}
	const requirement = params.get('requirement');
	if (requirement) return { kind: 'requirement', requirement };
	const session = params.get('session');
	if (!session) return null;
	const host = params.get('host');
	return host ? { kind: 'session', session, host } : { kind: 'session', session };
}

/** The computer's notification rules (daemon `push_rules`). */
export interface PushRules {
	daily_budget: number;
	quiet_start: string;
	quiet_end: string;
	turn_done: boolean;
	sent_today?: number;
}

export const DEFAULT_RULES: PushRules = { daily_budget: 20, quiet_start: '23:00', quiet_end: '08:00', turn_done: true };

/** The rules on `daemon`; null from a computer whose engine has none yet. */
export async function loadRules(daemon: DaemonClient): Promise<PushRules | null> {
	try {
		const reply = await daemon.request({ op: 'push_rules' });
		return { ...DEFAULT_RULES, ...((reply.rules as Partial<PushRules>) ?? {}) };
	} catch {
		return null;
	}
}

export async function saveRules(daemon: DaemonClient, rules: Partial<PushRules>): Promise<PushRules> {
	const reply = await daemon.request({ op: 'push_rules_set', rules });
	return { ...DEFAULT_RULES, ...((reply.rules as Partial<PushRules>) ?? {}) };
}

/** Turns notifications off on this phone: every computer forgets this
 *  browser's subscription, and the browser drops it. */
export async function disablePush(daemons: DaemonClient[]): Promise<void> {
	localStorage.removeItem(ON);
	if (!pushSupported()) return;
	const registration = await navigator.serviceWorker.ready;
	const existing = await registration.pushManager.getSubscription();
	if (!existing) return;
	await Promise.allSettled(daemons.map((d) => d.request({ op: 'push_unsubscribe', endpoint: existing.endpoint })));
	await existing.unsubscribe();
}

/** Tells the computer which of its sessions this phone shows now (null:
 *  none): nothing about it is pushed here meanwhile. An older engine
 *  answers with an error, which changes nothing. */
export function sayViewing(daemon: DaemonClient, session: string | null): void {
	daemon.request({ op: 'push_viewing', session }).catch(() => {});
	// And to the service worker, for a notice already on its way.
	if (typeof navigator !== 'undefined') navigator.serviceWorker?.controller?.postMessage({ type: 'lynshen-viewing', session });
}
