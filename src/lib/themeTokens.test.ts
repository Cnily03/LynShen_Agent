// The colour rules of design.md ("Color", "Surfaces and depth"), held against
// the tokens in app.css and the places that repeat a token's value because
// they paint before app.css is there (app.html, the native window).
import { describe, expect, it } from 'vitest';
import appCss from './app.css?raw';
import html from '../app.html?raw';
import rust from '../../src-tauri/src/main_window.rs?raw';

// Without its comments: they quote token names and numbers.
const css = appCss.replace(/\/\*[\s\S]*?\*\//g, '');

type RGB = [number, number, number];

/** The custom properties declared in the first block that starts with `selector {`. */
function block(selector: string): Record<string, string> {
	const start = css.indexOf(`\n${selector} {`);
	if (start < 0) throw new Error(`no block for ${selector}`);
	const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('\n}', start));
	const vars: Record<string, string> = {};
	for (const [, name, value] of body.matchAll(/(--[\w-]+):\s*([^;]+);/g)) vars[name] = value.trim();
	return vars;
}

function hex(value: string): RGB {
	const m = /^#([0-9a-f]{6})$/i.exec(value);
	if (!m) throw new Error(`not a #rrggbb colour: ${value}`);
	return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as RGB;
}
const linear = (c: number) => (c / 255 <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4);
const luminance = ([r, g, b]: RGB) => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
/** WCAG 2 contrast ratio. */
function contrast(a: RGB, b: RGB) {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}
/** CIE L*. */
function lightness(c: RGB) {
	const y = luminance(c);
	return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}
/** `top` at `alpha` over `under`, as the compositor paints it (sRGB, 8 bits). */
const over = (top: RGB, alpha: number, under: RGB) => top.map((c, i) => Math.round(c * alpha + under[i] * (1 - alpha))) as RGB;

const dark = block(':root');
const light = { ...dark, ...block("[data-theme='light']") };
const themes = { dark, light };
const color = (theme: Record<string, string>, name: string) => hex(theme[name]);

const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];
const TEXT_RULE = { '--text': 12, '--dim': 7, '--dim2': 4.5 };
const STATUS = ['--ok', '--info', '--warn', '--err'];

describe.each(Object.entries(themes))('%s theme', (name, theme) => {
	// design.md measures on --bg and --sidebar. The title bar's title and
	// subtitle sit on --rail, so the rule is kept there too.
	it.each(['--bg', '--sidebar', '--rail'])('text is readable on %s', (surface) => {
		for (const [ink, least] of Object.entries(TEXT_RULE)) expect(contrast(color(theme, ink), color(theme, surface)), `${ink} on ${surface}`).toBeGreaterThanOrEqual(least);
	});

	it('a status colour used as text is readable on each surface and on its own tint', () => {
		for (const status of STATUS)
			for (const surface of ['--bg', '--sidebar', '--panel']) {
				const under = color(theme, surface);
				expect(contrast(color(theme, status), under), `${status} on ${surface}`).toBeGreaterThanOrEqual(4.5);
				// An error surface: the colour at 10–11% over the surface.
				expect(contrast(color(theme, status), over(color(theme, status), 0.11, under)), `${status} on its tint over ${surface}`).toBeGreaterThanOrEqual(4.5);
			}
	});

	it('links and the focus ring stand out on the canvas', () => {
		expect(contrast(color(theme, '--brand-bright'), color(theme, '--bg'))).toBeGreaterThanOrEqual(4.5);
	});

	it('the label on a primary button is readable', () => {
		expect(contrast(color(theme, '--on-accent'), color(theme, '--accent'))).toBeGreaterThanOrEqual(7);
	});

	it(`syntax colours are readable on a code block (${name})`, () => {
		// A code block: --surface over the canvas.
		const [, r, g, b, a] = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(theme['--surface'])!.map(Number);
		const code = over([r, g, b], a, color(theme, '--bg'));
		for (const token of Object.keys(theme).filter((k) => k.startsWith('--cm-') && k !== '--cm-comment' && k !== '--cm-punct'))
			expect(contrast(color(theme, token), code), token).toBeGreaterThanOrEqual(4.5);
	});
});

describe('light theme surfaces', () => {
	const L = (name: string) => lightness(color(light, name));

	it('the canvas is an off-white: L* 95.5–97, a little warm, low in chroma', () => {
		expect(L('--bg')).toBeGreaterThanOrEqual(95.5);
		expect(L('--bg')).toBeLessThanOrEqual(97);
		const [r, g, b] = color(light, '--bg');
		expect(r).toBeGreaterThanOrEqual(g);
		expect(g).toBeGreaterThan(b);
		expect(r - b).toBeLessThanOrEqual(8);
	});

	it('the frame tone is one visible step darker', () => {
		expect(L('--bg') - L('--sidebar')).toBeGreaterThanOrEqual(2);
	});

	it('panels may be lighter than the canvas, up to L* 99: nothing is pure white', () => {
		expect(L('--panel')).toBeGreaterThanOrEqual(L('--bg'));
		expect(L('--panel')).toBeLessThanOrEqual(99);
		for (const surface of ['--bg', '--sidebar', '--rail', '--panel']) expect(light[surface].toLowerCase()).not.toBe('#ffffff');
	});
});

describe('dark theme', () => {
	it('keeps its surfaces and text', () => {
		expect(dark).toMatchObject({ '--bg': '#1a1a1a', '--sidebar': '#141414', '--rail': '#141414', '--divider': '#2a2a2a', '--panel': '#262626', '--text': '#ececec' });
	});
});

