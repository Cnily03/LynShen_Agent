// Streaming benchmark: a long reasoning block streamed into a real ChatPane
// (production build, tests/browser/perf.html), each delta delivered the way
// the page delivers a daemon frame: in a task of its own, through
// ChatState.handle, then the pane follows the end. Not run in CI.
//
//   node scripts/reasoning-perf.mjs [--deltas 20000] [--windows 10] [--per-frame 4] [--words 1]
//                                   [--open] [--answer] [--webkit]
//
// Prints, per window of deltas: the time the deliveries took per delta, the
// time per frame (average and 95th percentile), and in Chromium the main
// thread's task, script and layout time per frame and the JS heap (not
// collected); at the end, the heap after a forced GC. A cost per frame that
// grows from window to window grows with the text's length.
//
// --per-frame: deltas per animation frame. --words: words per delta (about
//   4 characters each; more reaches a long text sooner).
// --open: the reader unfolds the reasoning as it starts streaming.
// --answer: stream the deltas as the reply instead of reasoning.
// --webkit: Playwright's WebKit (the engine of the macOS app's web view)
//   instead of Chromium. It has no CDP: memory is the WebContent process's
//   footprint (macOS `footprint`), which WebKit's allocator does not give
//   back when freed, so it shows the peak.
import { resolve } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { build, preview } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { execFileSync } from 'node:child_process';
import { chromium, webkit } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, def) => {
	const i = args.indexOf(`--${name}`);
	return i < 0 ? def : Number(args[i + 1]);
};
const DELTAS = opt('deltas', 20000);
const PER_FRAME = opt('per-frame', 4);
const WINDOWS = opt('windows', 10);
const WORDS = opt('words', 1);
const OPEN = args.includes('--open');
const ANSWER = args.includes('--answer');
const WEBKIT = args.includes('--webkit');

const outDir = mkdtempSync(resolve(tmpdir(), 'lynshen-perf-'));
const shared = {
	configFile: false,
	logLevel: 'warn',
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: { alias: { $lib: resolve('src/lib') } }
};
await build({ ...shared, build: { outDir, emptyOutDir: true, rollupOptions: { input: resolve('tests/browser/perf.html') } } });
const server = await preview({ ...shared, build: { outDir }, preview: { host: '127.0.0.1', port: 1439, strictPort: true } });
const browser = WEBKIT
	? await webkit.launch()
	: await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
