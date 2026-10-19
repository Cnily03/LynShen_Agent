import { describe, expect, it } from 'vitest';
import { proxySetting, proxyUrl } from './networkProxy';

describe('the network proxy setting (ticket #50)', () => {
	it('takes an HTTP proxy as the engine does', () => {
		expect(proxyUrl('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
		expect(proxyUrl(' 127.0.0.1:7890 ')).toBe('http://127.0.0.1:7890');
		expect(proxyUrl('http://u:p@proxy.lan:8080/')).toBe('http://u:p@proxy.lan:8080');
		expect(proxyUrl('socks5://127.0.0.1:7891')).toBeNull();
		expect(proxyUrl('127.0.0.1')).toBeNull();
		expect(proxyUrl('http://h:0')).toBeNull();
		expect(proxyUrl('http://h:1/path')).toBeNull();
	});

	it('writes nothing for an empty or unusable value', () => {
		expect(proxySetting('')).toBe('');
		expect(proxySetting('socks5://x:1')).toBe('');
		expect(proxySetting('127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
	});
});
