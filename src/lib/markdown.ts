import { Marked } from 'marked';
import markedKatex from 'marked-katex-extension';
import hljs from '$lib/hljs';
import { t } from '$lib/i18n';
import { codeFileRef, fileHref, splitFileRefs, type FileRef } from '$lib/fileRefs';

// One configured instance for the whole app. Configuring the shared `marked`
// singleton from each <Markdown> instance stacks the extensions and makes
// code blocks get highlighted (and escaped) more than once.
const marked = new Marked();
marked.setOptions({ breaks: true, gfm: true });
// Math: $…$ inline (with a space or punctuation around it, so "$5 和 $10"
// stays text), $$…$$ display. A formula KaTeX can't parse shows as its source.
marked.use(markedKatex({ throwOnError: false, output: 'htmlAndMathml' }));

const escapeHtml = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = (s: string) => escapeHtml(s).replace(/"/g, '&quot;');

/** A code block's text as HTML, highlighted as the language its info string
 *  starts with ("rust src/a.rs", "ts:src/a.ts").
 *
 *  Highlighted here, in the code renderer, not by marked-highlight: that
 *  extension is a `walkTokens` callback, and marked's walk gathers each
 *  token's result with `concat`, which copies the list so far for every
 *  token. On a long text that is quadratic: rendering a 240,000-character
 *  reasoning left about 250 MB of dead arrays behind (in WebKit the
 *  process's footprint reached 330 MB during the render; 70 MB without
 *  the walk). */
function highlightCode(code: string, info: string): string {
	const lang = info.split(/[\s:]/)[0];
	const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
	try {
		return hljs.highlight(code, { language }).value;
	} catch {
		return escapeHtml(code);
	}
}

/** A file reference as a link the chat opens in the editor (see <Markdown>). */
function fileLink(ref: FileRef, inner: string): string {
	const where = ref.line ? `:${ref.line}${ref.col ? `:${ref.col}` : ''}` : '';
	return `<a class="fileref" href="${escapeAttr(fileHref(ref))}" title="${escapeAttr(ref.path + where)}">${inner}</a>`;
}

// Wrap fenced code in a header (language label + copy button). The copy is wired
// by <Markdown> via event delegation, reading the <pre>'s text content.
marked.use({
	renderer: {
		code(token: { text: string; lang?: string }) {
			// The info string may name the file: "ts src/a.ts" or "ts:src/a.ts".
			const info = (token.lang || '').trim();
			const [head, ...rest] = info.split(/\s+/);
			const [langPart, pathPart] = head.includes(':') && head.includes('/') ? head.split(/:(.*)/s) : [head, rest[0]];
			const lang = langPart ?? '';
			const named = pathPart ? codeFileRef(pathPart) : null;
			const body = highlightCode(token.text, info);
			const langCls = lang ? ` language-${escapeAttr(lang)}` : '';
			return (
				`<div class="codeblock"><div class="cb-head">` +
				`<span class="cb-lang">${escapeHtml(lang)}</span>` +
				(named ? fileLink(named, escapeHtml(pathPart!)) : '') +
				`<button class="cb-copy" type="button">${escapeHtml(t('common.copy'))}</button></div>` +
				`<pre><code class="hljs${langCls}">${body}</code></pre></div>`
			);
		},
		// Inline code that is all one file path opens it.
		codespan(token: { text: string }) {
			const code = `<code>${escapeHtml(token.text)}</code>`;
			const ref = codeFileRef(token.text);
			return ref ? fileLink(ref, code) : code;
		}
	},
	extensions: [
		{
			name: 'fileref',
			level: 'inline',
			renderer(token) {
				const ref = token as unknown as FileRef & { raw: string };
				return fileLink(ref, escapeHtml(ref.raw));
			}
		}
	]
});

type Tok = { type: string; raw?: string; text?: string; tokens?: Tok[]; items?: Tok[]; header?: Tok[]; rows?: Tok[][] };

/** Prose tokens with their file paths split out as `fileref` tokens.
 *  Links, code and HTML keep their text. */
function linkFiles(tokens: Tok[]): Tok[] {
	const out: Tok[] = [];
	for (const token of tokens) {
		if (token.type === 'text' && !token.tokens && token.text) {
			for (const part of splitFileRefs(token.text)) {
				out.push(
					typeof part === 'string'
						? { type: 'text', raw: part, text: part }
						: ({ ...part, type: 'fileref', raw: part.text } as unknown as Tok)
				);
			}
			continue;
		}
		if (!['link', 'image', 'code', 'codespan', 'html'].includes(token.type)) {
			if (token.tokens) token.tokens = linkFiles(token.tokens);
			if (token.items) token.items = linkFiles(token.items);
			for (const cell of [...(token.header ?? []), ...(token.rows ?? []).flat()]) {
				if (cell.tokens) cell.tokens = linkFiles(cell.tokens);
			}
		}
		out.push(token);
	}
	return out;
}

// Before the highlight extension walks the tokens: file paths in prose
// become `fileref` tokens.
marked.use({
	hooks: {
		processAllTokens(tokens) {
			return linkFiles(tokens as unknown as Tok[]) as never;
		}
	}
});

export function renderMarkdown(text: string): string {
	// A table scrolls sideways in its own box when it is wider than the column.
	return (marked.parse(text, { async: false }) as string)
		.replace(/<table>/g, '<div class="table-wrap"><table>')
		.replace(/<\/table>/g, '</table></div>');
}