// design.md §5, the token table.
describe.each(Object.entries(themes))('the frame and the canvas (%s)', (_, theme) => {
	it('the title bar, the navigator and the tab bars share one frame tone, darker than the canvas', () => {
		expect(theme['--rail']).toBe(theme['--sidebar']);
		expect(lightness(color(theme, '--bg')) - lightness(color(theme, '--rail'))).toBeGreaterThanOrEqual(2);
	});

	it('a divider shows on the canvas and on the frame', () => {
		expect(contrast(color(theme, '--divider'), color(theme, '--bg'))).toBeGreaterThan(1.15);
		expect(contrast(color(theme, '--divider'), color(theme, '--rail'))).toBeGreaterThan(1.15);
	});
});

describe('type, radii and depth', () => {
	it('the type scale and the radii are the design.md steps', () => {
		const px = (names: string[]) => names.map((n) => dark[n]);
		expect(px(['--fs-2xs', '--fs-xs', '--fs-sm', '--fs-md', '--fs-lg', '--fs-xl', '--fs-2xl'])).toEqual(['11px', '12px', '13px', '15px', '18px', '22px', '28px']);
		expect(px(['--r-xs', '--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-2xl', '--r-full'])).toEqual(['2px', '4px', '6px', '8px', '12px', '14px', '999px']);
	});

	it('the frame has no shadow, and the dark theme floats nothing on a blur', () => {
		expect(dark['--shadow-canvas']).toBeUndefined();
		expect(dark['--shadow-float']).toBe('none');
		expect(dark['--shadow-float-strong']).toBe('none');
		expect(light['--shadow-float']).toBe('0 2px 8px rgba(28, 25, 23, 0.05)');
		for (const theme of [dark, light]) expect(theme['--shadow-pop']).toMatch(/^0 0 0 1px var\(--divider\), /);
	});

	it('the interface sets the system UI face first and the display face apart', () => {
		expect(dark['--font-sans']).toMatch(/^-apple-system, BlinkMacSystemFont, 'Segoe UI Variable', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', 'Microsoft YaHei', 'Inter Variable'/);
		expect(dark['--font-display']).toBe("'Noto Serif SC', 'Source Han Serif SC', 'Songti SC', serif");
	});
});

describe('window frost', () => {
	/** The share of a `color-mix(in oklab, var(--token) N%, transparent)` fill. */
	const share = (value: string, token: string) => {
		const m = new RegExp(`^color-mix\\(in oklab, var\\(${token}\\) ([\\d.]+)%, transparent\\)$`).exec(value);
		if (!m) throw new Error(`not a share of ${token}: ${value}`);
		return Number(m[1]) / 100;
	};
	const frostDark = block(":root[data-vibrancy='on']");
	const frost = { dark: frostDark, light: { ...frostDark, ...block("[data-theme='light']:root[data-vibrancy='on']") } };

	describe.each(Object.entries(themes))('%s theme', (name, theme) => {
		const fills = frost[name as keyof typeof frost];
		describe.each([
			['white', WHITE],
			['black', BLACK]
		] as [string, RGB][])('over a %s backdrop', (_, backdrop) => {
			// The window frame's fill is under everything; the sidebar's is over it.
			const chrome = over(color(theme, '--rail'), share(fills['--vibrancy-chrome'], '--rail'), backdrop);
			const sidebar = over(color(theme, '--sidebar'), share(fills['--vibrancy-tint'], '--sidebar'), chrome);

			it('text is readable on the window chrome and on the sidebar', () => {
				for (const [ink, least] of Object.entries(TEXT_RULE)) {
					expect(contrast(color(theme, ink), chrome), `${ink} on the chrome`).toBeGreaterThanOrEqual(least);
					expect(contrast(color(theme, ink), sidebar), `${ink} on the sidebar`).toBeGreaterThanOrEqual(least);
				}
			});

			it('the sidebar keeps its colour', () => {
				expect(Math.abs(lightness(sidebar) - lightness(color(theme, '--sidebar')))).toBeLessThan(1);
			});
		});
	});
});

describe('what paints before app.css', () => {
	it('app.html paints the first frame in each theme’s canvas colour', () => {
		expect(/\n\s*html \{\s*background: (#[0-9a-f]{6});/.exec(html)?.[1]).toBe(dark['--bg']);
		expect(/html\[data-theme='light'\] \{\s*background: (#[0-9a-f]{6});/.exec(html)?.[1]).toBe(light['--bg']);
	});

	it('the phone page’s boot screen and the browser chrome use them too', () => {
		expect(/\.remote-boot #boot \{[^}]*background: (#[0-9a-f]{6});\s*color: (#[0-9a-f]{6});/.exec(html)?.slice(1)).toEqual([dark['--bg'], dark['--text']]);
		expect(/\.remote-boot\[data-theme='light'\] #boot \{\s*background: (#[0-9a-f]{6});\s*color: (#[0-9a-f]{6});/.exec(html)?.slice(1)).toEqual([light['--bg'], light['--text']]);
		expect(/media="\(prefers-color-scheme: light\)" content="(#[0-9a-f]{6})"/.exec(html)?.[1]).toBe(light['--bg']);
		expect(/media="\(prefers-color-scheme: dark\)" content="(#[0-9a-f]{6})"/.exec(html)?.[1]).toBe(dark['--bg']);
	});

	it('the native window starts in them', () => {
		const canvas = (name: string) => {
			const m = new RegExp(`const ${name}: Color = Color\\(0x([0-9a-f]{2}), 0x([0-9a-f]{2}), 0x([0-9a-f]{2}), 0xff\\);`).exec(rust);
			return m ? `#${m[1]}${m[2]}${m[3]}` : null;
		};
		expect(canvas('CANVAS_DARK')).toBe(dark['--bg']);
		expect(canvas('CANVAS_LIGHT')).toBe(light['--bg']);
	});
});
