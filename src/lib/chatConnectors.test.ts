import { describe, expect, it } from 'vitest';
import { isChatDevice, isOldDaemon, isTelegramToken, parseConnectors, proxyValue, remaining } from './chatConnectors';

describe('chat connectors', () => {
	it('reads the daemon list and drops what it cannot use', () => {
		const list = parseConnectors({
			type: 'connectors',
			connectors: [
				{
					id: 'tg-1',
					platform: 'telegram',
					name: '@lyn_bot',
					link: 'https://t.me/lyn_bot',
					enabled: true,
					proxy: null,
					proxy_source: 'environment',
					proxy_shown: 'http://127.0.0.1:7890',
					state: 'connected',
					error: null,
					settings: { approvals: false, notify: true, max_mode: 'manual' },
					bindings: [{ device: 'dev-1', name: 'Alice (@alice)', paired_at: 5, last_seen: 9 }, { name: 'no id' }]
				},
				{ id: 'tg-2', state: 'weird', settings: { max_mode: 'full-access' } },
				{ name: 'no id' },
				null
			]
		});
		expect(list).toHaveLength(2);
		expect(list[0]).toMatchObject({
			name: '@lyn_bot',
			proxySource: 'environment',
			proxyShown: 'http://127.0.0.1:7890',
			state: 'connected',
			settings: { approvals: false, notify: true, max_mode: 'manual' }
		});
		expect(list[0].bindings).toEqual([{ device: 'dev-1', name: 'Alice (@alice)', paired_at: 5, last_seen: 9 }]);
		// Unknown values fall back to safe ones: a full-access mode never shows.
		expect(list[1]).toMatchObject({ platform: 'telegram', state: 'connecting', enabled: true, link: null });
		expect(list[1].settings.max_mode).toBe('auto');
		expect(parseConnectors({})).toEqual([]);
	});

	it('checks a token and a proxy before they are sent', () => {
		expect(isTelegramToken(' 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1 ')).toBe(true);
		expect(isTelegramToken('123456789:short')).toBe(false);
		expect(isTelegramToken('abc:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1')).toBe(false);
		expect(proxyValue('')).toEqual({ ok: true, value: null });
		expect(proxyValue(' direct ')).toEqual({ ok: true, value: 'direct' });
		expect(proxyValue('http://127.0.0.1:7890/')).toEqual({ ok: true, value: 'http://127.0.0.1:7890' });
		expect(proxyValue('http://user:pass@proxy.lan:8080')).toEqual({ ok: true, value: 'http://user:pass@proxy.lan:8080' });
		expect(proxyValue('socks5://127.0.0.1:7891').ok).toBe(false);
		expect(proxyValue('127.0.0.1:7890').ok).toBe(false);
	});

	it('counts down a binding code and tells chat bindings from phones', () => {
		expect(remaining(1_000 + 125_000, 1_000)).toBe('2:05');
		expect(remaining(0, 5_000)).toBe('0:00');
		expect(isChatDevice({ kind: 'chat' })).toBe(true);
		expect(isChatDevice({ kind: 'device' })).toBe(false);
		expect(isChatDevice({})).toBe(false);
		expect(isOldDaemon('connector_list requires session')).toBe(true);
		expect(isOldDaemon('Telegram answered 401: Unauthorized')).toBe(false);
	});
});
