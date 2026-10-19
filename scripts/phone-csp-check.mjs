// Loads a built phone page (with its CSP tag, scripts/phone-csp.mjs) in
// Chromium and WebKit at 390×844, served as app.lynshen.org serves it (SPA
// fallback, the relay answering 404): the page must render its pairing
// screen with no CSP violation and no page error. An inline script someone
// adds later must be blocked.
//
//   node scripts/phone-csp-check.mjs <build dir copy> [port]
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium, webkit } from '@playwright/test';

const dir = process.argv[2];
const port = Number(process.argv[3] ?? 1451);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain', '.woff2': 'font/woff2' };
const server = createServer((req, res) => {
	const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
	if (path.startsWith('/relay/')) return res.writeHead(404).end();
	let file = join(dir, path);
	if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, 'index.html');
	res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream' });
	res.end(readFileSync(file));
});
await new Promise((r) => server.listen(port, '127.0.0.1', r));
let failed = false;
try {
	for (const [name, launch] of [
		['chromium', () => chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })],
		['webkit', () => webkit.launch()]
	]) {
		const browser = await launch();
		try {
			const page = await browser.newPage({ viewport: { width: 390, height: 844 }, locale: 'zh-CN' });
			const violations = [];
			const errors = [];
			await page.exposeFunction('__cspViolation', (v) => violations.push(v));
			await page.addInitScript(() =>
				document.addEventListener('securitypolicyviolation', (e) => window.__cspViolation(`${e.violatedDirective} ${e.blockedURI}`))
			);
			page.on('pageerror', (e) => errors.push(e.message));
			await page.goto(`http://127.0.0.1:${port}/remote`);
			// The page rendered (its first screen: pairing, as nothing is paired).
			await page.locator('h1').first().waitFor({ timeout: 20000 });
			assert.deepEqual(violations, [], `${name}: CSP violations`);
			assert.deepEqual(errors, [], `${name}: page errors`);
			// A script the page did not ship does not run.
			const ran = await page.evaluate(() => {
				window.__injected = false;
				const s = document.createElement('script');
				s.textContent = 'window.__injected = true';
				document.head.append(s);
				return window.__injected;
			});
			assert.equal(ran, false, `${name}: an injected inline script ran`);
			console.log(`${name}: CSP CHECK PASSED (blocked: ${violations.join(', ')})`);
		} catch (e) {
			failed = true;
			console.error(`${name}: FAILED`, e.message);
		} finally {
			await browser.close();
		}
	}
} finally {
	server.close();
}
process.exit(failed ? 1 : 0);
