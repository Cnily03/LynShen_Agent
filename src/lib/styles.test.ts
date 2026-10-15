import { describe, it, expect } from 'vitest';
import { setLocale, t } from './i18n';
import { DaemonError } from './daemon';
import {
	DEFAULT_STYLE,
	STYLE_ERROR_CODES,
	STYLE_INSTRUCTIONS_MAX_BYTES,
	codeText,
	copyDraft,
	currentStyle,
	editable,
	nameOf,
	parseReplyStyle,
	parseStyleList,
	problemText,
	styleDescription,
	styleDraftError,
	styleErrorText,
	styleHome,
	styleName,
	type ReplyStyle
} from './styles';

const style = (id: string, source: ReplyStyle['source'], extra: Partial<ReplyStyle> = {}): ReplyStyle => ({
	id,
	name: id,
	description: '',
	instructions: 'Be brief.',
	source,
	path: source === 'builtin' ? null : `/Users/me/.lynshen/styles/${id}.md`,
	truncated: false,
	...extra
});

describe('reply styles', () => {
	it('reads the reply_style event', () => {
		expect(parseReplyStyle({ type: 'reply_style', style: 'formal', name: '正式汇报', source: 'builtin', chosen: true, missing: false })).toEqual({
			style: 'formal',
			name: '正式汇报',
			source: 'builtin',
			chosen: true,
			missing: false
		});
		expect(parseReplyStyle({ type: 'reply_style', style: 'gone', source: 'missing', missing: true })).toMatchObject({ name: 'gone', source: 'missing', missing: true, chosen: false });
		expect(parseReplyStyle({ type: 'reply_style' })).toBeNull();
	});

	it('reads the styles_list reply and fills what is missing', () => {
		const list = parseStyleList({
			type: 'styles_list',
			styles: [
				{ id: 'default', name: '默认', description: 'none', instructions: '', source: 'builtin', path: null, truncated: false },
				{ id: 'review', instructions: 'Point at lines.', source: 'project', path: '/p/.lynshen/styles/review.md', truncated: true },
				{ name: 'no id' },
				null
			],
			dirs: [{ scope: 'user', path: '/Users/me/.lynshen/styles' }],
			projectTrusted: false,
			problems: [{ path: '/Users/me/.lynshen/styles/a b.md', message: 'bad name' }]
		});
		expect(list.styles.map((s) => s.id)).toEqual(['default', 'review']);
		expect(list.styles[1]).toMatchObject({ name: 'review', description: '', source: 'project', truncated: true });
		expect(list.default).toBe(DEFAULT_STYLE);
		expect(list.projectTrusted).toBe(false);
		expect(list.problems).toEqual([{ path: '/Users/me/.lynshen/styles/a b.md', code: '', message: 'bad name' }]);
		expect(parseStyleList({}).styles).toEqual([]);
		expect(styleHome(list)).toBe('/Users/me');
		expect(styleHome({ dirs: [] })).toBe('');
	});

	it('names the built-ins in the app language and files by their own name', () => {
		setLocale('en');
		expect(styleName(style('concise', 'builtin', { name: '简洁' }), t)).toBe('Concise');
		expect(styleDescription(style('formal', 'builtin'), t)).toBe('A formal report: conclusion, work, checks, risks');
		// A personal file that replaces a built-in keeps its own name.
		expect(styleName(style('concise', 'user', { name: 'My concise' }), t)).toBe('My concise');
		setLocale('zh');
		expect(styleName(style('learning', 'builtin'), t)).toBe('教学引导');
		const list = parseStyleList({ styles: [style('code-review', 'user', { name: '代码评审' })] });
		expect(nameOf(list, 'code-review', t)).toBe('代码评审');
		expect(nameOf(list, 'explanatory', t)).toBe('详细讲解');
		expect(nameOf(null, 'gone', t)).toBe('gone');
	});

	it('words every failure by its code, never with the engine’s English detail', () => {
		setLocale('zh');
		const problem = { path: '/Users/me/.lynshen/styles/a b.md', code: 'invalid_id', message: 'the file name cannot be a style id' };
		expect(problemText(problem, '/Users/me', t)).toBe('~/.lynshen/styles/a b.md 不会加载：文件名不能作为风格 id：不能有空格和 / \\ : * ? " < > |，也不能以 . 或 - 开头');
		// A code this app does not know reads as a plain failure.
		expect(problemText({ ...problem, code: 'newer_reason' }, '/Users/me', t)).toBe('~/.lynshen/styles/a b.md 不会加载：没有完成，原因写在日志里');
		expect(styleErrorText(new DaemonError('cannot write /x: Permission denied', 'write_failed'), t)).toBe('写不了风格文件，检查 ~/.lynshen/styles 能否写入');
		expect(styleErrorText(new DaemonError('not connected to lynshen daemon'), t)).toBe('没有完成，原因写在日志里');
		expect(styleErrorText(new Error('boom'), t)).toBe('没有完成，原因写在日志里');
		expect(styleErrorText('name_missing', t)).toBe('填写名称');
		// Every code has its words in both languages.
		for (const locale of ['zh', 'en'] as const) {
			setLocale(locale);
			for (const code of STYLE_ERROR_CODES) expect(codeText(code, t)).not.toBe(`settings.styles.error.${code}`);
		}
		setLocale('en');
		expect(codeText('not_found', t)).toBe('This style file is gone');
		setLocale('zh');
	});

	it('marks a draft’s pick, else the default, else what the engine said', () => {
		const list = parseStyleList({ styles: [], default: 'concise' });
		expect(currentStyle(true, undefined, null, list)).toBe('concise');
		expect(currentStyle(true, 'formal', null, list)).toBe('formal');
		expect(currentStyle(true, undefined, null, null)).toBe(DEFAULT_STYLE);
		const told = parseReplyStyle({ style: 'learning', source: 'builtin', chosen: true });
		expect(currentStyle(false, 'formal', told, list)).toBe('learning');
		// An engine that never said: no choice to mark.
		expect(currentStyle(false, undefined, null, list)).toBeNull();
	});

	it('checks a draft before it is saved', () => {
		const ok = { name: '评审', description: '', instructions: '先列问题。' };
		// The engine's codes for the same checks.
		expect(styleDraftError(ok)).toBe('');
		expect(styleDraftError({ ...ok, name: '  ' })).toBe('name_missing');
		expect(styleDraftError({ ...ok, name: '长'.repeat(41) })).toBe('name_too_long');
		expect(styleDraftError({ ...ok, description: 'x'.repeat(201) })).toBe('description_too_long');
		expect(styleDraftError({ ...ok, instructions: ' ' })).toBe('instructions_missing');
		// Bytes, not characters: a Chinese character takes three.
		expect(styleDraftError({ ...ok, instructions: '长'.repeat(Math.floor(STYLE_INSTRUCTIONS_MAX_BYTES / 3)) })).toBe('');
		expect(styleDraftError({ ...ok, instructions: '长'.repeat(Math.floor(STYLE_INSTRUCTIONS_MAX_BYTES / 3) + 1) })).toBe('instructions_too_long');
	});

	it('copies a style into a new personal draft', () => {
		setLocale('zh');
		const draft = copyDraft(style('concise', 'builtin', { instructions: '- 先给结论。' }), t);
		expect(draft).toEqual({ name: '简洁 副本', description: '先给结论，省掉铺垫和复述', instructions: '- 先给结论。' });
		expect(editable(style('mine', 'user'))).toBe(true);
		expect(editable(style('concise', 'builtin'))).toBe(false);
		expect(editable(style('team', 'project'))).toBe(false);
	});
});
