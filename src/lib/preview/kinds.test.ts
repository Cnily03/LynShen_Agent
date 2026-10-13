import { describe, expect, it } from 'vitest';
import {
	canPreview,
	canRender,
	clipLines,
	codeText,
	dropPreviewTabs,
	formatSize,
	IMAGE_PREVIEW_BYTES,
	jsonlRecords,
	kindByName,
	LINE_MAX,
	MARKDOWN_RENDER_MAX,
	prettyJson,
	previewOf,
	previewPanel,
	previewView,
	textBytesFor,
	TEXT_PREVIEW_BYTES,
	type PreviewFacts
} from './kinds';
import { filePreviews } from './store.svelte';
import { leavesOf, openTab, singleLeafLayout, splitLeaf } from '$lib/workbench/tiles';

const facts = (over: Partial<PreviewFacts> = {}): PreviewFacts => ({
	path: '/Users/me/a.txt',
	size: 12,
	mtime_ms: 1_760_000_000_000,
	is_dir: false,
	binary: false,
	text: 'hello',
	truncated: false,
	lossy: false,
	runs: false,
	...over
});

describe('the allowed-path rule', () => {
	const sent = ['/Users/me/Documents/私聊_墨竹.jsonl', 'C:\\Users\\me\\data.csv', '~/notes.md'];
	it('allows only a path in the clicked message’s list of files', () => {
		for (const path of sent) expect(canPreview(path, sent)).toBe(true);
		expect(canPreview('/etc/passwd', sent)).toBe(false);
		expect(canPreview('/Users/me/Documents', sent)).toBe(false);
		expect(canPreview('/Users/me/Documents/私聊_墨竹.jsonl ', sent)).toBe(false);
		expect(canPreview('/Users/me/Documents/私聊_墨竹.jsonl', [])).toBe(false);
	});
	it('never allows a relative path, even when listed', () => {
		expect(canPreview('notes.md', ['notes.md'])).toBe(false);
		expect(canPreview('../secret', ['../secret'])).toBe(false);
		expect(canPreview('', [''])).toBe(false);
	});
	it('records the click, and nothing for a path not sent', () => {
		expect(filePreviews.open('s1', '/tmp/x.log', ['/tmp/y.log'])).toBe(false);
		expect(filePreviews.asked('/tmp/x.log')).toBe(false);
		expect(filePreviews.request).toBeNull();
		expect(filePreviews.open('s1', '/tmp/y.log', ['/tmp/y.log'])).toBe(true);
		expect(filePreviews.asked('/tmp/y.log')).toBe(true);
		expect(filePreviews.request).toMatchObject({ sessionId: 's1', path: '/tmp/y.log', n: 1 });
		filePreviews.open('s1', '/tmp/y.log', ['/tmp/y.log']);
		expect(filePreviews.request?.n).toBe(2);
	});
});

describe('the file kind', () => {
	it('comes from the name first', () => {
		expect(kindByName('/a/shot.PNG')).toBe('image');
		expect(kindByName('/a/icon.svg')).toBe('image');
		expect(kindByName('/a/报告 2026.pdf')).toBe('pdf');
		expect(kindByName('/a/README.md')).toBe('markdown');
		expect(kindByName('/a/package.json')).toBe('json');
		expect(kindByName('/a/私聊_墨竹.jsonl')).toBe('jsonl');
		expect(kindByName('/a/events.ndjson')).toBe('jsonl');
		expect(kindByName('C:\\a\\销售明细.xlsx')).toBe('binary');
		expect(kindByName('/a/build.zip')).toBe('binary');
		expect(kindByName('/a/main.rs')).toBe('text');
		expect(kindByName('/a/Makefile')).toBe('text');
		expect(kindByName('/a/.env')).toBe('text');
		expect(kindByName('/a/data.csv')).toBe('text');
	});
	it('asks for text only where text is shown', () => {
		expect(textBytesFor('/a/shot.png')).toBe(0);
		expect(textBytesFor('/a/x.pdf')).toBe(0);
		expect(textBytesFor('/a/x.docx')).toBe(0);
		expect(textBytesFor('/a/x.jsonl')).toBe(TEXT_PREVIEW_BYTES);
		expect(textBytesFor('/a/unknown.weird')).toBe(TEXT_PREVIEW_BYTES);
	});
	it('is overruled by the bytes', () => {
		// A ".txt" that is binary is a card; an unknown name that is text is code.
		expect(previewView('/a/x.txt', { facts: facts({ binary: true, text: null }) })).toEqual({ view: 'card', reason: 'binary' });
		expect(previewView('/a/x.weird', { facts: facts({ text: 'plain' }) })).toMatchObject({ view: 'text', kind: 'code', text: 'plain' });
	});
});

