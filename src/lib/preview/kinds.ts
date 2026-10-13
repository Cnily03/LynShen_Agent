// A file a sent message names, previewed in a tab beside the conversation
// (FilePreview.svelte), the way Codex, OpenCode and ZCode open a clicked
// file in their side panel. This module is the pure part: which paths may
// be read, how much, and what the tab shows for what it read.

import { closeTab, leavesOf, type TileLayout } from '$lib/workbench/tiles';

const PREFIX = 'preview:';

/** The panel (and tab) of a file's preview: one tab per file. */
export const previewPanel = (path: string) => `${PREFIX}${path}`;

/** The file a `preview:` panel shows; null for any other panel. */
export function previewOf(panel: string): string | null {
	return panel.startsWith(PREFIX) && panel.length > PREFIX.length ? panel.slice(PREFIX.length) : null;
}

/** The most text a preview asks for (the app reads at most 8 MiB). */
export const TEXT_PREVIEW_BYTES = 2 * 1024 * 1024;
/** The largest image shown in the app. */
export const IMAGE_PREVIEW_BYTES = 40 * 1024 * 1024;
/** Lines longer than this show their start only: a code view slows to a
 *  crawl on a line of a megabyte (a minified bundle, a one-line JSON). */
export const LINE_MAX = 5000;
/** Markdown up to this length is rendered; a longer file shows its source. */
export const MARKDOWN_RENDER_MAX = 512 * 1024;
/** JSON Lines records shown at a time ("show more" adds as many). */
export const JSONL_PAGE = 200;

/** A line of a message's file list: an absolute path (POSIX, home, Windows
 *  drive or UNC), as attachments.ts writes it. */
const isAbsolute = (path: string) => /^(?:\/|~[\\/]|[A-Za-z]:[\\/]|\\\\)\S/.test(path);

/**
 * Whether a click may preview `path`: only a file in the list of files the
 * clicked message was sent with. Nothing else (a path a reply names, one
 * typed in, one restored with a saved layout) is read for a preview.
 */
export function canPreview(path: string, attached: readonly string[]): boolean {
	return isAbsolute(path) && attached.includes(path);
}

/** What a file is taken for by its name, before anything is read. */
export type NameKind = 'image' | 'pdf' | 'markdown' | 'json' | 'jsonl' | 'binary' | 'text';

const IMAGE = /^(?:png|jpe?g|gif|webp|bmp|svg|ico|avif|apng)$/;
const MARKDOWN = /^(?:md|markdown|mdx|mdown|mkd)$/;
const JSON_EXT = /^(?:json|jsonc|json5|geojson|webmanifest|har)$/;
const JSONL = /^(?:jsonl|ndjson|jsonlines)$/;
/** Files no text view can show: documents, archives, media, programs, data
 *  stores. (Anything else is read, and its bytes decide.) */
const BINARY =
	/^(?:docx?|xlsx?|pptx?|key|numbers|pages|odt|ods|odp|rtf|epub|zip|tar|t?gz|tbz2?|bz2|xz|7z|rar|zst|lz4|br|iso|dmg|pkg|msi|exe|dll|so|dylib|a|o|obj|lib|class|jar|wasm|pyc|bin|dat|db|sqlite3?|mdb|parquet|feather|arrow|npy|npz|pt|pth|onnx|safetensors|ckpt|h5|mp3|wav|m4a|flac|aac|ogg|opus|wma|mp4|mov|webm|mkv|avi|m4v|wmv|flv|heic|heif|tiff?|psd|ai|sketch|fig|xcf|raw|cr2|nef|ttf|otf|woff2?|eot|apk|ipa|deb|rpm|appimage)$/;

