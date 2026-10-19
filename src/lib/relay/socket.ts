// A WebSocket-shaped connection to the local daemon's protocol, carried
// through the LynShen relay inside a Noise IK session (LynShen-CLI
// docs/relay-protocol.md §3.2, §4). DaemonClient uses it in place of a plain
// WebSocket: "open" means the daemon accepted this device, and text frames in
// and out are encrypted and chunked.

import type { SocketLike } from '$lib/daemon';
import { FrameReader, Initiator, sealFrame, type CipherState, type StaticKey } from './noise';

export type RelayErrorKind =
	/** The computer's daemon is not connected to the relay (4404). */
	| 'offline'
	/** The daemon refused this device: its pairing code was wrong or used up. */
	| 'pair-invalid'
	/** The daemon refused this device: not paired, or revoked (also 4401). */
	| 'revoked'
	/** Paired: the computer has not confirmed this device yet. `check` is
	 *  the 6-digit code both sides show. */
	| 'pending'
	/** Too many connections (4429). */
	| 'busy'
	/** The daemon ended the stream (4410). */
	| 'closed'
	/** The relay could not be reached, or the stream broke. */
	| 'network'
	/** The daemon's reply could not be read. */
	| 'protocol';

export class RelayError extends Error {
	constructor(
		readonly kind: RelayErrorKind,
		message: string,
		/** For `pending`: the check code. */
		readonly check?: string
	) {
		super(message);
	}

	/** Retrying will not help; the user has to pair again. */
	get fatal() {
		return this.kind === 'pair-invalid' || this.kind === 'revoked';
	}
}

export interface RelayOptions {
	/** Relay base, e.g. `wss://app.lynshen.org/relay/v1`. */
	relay: string;
	hostId: string;
	hostStatic: Uint8Array;
	/** This phone's key for this computer, or how to get it. */
	device: StaticKey | (() => Promise<StaticKey>);
	name: string;
	/** One-time pairing code, sent only on the first connection. */
	pair?: string;
	/** Called once the daemon accepted the device (msg 2 `ok:true`). */
	onAccepted?: (reply: { device?: string; name?: string }) => void;
	/** Called with the reason whenever the socket fails or closes. */
	onRelayError?: (error: RelayError) => void;
	/** For tests. */
	WebSocketImpl?: typeof WebSocket;
}

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 3;
const HANDSHAKE_TIMEOUT_MS = 15_000;

/** The 6-digit check code of a pairing (LynShen-CLI `check_code`): the
 *  first 8 bytes of `bytes`, big-endian, modulo 10^6, zero-padded. */
export function checkCode(bytes: Uint8Array): string {
	let n = 0n;
	for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(bytes[i] ?? 0);
	return String(n % 1_000_000n).padStart(6, '0');
}

export function closeCodeError(code: number, reason: string): RelayError {
	switch (code) {
		case 4404:
			return new RelayError('offline', reason || 'host offline');
		case 4410:
			return new RelayError('closed', reason || 'host closed');
		case 4429:
			return new RelayError('busy', reason || 'too many connections');
		case 4401:
			return new RelayError('revoked', reason || 'unauthorized');
		case 4400:
			return new RelayError('protocol', reason || 'protocol error');
		default:
			return new RelayError('network', reason || `connection closed (${code})`);
	}
}

export class RelaySocket implements SocketLike {
	readyState = CONNECTING;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	/** Why the socket failed or closed, once it has. */
	error: RelayError | null = null;

	#ws: WebSocket;
	#initiator!: Initiator;
	/** The initiator, once the device key is at hand. */
	#ready: Promise<Initiator>;
	/** Messages in order: the handshake reply waits for the key work. */
	#queue: Promise<void> = Promise.resolve();
	#send: CipherState | null = null;
	#reader: FrameReader | null = null;
	#timer: ReturnType<typeof setTimeout>;

