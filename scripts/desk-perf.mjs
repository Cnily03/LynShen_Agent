// Memory and CPU benchmark of the conversation pane (production build,
// tests/browser/perf.html): a long conversation open and idle, a long reply
// streamed into it, and a stretch of activity (turns, switching between
// conversations). Not run in CI (the browser regression has a short check of
// its own); run it before and after a change and compare.
//
//   node scripts/desk-perf.mjs [--turns 500] [--deltas 2000] [--cycles 30]
//                              [--sessions 6] [--webkit] [--port 1441] [--json out.json]
//
// Prints one JSON object:
//   open      the pane showing a conversation of --turns turns: time to show
//             it (ms), JS heap after GC (MB), DOM nodes, event listeners;
//             WebKit: the WebContent process's footprint (MB)
//   idle      10 s with nothing happening, then 10 s of a turn waiting for
//             the model (no output): main-thread busy time per second (ms/s),
//             timers and animation frames fired per second
//   stream    --deltas deltas (half reasoning, half reply, 4 a frame) into
//             the end of it: script time per delta, frame mean and p95, long
//             tasks (> 50 ms), the heap's peak and its growth after GC
//   activity  --cycles cycles of: one turn streamed with tool calls, show
//             another of --sessions conversations and back; the heap after
//             GC at the start and the end, per cycle, and DOM nodes and
//             listeners left over
import { resolve } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { build, preview } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium, webkit } from '@playwright/test';

const args = process.argv.slice(2);
const opt = (name, def) => {
	const i = args.indexOf(`--${name}`);
	return i < 0 ? def : Number(args[i + 1]);
};
const TURNS = opt('turns', 500);
const DELTAS = opt('deltas', 2000);
const CYCLES = opt('cycles', 30);
const SESSIONS = opt('sessions', 6);
const WEBKIT = args.includes('--webkit');
const PORT = opt('port', 1441);
const jsonAt = args.indexOf('--json');
const JSON_OUT = jsonAt < 0 ? null : args[jsonAt + 1];

const outDir = mkdtempSync(resolve(tmpdir(), 'lynshen-deskperf-'));
const shared = {
	configFile: false,
	logLevel: 'warn',
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: { alias: { $lib: resolve('src/lib') } }
};
await build({ ...shared, build: { outDir, emptyOutDir: true, rollupOptions: { input: resolve('tests/browser/perf.html') } } });
const server = await preview({ ...shared, build: { outDir }, preview: { host: '127.0.0.1', port: PORT, strictPort: true } });

