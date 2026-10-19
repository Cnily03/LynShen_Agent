// Performance check, run in CI: a long conversation in a real conversation
// pane (production build of tests/browser/perf.html), in Chromium and WebKit.
// Its bounds are counts, ratios and wide budgets, so a slow or busy runner
// passes and a change that makes the cost grow with the conversation fails:
//
//   - opening a conversation of 500 turns (4,000 messages, screenshots read,
//     long logs and diffs) renders the rows in view, not all of them;
//   - a reply of 2,000 deltas streamed into its end costs per delta at most
//     a few times what it costs in a conversation of 10 turns, and all of it
//     stays within a budget;
//   - no screenshot's pixels are held, and (Chromium) the heap after the
//     stream and five switches to another conversation and back has grown
//     by less than a bound, with no event listeners left behind;
//   - a turn waiting for the model ticks its clocks only while the page
//     shows.
//
// The full benchmark (memory, frames, idle CPU, WebKit's footprint) is
// scripts/desk-perf.mjs.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { build, preview } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium, webkit } from '@playwright/test';

const TURNS = 500;
const DELTAS = 2000;
/** Rows a window of the pane and its overscan hold, at most. */
const ROWS_MAX = 100;
/** Cost per delta at 500 turns over its cost at 10 turns. */
const RATIO_MAX = 4;
/** All 2,000 deltas into the long conversation, ms (about 0.2 s on a laptop). */
const STREAM_BUDGET_MS = 6000;
/** JS heap growth over the stream and the switches, MB. */
const HEAP_GROWTH_MB = 15;