/** The extension of a path's file name, lower case; '' without one. */
export function extOf(path: string): string {
	const name = path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function kindByName(path: string): NameKind {
	const ext = extOf(path);
	if (IMAGE.test(ext)) return 'image';
	if (ext === 'pdf') return 'pdf';
	if (MARKDOWN.test(ext)) return 'markdown';
	if (JSONL.test(ext)) return 'jsonl';
	if (JSON_EXT.test(ext)) return 'json';
	if (BINARY.test(ext)) return 'binary';
	return 'text';
}

/** How much text to ask for: none for a file shown another way. */
export function textBytesFor(path: string): number {
	const kind = kindByName(path);
	return kind === 'image' || kind === 'pdf' || kind === 'binary' ? 0 : TEXT_PREVIEW_BYTES;
}

/** What `preview_file` returns (src-tauri/src/file_preview.rs). */
export interface PreviewFacts {
	/** The real path, symlinks resolved. */
	path: string;
	size: number;
	mtime_ms: number;
	is_dir: boolean;
	binary: boolean;
	text: string | null;
	truncated: boolean;
	lossy: boolean;
	/** Opening it with its default app would run it. */
	runs: boolean;
}

/** Why a file shows as a card: name, type, size, time, place and the two
 *  ways to open it outside the app. */
export type CardReason = 'folder' | 'pdf' | 'binary' | 'imageTooLarge' | 'imageFailed';

export type TextKind = 'markdown' | 'json' | 'jsonl' | 'code';

export type PreviewView =
	| { view: 'loading' }
	| { view: 'missing' }
	| { view: 'error'; message: string }
	| { view: 'card'; reason: CardReason }
	| { view: 'image' }
	| { view: 'text'; kind: TextKind; text: string; truncated: boolean; lossy: boolean };

/** The error `preview_file` gives for a path where nothing is. */
export const isMissing = (error: unknown) => String(error) === 'missing';

/**
 * What the tab shows for a file: `read` is what `preview_file` answered
 * (absent while it reads); `imageFailed` is set once an image could not
 * be decoded. The name picks the view, the bytes overrule it: a `.txt`
 * that is binary shows as a card, an unknown extension that is text shows
 * as code.
 */
export function previewView(
	path: string,
	read?: { facts: PreviewFacts } | { error: unknown },
	imageFailed = false
): PreviewView {
	if (!read) return { view: 'loading' };
	if ('error' in read) return isMissing(read.error) ? { view: 'missing' } : { view: 'error', message: String(read.error) };
	const facts = read.facts;
	if (facts.is_dir) return { view: 'card', reason: 'folder' };
	const kind = kindByName(path);
	if (kind === 'image') {
		if (facts.size > IMAGE_PREVIEW_BYTES) return { view: 'card', reason: 'imageTooLarge' };
		return imageFailed ? { view: 'card', reason: 'imageFailed' } : { view: 'image' };
	}
	if (kind === 'pdf') return { view: 'card', reason: 'pdf' };
	if (kind === 'binary' || facts.binary || facts.text === null) return { view: 'card', reason: 'binary' };
	return { view: 'text', kind: kind === 'text' ? 'code' : kind, text: facts.text, truncated: facts.truncated, lossy: facts.lossy };
}

/** How a text file shows: `rendered` (Markdown laid out, JSON formatted,
 *  JSON Lines as records) or `source` (the file as it is). */
export type TextMode = 'rendered' | 'source';

/** Whether a file of `kind` has a rendered view: Markdown up to
 *  MARKDOWN_RENDER_MAX, JSON and JSON Lines always; code has its source only. */
export function canRender(kind: TextKind, text: string): boolean {
	if (kind === 'markdown') return text.length <= MARKDOWN_RENDER_MAX;
	return kind === 'json' || kind === 'jsonl';
}

/** What a code view shows for a text file in `mode`: JSON formatted when it
 *  parses (`formatted`), long lines cut (`clipped` of them). */
export function codeText(kind: TextKind, mode: TextMode, text: string): { text: string; clipped: number; formatted: boolean } {
	const pretty = kind === 'json' && mode === 'rendered' ? prettyJson(text) : null;
	return { ...clipLines(pretty ?? text), formatted: pretty !== null };
}

/** `text` with every line longer than `max` cut to its start (an ellipsis
 *  marks the cut), and how many lines were cut. */
export function clipLines(text: string, max = LINE_MAX): { text: string; clipped: number } {
	if (text.length <= max) return { text, clipped: 0 };
	let clipped = 0;
	const lines = text.split('\n').map((line) => {
		if (line.length <= max) return line;
		clipped++;
		return `${line.slice(0, max)} …`;
	});
	return { text: clipped ? lines.join('\n') : text, clipped };
}

/** A JSON document laid out two spaces deep, or null when it does not parse
 *  (a cut-off file, JSON with comments). */
export function prettyJson(text: string): string | null {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return null;
	}
}

/** One line of a JSON Lines file: where it is, its text, whether it parses. */
export interface JsonlRecord {
	line: number;
	raw: string;
	ok: boolean;
}

/** The records of a JSON Lines file, one per non-blank line. `truncated`:
 *  the text stops inside the file, so its last line may be cut off. */
export function jsonlRecords(text: string, truncated = false): JsonlRecord[] {
	const lines = text.split('\n');
	if (truncated && lines.length > 1) lines.pop();
	const records: JsonlRecord[] = [];
	lines.forEach((line, i) => {
		const raw = line.replace(/\r$/, '');
		if (!raw.trim()) return;
		let ok = true;
		try {
			JSON.parse(raw);
		} catch {
			ok = false;
		}
		records.push({ line: i + 1, raw, ok });
	});
	return records;
}

/** A size as people read it: `512 B`, `12.4 KB`, `3.1 MB`, `1.2 GB`. */
export function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ['KB', 'MB', 'GB', 'TB'];
	let n = bytes / 1024;
	let i = 0;
	while (n >= 1024 && i < units.length - 1) {
		n /= 1024;
		i++;
	}
	return `${n >= 100 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

/** The layout without preview tabs: a saved layout's previews are not read
 *  again in a later run, where no click asked for them. */
export function dropPreviewTabs(layout: TileLayout): TileLayout {
	let next = layout;
	for (const tab of leavesOf(layout.root).flatMap((l) => l.tabs)) if (previewOf(tab.panel)) next = closeTab(next, tab.id);
	return next;
}