describe('the preview states', () => {
	it('loading, missing and failed reads', () => {
		expect(previewView('/a/x.md')).toEqual({ view: 'loading' });
		expect(previewView('/a/x.md', { error: 'missing' })).toEqual({ view: 'missing' });
		expect(previewView('/a/x.md', { error: 'Permission denied (os error 13)' })).toEqual({ view: 'error', message: 'Permission denied (os error 13)' });
	});
	it('text kinds keep the read text and say when it is cut or not UTF-8', () => {
		expect(previewView('/a/x.md', { facts: facts({ text: '# t' }) })).toEqual({ view: 'text', kind: 'markdown', text: '# t', truncated: false, lossy: false });
		expect(previewView('/a/x.json', { facts: facts({ text: '{}', truncated: true }) })).toMatchObject({ kind: 'json', truncated: true });
		expect(previewView('/a/x.jsonl', { facts: facts({ text: '{}', lossy: true }) })).toMatchObject({ kind: 'jsonl', lossy: true });
	});
	it('images, until too large or undecodable', () => {
		expect(previewView('/a/x.png', { facts: facts({ text: null, size: 1000 }) })).toEqual({ view: 'image' });
		expect(previewView('/a/x.png', { facts: facts({ text: null, size: IMAGE_PREVIEW_BYTES + 1 }) })).toEqual({ view: 'card', reason: 'imageTooLarge' });
		expect(previewView('/a/x.png', { facts: facts({ text: null }) }, true)).toEqual({ view: 'card', reason: 'imageFailed' });
	});
	it('cards for PDFs, binaries and folders', () => {
		expect(previewView('/a/x.pdf', { facts: facts({ text: null, binary: true }) })).toEqual({ view: 'card', reason: 'pdf' });
		expect(previewView('/a/x.zip', { facts: facts({ text: null }) })).toEqual({ view: 'card', reason: 'binary' });
		expect(previewView('/a/dir', { facts: facts({ is_dir: true, text: null }) })).toEqual({ view: 'card', reason: 'folder' });
	});
});

describe('text views', () => {
	it('cut lines too long for a code view, and count them', () => {
		const long = 'x'.repeat(LINE_MAX + 10);
		expect(clipLines('short\nlines')).toEqual({ text: 'short\nlines', clipped: 0 });
		const cut = clipLines(`a\n${long}\nb\n${long}`);
		expect(cut.clipped).toBe(2);
		expect(cut.text.split('\n').map((l) => l.length)).toEqual([1, LINE_MAX + 2, 1, LINE_MAX + 2]);
	});
	it('format JSON when it parses, before cutting lines', () => {
		const minified = JSON.stringify({ items: Array.from({ length: 800 }, (_, i) => ({ id: i, name: `item ${i}` })) });
		expect(minified.length).toBeGreaterThan(LINE_MAX);
		const shown = codeText('json', 'rendered', minified);
		expect(shown.formatted).toBe(true);
		expect(shown.clipped).toBe(0);
		expect(shown.text.startsWith('{\n  "items": [')).toBe(true);
		// Its source keeps the one line, cut.
		expect(codeText('json', 'source', minified)).toMatchObject({ formatted: false, clipped: 1 });
		// A cut-off file does not parse: shown as it is.
		expect(codeText('json', 'rendered', '{"a": [1, 2')).toEqual({ text: '{"a": [1, 2', clipped: 0, formatted: false });
		expect(prettyJson('[1,2]')).toBe('[\n  1,\n  2\n]');
		expect(prettyJson('// comment\n{}')).toBeNull();
	});
	it('render Markdown up to a size, JSON and JSON Lines always, code never', () => {
		expect(canRender('markdown', '# t')).toBe(true);
		expect(canRender('markdown', 'x'.repeat(MARKDOWN_RENDER_MAX + 1))).toBe(false);
		expect(canRender('json', '{')).toBe(true);
		expect(canRender('jsonl', '')).toBe(true);
		expect(canRender('code', 'fn main() {}')).toBe(false);
	});
	it('read JSON Lines as one record per line', () => {
		const text = '{"from":"墨竹","text":"在吗"}\n\n{"from":"我"}\r\nnot json\n{"cut":';
		expect(jsonlRecords(text)).toEqual([
			{ line: 1, raw: '{"from":"墨竹","text":"在吗"}', ok: true },
			{ line: 3, raw: '{"from":"我"}', ok: true },
			{ line: 4, raw: 'not json', ok: false },
			{ line: 5, raw: '{"cut":', ok: false }
		]);
		// A file read in part: its last line may be cut off, so it goes.
		expect(jsonlRecords(text, true).map((r) => r.line)).toEqual([1, 3, 4]);
	});
});

describe('formatSize', () => {
	it('reads as people read sizes', () => {
		expect(formatSize(0)).toBe('0 B');
		expect(formatSize(1023)).toBe('1023 B');
		expect(formatSize(12_700)).toBe('12.4 KB');
		expect(formatSize(3_250_000)).toBe('3.1 MB');
		expect(formatSize(250 * 1024 * 1024)).toBe('250 MB');
		expect(formatSize(1.5 * 1024 ** 3)).toBe('1.5 GB');
	});
});

describe('preview tabs', () => {
	it('name their file', () => {
		const path = 'C:\\Users\\me\\私聊 1.jsonl';
		expect(previewOf(previewPanel(path))).toBe(path);
		expect(previewOf('preview:')).toBeNull();
		expect(previewOf('files')).toBeNull();
	});
	it('are dropped from a layout loaded in a later run', () => {
		let layout = singleLeafLayout([{ id: 'chat:s1', panel: 'chat:s1' }]);
		layout = splitLeaf(layout, leavesOf(layout.root)[0]!.id, 'right', { id: 'p1', panel: previewPanel('/a/x.md') }).layout;
		layout = openTab(layout, leavesOf(layout.root)[1]!.id, { id: 'p2', panel: 'git' });
		layout = openTab(layout, leavesOf(layout.root)[1]!.id, { id: 'p3', panel: previewPanel('/a/y.png') });
		const kept = dropPreviewTabs(layout);
		expect(leavesOf(kept.root).flatMap((l) => l.tabs.map((t) => t.panel))).toEqual(['chat:s1', 'git']);
		const none = singleLeafLayout([{ id: 'chat:s1', panel: 'chat:s1' }]);
		expect(dropPreviewTabs(none)).toBe(none);
	});
});