const outDir = mkdtempSync(resolve(tmpdir(), 'lynshen-perfcheck-'));
const shared = {
	configFile: false,
	logLevel: 'warn',
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: { alias: { $lib: resolve('src/lib') } }
};
await build({ ...shared, build: { outDir, emptyOutDir: true, chunkSizeWarningLimit: 4096, rollupOptions: { input: resolve('tests/browser/perf.html') } } });
const server = await preview({ ...shared, build: { outDir }, preview: { host: '127.0.0.1', port: 1442, strictPort: true } });
const results = {};
try {
	for (const [name, type] of [
		['chromium', chromium],
		['webkit', webkit]
	]) {
		const browser = await type.launch(name === 'chromium' ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {});
		try {
			const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
			const errors = [];
			page.on('pageerror', (e) => errors.push(e.message));
			// Counts the timers that fire.
			await page.addInitScript(() => {
				const c = (window.__timers = { n: 0 });
				const st = window.setTimeout;
				const si = window.setInterval;
				window.setTimeout = (f, ...a) => st((...x) => (c.n++, typeof f === 'function' ? f(...x) : undefined), ...a);
				window.setInterval = (f, ...a) => si((...x) => (c.n++, typeof f === 'function' ? f(...x) : undefined), ...a);
			});
			const cdp = name === 'chromium' ? await page.context().newCDPSession(page) : null;
			const heap = async () => {
				await cdp.send('HeapProfiler.collectGarbage');
				await cdp.send('HeapProfiler.collectGarbage');
				return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6;
			};
			const listeners = async () => (await cdp.send('Memory.getDOMCounters')).jsEventListeners;
			await page.goto('http://127.0.0.1:1442/tests/browser/perf.html?defer');
			await page.waitForFunction(() => window.__perf, null, { timeout: 30000 });
			const r = (results[name] = {});

			// A conversation of 10 turns, then one of 500, the first shown.
			await page.evaluate((n) => {
				window.__perf.seed(n);
				window.__perf.addSessions(1, 10);
			}, TURNS);
			// The rows the pane rendered as it showed, before anything else
			// runs (a frame, an observer): those in it, and those it rendered
			// and dropped again.
			r.rowsOnOpen = await page.evaluate(() => {
				const seen = new MutationObserver(() => {});
				seen.observe(document.body, { childList: true, subtree: true });
				window.__perf.show(0);
				window.__perf.flush();
				let dropped = 0;
				for (const rec of seen.takeRecords()) for (const n of rec.removedNodes) if (n instanceof Element) dropped += (n.matches('.mwrap') ? 1 : 0) + n.querySelectorAll('.mwrap').length;
				seen.disconnect();
				return document.querySelectorAll('.mwrap').length + dropped;
			});
			await page.waitForFunction(() => window.__perf.ready(), null, { timeout: 30000 });
			r.messages = await page.evaluate(() => window.__perf.chat().messages.length);
			r.pixelsHeld = await page.evaluate(() => window.__perf.chat().messages.filter((m) => m.kind === 'tool' && m.output.includes('"base64"')).length);

			// Streaming: each delta delivered and its updates run, timed.
			const stream = (n) =>
				page.evaluate(
					(n) =>
						new Promise((done) => {
							const P = window.__perf;
							P.deliver({ type: 'user_message', content: '继续' });
							P.deliver({ type: 'status', message: 'streaming' });
							P.deliver({ type: 'thinking_start' });
							P.flush();
							const words = ['我们', '需要', '考虑', 'the cache', '边界', '**注意**', '`buf.len()`', '。', '\n\n'];
							let ms = 0;
							let left = n;
							const frame = () => {
								for (let i = 0; i < 4 && left > 0; i++, left--) {
									const t = performance.now();
									P.deliver({ type: left > n / 2 ? 'reasoning_delta' : 'assistant_delta', delta: words[left % words.length] + words[(left * 7) % words.length] });
									P.flush();
									ms += performance.now() - t;
								}
								if (left > 0) requestAnimationFrame(frame);
								else {
									P.deliver({ type: 'status', message: 'ready' });
									P.flush();
									done(ms);
								}
							};
							requestAnimationFrame(frame);
						}),
					n
				);
			const heapBefore = cdp ? await heap() : 0;
			r.streamLongMs = Math.round(await stream(DELTAS));
			await page.evaluate(() => window.__perf.show(1));
			await page.waitForFunction(() => window.__perf.ready(), null, { timeout: 30000 });
			r.streamShortMs = Math.round(await stream(DELTAS));
			r.ratio = +(r.streamLongMs / Math.max(r.streamShortMs, 50)).toFixed(2);

			// Switching conversations leaves nothing behind.
			const cycle = async () => {
				for (const i of [0, 1]) {
					await page.evaluate((i) => window.__perf.show(i), i);
					await page.waitForFunction(() => window.__perf.ready(), null, { timeout: 30000 });
				}
				await page.waitForTimeout(300);
			};
			await cycle();
			const listenersBefore = cdp ? await listeners() : 0;
			for (let k = 0; k < 5; k++) await cycle();
			if (cdp) {
				r.heapGrowthMB = +((await heap()) - heapBefore).toFixed(1);
				r.listenersLeft = (await listeners()) - listenersBefore;
			}

			// A turn waiting for the model: its clocks tick while the page
			// shows, not while it is hidden.
			await page.evaluate(() => {
				const P = window.__perf;
				P.deliver({ type: 'user_message', content: '再想一想' });
				P.deliver({ type: 'status', message: 'streaming' });
			});
			const timersIn = (ms) => page.evaluate((ms) => new Promise((done) => {
				const start = window.__timers.n;
				setTimeout(() => done(window.__timers.n - start - 1), ms);
			}), ms);
			r.timersShown = await timersIn(2000);
			await page.evaluate(() => {
				Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
				document.dispatchEvent(new Event('visibilitychange'));
			});
			r.timersHidden = await timersIn(2000);
			r.errors = errors;
			console.log(name, JSON.stringify(r));

			assert.ok(r.messages >= TURNS * 7, `${name}: the conversation has ${r.messages} messages`);
			assert.ok(r.rowsOnOpen > 0 && r.rowsOnOpen <= ROWS_MAX, `${name}: opening ${r.messages} messages rendered ${r.rowsOnOpen} rows`);
			assert.equal(r.pixelsHeld, 0, `${name}: screenshots read keep their pixels`);
			assert.ok(r.streamLongMs <= STREAM_BUDGET_MS, `${name}: ${DELTAS} deltas into ${TURNS} turns took ${r.streamLongMs} ms`);
			assert.ok(r.ratio <= RATIO_MAX, `${name}: a delta costs ${r.ratio}× more at ${TURNS} turns than at 10 (${r.streamLongMs} vs ${r.streamShortMs} ms)`);
			if (cdp) {
				assert.ok(r.heapGrowthMB <= HEAP_GROWTH_MB, `${name}: the heap grew ${r.heapGrowthMB} MB`);
				assert.ok(r.listenersLeft <= 5, `${name}: ${r.listenersLeft} event listeners left behind`);
			}
			assert.ok(r.timersShown >= 3, `${name}: the clocks of a waiting turn fired ${r.timersShown} timers`);
			assert.ok(r.timersHidden <= 1, `${name}: ${r.timersHidden} timers fired while the page was hidden`);
			assert.deepEqual(errors, []);
		} finally {
			await browser.close();
		}
	}
} finally {
	await new Promise((r) => server.httpServer.close(r));
	rmSync(outDir, { recursive: true, force: true });
}
console.log('Performance check passed.');
