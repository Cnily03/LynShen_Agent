// Files the `?shell&preview` window's messages were sent with, as the app's
// `preview_file` command reads them (src-tauri/src/file_preview.rs), and
// the image the asset protocol would serve. One file is gone.

const NOW = Date.parse('2026-10-13T09:42:00+08:00');

const CODE = `// The conversation column's width (design.md, "Workbench canvas"): a share of
// the chat pane between a floor and a cap, or one of two fixed choices.

export type ChatWidthMode = 'auto' | 'standard' | 'full';

export const CHAT_W_STANDARD = 844;
export const CHAT_W_MAX = 1120;
export const CHAT_W_MIN = 640;
export const CHAT_W_SHARE = 0.75;
export const CHAT_PAD = 28;

/** The column's width in a pane \`pane\` px wide. */
export function chatColumnWidth(pane: number, mode: ChatWidthMode, pad: number = CHAT_PAD): number {
	const room = Math.max(0, pane - 2 * pad);
	const asked =
		mode === 'full'
			? room
			: mode === 'standard'
				? CHAT_W_STANDARD
				: Math.min(CHAT_W_MAX, Math.max(CHAT_W_STANDARD, pane * CHAT_W_SHARE));
	const least = Math.max(0, Math.min(CHAT_W_MIN, pane - 2 * Math.min(pad, CHAT_PAD)));
	return Math.round(Math.max(Math.min(asked, room), least));
}

/** The padding left on each side of the column. */
export function chatColumnPad(pane: number, width: number, pad: number = CHAT_PAD): number {
	return Math.max(pad, Math.floor((pane - width) / 2));
}
`;

const PEOPLE = ['墨竹', '我'];
const LINES = [
	'在吗？下午的评审改到三点了',
	'收到，我把 PPT 再过一遍',
	'第 12 页的数字和表格对不上，你看一下',
	'是口径问题，表格按周活，报告按月活',
	'那统一成月活吧，脚注里写清楚',
	'好，我今晚改完发你',
	'顺便把附录里的截图换成新版的',
	'截图在共享盘「评审/2026Q3」里',
	'找到了，谢谢',
	'明天早上我们再对一遍？'
];
const JSONL = Array.from({ length: 1284 }, (_, i) =>
	JSON.stringify({
		id: 90210 + i,
		time: new Date(NOW - (1284 - i) * 97_000).toISOString(),
		from: PEOPLE[i % 2],
		text: LINES[i % LINES.length],
		...(i % 7 === 3 ? { reply_to: 90210 + i - 1 } : {}),
		...(i % 11 === 5 ? { attachments: [{ kind: 'image', name: `IMG_${4100 + i}.jpg`, size: 1_204_331 + i }] } : {})
	})
).join('\n');

const MARKDOWN = `# 指标口径

三份材料里的「活跃用户」口径不同，评审前统一为**月活**。

| 材料 | 现口径 | 改为 |
| --- | --- | --- |
| 2026 Q3 经营分析.pdf | 月活 | 月活 |
| 销售明细.xlsx | 周活 | 月活 |
| metrics.md | 日活 | 月活 |

## 计算方法

1. 以自然月为窗口。
2. 同一账号多端登录算一个。

\`\`\`sql
select count(distinct account_id) from events where ts >= date_trunc('month', now());
\`\`\`
`;

type Entry = { text?: string; size?: number; binary?: boolean; is_dir?: boolean; runs?: boolean; missing?: boolean; mtime?: number };

const FILES: Record<string, Entry> = {
	'/Users/me/code/lynshen-desktop/src/lib/chatWidth.ts': { text: CODE, mtime: NOW - 3_600_000 },
	'/Users/me/Documents/私聊_墨竹.jsonl': { text: JSONL, mtime: NOW - 86_400_000 },
	'/Users/me/code/lynshen-desktop/docs/metrics.md': { text: MARKDOWN, mtime: NOW - 7_200_000 },
	'/Users/me/Desktop/评审截图 2026-10-13.png': { size: 412_331, binary: true, mtime: NOW - 600_000 },
	'/Users/me/Downloads/lynshen-desktop-0.5.1.zip': { size: 48_213_766, binary: true, mtime: NOW - 172_800_000 },
	'/Users/me/Documents/季度报告/2026 Q3 经营分析.pdf': { size: 3_284_112, binary: true, mtime: NOW - 259_200_000 },
	'/Users/me/Downloads/error-log-1013.txt': { missing: true }
};

export const PREVIEW_FILES = Object.keys(FILES);

export function previewFacts(path: string, maxBytes: number) {
	const f = FILES[path];
	if (!f || f.missing) throw 'missing';
	const bytes = f.text !== undefined ? new TextEncoder().encode(f.text).length : (f.size ?? 0);
	const text = f.text !== undefined && maxBytes > 0 ? f.text : null;
	return {
		path,
		size: bytes,
		mtime_ms: f.mtime ?? NOW,
		is_dir: !!f.is_dir,
		binary: !!f.binary,
		text,
		truncated: false,
		lossy: false,
		runs: !!f.runs
	};
}

/** A stand-in screenshot, drawn once, for the asset URL of the PNG above. */
let drawn = '';
export function imageSrc(): string {
	if (drawn) return drawn;
	const canvas = document.createElement('canvas');
	canvas.width = 1440;
	canvas.height = 900;
	const g = canvas.getContext('2d')!;
	const sky = g.createLinearGradient(0, 0, 1440, 900);
	sky.addColorStop(0, '#2f4858');
	sky.addColorStop(1, '#86bbd8');
	g.fillStyle = sky;
	g.fillRect(0, 0, 1440, 900);
	g.fillStyle = '#f6f5f2';
	g.fillRect(120, 110, 1200, 680);
	g.fillStyle = '#e4e1da';
	g.fillRect(120, 110, 1200, 56);
	g.fillStyle = '#33658a';
	const bars = [220, 340, 290, 460, 410, 520, 600];
	bars.forEach((h, i) => g.fillRect(220 + i * 150, 740 - h, 90, h));
	g.fillStyle = '#1a1a1a';
	g.font = '600 34px sans-serif';
	g.fillText('2026 Q3 月活', 160, 150);
	drawn = canvas.toDataURL('image/png');
	return drawn;
}