const webkitPids = (kind) => {
	try {
		return execFileSync('pgrep', ['-f', `ms-playwright/webkit.*${kind}`], { encoding: 'utf8' }).trim().split('\n');
	} catch {
		return [];
	}
};
const others = new Set(webkitPids('WebContent'));
let mine = [];
const footprintMB = (peak = false) => {
	let total = 0;
	for (const pid of mine) {
		let out;
		try {
			out = execFileSync('footprint', ['-p', pid], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
		} catch {
			continue;
		}
		const m = out.match(peak ? /phys_footprint_peak:\s+([\d.]+)\s+(KB|MB|GB)/ : /Footprint:\s+([\d.]+)\s+(KB|MB|GB)/);
		if (m) total += Number(m[1]) * (m[2] === 'GB' ? 1024 : m[2] === 'KB' ? 1 / 1024 : 1);
	}
	return +total.toFixed(1);
};

const browser = WEBKIT ? await webkit.launch() : await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH });
const result = { engine: WEBKIT ? 'webkit' : 'chromium', turns: TURNS, deltas: DELTAS, cycles: CYCLES, sessions: SESSIONS };
try {
	const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
	const errors = [];
	page.on('pageerror', (e) => errors.push(e.message));
	// Counts the timers and animation frames that fire, and long tasks.
	await page.addInitScript(() => {
		const c = (window.__counts = { timeouts: 0, intervals: 0, frames: 0, longTasks: [] });
		const st = window.setTimeout;
		const si = window.setInterval;
		const raf = window.requestAnimationFrame;
		window.setTimeout = (f, ...a) => st((...x) => (c.timeouts++, typeof f === 'function' ? f(...x) : undefined), ...a);
		window.setInterval = (f, ...a) => si((...x) => (c.intervals++, typeof f === 'function' ? f(...x) : undefined), ...a);
		window.requestAnimationFrame = (f) => raf((t) => (c.frames++, f(t)));
		try {
			new PerformanceObserver((l) => l.getEntries().forEach((e) => c.longTasks.push(e.duration))).observe({ type: 'longtask', buffered: false });
		} catch {
			/* WebKit: none */
		}
	});
	const cdp = WEBKIT ? null : await page.context().newCDPSession(page);
	await cdp?.send('Performance.enable');
	await page.goto(`http://127.0.0.1:${PORT}/tests/browser/perf.html?defer`);
	await page.waitForFunction(() => window.__perf, null, { timeout: 30000 });
	if (WEBKIT) mine = webkitPids('WebContent').filter((p) => !others.has(p));
	const metrics = async () => (cdp ? Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value])) : {});
	const gc = async () => {
		if (cdp) {
			await cdp.send('HeapProfiler.collectGarbage');
			await cdp.send('HeapProfiler.collectGarbage');
			const heap = (await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6;
			const dom = await cdp.send('Memory.getDOMCounters');
			return { heapMB: +heap.toFixed(1), nodes: dom.nodes, listeners: dom.jsEventListeners };
		}
		await page.waitForTimeout(500);
		const nodes = await page.evaluate(() => document.getElementsByTagName('*').length);
		return { footprintMB: footprintMB(), elements: nodes };
	};
	const frames2 = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
	const counts = () => page.evaluate(() => ({ ...window.__counts, longTasks: window.__counts.longTasks.length }));
	const reset = () => page.evaluate(() => Object.assign(window.__counts, { timeouts: 0, intervals: 0, frames: 0, longTasks: [] }));

	// ── open: a long conversation shown ──────────────────────────────────
	const before = await gc();
	await page.evaluate((n) => window.__perf.seed(n), TURNS);
	const seeded = await gc();
	const t0 = Date.now();
	await page.evaluate(() => window.__perf.show(0));
	await page.waitForFunction(() => window.__perf.ready(), null, { timeout: 60000 });
	await frames2();
	const showMs = Date.now() - t0;
	await page.waitForTimeout(1500);
	const open = await gc();
	result.open = { showMs, empty: before, held: seeded, shown: open, messages: await page.evaluate(() => window.__perf.chat().messages.length) };

	// ── idle ─────────────────────────────────────────────────────────────
	const idleFor = async (ms) => {
		await reset();
		const a = await metrics();
		await page.waitForTimeout(ms);
		const b = await metrics();
		const c = await counts();
		const s = ms / 1000;
		return {
			...(cdp ? { busyMsPerS: +(((b.TaskDuration - a.TaskDuration) * 1000) / s).toFixed(2), scriptMsPerS: +(((b.ScriptDuration - a.ScriptDuration) * 1000) / s).toFixed(2) } : {}),
			timersPerS: +((c.timeouts + c.intervals) / s).toFixed(1),
			framesPerS: +(c.frames / s).toFixed(1)
		};
	};
	result.idle = { settled: await idleFor(10000) };
	await page.evaluate(() => {
		const P = window.__perf;
		P.deliver({ type: 'user_message', content: '再想一想' });
		P.deliver({ type: 'connecting' });
		P.deliver({ type: 'status', message: 'streaming' });
	});
	result.idle.waiting = await idleFor(10000);

	// ── stream: a long reply into the end of it ──────────────────────────
	const feed = (n, type, per = 4) =>
		page.evaluate(
			({ n, type, per }) =>
				new Promise((done) => {
					const words = ['我们', '需要', '考虑', '这个', '函数', 'the cache', '边界', '情况', 'returns', '**注意**', '`buf.len()`', '然后', 'maybe', '检查', '一下', '。'];
					let seed = 7;
					const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed / 0x7fffffff);
					const word = () => {
						const r = rnd();
						if (r < 0.02) return '\n\n';
						if (r < 0.025) return '\n- ';
						return words[Math.floor(rnd() * words.length)] + (rnd() < 0.3 ? ' ' : '');
					};
					const ch = new MessageChannel();
					let left = n;
					let busy = 0;
					ch.port1.onmessage = () => {
						const t = performance.now();
						window.__perf.deliver({ type, delta: word() + word() });
						busy += performance.now() - t;
					};
					const frames = [];
					let last = performance.now();
					const frame = (now) => {
						frames.push(now - last);
						last = now;
						if (left <= 0) return done({ frames, busy });
						for (let i = 0; i < per && left > 0; i++, left--) ch.port2.postMessage(0);
						requestAnimationFrame(frame);
					};
					requestAnimationFrame(frame);
				}),
			{ n, type, per }
		);
	const pre = await gc();
	await reset();
	await page.evaluate(() => window.__perf.deliver({ type: 'thinking_start' }));
	let peak = 0;
	const streamed = [];
	const half = Math.floor(DELTAS / 2);
	for (const [type, n] of [['reasoning_delta', half], ['assistant_delta', DELTAS - half]]) {
		for (let done = 0; done < n; done += 250) {
			streamed.push(await feed(Math.min(250, n - done), type));
			const m = await metrics();
			peak = Math.max(peak, cdp ? m.JSHeapUsedSize / 1e6 : footprintMB());
		}
	}
	await page.evaluate(() => window.__perf.deliver({ type: 'status', message: 'ready' }));
	await frames2();
	await page.waitForTimeout(1000);
	const frames = streamed.flatMap((s) => s.frames).sort((a, b) => a - b);
	const post = await gc();
	const c = await counts();
	result.stream = {
		deliverMsPerDelta: +(streamed.reduce((a, s) => a + s.busy, 0) / DELTAS).toFixed(3),
		frameMean: +(frames.reduce((a, b) => a + b, 0) / frames.length).toFixed(1),
		frameP95: +frames[Math.floor(frames.length * 0.95)].toFixed(1),
		framesOver50: frames.filter((f) => f > 50).length,
		longTasks: c.longTasks,
		peak: +peak.toFixed(1),
		before: pre,
		after: post
	};

	// ── activity: turns and switching conversations ─────────────────────
	await page.evaluate(({ n, turns }) => window.__perf.addSessions(n, turns), { n: SESSIONS - 1, turns: 100 });
	await page.waitForTimeout(500);
	const start = await gc();
	const samples = [];
	for (let k = 0; k < CYCLES; k++) {
		await page.evaluate((k) => {
			const P = window.__perf;
			P.deliver({ type: 'user_message', content: `第 ${k} 次：继续` });
			P.deliver({ type: 'status', message: 'streaming' });
			P.deliver({ type: 'thinking_start' });
		}, k);
		await feed(60, 'reasoning_delta');
		await page.evaluate((k) => {
			const P = window.__perf;
			for (let j = 0; j < 3; j++) {
				const id = `a${k}-${j}`;
				P.deliver({ type: 'tool_start', call_id: id, name: 'bash' });
				P.deliver({ type: 'tool_output', call_id: id, name: 'bash', output: JSON.stringify({ command: 'pnpm test', exit_code: 0, stdout: 'ok\n'.repeat(400), stderr: '' }) });
			}
		}, k);
		await feed(120, 'assistant_delta');
		await page.evaluate(() => window.__perf.deliver({ type: 'status', message: 'ready' }));
		await frames2();
		// Another conversation, then back.
		await page.evaluate((i) => window.__perf.show(i), 1 + (k % (SESSIONS - 1)));
		await page.waitForFunction(() => window.__perf.ready(), null, { timeout: 60000 });
		await frames2();
		await page.evaluate(() => window.__perf.show(0));
		await page.waitForFunction(() => window.__perf.ready(), null, { timeout: 60000 });
		await frames2();
		if ((k + 1) % 10 === 0) samples.push(await gc());
	}
	const end = await gc();
	const key = cdp ? 'heapMB' : 'footprintMB';
	result.activity = { start, end, samples, perCycleMB: +((end[key] - start[key]) / CYCLES).toFixed(3) };
	if (WEBKIT) result.processPeakMB = footprintMB(true);
	result.errors = errors;
} finally {
	await browser.close();
	await new Promise((r) => server.httpServer.close(r));
	rmSync(outDir, { recursive: true, force: true });
}
console.log(JSON.stringify(result, null, 1));
if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(result, null, 1));
