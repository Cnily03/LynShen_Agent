// The logo in the app (design.md, "Brand marks" and "Launch screen"): the
// light's tokens and their contrast, the launch screen in app.html against
// app.css and launch.ts, the in-app marks, and the icon files that
// design/icon/make-aogiri-icons.mjs writes.
import { describe, expect, it } from 'vitest';
import appCss from './app.css?raw';
import html from '../app.html?raw';
import manifest from '../../static/manifest.webmanifest?raw';
import worker from '../service-worker.ts?raw';
import mark from './aogiri-mark.svg?raw';
import wordmark from './aogiri-wordmark.svg?raw';
import lockup from './aogiri-lockup.svg?raw';
import lynshen from './lynshen-mark.svg?raw';
import trayRust from '../../src-tauri/src/lib.rs?raw';
import { LAUNCH } from './launch';

// Node's own modules (vitest runs on Node; the project has no @types/node).
// @ts-ignore
const { readFileSync } = await import('node:fs');
// @ts-ignore
const { inflateSync } = await import('node:zlib');
type Bytes = Uint8Array & { readUInt32BE(at: number): number; toString(enc: string, a?: number, b?: number): string };
const file = (rel: string): Bytes => readFileSync(new URL(`../../${rel}`, import.meta.url));

const css = appCss.replace(/\/\*[\s\S]*?\*\//g, '');
function block(selector: string): Record<string, string> {
	const start = css.indexOf(`\n${selector} {`);
	const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
	const vars: Record<string, string> = {};
	for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[name] = value.trim();
	return vars;
}
const dark = block(':root');
const light = { ...dark, ...block("[data-theme='light']") };

type RGB = [number, number, number];
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
const lin = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const contrast = (a: string, b: string) => {
	const [hi, lo] = [lum(rgb(a)), lum(rgb(b))].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

describe.each([
	['dark', dark],
	['light', light]
])('the logo light, %s theme', (_, theme) => {
	// Graphics need 3:1 (WCAG 1.4.11): the light against what it sits on.
	it('holds 3:1 on the canvas, as a flat light and at both ends of the gradient', () => {
		for (const name of ['--logo-light', '--logo-light-from', '--logo-light-to', '--lynshen-light'])
			expect(contrast(theme[name], theme['--bg']), name).toBeGreaterThanOrEqual(3);
		expect(contrast(theme['--lynshen-light'], theme['--panel'])).toBeGreaterThanOrEqual(3);
	});
	it('holds 3:1 on the navigator’s --text tile', () => {
		expect(contrast(theme['--logo-light-tile'], theme['--text'])).toBeGreaterThanOrEqual(3);
	});
});

describe('the launch screen in app.html', () => {
	const style = html.slice(html.indexOf('#launch {'), html.indexOf('@media (prefers-reduced-motion: reduce) { .launching #launch'));
	const rule = (selector: string) => {
		const at = style.indexOf(`${selector} {`);
		return style.slice(at, style.indexOf('}', at));
	};
	const prop = (body: string, name: string) => new RegExp(`(?:^|\\s|;)${name}: ([^;]+);`).exec(body)?.[1];

	it('paints each theme’s canvas and text colour, and the light’s gradient', () => {
		const d = rule('.launching #launch');
		const l = rule("[data-theme='light'] #launch");
		expect([prop(d, 'background'), prop(d, 'color'), prop(d, '--l-from'), prop(d, '--l-to')]).toEqual([
			dark['--bg'],
			dark['--text'],
			dark['--logo-light-from'],
			dark['--logo-light-to']
		]);
		expect([prop(l, 'background'), prop(l, 'color'), prop(l, '--l-from'), prop(l, '--l-to')]).toEqual([
			light['--bg'],
			light['--text'],
			light['--logo-light-from'],
			light['--logo-light-to']
		]);
	});

	it('plays the logo kit’s timetable, as long as launch.ts waits for', () => {
		const parts = [...style.matchAll(/animation: (l-[\w-]+) (\d+)ms \S+(?: [\d., ]+\))? (\d+)ms (\w+);/g)];
		// [keyframes, start, length] in ms from the first frame (欢迎页说明.md, timeline.json).
		expect(parts.map((m) => [m[1], Number(m[3]), Number(m[2])])).toEqual([
			['l-rise', 100, 700],
			['l-rise', 260, 700],
			['l-fall', 820, 640],
			['l-glow', 1100, 700],
			['l-word', 1450, 600]
		]);
		// Only the start state is held (before the delay): the end state is
		// the box's own style, so no transform stays on after the entrance.
		for (const [, , , , fill] of parts) expect(fill).toBe('backwards');
		expect(Math.max(...parts.map((m) => Number(m[2]) + Number(m[3])))).toBe(LAUNCH.sequenceMs);
	});

	it('animates transform and opacity only, with no filter', () => {
		const keyframes = [...html.matchAll(/@keyframes l-[\w-]+ \{([^\r\n]*)\}\r?\n/g)].map((m) => m[1]);
		expect(keyframes).toHaveLength(4);
		for (const k of keyframes) for (const [, name] of k.matchAll(/([\w-]+):/g)) expect(['transform', 'opacity']).toContain(name);
		expect(style).not.toMatch(/filter|blur|will-change/);
	});

	it('holds still under reduced motion', () => {
		expect(html).toContain('@media (prefers-reduced-motion: reduce) { .launching #launch * { animation: none !important; } }');
	});

	it('shows only in the desktop app’s main window at /, and goes by itself if the scripts never run', () => {
		expect(html).toMatch(/if \(tauri && location\.pathname === '\/' && \(!label \|\| label === 'main'\)\) \{\s*root\.classList\.add\('launching'\);/);
		// After the cap and its fade, so it never cuts the fade short.
		expect(Number(/\}, (\d+)\);\s*\}\s*\}\)\(\);/.exec(html)?.[1])).toBeGreaterThan(LAUNCH.capMs + LAUNCH.fadeMs);
		expect(html).toMatch(/<div id="launch" aria-hidden="true" data-tauri-drag-region>/);
	});
});