/** The WebContent processes' footprint, MB (WebKit only). */
const footprintMB = () => {
	const pids = execFileSync('pgrep', ['-f', 'ms-playwright/webkit.*WebContent'], { encoding: 'utf8' }).trim().split('\n');
	let total = 0;
	for (const pid of pids) {
		const out = execFileSync('footprint', ['-p', pid], { encoding: 'utf8' });
		const m = out.match(/Footprint:\s+([\d.]+)\s+(KB|MB|GB)/);
		if (m) total += Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1);
	}
	return +total.toFixed(1);
};
try {
	const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	const cdp = WEBKIT ? null : await page.context().newCDPSession(page);
	await cdp?.send('Performance.enable');
	page.on('console', (m) => m.type() === 'error' && console.error('[page]', m.text()));
	await page.goto('http://127.0.0.1:1439/tests/browser/perf.html');
	await page.waitForFunction(() => window.__perf?.ready(), null, { timeout: 15000 });
	const metrics = async () =>
		cdp ? Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])) : {};
	const gcHeap = async () => {
		if (!cdp) return NaN;
		await cdp.send('HeapProfiler.collectGarbage');
		return (await cdp.send('Runtime.getHeapUsage')).usedSize;
	};

	await page.evaluate(
		({ open, answer, wordsPer }) => {
			const P = window.__perf;
			P.deliver({ type: 'user_message', content: '请仔细想一想再回答' });
			P.deliver({ type: 'connecting' });
			P.deliver({ type: 'status', message: 'streaming' });
			P.deliver({ type: 'thinking_start' });
			// Reasoning as models write it: paragraphs of mixed Chinese and
			// English, some Markdown, a few chars per delta.
			const words = ['我们', '需要', '考虑', '这个', '函数', 'the cache', '边界', '情况', 'returns', '**注意**', '`buf.len()`', '然后', 'maybe', '检查', '一下', '。'];
			let seed = 7;
			const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
			const word = () => {
				const r = rnd();
				if (r < 0.02) return '\n\n';
				if (r < 0.025) return '\n- ';
				return words[Math.floor(rnd() * words.length)] + (rnd() < 0.3 ? ' ' : '');
			};
			window.__nextDelta = () => Array.from({ length: wordsPer }, word).join('');
			window.__type = answer ? 'assistant_delta' : 'reasoning_delta';
			P.deliver({ type: window.__type, delta: '好的，' });
			if (open) window.__perf.chat().messages.at(-1).collapsed = false;
		},
		{ open: OPEN, answer: ANSWER, wordsPer: WORDS }
	);

	// Feeds `n` deltas, `per` per animation frame, each in a task of its own
	// (a WebSocket message each); resolves with the frame intervals, the time
	// the deliveries took and the time it all took.
	const feed = (n) =>
		page.evaluate(
			({ n, per }) =>
				new Promise((done) => {
					const ch = new MessageChannel();
					let left = n;
					let busy = 0;
					ch.port1.onmessage = () => {
						const t = performance.now();
						window.__perf.deliver({ type: window.__type, delta: window.__nextDelta() });
						busy += performance.now() - t;
					};
					const frames = [];
					const started = performance.now();
					let last = performance.now();
					const frame = (now) => {
						frames.push(now - last);
						last = now;
						if (left <= 0) return done({ frames, busy, wall: now - started });
						for (let i = 0; i < per && left > 0; i++, left--) ch.port2.postMessage(0);
						requestAnimationFrame(frame);
					};
					requestAnimationFrame(frame);
				}),
			{ n, per: PER_FRAME }
		);

	const per = Math.floor(DELTAS / WINDOWS);
	const rows = [];
	let peak = 0;
	let before = await metrics();
	const t0 = Date.now();
	for (let w = 0; w < WINDOWS; w++) {
		const { frames, busy, wall } = await feed(per);
		const after = await metrics();
		const d = (k) => (after[k] - before[k]) * 1000;
		const n = frames.length;
		const sorted = [...frames].sort((a, b) => a - b);
		const chars = await page.evaluate(() => window.__perf.chat().messages.at(-1).text.length);
		const row = { upTo: (w + 1) * per, chars, 'deliver ms/delta': +(busy / per).toFixed(3) };
		if (cdp) {
			peak = Math.max(peak, after.JSHeapUsedSize);
			Object.assign(row, {
				'task ms/frame': +(d('TaskDuration') / n).toFixed(2),
				'script ms/frame': +(d('ScriptDuration') / n).toFixed(2),
				'layout ms/frame': +(d('LayoutDuration') / n).toFixed(2),
				'heap MB': +(after.JSHeapUsedSize / 1e6).toFixed(1)
			});
		} else {
			const mb = footprintMB();
			peak = Math.max(peak, mb);
			row['footprint MB'] = mb;
		}
		Object.assign(row, {
			'ms/frame': +(wall / n).toFixed(1),
			'frame p95': +sorted[Math.floor(n * 0.95)].toFixed(1)
		});
		rows.push(row);
		before = after;
	}
	const seconds = (Date.now() - t0) / 1000;
	const heapAfterGc = await gcHeap();
	await page.evaluate(() => window.__perf.deliver({ type: 'status', message: 'ready' }));
	await page.waitForTimeout(300);
	const finalHeap = await gcHeap();
	console.table(rows);
	console.log(
		JSON.stringify({
			engine: WEBKIT ? 'webkit' : 'chromium',
			mode: `${ANSWER ? 'answer' : 'reasoning'}${OPEN ? ' open' : ' folded'}`,
			deltas: DELTAS,
			perFrame: PER_FRAME,
			wordsPerDelta: WORDS,
			seconds,
			...(cdp
				? { peakHeapMB: +(peak / 1e6).toFixed(1), heapAfterGcMB: +(heapAfterGc / 1e6).toFixed(1), heapAfterTurnMB: +(finalHeap / 1e6).toFixed(1) }
				: { peakFootprintMB: peak, footprintAfterTurnMB: footprintMB() }),
			errors
		})
	);
} finally {
	await browser.close();
	await new Promise((r) => server.httpServer.close(r));
	rmSync(outDir, { recursive: true, force: true });
}
