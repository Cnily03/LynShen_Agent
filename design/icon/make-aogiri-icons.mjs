// Builds the Aogiri icon files from the SVG sources in this folder.
//
//   CHROME="/path/to/Google Chrome for Testing" node design/icon/make-aogiri-icons.mjs
//
// The drawing is the 04 林光 mark (owner's choice, 2026-10-17: variant C):
// two trunks of different height and a separate diagonal light with a short
// gradient, on the warm near-black ground. The phone app's icon is the same
// drawing. The logo kit (~/Desktop/Logo方案/定稿/, logo-work/scripts/kit.py)
// made these sources; sizes up to 32 px are drawn on their own pixel grid
// with the flat light (no gradient), as the brand rules ask:
//
//   aogiri-icon-macos.svg     Apple's template: an 824 px rounded square in the
//                             1024 px canvas, the soft shadow in the margin.
//                             -> src-tauri/icons/icon.icns, icon.png
//   aogiri-icon-macos-16.svg  the 16 and 32 px entries of icon.icns
//   aogiri-icon-macos-32.svg  (is32/s8mk, il32/l8mk, ic11 = 16 pt at 2x)
//   aogiri-icon-rounded.svg   the rounded square filling the canvas (Windows
//                             and Linux add no mask or margin of their own).
//                             -> icon.ico and every other PNG in src-tauri/icons
//   aogiri-icon-16.svg        the 16, 24 and 32 px entries of icon.ico,
//   aogiri-icon-24.svg        32x32.png (Linux), static/favicon.png
//   aogiri-icon-32.svg
//   aogiri-icon.svg           full bleed, as the phone app's icon (a phone masks
//                             it). -> static/icon-192.png, icon-512.png,
//                             apple-touch-icon.png
//   aogiri-icon-maskable.svg  full bleed with the mark in the 80 % safe zone.
//                             -> static/icon-maskable-192.png, -512.png
//   tray-template.svg         the macOS menu bar icon, a template image (black
//                             and clear). -> src-tauri/icons/tray-template.png
//   aogiri-tray.svg           the Windows and Linux tray icon.
//                             -> src-tauri/icons/tray.png
//
// The in-app marks (src/lib/aogiri-mark.svg, aogiri-wordmark.svg,
// aogiri-lockup.svg, lynshen-mark.svg) come from the same kit.
//
// Headless Chrome draws each SVG on a transparent page at the size wanted;
// `pnpm tauri icon` cuts the desktop sizes from a 1024 px drawing, and the
// small entries of icon.ico and icon.icns are then replaced by the drawings
// made for them.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const icons = path.join(root, 'src-tauri/icons');
const web = path.join(root, 'static');

/** Width, height and RGBA pixels of an 8-bit, non-interlaced PNG (what Chrome writes). */
export function decodePng(buf) {
	if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
	let pos = 8;
	let width = 0;
	let height = 0;
	let type = 0;
	const idat = [];
	while (pos < buf.length) {
		const len = buf.readUInt32BE(pos);
		const name = buf.toString('latin1', pos + 4, pos + 8);
		const data = buf.subarray(pos + 8, pos + 8 + len);
		if (name === 'IHDR') {
			width = data.readUInt32BE(0);
			height = data.readUInt32BE(4);
			type = data[9];
			if (data[8] !== 8 || data[12] !== 0 || (type !== 6 && type !== 2)) throw new Error('only 8-bit RGB(A), not interlaced');
		} else if (name === 'IDAT') idat.push(data);
		pos += 12 + len;
	}
	const bpp = type === 6 ? 4 : 3;
	const raw = inflateSync(Buffer.concat(idat));
	const stride = width * bpp;
	const out = Buffer.alloc(width * height * 4);
	let prev = Buffer.alloc(stride);
	for (let y = 0; y < height; y++) {
		const filter = raw[y * (stride + 1)];
		const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
		for (let i = 0; i < stride; i++) {
			const a = i >= bpp ? line[i - bpp] : 0;
			const b = prev[i];
			const c = i >= bpp ? prev[i - bpp] : 0;
			let add = 0;
			if (filter === 1) add = a;
			else if (filter === 2) add = b;
			else if (filter === 3) add = (a + b) >> 1;
			else if (filter === 4) {
				const p = a + b - c;
				const pa = Math.abs(p - a);
				const pb = Math.abs(p - b);
				const pc = Math.abs(p - c);
				add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
			}
			line[i] = (line[i] + add) & 0xff;
		}
		for (let x = 0; x < width; x++) {
			for (let k = 0; k < 3; k++) out[(y * width + x) * 4 + k] = line[x * bpp + k];
			out[(y * width + x) * 4 + 3] = bpp === 4 ? line[x * bpp + 3] : 255;
		}
		prev = line;
	}
	return { width, height, rgba: out };
}

