// The display face holds every character of the two display moments
// (design.md, "Type"): the first-run titles and the empty-conversation
// greeting, in each language. It is a subset (scripts/subset-display-font.py);
// a new or changed display line needs the script run again.
import { describe, expect, it } from 'vitest';
import { catalog } from './i18n/messages';
import chars from './fonts/noto-serif-sc-display.chars.txt?raw';
import appCss from './app.css?raw';

const DISPLAY = ['shell.home.greeting', 'setup.welcome.login.title', 'setup.welcome.agents.title', 'setup.welcome.guide.title'];

function lookup(tree: unknown, key: string): string {
	const value = key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], tree);
	if (typeof value !== 'string') throw new Error(`no string at ${key}`);
	return value;
}

describe('display face', () => {
	it.each(Object.keys(catalog))('holds every character of the display lines (%s)', (locale) => {
		const held = new Set(chars.replace(/\n$/, ''));
		for (const key of DISPLAY) {
			const missing = [...lookup(catalog[locale as keyof typeof catalog], key)].filter((c) => !held.has(c));
			expect(missing.join(''), `${key}: run scripts/subset-display-font.py with these characters`).toBe('');
		}
	});

	it('app.css loads it at weight 500 only', () => {
		const faces = [...appCss.matchAll(/@font-face \{([^}]*)\}/g)].map((m) => m[1]);
		expect(faces).toHaveLength(1);
		expect(faces[0]).toMatch(/font-family: 'Noto Serif SC';/);
		expect(faces[0]).toMatch(/font-weight: 500;/);
		expect(faces[0]).toMatch(/url\('\.\/fonts\/noto-serif-sc-display\.woff2'\)/);
	});
});
