// The phone page's Content-Security-Policy (audit 8.1). From a built
// index.html: `script-src 'self'` plus the SHA-256 of each inline script it
// has (the theme/boot script of src/app.html and SvelteKit's start script),
// so no other script runs. The hashes change with every build, so the
// policy goes into the page itself, as a <meta> tag at the top of <head>,
// in the copy deployed to app.lynshen.org only (the desktop app has its own
// CSP in tauri.conf.json). What a <meta> policy cannot say
// (frame-ancestors) and HSTS come from Caddy as fixed headers
// (docs/phone-page-deploy.md).
//
//   node scripts/phone-csp.mjs <dir>    adds the tag to <dir>/index.html
//                                       and writes <dir>/CSP
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The hashes of every inline <script> (no src) in `html`. */
export function inlineScriptHashes(html) {
	const hashes = [];
	for (const m of html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
		if (/\ssrc\s*=/.test(m[1] ?? '')) continue;
		hashes.push(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
	}
	return hashes;
}

/** The policy for a page whose inline scripts hash to `hashes`. */
export function policy(hashes) {
	return [
		"default-src 'self'",
		`script-src 'self' ${hashes.join(' ')}`,
		// Svelte transitions and the components' style attributes.
		"style-src 'self' 'unsafe-inline'",
		// Attachments shown before upload, inline icons.
		"img-src 'self' data: blob:",
		"font-src 'self' data:",
		// The relay and its push key, on this origin.
		"connect-src 'self' wss://app.lynshen.org",
		"worker-src 'self'",
		"manifest-src 'self'",
		"object-src 'none'",
		"base-uri 'none'",
		"form-action 'self'"
	].join('; ');
}

/** `html` with the policy as the first element of <head>. */
export function withMeta(html, csp) {
	if (/http-equiv="content-security-policy"/i.test(html)) throw new Error('the page already has a CSP tag');
	const head = /<head[^>]*>/i.exec(html);
	if (!head) throw new Error('no <head>');
	const at = head.index + head[0].length;
	return `${html.slice(0, at)}\n    <meta http-equiv="content-security-policy" content="${csp}">${html.slice(at)}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const dir = process.argv[2];
	if (!dir) throw new Error('usage: node scripts/phone-csp.mjs <build dir copy>');
	const file = join(dir, 'index.html');
	const html = readFileSync(file, 'utf8');
	const hashes = inlineScriptHashes(html);
	if (hashes.length < 2) throw new Error(`${file}: expected the boot script and SvelteKit's start script, found ${hashes.length}`);
	const csp = policy(hashes);
	writeFileSync(file, withMeta(html, csp));
	writeFileSync(join(dir, 'CSP'), csp + '\n');
	console.log(csp);
}