/** Apple's run-length coding of one channel of an is32 / il32 icon. */
export function icnsRle(bytes) {
	const out = [];
	let i = 0;
	while (i < bytes.length) {
		let run = 1;
		while (i + run < bytes.length && run < 130 && bytes[i + run] === bytes[i]) run++;
		if (run >= 3) {
			out.push(0x80 + run - 3, bytes[i]);
			i += run;
			continue;
		}
		const start = i;
		while (i < bytes.length && i - start < 128) {
			if (i + 2 < bytes.length && bytes[i] === bytes[i + 1] && bytes[i] === bytes[i + 2]) break;
			i++;
		}
		out.push(i - start - 1, ...bytes.subarray(start, i));
	}
	return Buffer.from(out);
}

/** The entries of an .icns file, in order: [type, data]. */
export function icnsEntries(buf) {
	if (buf.toString('latin1', 0, 4) !== 'icns') throw new Error('not an icns file');
	const entries = [];
	for (let pos = 8; pos < buf.length; ) {
		const len = buf.readUInt32BE(pos + 4);
		entries.push([buf.toString('latin1', pos, pos + 4), buf.subarray(pos + 8, pos + len)]);
		pos += len;
	}
	return entries;
}

function icnsFile(entries) {
	const parts = entries.map(([type, data]) => {
		const head = Buffer.alloc(8);
		head.write(type, 0, 'latin1');
		head.writeUInt32BE(data.length + 8, 4);
		return Buffer.concat([head, data]);
	});
	const head = Buffer.alloc(8);
	head.write('icns', 0, 'latin1');
	head.writeUInt32BE(8 + parts.reduce((n, p) => n + p.length, 0), 4);
	return Buffer.concat([head, ...parts]);
}

/** icon.icns with its 16 and 32 px entries drawn from the small sources. */
export function patchIcns(buf, png16, png32) {
	const legacy = (png) => {
		const { width, height, rgba } = decodePng(png);
		const n = width * height;
		const channel = (k) => {
			const c = Buffer.alloc(n);
			for (let i = 0; i < n; i++) c[i] = rgba[i * 4 + k];
			return c;
		};
		return { rgb: Buffer.concat([0, 1, 2].map((k) => icnsRle(channel(k)))), mask: channel(3) };
	};
	const s = legacy(png16);
	const l = legacy(png32);
	const swap = { is32: s.rgb, s8mk: s.mask, il32: l.rgb, l8mk: l.mask, ic11: png32 };
	const entries = icnsEntries(buf).map(([type, data]) => [type, swap[type] ?? data]);
	for (const type of Object.keys(swap))
		if (!entries.some(([t]) => t === type)) throw new Error(`icon.icns has no ${type} entry to replace`);
	return icnsFile(entries);
}

/** icon.ico with the entries of the given sizes replaced by PNGs. */
export function patchIco(buf, bySize) {
	const count = buf.readUInt16LE(4);
	const entries = [];
	for (let i = 0; i < count; i++) {
		const e = 6 + 16 * i;
		const size = buf[e] || 256;
		const len = buf.readUInt32LE(e + 8);
		const off = buf.readUInt32LE(e + 12);
		entries.push({ head: Buffer.from(buf.subarray(e, e + 16)), size, data: bySize[size] ?? buf.subarray(off, off + len) });
	}
	for (const size of Object.keys(bySize))
		if (!entries.some((e) => e.size === Number(size))) throw new Error(`icon.ico has no ${size} px entry to replace`);
	let off = 6 + 16 * count;
	for (const e of entries) {
		e.head.writeUInt32LE(e.data.length, 8);
		e.head.writeUInt32LE(off, 12);
		off += e.data.length;
	}
	return Buffer.concat([buf.subarray(0, 6), ...entries.map((e) => e.head), ...entries.map((e) => e.data)]);
}

