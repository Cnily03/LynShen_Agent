// Streaming benchmark: a long reasoning block streamed into a real ChatPane
// (production build, tests/browser/perf.html), each delta delivered the way
// the page delivers a daemon frame: in a task of its own, through
// ChatState.handle, then the pane follows the end. Not run in CI (its short
// version is scripts/perf-check.mjs; a long conversation:
// scripts/desk-perf.mjs).
//
//   node scripts/reasoning-perf.mjs [--deltas 20000] [--windows 10] [--per-frame 4] [--words 1]
//                                   [--open] [--answer] [--webkit] [--paint] [--port 1439]
//
// Prints, per window of deltas: the time the deliveries took per delta, the
// time per frame (average and 95th percentile), and in Chromium the main
// thread's task, script and layout time per frame and the JS heap (not
// collected); at the end, the heap after a forced GC. A cost per frame that
// grows from window to window grows with the text's length. Then the turn
// ends: `turnEndMs` is the time to the second frame after it, the time the
// finished message took to show; `turnSettledMs` the time until no part of
// it shows as plain text any more (a long reasoning turns into Markdown
// over frames), and `longestFrameAfterMs` the longest frame from the second
// until then.
//
// --per-frame: deltas per animation frame. --words: words per delta (about
//   4 characters each; more reaches a long text sooner).
// --open: the reader unfolds the reasoning as it starts streaming.
// --answer: stream the deltas as the reply instead of reasoning.
// --webkit: Playwright's WebKit (the engine of the macOS app's web view)
//   instead of Chromium. It has no CDP: memory is the WebContent process's
//   footprint (macOS `footprint`), which WebKit's allocator does not give
//   back when freed, so it shows the peak; and the GPU process's, which
//   holds the compositing layers' backing stores in this WebKit build. Only
//   this run's processes count: those started between its launch and its
//   page's load (one that starts later is another run's, and one that ran
//   before is too). `processPeakMB` is the highest footprint the WebContent process
//   has had, by the kernel's count: above `peakFootprintMB` (the highest
//   while streaming), the turn's end made it. Memory that render frees
//   within the second is gone from `footprintAfterTurnMB` on some runs and
//   not on others; the peak counts it on all.
// --paint (Chromium): also trace each window (devtools.timeline) and print
//   the main thread's PrePaint, Paint and Layerize time per frame. Tracing
//   slows every frame a little: compare runs that all trace, or none.
// --port: the preview server's port (another run may hold 1439).
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
const PAINT = args.includes('--paint') && !WEBKIT;
const PORT = opt('port', 1439);

const outDir = mkdtempSync(resolve(tmpdir(), 'lynshen-perf-'));
const shared = {
	configFile: false,
	logLevel: 'warn',
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: { alias: { $lib: resolve('src/lib') } }
};
await build({ ...shared, build: { outDir, emptyOutDir: true, rollupOptions: { input: resolve('tests/browser/perf.html') } } });
const server = await preview({ ...shared, build: { outDir }, preview: { host: '127.0.0.1', port: PORT, strictPort: true } });
/** The WebKit processes of a kind (WebContent, GPU) running now. */
const webkitPids = (kind) => {
	try {
		return execFileSync('pgrep', ['-f', `ms-playwright/webkit.*${kind}`], { encoding: 'utf8' }).trim().split('\n');
	} catch {
		return []; // none
	}
};
const others = new Set([...webkitPids('WebContent'), ...webkitPids('GPU')]);
const browser = WEBKIT
	? await webkit.launch()
	: await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
/** This run's processes of each kind, set once its page has loaded. */
const mine = { WebContent: [], GPU: [] };
/** This run's processes' footprint, MB (WebKit only); `peak`: the highest
 *  each has had since it started. */
