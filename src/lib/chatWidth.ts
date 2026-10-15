// How wide the conversation column is (design.md, "Workbench canvas"): the
// messages, the composer and the approval card above it share one centred
// column whose width follows the chat pane and the 对话宽度 setting. (The
// plan and subagents cards can move it left: agents/progressCards.ts.)

export const CHAT_WIDTH_MODES = ['auto', 'standard', 'full'] as const;
/** 自适应: a share of the pane, between two bounds. 标准: one fixed width.
 *  铺满: all the pane gives. */
export type ChatWidthMode = (typeof CHAT_WIDTH_MODES)[number];

/** 标准, and the least 自适应 asks for. */
export const CHAT_W_STANDARD = 844;
/** The most 自适应 asks for: about 70 Chinese characters a line. */
export const CHAT_W_MAX = 1120;
/** The share of the pane 自适应 asks for. */
export const CHAT_W_SHARE = 0.75;
/** The column is not narrower than this while the pane can hold it. */
export const CHAT_W_MIN = 640;
/** The room beside the column, each side: the scrollbar and some air. */
export const CHAT_PAD = 32;
/** The same with the turn rail at the left edge. */
export const CHAT_PAD_RAIL = 56;

export const isChatWidthMode = (v: unknown): v is ChatWidthMode => (CHAT_WIDTH_MODES as readonly unknown[]).includes(v);

/**
 * The column's width in px for a chat pane `pane` px wide.
 *
 * `pad` is the room the pane wants beside the column on each side
 * (CHAT_PAD, or CHAT_PAD_RAIL with the turn rail). A pane too narrow for
 * what the setting asks gives the column all it has between the pads. Down
 * to CHAT_W_MIN that is all: under it the rail's wider pad gives way first,
 * to CHAT_PAD and no further, so the column never touches the pane's edges.
 */
export function chatColumnWidth(pane: number, mode: ChatWidthMode, pad: number = CHAT_PAD): number {
	const room = Math.max(0, pane - 2 * pad);
	const asked = mode === 'full' ? room : mode === 'standard' ? CHAT_W_STANDARD : Math.min(CHAT_W_MAX, Math.max(CHAT_W_STANDARD, pane * CHAT_W_SHARE));
	const least = Math.max(0, Math.min(CHAT_W_MIN, pane - 2 * Math.min(pad, CHAT_PAD)));
	return Math.round(Math.max(Math.min(asked, room), least));
}

/** The pad left beside a column `width` px wide: `pad`, or less where the
 *  column kept CHAT_W_MIN (see chatColumnWidth). */
export function chatColumnPad(pane: number, width: number, pad: number = CHAT_PAD): number {
	return Math.max(0, Math.min(pad, Math.floor((pane - width) / 2)));
}
