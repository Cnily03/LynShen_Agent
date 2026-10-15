import { describe, it, expect } from 'vitest';
import { setLocale, t } from './i18n';
import {
	DEFAULT_STYLE,
	STYLE_INSTRUCTIONS_MAX_BYTES,
	copyDraft,
	currentStyle,
	editable,
	nameOf,
	parseReplyStyle,
	parseStyleList,
	problemText,
	styleDescription,
	styleDraftError,
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
		expect(list.problems).toEqual([{ path: '/Users/me/.lynshen/styles/a b.md', kind: '', message: 'bad name' }]);
		setLocale('zh');
		expect(problemText({ path: '/x', kind: 'empty', message: 'no instructions' }, t)).toBe('frontmatter 后面没有指令，不会加载');
		expect(problemText(list.problems[0], t)).toBe('bad name');
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
		expect(styleDraftError(ok)).toBe('');
		expect(styleDraftError({ ...ok, name: '  ' })).toBe('settings.styles.errName');
		expect(styleDraftError({ ...ok, name: '长'.repeat(41) })).toBe('settings.styles.errNameLong');
		expect(styleDraftError({ ...ok, description: 'x'.repeat(201) })).toBe('settings.styles.errDescriptionLong');
		expect(styleDraftError({ ...ok, instructions: ' ' })).toBe('settings.styles.errInstructions');
		// Bytes, not characters: a Chinese character takes three.
		expect(styleDraftError({ ...ok, instructions: '长'.repeat(Math.floor(STYLE_INSTRUCTIONS_MAX_BYTES / 3)) })).toBe('');
		expect(styleDraftError({ ...ok, instructions: '长'.repeat(Math.floor(STYLE_INSTRUCTIONS_MAX_BYTES / 3) + 1) })).toBe('settings.styles.errInstructionsLong');
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