	constructor(private opts: RelayOptions) {
		const Impl = opts.WebSocketImpl ?? WebSocket;
		const base = opts.relay.replace(/\/+$/, '');
		this.#ws = new Impl(`${base}/connect?host=${encodeURIComponent(opts.hostId)}`);
		this.#ws.binaryType = 'arraybuffer';
		const device = typeof opts.device === 'function' ? opts.device() : Promise.resolve(opts.device);
		this.#ready = device.then((key) => (this.#initiator = new Initiator(key, opts.hostStatic)));
		this.#timer = setTimeout(
			() => this.#fail(new RelayError('network', 'handshake timed out')),
			HANDSHAKE_TIMEOUT_MS
		);

		this.#ws.onopen = () => {
			const hello: Record<string, string> = { name: opts.name };
			if (opts.pair) hello.pair = opts.pair;
			this.#queue = this.#queue
				.then(() => this.#ready)
				.then((initiator) => initiator.write1(new TextEncoder().encode(JSON.stringify(hello))))
				.then((msg1) => this.#ws.send(msg1 as Uint8Array<ArrayBuffer>))
				.catch((e) => this.#fail(new RelayError('protocol', String(e))));
		};
		this.#ws.onmessage = (event) => {
			if (!(event.data instanceof ArrayBuffer)) return this.#fail(new RelayError('protocol', 'unexpected text frame'));
			const bytes = new Uint8Array(event.data);
			// After the handshake, frames are handled as they come.
			if (this.#reader) return this.#guard(() => this.#receive(bytes));
			this.#queue = this.#queue.then(() => this.#guard(() => this.#receive(bytes)));
		};
		this.#ws.onerror = () => {
			// A close event (with the relay's code) always follows.
		};
		this.#ws.onclose = (event) => {
			this.#finish(this.error ?? closeCodeError(event.code, event.reason));
		};
	}

	async #guard(work: () => void | Promise<void>) {
		try {
			await work();
		} catch (e) {
			this.#fail(e instanceof RelayError ? e : new RelayError('protocol', String(e)));
		}
	}

	async #receive(message: Uint8Array) {
		if (this.#reader) {
			const text = this.#reader.push(message);
			if (text !== null) this.onmessage?.({ data: text });
			return;
		}
		// The check code is from the handshake hash after msg 1 (the daemon
		// takes it at the same point): taken before msg 2 is read.
		const check = checkCode(this.#initiator.handshakeHash);
		const { payload, transport } = await this.#initiator.read2(message);
		let reply: { ok?: boolean; error?: string; device?: string; name?: string; pending?: boolean; check?: string };
		try {
			reply = JSON.parse(new TextDecoder().decode(payload));
		} catch {
			throw new RelayError('protocol', 'unreadable handshake reply');
		}
		if (reply.pending) {
			// A new pairing shows this connection's code; later tries show
			// the first one, which the computer kept.
			throw new RelayError('pending', reply.error || 'waiting for the computer', this.opts.pair ? check : reply.check);
		}
		if (!reply.ok) {
			throw new RelayError(
				this.opts.pair ? 'pair-invalid' : 'revoked',
				reply.error || 'device not authorized'
			);
		}
		clearTimeout(this.#timer);
		this.#send = transport.send;
		this.#reader = new FrameReader(transport.recv);
		this.readyState = OPEN;
		this.opts.onAccepted?.({ device: reply.device, name: reply.name });
		this.onopen?.();
	}

	send(text: string) {
		if (this.readyState !== OPEN || !this.#send) throw new Error('relay socket is not open');
		for (const message of sealFrame(this.#send, text)) this.#ws.send(message as Uint8Array<ArrayBuffer>);
	}

	close() {
		if (this.readyState === CLOSED) return;
		this.#ws.close(1000);
		this.#finish(this.error ?? new RelayError('closed', 'closed'));
	}

	#fail(error: RelayError) {
		this.error ??= error;
		try {
			this.#ws.close(1000);
		} catch {
			/* already closing */
		}
		this.#finish(error);
	}

	#finish(error: RelayError) {
		if (this.readyState === CLOSED) return;
		const wasOpen = this.readyState === OPEN;
		clearTimeout(this.#timer);
		this.readyState = CLOSED;
		this.error ??= error;
		this.opts.onRelayError?.(this.error);
		if (!wasOpen) this.onerror?.();
		this.onclose?.();
	}
}
