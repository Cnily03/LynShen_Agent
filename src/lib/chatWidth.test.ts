import { describe, expect, it } from 'vitest';
import { CHAT_PAD, CHAT_PAD_RAIL, CHAT_WIDTH_MODES, chatColumnPad, chatColumnWidth, isChatWidthMode } from './chatWidth';

// The chat pane of a window `w` px wide with the navigator at its default 292px.
const pane = (w: number) => w - 292;

describe('chatColumnWidth', () => {
	it('自适应 takes 75% of the pane', () => {
		// The report's window: 1720 wide.
		expect(chatColumnWidth(pane(1720), 'auto')).toBe(1071);
		expect(chatColumnWidth(1300, 'auto')).toBe(975);
	});

	it('自适应 is at least 844px where the pane has room', () => {
		expect(chatColumnWidth(pane(1280), 'auto')).toBe(844);
		// 75% would be 681px; 844px and its pads just fit.
		expect(chatColumnWidth(908, 'auto')).toBe(844);
		expect(chatColumnWidth(1125, 'auto')).toBe(844);
		expect(chatColumnWidth(1128, 'auto')).toBe(846);
	});

	it('自适应 is at most 1120px', () => {
		expect(chatColumnWidth(1493, 'auto')).toBe(1120);
		expect(chatColumnWidth(1494, 'auto')).toBe(1120);
		expect(chatColumnWidth(pane(2560), 'auto')).toBe(1120);
		expect(chatColumnWidth(5000, 'auto')).toBe(1120);
	});

	it('标准 is 844px whatever the pane', () => {
		for (const w of [1280, 1720, 2560, 3840]) expect(chatColumnWidth(pane(w), 'standard')).toBe(844);
	});

	it('铺满 is the pane less its pads', () => {
		expect(chatColumnWidth(pane(1720), 'full')).toBe(1364);
		expect(chatColumnWidth(pane(1280), 'full')).toBe(924);
		expect(chatColumnWidth(pane(1720), 'full', CHAT_PAD_RAIL)).toBe(1316);
	});

	it('a narrow pane gives the column all it has between the pads, in every setting', () => {
		for (const mode of CHAT_WIDTH_MODES) {
			expect(chatColumnWidth(900, mode)).toBe(836);
			// The smallest window, 1040 wide.
			expect(chatColumnWidth(pane(1040), mode)).toBe(684);
			expect(chatColumnWidth(704, mode)).toBe(640);
			// Beside a tool panel: narrower than 640px and its pads.
			expect(chatColumnWidth(573, mode)).toBe(509);
		}
	});

	it('the rail’s wider pad gives way before the column goes under 640px', () => {
		for (const mode of CHAT_WIDTH_MODES) {
			expect(chatColumnWidth(800, mode, CHAT_PAD_RAIL)).toBe(688);
			expect(chatColumnWidth(752, mode, CHAT_PAD_RAIL)).toBe(640);
			// 636px with the rail's pads: the smallest window keeps 640px.
			expect(chatColumnWidth(pane(1040), mode, CHAT_PAD_RAIL)).toBe(640);
			expect(chatColumnWidth(704, mode, CHAT_PAD_RAIL)).toBe(640);
			// Under that the ordinary pad stays.
			expect(chatColumnWidth(700, mode, CHAT_PAD_RAIL)).toBe(636);
			expect(chatColumnWidth(573, mode, CHAT_PAD_RAIL)).toBe(509);
		}
	});

	it('never exceeds the pane and never shrinks as the pane grows', () => {
		for (const mode of CHAT_WIDTH_MODES)
			for (const pad of [CHAT_PAD, CHAT_PAD_RAIL]) {
				let last = 0;
				for (let w = 0; w <= 4000; w += 7) {
					const col = chatColumnWidth(w, mode, pad);
					expect(col).toBeGreaterThanOrEqual(last);
					expect(col).toBeLessThanOrEqual(Math.max(0, w - 2 * CHAT_PAD));
					last = col;
				}
			}
	});

	it('is a whole number of pixels, and 0 before the pane is measured', () => {
		expect(chatColumnWidth(1333, 'auto')).toBe(1000);
		expect(chatColumnWidth(0, 'auto')).toBe(0);
		expect(chatColumnWidth(0, 'full')).toBe(0);
		expect(chatColumnWidth(40, 'standard')).toBe(0);
	});
});

describe('chatColumnPad', () => {
	it('is the pad the pane asked for when the column leaves it', () => {
		expect(chatColumnPad(pane(1720), 1071)).toBe(32);
		expect(chatColumnPad(900, 836)).toBe(32);
		expect(chatColumnPad(800, 688, CHAT_PAD_RAIL)).toBe(56);
	});

	it('is what is left where the column kept 640px', () => {
		expect(chatColumnPad(pane(1040), 640, CHAT_PAD_RAIL)).toBe(54);
		expect(chatColumnPad(704, 640, CHAT_PAD_RAIL)).toBe(32);
	});

	it('with the column, never exceeds the pane', () => {
		for (const mode of CHAT_WIDTH_MODES)
			for (const pad of [CHAT_PAD, CHAT_PAD_RAIL])
				for (let w = 0; w <= 2000; w += 3) {
					const col = chatColumnWidth(w, mode, pad);
					const side = chatColumnPad(w, col, pad);
					expect(col + 2 * side).toBeLessThanOrEqual(w);
					if (w >= 2 * CHAT_PAD) expect(side).toBeGreaterThanOrEqual(CHAT_PAD);
				}
	});
});

describe('isChatWidthMode', () => {
	it('accepts the three settings only', () => {
		expect(CHAT_WIDTH_MODES.every(isChatWidthMode)).toBe(true);
		// The old preference was a number of pixels.
		for (const v of [844, '844', 'wide', null, undefined]) expect(isChatWidthMode(v)).toBe(false);
	});
});
