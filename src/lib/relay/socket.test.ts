import { describe, expect, it, vi } from 'vitest';
import { FrameReader, generateKeyPair, sealFrame, type Transport } from './noise';
import { respond } from './responder.testing';
import { RelaySocket, checkCode, type RelayError } from './socket';

const enc = new TextEncoder();
const dec = new TextDecoder();

/** A fake browser WebSocket; the test plays relay + daemon. */
class FakeWs {
	static last: FakeWs;
	binaryType = 'blob';
	sent: Uint8Array[] = [];
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: unknown }) => void) | null = null;
	onerror: (() => void) | null = null;
	onclose: ((event: { code: number; reason: string }) => void) | null = null;
	closed = false;
	constructor(readonly url: string) {
		FakeWs.last = this;
	}
	send(data: Uint8Array) {
		this.sent.push(new Uint8Array(data));
	}
	close() {
		this.closed = true;
	}
	deliver(bytes: Uint8Array) {
		this.onmessage?.({ data: bytes.slice().buffer });
	}
	drop(code: number, reason = '') {
		this.onclose?.({ code, reason });
	}
}

/** Lets the socket's queued key work run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(pair?: string, reply: object | ((h: Uint8Array) => object) = { ok: true, device: 'd1', name: 'iPhone' }) {
	const host = generateKeyPair();
	const device = generateKeyPair();
	const errors: RelayError[] = [];
	const accepted = vi.fn();
	const socket = new RelaySocket({
		relay: 'wss://relay.test/relay/v1/',
		hostId: 'H'.repeat(22),
		hostStatic: host.pub,
		device,
		name: 'iPhone',
		pair,
		onAccepted: accepted,
		onRelayError: (e) => errors.push(e),
		WebSocketImpl: FakeWs as unknown as typeof WebSocket
	});
	const ws = FakeWs.last;
	let hello: unknown;
	let daemon: Transport | undefined;
	const handshake = async () => {
		ws.onopen?.();
		await settle();
		const r = respond(host, ws.sent[0], (payload, _rs, h) => {
			hello = JSON.parse(dec.decode(payload));
			return enc.encode(JSON.stringify(typeof reply === 'function' ? reply(h) : reply));
		});
		daemon = r.transport;
		ws.deliver(r.msg2);
		await settle();
	};
	return { socket, ws, errors, accepted, handshake, hello: () => hello, daemon: () => daemon! };
}

describe('RelaySocket', () => {
	it('opens after the daemon accepts, then carries encrypted frames', async () => {
		const { socket, ws, accepted, handshake, hello, daemon } = setup('ABCD1234');
		expect(ws.url).toBe(`wss://relay.test/relay/v1/connect?host=${'H'.repeat(22)}`);
		expect(ws.binaryType).toBe('arraybuffer');
		const opened = vi.fn();
		socket.onopen = opened;
		const got: unknown[] = [];
		socket.onmessage = (event) => got.push(event.data);
		await handshake();
		expect(hello()).toEqual({ name: 'iPhone', pair: 'ABCD1234' });
		expect(socket.readyState).toBe(1);
		expect(opened).toHaveBeenCalledOnce();
		expect(accepted).toHaveBeenCalledWith({ device: 'd1', name: 'iPhone' });

		const big = JSON.stringify({ type: 'hello', protocol: 2, pad: 'x'.repeat(70_000) });
		for (const message of sealFrame(daemon().send, big)) ws.deliver(message);
		await settle();
		expect(got).toEqual([big]);

		socket.send('{"op":"session_list","id":1}');
		const reader = new FrameReader(daemon().recv);
		expect(reader.push(ws.sent[1])).toBe('{"op":"session_list","id":1}');
	});

	it('omits pair when there is no code', async () => {
		const { handshake, hello } = setup();
		await handshake();
		expect(hello()).toEqual({ name: 'iPhone' });
	});

	it('reports a refused pairing code as fatal', async () => {
		const { socket, handshake, errors } = setup('ABCD1234', { ok: false, error: 'bad code' });
		const onclose = vi.fn();
		socket.onclose = onclose;
		await handshake();
		expect(socket.readyState).toBe(3);
		expect(errors[0].kind).toBe('pair-invalid');
		expect(errors[0].fatal).toBe(true);
		expect(onclose).toHaveBeenCalledOnce();
	});

	it('a new pairing waits for the computer and shows the code both sides compute', async () => {
		let daemonCheck = '';
		const { socket, handshake, errors } = setup('ABCD1234', (h) => {
			daemonCheck = checkCode(h);
			return { ok: false, pending: true, device: 'd1', check: daemonCheck };
		});
		await handshake();
		expect(socket.readyState).toBe(3);
		expect(errors[0].kind).toBe('pending');
		expect(errors[0].fatal).toBe(false);
		expect(errors[0].check).toMatch(/^\d{6}$/);
		expect(errors[0].check).toBe(daemonCheck);
	});

	it('a later try while still pending shows the code the computer kept', async () => {
		const { handshake, errors } = setup(undefined, { ok: false, pending: true, device: 'd1', check: '042137' });
		await handshake();
		expect(errors[0].kind).toBe('pending');
		expect(errors[0].check).toBe('042137');
	});

	it('the check code is the first 8 bytes modulo a million, as the daemon has it', () => {
		const bytes = new Uint8Array(32);
		bytes.set([0, 0, 0, 0, 0, 0x0f, 0x42, 0x41]); // 1_000_001
		expect(checkCode(bytes)).toBe('000001');
		expect(checkCode(new Uint8Array(32).fill(0xff))).toBe(String(2n ** 64n - 1n).slice(-6));
	});

	it('works with a key whose private half cannot be read (WebCrypto)', async () => {
		const key = (await crypto.subtle.generateKey({ name: 'X25519' }, false, ['deriveBits'])) as CryptoKeyPair;
		const pub = new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey));
		await expect(crypto.subtle.exportKey('pkcs8', key.privateKey)).rejects.toThrow();
		const host = generateKeyPair();
		let seenKey: Uint8Array | null = null;
		const socket = new RelaySocket({
			relay: 'wss://relay.test/relay/v1',
			hostId: 'H'.repeat(22),
			hostStatic: host.pub,
			device: async () => ({
				pub,
				dh: async (peer) => {
					const publicKey = await crypto.subtle.importKey('raw', peer as Uint8Array<ArrayBuffer>, { name: 'X25519' }, false, []);
					return new Uint8Array(await crypto.subtle.deriveBits({ name: 'X25519', public: publicKey }, key.privateKey, 256));
				}
			}),
			name: 'iPhone',
			WebSocketImpl: FakeWs as unknown as typeof WebSocket
		});
		const ws = FakeWs.last;
		ws.onopen?.();
		await vi.waitFor(() => expect(ws.sent.length).toBe(1));
		const r = respond(host, ws.sent[0], (_payload, rs) => {
			seenKey = rs;
			return enc.encode(JSON.stringify({ ok: true, device: 'd1' }));
		});
		ws.deliver(r.msg2);
		await vi.waitFor(() => expect(socket.readyState).toBe(1));
		expect(Array.from(seenKey!)).toEqual(Array.from(pub));
	});

	it('maps relay close codes', () => {
		for (const [code, kind] of [
			[4404, 'offline'],
			[4410, 'closed'],
			[4429, 'busy'],
			[4401, 'revoked'],
			[1006, 'network']
		] as const) {
			const { ws, errors, socket } = setup();
			const onerror = vi.fn();
			socket.onerror = onerror;
			ws.drop(code);
			expect(errors[0].kind).toBe(kind);
			expect(onerror).toHaveBeenCalledOnce();
		}
	});
});