function main() {
	const chrome = process.env.CHROME ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
	if (!chrome) throw new Error('Set CHROME to a Chrome or Chromium executable');
	const work = mkdtempSync(path.join(tmpdir(), 'aogiri-icons-'));

	/** Draws one of the SVGs at `size` px, transparent around it. */
	function draw(svg, size, out) {
		const data = readFileSync(path.join(here, svg)).toString('base64');
		const page = path.join(work, `${path.basename(out)}.html`);
		writeFileSync(
			page,
			'<!doctype html><style>html,body{margin:0;background:transparent;overflow:hidden}img{display:block}</style>' +
				`<img width="${size}" height="${size}" src="data:image/svg+xml;base64,${data}">`
		);
		const run = spawnSync(
			chrome,
			[
				'--headless=new',
				`--screenshot=${out}`,
				`--window-size=${size},${size}`,
				'--force-device-scale-factor=1',
				'--default-background-color=00000000',
				'--hide-scrollbars',
				'--no-first-run',
				`--user-data-dir=${path.join(work, 'profile')}`,
				pathToFileURL(page).href
			],
			{ stdio: ['ignore', 'ignore', 'pipe'] }
		);
		if (run.status !== 0) throw new Error(`Chrome could not draw ${svg}: ${run.stderr}`);
		const { width, height } = decodePng(readFileSync(out));
		if (width !== size || height !== size) throw new Error(`${svg} came out ${width}×${height}, not ${size}`);
		return out;
	}

	/** `pnpm tauri icon`: every desktop size from one 1024 px PNG, into a folder of its own. */
	function cut(png, name) {
		const out = path.join(work, name);
		const run = spawnSync('corepack', ['pnpm', 'tauri', 'icon', png, '-o', out], { cwd: root, stdio: 'inherit' });
		if (run.status !== 0) throw new Error(`tauri icon failed for ${name}`);
		return out;
	}

	const small = (svg, size) => readFileSync(draw(svg, size, path.join(work, `${path.basename(svg, '.svg')}-${size}.png`)));
	try {
		const mac = cut(draw('aogiri-icon-macos.svg', 1024, path.join(work, 'macos.png')), 'macos');
		const rounded = cut(draw('aogiri-icon-rounded.svg', 1024, path.join(work, 'rounded.png')), 'rounded');
		writeFileSync(
			path.join(icons, 'icon.icns'),
			patchIcns(readFileSync(path.join(mac, 'icon.icns')), small('aogiri-icon-macos-16.svg', 16), small('aogiri-icon-macos-32.svg', 32))
		);
		copyFileSync(path.join(mac, 'icon.png'), path.join(icons, 'icon.png'));
		const ico32 = small('aogiri-icon-32.svg', 32);
		writeFileSync(
			path.join(icons, 'icon.ico'),
			patchIco(readFileSync(path.join(rounded, 'icon.ico')), { 16: small('aogiri-icon-16.svg', 16), 24: small('aogiri-icon-24.svg', 24), 32: ico32 })
		);
		// Every other file `tauri icon` writes that this folder keeps (its
		// android/ and ios/ folders are not used) comes from the rounded square.
		const made = new Set(readdirSync(rounded));
		for (const name of readdirSync(icons)) {
			if (['icon.icns', 'icon.png', 'icon.ico'].includes(name) || !made.has(name)) continue;
			if (!statSync(path.join(rounded, name)).isFile()) continue;
			copyFileSync(path.join(rounded, name), path.join(icons, name));
		}
		writeFileSync(path.join(icons, '32x32.png'), ico32);
		draw('tray-template.svg', 36, path.join(icons, 'tray-template.png'));
		draw('aogiri-tray.svg', 32, path.join(icons, 'tray.png'));
		writeFileSync(path.join(web, 'favicon.png'), ico32);
		draw('aogiri-icon.svg', 192, path.join(web, 'icon-192.png'));
		draw('aogiri-icon.svg', 512, path.join(web, 'icon-512.png'));
		draw('aogiri-icon.svg', 180, path.join(web, 'apple-touch-icon.png'));
		draw('aogiri-icon-maskable.svg', 192, path.join(web, 'icon-maskable-192.png'));
		draw('aogiri-icon-maskable.svg', 512, path.join(web, 'icon-maskable-512.png'));
	} finally {
		rmSync(work, { recursive: true, force: true });
	}
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