describe('in-app marks', () => {
	it('draw the trunks and letters in the text colour and the light from a token', () => {
		expect(mark).toMatch(/viewBox="0 0 30 30"/);
		expect(mark).toContain('fill:var(--logo-light-tile,');
		expect(lynshen).toMatch(/viewBox="0 0 16 16"/);
		expect(lynshen).toContain('fill:var(--lynshen-light,');
		expect(lockup).toContain('fill:var(--logo-light,');
		for (const svg of [mark, lynshen, lockup, wordmark]) {
			const fills = [...svg.matchAll(/fill="([^"]+)"/g)].map((m) => m[1]);
			expect(new Set(fills)).toEqual(new Set(['currentColor']));
		}
	});
});

/** Width and height of a PNG. */
const size = (png: Bytes) => [png.readUInt32BE(16), png.readUInt32BE(20)];

/** RGBA pixels of an 8-bit RGBA PNG (what Chrome writes). */
function pixels(png: Bytes): number[][] {
	const [w, h] = size(png);
	const parts: Bytes[] = [];
	for (let at = 8; at < png.length; ) {
		const len = png.readUInt32BE(at);
		if (png.toString('latin1', at + 4, at + 8) === 'IDAT') parts.push(png.subarray(at + 8, at + 8 + len) as Bytes);
		at += 12 + len;
	}
	const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	parts.reduce((at, p) => (joined.set(p, at), at + p.length), 0);
	const raw: Uint8Array = inflateSync(joined);
	const out: number[][] = [];
	let prev = new Uint8Array(w * 4);
	for (let y = 0; y < h; y++) {
		const f = raw[y * (w * 4 + 1)];
		const line = raw.slice(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1));
		for (let i = 0; i < line.length; i++) {
			const a = i >= 4 ? line[i - 4] : 0;
			const b = prev[i];
			const c = i >= 4 ? prev[i - 4] : 0;
			const p = a + b - c;
			const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
			line[i] = (line[i] + [0, a, b, (a + b) >> 1, paeth][f]) & 0xff;
		}
		for (let x = 0; x < w; x++) out.push([...line.slice(x * 4, x * 4 + 4)]);
		prev = line;
	}
	return out;
}

