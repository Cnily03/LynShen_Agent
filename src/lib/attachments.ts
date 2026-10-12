// Files and videos sent with a message. The engine gets them as text after
// what the user typed (it reads paths, not uploads):
//
//   <typed text>
//
//   Attached files (read these):
//   /path/one
//   /path/two
//
//   [视频附件] clip.mp4（时长 12.0 秒）：…
//
// That text is what the engine receives, keeps in its session file and
// echoes back, so the conversation shows it again on every reload. The
// builders here make it (one place for its format) and `splitAttachments`
// takes it apart again for display: the bubble shows what was typed, the
// files and videos show as chips beside it.

const HEADER = 'Attached files (read these):';
const VIDEO_MARK = '[视频附件] ';
const VIDEO_RE =
	/^\[视频附件\] (.+?)（时长 (\d+(?:\.\d+)?) 秒）：已按时间等间隔抽取 (\d+) 个关键帧，随消息以图片附上（按时间先后排序），请结合这些关键帧理解视频内容。$/;

/** A video sent as keyframes: its file name, length in seconds and frame count. */
export interface SentVideo {
	name: string;
	duration: number;
	frames: number;
}

/** A message's text taken apart: what was typed, then what was attached. */
export interface SentParts {
	text: string;
	files: string[];
	videos: SentVideo[];
}

/** `text` with the files listed after it, as the engine reads them. */
export function withFiles(text: string, files: readonly string[]): string {
	if (!files.length) return text;
	return `${text}${text ? '\n\n' : ''}${HEADER}\n${files.join('\n')}`;
}

/** `text` with a video's note after it (its keyframes go as images). */
export function withVideo(text: string, name: string, duration: number, frames: number): string {
	const note = `${VIDEO_MARK}${name}（时长 ${duration.toFixed(1)} 秒）：已按时间等间隔抽取 ${frames} 个关键帧，随消息以图片附上（按时间先后排序），请结合这些关键帧理解视频内容。`;
	return `${text}${text ? '\n\n' : ''}${note}`;
}

/** A line of the file list: an absolute path (POSIX, home, Windows drive or
 *  UNC). Anything else means the text is not a list the app wrote. */
const isPath = (line: string) => /^(?:\/|~[\\/]|[A-Za-z]:[\\/]|\\\\)\S/.test(line);

/** Where the last block that starts with `mark` begins in `text`: after a
 *  blank line, or at the very start. -1 when there is none. */
function blockStart(text: string, mark: string): number {
	const at = text.lastIndexOf(`\n\n${mark}`);
	if (at >= 0) return at + 2;
	return text.startsWith(mark) ? 0 : -1;
}

/**
 * The parts of a sent message: the text the user typed, and the files and
 * videos the app listed after it. Only a list at the very end counts (the
 * files, then any videos), each block starting the text or after a blank
 * line, every file line an absolute path: words the user typed that look
 * like the header stay text. A message with none comes back as it is.
 */
export function splitAttachments(message: string): SentParts {
	const none = { text: message, files: [], videos: [] };
	if (!message.includes(HEADER) && !message.includes(VIDEO_MARK)) return none;
	let rest = message.replace(/\s+$/, '');
	const videos: SentVideo[] = [];
	for (;;) {
		const at = blockStart(rest, VIDEO_MARK);
		if (at < 0) break;
		const m = VIDEO_RE.exec(rest.slice(at));
		if (!m) break;
		videos.unshift({ name: m[1]!, duration: Number(m[2]), frames: Number(m[3]) });
		rest = rest.slice(0, at).replace(/\n\n$/, '');
	}
	let files: string[] = [];
	const at = blockStart(rest, `${HEADER}\n`);
	if (at >= 0) {
		const lines = rest
			.slice(at + HEADER.length + 1)
			.split('\n')
			.map((l) => l.replace(/\r$/, ''));
		if (lines.length && lines.every(isPath)) {
			files = lines;
			rest = rest.slice(0, at).replace(/\n\n$/, '');
		}
	}
	if (!files.length && !videos.length) return none;
	return { text: rest.replace(/\s+$/, ''), files, videos };
}

/** What a message says without its attachment list: the typed text, or the
 *  attached file names when nothing was typed. For one-line previews. */
export function sentLabel(message: string): string {
	const { text, files, videos } = splitAttachments(message);
	if (text || (!files.length && !videos.length)) return text;
	return [...files.map(fileName), ...videos.map((v) => v.name)].join(', ');
}

/** The last part of a path, `/` or `\` separated. */
export function fileName(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, '');
	const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	return trimmed.slice(i + 1) || path;
}

/** The folder a path is in, with its trailing separator dropped. */
export function folderOf(path: string): string {
	const trimmed = path.replace(/[\\/]+$/, '');
	const i = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
	if (i < 0) return '';
	return i === 0 ? trimmed[0]! : trimmed.slice(0, i);
}

/** The text to copy for a sent message: what was typed, then the attached
 *  paths one per line (no header: the reader sees what they are). */
export function copyableText(message: string): string {
	const { text, files, videos } = splitAttachments(message);
	const listed = [...files, ...videos.map((v) => v.name)];
	if (!listed.length) return message;
	return [text, listed.join('\n')].filter(Boolean).join('\n\n');
}
