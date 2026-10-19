import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inlineScriptHashes, policy, withMeta } from './phone-csp.mjs';

const sha = (text) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`;

describe('phone page CSP', () => {
	const html = '<!doctype html><html><head><meta charset="utf-8"><script>boot()</script><script type="module" src="/a.js"></script></head><body><div><script>\n\tstart()\n</script></div></body></html>';

	it('hashes the inline scripts and only those', () => {
		assert.deepEqual(inlineScriptHashes(html), [sha('boot()'), sha('\n\tstart()\n')]);
	});

	it("allows this origin and the page's own inline scripts, nothing else", () => {
		const csp = policy(inlineScriptHashes(html));
		assert.ok(csp.includes(`script-src 'self' ${sha('boot()')} ${sha('\n\tstart()\n')}`));
		assert.doesNotMatch(csp, /script-src[^;]*unsafe/);
		for (const part of ["object-src 'none'", "base-uri 'none'", "connect-src 'self' wss://app.lynshen.org"]) assert.ok(csp.includes(part), part);
	});

	it('goes first in <head>, once', () => {
		const out = withMeta(html, "default-src 'self'");
		assert.ok(out.indexOf('content-security-policy') < out.indexOf('<meta charset'));
		assert.throws(() => withMeta(out, 'x'));
	});
});
