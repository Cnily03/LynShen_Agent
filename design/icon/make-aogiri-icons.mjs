// Builds the Aogiri icon files from the SVG sources in this folder.
//
//   CHROME="/path/to/Google Chrome for Testing" node design/icon/make-aogiri-icons.mjs
//
// The drawing is the phone app's icon (Aogiri repo, assets/source/icon.svg):
// a warm near-black ground, the ember and its halo. The three SVGs here are
// that drawing as each system wants it:
//
//   aogiri-icon-macos.svg    Apple's template: an 824 px rounded square in the
//                            1024 px canvas, a transparent margin with the soft
//                            shadow. -> src-tauri/icons/icon.icns, icon.png
//   aogiri-icon-rounded.svg  the rounded square filling the canvas (Windows and
//                            Linux add no mask or margin of their own).
//                            -> src-tauri/icons/icon.ico, the other PNGs there,
//                            static/favicon.png
//   aogiri-icon.svg          full bleed, the source as it is (a phone masks it).
//                            -> static/icon-192.png, icon-512.png,
//                            apple-touch-icon.png
//
// The in-app mark, src/lib/aogiri-mark.svg, is the source's mono.svg (the
// ember with its eyes cut out) on a square view box.
//
// Headless Chrome draws each SVG on a transparent page at the size wanted;
// `pnpm tauri icon` cuts the desktop sizes from a 1024 px drawing.
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const chrome = process.env.CHROME ?? process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
if (!chrome) throw new Error('Set CHROME to a Chrome or Chromium executable');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const icons = path.join(root, 'src-tauri/icons');
const web = path.join(root, 'static');
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
      '--default-background-color=00000000',
      '--hide-scrollbars',
      '--no-first-run',
      `--user-data-dir=${path.join(work, 'profile')}`,
      pathToFileURL(page).href
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] }
  );
  if (run.status !== 0) throw new Error(`Chrome could not draw ${svg}: ${run.stderr}`);
  return out;
}

/** `pnpm tauri icon`: every desktop size from one 1024 px PNG, into a folder of its own. */
function cut(png, name) {
  const out = path.join(work, name);
  const run = spawnSync('corepack', ['pnpm', 'tauri', 'icon', png, '-o', out], { cwd: root, stdio: 'inherit' });
  if (run.status !== 0) throw new Error(`tauri icon failed for ${name}`);
  return out;
}

try {
  const mac = cut(draw('aogiri-icon-macos.svg', 1024, path.join(work, 'macos.png')), 'macos');
  const rounded = cut(draw('aogiri-icon-rounded.svg', 1024, path.join(work, 'rounded.png')), 'rounded');
  for (const name of ['icon.icns', 'icon.png']) copyFileSync(path.join(mac, name), path.join(icons, name));
  // Everything else the icons folder holds comes from the rounded square.
  for (const name of readdirSync(icons)) {
    if (name === 'icon.icns' || name === 'icon.png') continue;
    copyFileSync(path.join(rounded, name), path.join(icons, name));
  }
  draw('aogiri-icon-rounded.svg', 32, path.join(web, 'favicon.png'));
  draw('aogiri-icon.svg', 192, path.join(web, 'icon-192.png'));
  draw('aogiri-icon.svg', 512, path.join(web, 'icon-512.png'));
  draw('aogiri-icon.svg', 180, path.join(web, 'apple-touch-icon.png'));
} finally {
  rmSync(work, { recursive: true, force: true });
}
