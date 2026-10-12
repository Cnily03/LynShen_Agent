import { describe, expect, it } from 'vitest';
import { copyableText, fileKind, fileName, folderOf, isInside, sentLabel, splitAttachments, withFiles, withVideo } from './attachments';

const VIDEO = (name: string, s: string, n: number) =>
	`[视频附件] ${name}（时长 ${s} 秒）：已按时间等间隔抽取 ${n} 个关键帧，随消息以图片附上（按时间先后排序），请结合这些关键帧理解视频内容。`;

describe('withFiles / withVideo', () => {
	it('write what the engine has always received', () => {
		// The template literals ChatPane and RemoteSession used before.
		const old = (content: string, files: string[]) => `${content}${content ? '\n\n' : ''}Attached files (read these):\n${files.join('\n')}`;
		for (const typed of ['帮我看看谁发的消息更多', '']) {
			for (const files of [['/a.txt'], ['/a.txt', 'C:\\b c\\d.md']]) expect(withFiles(typed, files)).toBe(old(typed, files));
			expect(withFiles(typed, [])).toBe(typed);
		}
		const oldVideo = (content: string, name: string, d: number, n: number) =>
			`${content}${content ? '\n\n' : ''}[视频附件] ${name}（时长 ${d.toFixed(1)} 秒）：已按时间等间隔抽取 ${n} 个关键帧，随消息以图片附上（按时间先后排序），请结合这些关键帧理解视频内容。`;
		expect(withVideo('看看', 'clip.mp4', 12.345, 8)).toBe(oldVideo('看看', 'clip.mp4', 12.345, 8));
		expect(withVideo('', 'clip.mp4', 3, 4)).toBe(oldVideo('', 'clip.mp4', 3, 4));
	});
});

describe('splitAttachments', () => {
	it('takes one file off the typed text (the reported message)', () => {
		const sent = '帮我看看谁发的消息更多\n\nAttached files (read these):\n/Users/chad/Documents/私聊_墨竹.jsonl';
		expect(splitAttachments(sent)).toEqual({
			text: '帮我看看谁发的消息更多',
			files: ['/Users/chad/Documents/私聊_墨竹.jsonl'],
			videos: []
		});
	});

	it('takes several files, with spaces, CJK, Windows and UNC paths', () => {
		const files = ['/Users/me/My Docs/报告 2026.pdf', 'C:\\Users\\me\\Desktop\\a b.txt', 'D:/data/x.csv', '\\\\server\\share\\y.log', '~/notes/z.md'];
		expect(splitAttachments(withFiles('compare these', files))).toEqual({ text: 'compare these', files, videos: [] });
	});

	it('keeps the typed text whole: line breaks, quotes, its own blank lines', () => {
		const typed = '第一段\n\n> 引用的一行\n\n第二段\n  缩进';
		expect(splitAttachments(withFiles(typed, ['/a.txt'])).text).toBe(typed);
	});

	it('reads a message with attachments only', () => {
		expect(splitAttachments(withFiles('', ['/a.txt', '/b.txt']))).toEqual({ text: '', files: ['/a.txt', '/b.txt'], videos: [] });
	});

	it('leaves text without a list as it is', () => {
		for (const text of ['', 'hello', '  spaced  \n', 'Attached files', '路径 /a/b.txt']) expect(splitAttachments(text)).toEqual({ text, files: [], videos: [] });
	});

	it('leaves the header alone when the user typed it in the middle', () => {
		const typed = [
			'See "Attached files (read these):" in the log',
			'note: Attached files (read these):\n/a.txt',
			'Attached files (read these):\n/a.txt\n\nand then explain',
			'foo\n\nAttached files (read these):\nnot a path',
			'foo\n\nAttached files (read these):\n/a.txt\nrelative/b.txt',
			'foo\n\nAttached files (read these):\n'
		];
		for (const text of typed) expect(splitAttachments(text)).toEqual({ text, files: [], videos: [] });
	});

	it('takes only the last list when the typed text quotes an earlier one', () => {
		const typed = 'earlier:\n\nAttached files (read these):\n/old.txt\n\nwhat about it?';
		expect(splitAttachments(withFiles(typed, ['/new.txt']))).toEqual({ text: typed, files: ['/new.txt'], videos: [] });
	});

	it('reads videos after the files, and videos alone', () => {
		let sent = withFiles('看下这个视频', ['/a.txt']);
		sent = withVideo(sent, 'clip one.mp4', 12.34, 8);
		sent = withVideo(sent, '录屏.mov', 3, 4);
		expect(splitAttachments(sent)).toEqual({
			text: '看下这个视频',
			files: ['/a.txt'],
			videos: [
				{ name: 'clip one.mp4', duration: 12.3, frames: 8 },
				{ name: '录屏.mov', duration: 3, frames: 4 }
			]
		});
		expect(splitAttachments(VIDEO('a.mp4', '1.0', 2))).toEqual({ text: '', files: [], videos: [{ name: 'a.mp4', duration: 1, frames: 2 }] });
		// A note the user typed that is not the app's stays text.
		const typed = '[视频附件] 我自己写的';
		expect(splitAttachments(typed)).toEqual({ text: typed, files: [], videos: [] });
	});

	it('tolerates what an engine may do to the end of a message', () => {
		expect(splitAttachments(withFiles('hi', ['/a.txt', '/b.txt']) + '\n  \n').files).toEqual(['/a.txt', '/b.txt']);
		expect(splitAttachments('hi\n\nAttached files (read these):\n/a.txt\r\n/b.txt')).toEqual({ text: 'hi', files: ['/a.txt', '/b.txt'], videos: [] });
	});
});

