// This phone's static key for one computer (audit 8.1): each computer gets
// its own key, so one leaked key does not open every paired computer.
// Where the browser can keep a WebCrypto X25519 key in IndexedDB (Chromium,
// recent Safari), the private half is generated non-extractable: page
// scripts can use it but never read it. Elsewhere it is generated with
// @noble and kept as bytes in IndexedDB (no longer in localStorage).
// The key a phone paired with before this (localStorage
// `lynshen-relay-device`, shared by every computer) keeps working for those
// computers until they are paired again.

import { fromBase64Url, generateKeyPair, toBase64Url, type StaticKey } from './noise';

const DB = 'lynshen-device-keys';
const STORE = 'keys';
const LEGACY = 'lynshen-relay-device';

type Kept = { kind: 'webcrypto'; key: CryptoKeyPair; pub: Uint8Array } | { kind: 'bytes'; priv: Uint8Array; pub: Uint8Array };

let db: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
	db ??= new Promise((resolve, reject) => {
		const req = indexedDB.open(DB, 1);
		req.onupgradeneeded = () => req.result.createObjectStore(STORE);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return db;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

async function get(id: string): Promise<Kept | undefined> {
	return request((await open()).transaction(STORE).objectStore(STORE).get(id)) as Promise<Kept | undefined>;
}

async function put(id: string, value: Kept): Promise<void> {
	const tx = (await open()).transaction(STORE, 'readwrite');
	tx.objectStore(STORE).put(value, id);
	await new Promise<void>((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error);
	});
}

function toStatic(kept: Kept): StaticKey {
	if (kept.kind === 'bytes') return { pub: kept.pub, priv: kept.priv };
	const privateKey = kept.key.privateKey;
	return {
		pub: kept.pub,
		dh: async (peer) => {
			const publicKey = await crypto.subtle.importKey('raw', peer as Uint8Array<ArrayBuffer>, { name: 'X25519' }, false, []);
			return new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256));
		}
	};
}

/** A new non-extractable key, kept in IndexedDB, when the browser can do
 *  both; null otherwise. */
async function webcryptoKey(id: string): Promise<Kept | null> {
	try {
		const key = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
		const pub = new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey));
		const kept: Kept = { kind: 'webcrypto', key, pub };
		await put(id, kept);
		// Some browsers accept the key and give back nothing: check.
		const back = await get(id);
		return back?.kind === 'webcrypto' && back.key?.privateKey ? back : null;
	} catch {
		return null;
	}
}

/** Whether this computer was paired with the older shared key. */
export function legacyKey(): StaticKey | null {
	try {
		const raw = localStorage.getItem(LEGACY);
		const saved = raw ? (JSON.parse(raw) as { priv?: string; pub?: string }) : null;
		return saved?.priv && saved.pub ? { priv: fromBase64Url(saved.priv), pub: fromBase64Url(saved.pub) } : null;
	} catch {
		return null;
	}
}

/** The key this phone uses with computer `hostId`, made on first use.
 *  `legacy`: the computer was paired with the old shared key, which it
 *  keeps until paired again. */
export async function deviceKeyFor(hostId: string, legacy = false): Promise<StaticKey> {
	if (legacy) {
		const old = legacyKey();
		if (old) return old;
	}
	if (typeof indexedDB === 'undefined') {
		const pair = generateKeyPair();
		return pair;
	}
	const id = `host:${hostId}`;
	const kept = await get(id).catch(() => undefined);
	if (kept && (kept.kind === 'bytes' || kept.key?.privateKey)) return toStatic(kept);
	const fresh = (await webcryptoKey(id)) ?? (await bytesKey(id));
	return toStatic(fresh);
}

async function bytesKey(id: string): Promise<Kept> {
	const pair = generateKeyPair();
	const kept: Kept = { kind: 'bytes', priv: pair.priv, pub: pair.pub };
	await put(id, kept);
	return kept;
}

/** Forgets the key for `hostId` (the computer was forgotten); with
 *  `everything`, every key, the old shared one included. */
export async function forgetDeviceKey(hostId: string, everything = false): Promise<void> {
	try {
		if (everything) localStorage.removeItem(LEGACY);
	} catch {
		/* storage unavailable */
	}
	if (typeof indexedDB === 'undefined') return;
	try {
		const tx = (await open()).transaction(STORE, 'readwrite');
		if (everything) tx.objectStore(STORE).clear();
		else tx.objectStore(STORE).delete(`host:${hostId}`);
	} catch {
		/* nothing kept */
	}
}

/** What kind of key `hostId` uses here, for the settings page. */
export async function deviceKeyKind(hostId: string): Promise<'webcrypto' | 'bytes' | 'legacy' | 'none'> {
	if (typeof indexedDB === 'undefined') return 'none';
	const kept = await get(`host:${hostId}`).catch(() => undefined);
	return kept?.kind ?? (legacyKey() ? 'legacy' : 'none');
}

export { toBase64Url };
