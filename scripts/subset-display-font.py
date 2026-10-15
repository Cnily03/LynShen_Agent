#!/usr/bin/env python3
"""Make the display face (design.md, "Type": --font-display) from Noto Serif SC.

The app sets two display moments in Noto Serif SC 500: the first-run page
title and the empty-conversation greeting. It ships only the glyphs those
lines use, plus printable ASCII, as one small WOFF2:

    src/lib/fonts/noto-serif-sc-display.woff2
    src/lib/fonts/noto-serif-sc-display.chars.txt   (the characters it holds)

src/lib/displayFont.test.ts fails when a display line has a character that
the font does not hold. Then run this script again with the source font and
the new characters:

    curl -LO "https://raw.githubusercontent.com/google/fonts/$REV/ofl/notoserifsc/NotoSerifSC%5Bwght%5D.ttf"
    python3 -I scripts/subset-display-font.py 'NotoSerifSC[wght].ttf' '新的字'

REV is 2e61f4355afd22b801791b0df176065082423b87 (the font's sha256 is
050080d9255a86808f2945bffac582b31ef32bc36411ce29563b4961670c66f9).
Needs fontTools and brotli (pip install fonttools brotli). The font is
under the SIL Open Font License 1.1 (src/lib/fonts/OFL.txt), which allows
a subset; the copyright and licence names are kept in the file.
"""

import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

OUT = Path(__file__).resolve().parent.parent / 'src' / 'lib' / 'fonts'
WOFF2 = OUT / 'noto-serif-sc-display.woff2'
CHARS = OUT / 'noto-serif-sc-display.chars.txt'
ASCII = ''.join(chr(c) for c in range(0x20, 0x7F))


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    source = sys.argv[1]
    extra = ''.join(sys.argv[2:])
    kept = CHARS.read_text(encoding='utf-8') if CHARS.exists() else ''
    chars = ''.join(sorted(set(ASCII + kept + extra) - {'\n'}))

    font = TTFont(source)
    font = instancer.instantiateVariableFont(font, {'wght': 500}, updateFontNames=True)
    options = subset.Options()
    options.flavor = 'woff2'
    options.name_IDs = ['*']
    options.name_languages = ['*']
    options.hinting = False
    options.layout_features = ['kern', 'liga', 'locl', 'palt', 'vert']
    sub = subset.Subsetter(options)
    sub.populate(text=chars)
    sub.subset(font)
    missing = [c for c in chars if ord(c) not in font.getBestCmap()]
    if missing:
        sys.exit(f'the source font has no glyph for: {"".join(missing)!r}')
    font.flavor = 'woff2'
    OUT.mkdir(parents=True, exist_ok=True)
    font.save(WOFF2)
    CHARS.write_text(chars + '\n', encoding='utf-8')
    print(f'{WOFF2.name}: {WOFF2.stat().st_size} bytes, {len(chars)} characters')


if __name__ == '__main__':
    main()