const footprintMB = (kind = 'WebContent', peak = false) => {
	let total = 0;
	for (const pid of mine[kind]) {
		let out;
		try {
			out = execFileSync('footprint', ['-p', pid], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
		} catch {
			continue; // the process has ended
		}
		const m = out.match(peak ? /phys_footprint_peak:\s+([\d.]+)\s+(KB|MB|GB)/ : /Footprint:\s+([\d.]+)\s+(KB|MB|GB)/);
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
	await page.goto(`http://127.0.0.1:${PORT}/tests/browser/perf.html`);
	await page.waitForFunction(() => window.__perf?.ready(), null, { timeout: 15000 });
	if (WEBKIT) for (const kind of ['WebContent', 'GPU']) mine[kind] = webkitPids(kind).filter((p) => !others.has(p));
	const metrics = async () =>
		cdp ? Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])) : {};
	/** Renderer main thread time in each rendering step, ms, from the trace
	 *  since the last call (--paint): an event inside another of its name
	 *  counts once. */
	const STEPS = ['PrePaint', 'Paint', 'Layerize'];
	const traceSteps = async () => {
		const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
		await cdp.send('Tracing.end');
		const { stream } = await done;
		let text = '';
		for (let eof = false; !eof; ) {
			const chunk = await cdp.send('IO.read', { handle: stream, size: 1 << 22 });
			text += chunk.base64Encoded ? Buffer.from(chunk.data, 'base64').toString() : chunk.data;
			eof = chunk.eof;
		}
		await cdp.send('IO.close', { handle: stream });
		const parsed = JSON.parse(text);
		const events = Array.isArray(parsed) ? parsed : parsed.traceEvents;
		const main = new Set(events.filter((e) => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain').map((e) => `${e.pid}:${e.tid}`));
		const ms = Object.fromEntries(STEPS.map((n) => [n, 0]));
		const until = {};
		for (const e of events.filter((e) => e.ph === 'X' && e.name in ms && main.has(`${e.pid}:${e.tid}`)).sort((a, b) => a.ts - b.ts)) {
			const key = `${e.name}:${e.tid}`;
			if (e.ts < (until[key] ?? 0)) continue;
			until[key] = e.ts + e.dur;
			ms[e.name] += e.dur / 1000;
		}
		return ms;
	};
	const startTrace = () =>
		cdp.send('Tracing.start', { traceConfig: { includedCategories: ['devtools.timeline'] }, transferMode: 'ReturnAsStream' });
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
		if (PAINT) await startTrace();
		const { frames, busy, wall } = await feed(per);
		const steps = PAINT ? await traceSteps() : null;
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
				...(steps && Object.fromEntries(STEPS.map((s) => [`${s.toLowerCase()} ms/frame`, +(steps[s] / n).toFixed(2)]))),
				'heap MB': +(after.JSHeapUsedSize / 1e6).toFixed(1)
			});
		} else {
			const mb = footprintMB();
			peak = Math.max(peak, mb);
			row['footprint MB'] = mb;
			row['GPU process MB'] = footprintMB('GPU');
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
	const turnEnd = await page.evaluate(
		() =>
			new Promise((done) => {
				const t = performance.now();
				window.__perf.deliver({ type: 'status', message: 'ready' });
				requestAnimationFrame(() =>
					requestAnimationFrame(() => {
						const shown = performance.now() - t;
						// Then until no part of it shows as plain text, and the
						// longest frame on the way.
						let last = performance.now();
						let longest = 0;
						const frame = (now) => {
							longest = Math.max(longest, now - last);
							last = now;
							const plain = [...document.querySelectorAll('.reason-body .stream')].some((e) => e.textContent);
							if (plain) requestAnimationFrame(frame);
							else done({ shown, settled: performance.now() - t, longest });
						};
						requestAnimationFrame(frame);
					})
				);
			})
	);
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
			turnEndMs: Math.round(turnEnd.shown),
			turnSettledMs: Math.round(turnEnd.settled),
			longestFrameAfterMs: Math.round(turnEnd.longest),
			...(cdp
				? { peakHeapMB: +(peak / 1e6).toFixed(1), heapAfterGcMB: +(heapAfterGc / 1e6).toFixed(1), heapAfterTurnMB: +(finalHeap / 1e6).toFixed(1) }
				: { peakFootprintMB: peak, processPeakMB: footprintMB('WebContent', true), footprintAfterTurnMB: footprintMB(), gpuProcessAfterTurnMB: footprintMB('GPU') }),
			errors
		})
	);
} finally {
	await browser.close();
	await new Promise((r) => server.httpServer.close(r));
	rmSync(outDir, { recursive: true, force: true });
}
