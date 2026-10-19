// The remote page's side of pairing: it trades a code shown on the desktop
// for a device token (POST /api/pair on the daemon that serves the page) and
// connects back to that daemon with it.

import type { DaemonEndpoint } from './daemon';

const TOKEN_KEY = 'lynshen-remote-token';

export function remoteToken(): string | null {
	try {
		return localStorage.getItem(TOKEN_KEY);
	} catch {
		return null;
	}
}

export function forgetRemoteToken() {
	try {
		localStorage.removeItem(TOKEN_KEY);
	} catch {
		/* storage unavailable: nothing to forget */
	}
}

/** The 6-digit check code of a LAN pairing: from the token's SHA-256 (the
 *  daemon shows the same; see relay/socket.ts checkCode). */
export async function tokenCheckCode(token: string): Promise<string> {
	const { checkCode } = await import('$lib/relay/socket');
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)));
	return checkCode(digest);
}

/** Pairs this browser as a device named `name`; keeps the returned token.
 *  The computer confirms the device before the token connects: returns the
 *  check code to compare, or '' from a computer that does not ask. */
export async function pairDevice(code: string, name: string): Promise<string> {
	const response = await fetch('/api/pair', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ code: code.trim(), name })
	});
	const body = (await response.json().catch(() => ({}))) as { token?: string; error?: string; pending?: boolean };
	if (!response.ok || !body.token)
		throw new Error(body.error ?? `pairing failed (${response.status})`);
	localStorage.setItem(TOKEN_KEY, body.token);
	return body.pending ? tokenCheckCode(body.token) : '';
}

/** The daemon serving this page, reached over the page's own origin. */
export function remoteEndpoint(token: string): DaemonEndpoint {
	const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
	return { url: `${scheme}://${location.host}/`, token };
}

/** A short device name for the desktop's device list. */
export function deviceName(): string {
	const agent = navigator.userAgent;
	if (/iPhone/.test(agent)) return 'iPhone';
	if (/iPad/.test(agent)) return 'iPad';
	if (/Android/.test(agent)) return 'Android';
	if (/Macintosh/.test(agent)) return 'Mac browser';
	return 'Browser';
}
