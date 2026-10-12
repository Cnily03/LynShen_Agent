import { describe, expect, it } from 'vitest';
import { fileUris, imageExt, pasteRoute } from './paste';

const paste = (over: Partial<Parameters<typeof pasteRoute>[0]>) => pasteRoute({ text: '', uriList: '', files: [], ...over });

describe('pasteRoute', () => {
	it('takes files copied in Explorer or Finder (bytes, no text) as files', () => {
		expect(paste({ files: [{ type: '' }] })).toBe('files');
		expect(paste({ files: [{ type: 'application/json' }, { type: 'text/plain' }] })).toBe('files');
	});

	it('takes an image as files, as before, even with text beside it', () => {
		expect(paste({ files: [{ type: 'image/png' }] })).toBe('files');
		// Office copies offer text and a picture of it; the picture won before too.
		expect(paste({ text: 'A1\tB1', files: [{ type: 'image/png' }] })).toBe('files');
	});

	it('takes a file list in text/uri-list as files', () => {
		expect(paste({ text: '/home/me/a.txt', uriList: 'file:///home/me/a.txt\r\n' })).toBe('files');
	});

	it('takes plain text as text', () => {
		expect(paste({ text: 'hello' })).toBe('text');
		expect(paste({ text: 'https://example.com', uriList: 'https://example.com' })).toBe('text');
		expect(paste({ text: '/Users/me/a.txt' })).toBe('text');
	});

	it('asks the system clipboard when the page sees nothing', () => {
		expect(paste({})).toBe('clipboard');
	});
});

describe('fileUris', () => {
	it('decodes file URLs, POSIX and Windows, with spaces and CJK', () => {
		const list = [
			'# copied by the file manager',
			'file:///home/me/My%20Docs/%E7%A7%81%E8%81%8A_%E5%A2%A8%E7%AB%B9.jsonl',
			'file://localhost/tmp/a.txt',
			'file:///C:/Users/me/report%20final.pdf',
			'https://example.com/x',
			'file://otherhost/share/y.txt',
			'',
			'file:///tmp/a.txt'
		].join('\r\n');
		expect(fileUris(list)).toEqual(['/home/me/My Docs/私聊_墨竹.jsonl', '/tmp/a.txt', 'C:/Users/me/report final.pdf']);
	});

	it('ignores what is not a list of files', () => {
		expect(fileUris('')).toEqual([]);
		expect(fileUris('just text')).toEqual([]);
		expect(fileUris('file:///bad%E0%A4%A.txt')).toEqual([]);
	});
});

describe('imageExt', () => {
	it('names a pasted image by its MIME subtype, as before', () => {
		expect(imageExt('image/png')).toBe('png');
		expect(imageExt('image/jpeg')).toBe('jpeg');
		expect(imageExt('image/svg+xml')).toBe('svgxml');
		expect(imageExt('image/')).toBe('png');
	});
});