describe('icon files (design/icon/make-aogiri-icons.mjs)', () => {
	it('has every desktop size', () => {
		for (const [rel, px] of [
			['src-tauri/icons/32x32.png', 32],
			['src-tauri/icons/128x128.png', 128],
			['src-tauri/icons/128x128@2x.png', 256],
			['src-tauri/icons/icon.png', 512],
			['src-tauri/icons/tray.png', 32],
			['src-tauri/icons/tray-template.png', 36],
			['static/favicon.png', 32],
			['static/apple-touch-icon.png', 180],
			['static/icon-192.png', 192],
			['static/icon-512.png', 512],
			['static/icon-maskable-192.png', 192],
			['static/icon-maskable-512.png', 512]
		] as const)
			expect(size(file(rel)), rel).toEqual([px, px]);
	});

	it('icon.ico holds 16 to 256 px, and its sizes up to 32 px are the pixel-grid drawings', () => {
		const ico = file('src-tauri/icons/icon.ico');
		const dir = new DataView(ico.buffer, ico.byteOffset, ico.byteLength);
		const entries = Array.from({ length: dir.getUint16(4, true) }, (_, i) => {
			const e = 6 + 16 * i;
			const at = dir.getUint32(e + 12, true);
			return { px: ico[e] || 256, data: ico.subarray(at, at + dir.getUint32(e + 8, true)) };
		});
		expect(entries.map((e) => e.px)).toEqual([16, 24, 32, 48, 64, 256]);
		const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i]);
		expect(same(entries[2].data, file('src-tauri/icons/32x32.png'))).toBe(true);
		expect(same(entries[2].data, file('static/favicon.png'))).toBe(true);
	});

	it('icon.icns has its legacy small entries and every PNG size', () => {
		const icns = file('src-tauri/icons/icon.icns');
		expect(icns.toString('latin1', 0, 4)).toBe('icns');
		const types: string[] = [];
		for (let at = 8; at < icns.length; at += icns.readUInt32BE(at + 4)) types.push(icns.toString('latin1', at, at + 4));
		expect(types.sort()).toEqual(['ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14', 'il32', 'is32', 'l8mk', 's8mk']);
	});

	it('the menu bar icon is a template image: black, shaped by its alpha', () => {
		const px = pixels(file('src-tauri/icons/tray-template.png'));
		expect(px.some(([, , , a]) => a === 255)).toBe(true);
		for (const [r, g, b, a] of px) if (a > 0) expect(r + g + b).toBe(0);
		expect(trayRust).toContain('include_image!("icons/tray-template.png")');
		expect(trayRust).toContain('.icon_as_template(true)');
		expect(trayRust).toContain('include_image!("icons/tray.png")');
	});

	it('the phone page manifest names a maskable icon of its own, which the worker caches', () => {
		const icons: { src: string; purpose: string }[] = JSON.parse(manifest).icons;
		const maskable = icons.filter((i) => i.purpose === 'maskable').map((i) => i.src);
		expect(maskable).toEqual(['/icon-maskable-192.png', '/icon-maskable-512.png']);
		const precache = new RegExp(/files\.filter\(\(f\) => (\/.+\/)\.test\(f\)\)/.exec(worker)![1].slice(1, -1));
		for (const src of icons.map((i) => i.src)) expect(precache.test(src), src).toBe(true);
	});
});