describe('labels and copy', () => {
	it('names a message by its text, or by its files when it has none', () => {
		expect(sentLabel(withFiles('看看', ['/a/b.txt']))).toBe('看看');
		expect(sentLabel(withFiles('', ['/a/b.txt', 'C:\\x\\y.md']))).toBe('b.txt, y.md');
		expect(sentLabel('plain')).toBe('plain');
	});

	it('copies the typed text and the paths, without the header', () => {
		expect(copyableText(withFiles('看看', ['/a/b.txt', '/c.txt']))).toBe('看看\n\n/a/b.txt\n/c.txt');
		expect(copyableText(withFiles('', ['/a/b.txt']))).toBe('/a/b.txt');
		expect(copyableText('no files')).toBe('no files');
	});

	it('splits names and folders of POSIX and Windows paths', () => {
		expect(fileName('/Users/chad/Documents/私聊_墨竹.jsonl')).toBe('私聊_墨竹.jsonl');
		expect(folderOf('/Users/chad/Documents/私聊_墨竹.jsonl')).toBe('/Users/chad/Documents');
		expect(fileName('C:\\Users\\me\\a b.txt')).toBe('a b.txt');
		expect(folderOf('C:\\Users\\me\\a b.txt')).toBe('C:\\Users\\me');
		expect(fileName('/tmp/dir/')).toBe('dir');
		expect(folderOf('/a.txt')).toBe('/');
		expect(folderOf('a.txt')).toBe('');
	});
});

describe('fileKind', () => {
	it('picks a kind by extension', () => {
		expect(fileKind('/a/私聊_墨竹.jsonl')).toBe('text');
		expect(fileKind('C:\\x\\Report.PDF')).toBe('pdf');
		expect(fileKind('/src/app.svelte')).toBe('code');
		expect(fileKind('/d/sheet.xlsx')).toBe('table');
		expect(fileKind('/d/shot.png')).toBe('image');
		expect(fileKind('/d/Makefile')).toBe('file');
		expect(fileKind('/d/.env')).toBe('file');
		expect(fileKind('/d/folder/')).toBe('folder');
		expect(fileKind('/d/a.unknown')).toBe('file');
	});
});

describe('isInside', () => {
	it('tells files in a folder from files beside it', () => {
		expect(isInside('/p/app/src/a.ts', '/p/app')).toBe(true);
		expect(isInside('/p/app/src/a.ts', '/p/app/')).toBe(true);
		expect(isInside('/p/app-two/a.ts', '/p/app')).toBe(false);
		expect(isInside('/p/app', '/p/app')).toBe(false);
		expect(isInside('C:\\p\\app\\a.ts', 'C:/p/app')).toBe(true);
		expect(isInside('/a.ts', '')).toBe(false);
	});
});
