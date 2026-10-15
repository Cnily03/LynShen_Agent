// Reply styles (回复风格): how a LynShen engine's model writes to the user
// (tone, length, structure, how much it explains). Built-in presets plus the
// Markdown files in ~/.lynshen/styles (and a trusted project's
// .lynshen/styles). The daemon lists, saves and deletes them (styles_list /
// style_save / style_delete); config.json's `reply_style` is the default for
// new conversations; a session reports the style it uses (`reply_style`) and
// takes another with `set_style`. Pure logic, framework-free and unit-tested.

export type StyleSource = 'builtin' | 'user' | 'project';

export interface ReplyStyle {
	/** The file name without `.md`, or a built-in's id. */
	id: string;
	name: string;
	description: string;
	instructions: string;
	source: StyleSource;
	/** The file; null for a built-in. */
	path: string | null;
	/** Only the first 8 KiB of the instructions are used. */
	truncated: boolean;
}

export interface StyleProblem {
	path: string;
	message: string;
}

export interface StyleList {
	/** One per id: the built-ins first, then the others by name. */
	styles: ReplyStyle[];
	/** config.json's `reply_style`: the style of new conversations. */
	default: string;
	dirs: { scope: string; path: string }[];
	/** Whether the project's styles load; null without a project. */
	projectTrusted: boolean | null;
	/** Files that do not load, and why. */
	problems: StyleProblem[];
}

/** The `reply_style` event: the style a conversation uses now. */
export interface ReplyStyleState {
	/** The id in effect, or the one asked for when `missing`. */
	style: string;
	name: string;
	source: StyleSource | 'missing';
	/** The conversation chose it; false: it follows the default. */
	chosen: boolean;
	/** No style of that id exists now: the conversation runs with none. */
	missing: boolean;
}

/** No style: the engine's own prompt as it is. */
export const DEFAULT_STYLE = 'default';
/** The built-ins, in the engine's order; the app names them in its language. */
export const BUILTIN_STYLES = ['default', 'concise', 'explanatory', 'learning', 'formal'] as const;
export const STYLE_NAME_MAX = 40;
export const STYLE_DESCRIPTION_MAX = 200;
export const STYLE_INSTRUCTIONS_MAX_BYTES = 8 * 1024;

type Translate = (key: string, vars?: Record<string, string | number>) => string;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const SOURCES: StyleSource[] = ['builtin', 'user', 'project'];

/** A `reply_style` event; null when it does not name a style. */
export function parseReplyStyle(ev: Record<string, unknown>): ReplyStyleState | null {
	const style = str(ev.style);
	if (!style) return null;
	const source = str(ev.source);
	return {
		style,
		name: str(ev.name) || style,
		source: source === 'missing' || SOURCES.includes(source as StyleSource) ? (source as StyleSource | 'missing') : 'builtin',
		chosen: ev.chosen === true,
		missing: ev.missing === true
	};
}

/** The `styles_list` reply, with missing fields filled in. */
export function parseStyleList(reply: Record<string, unknown>): StyleList {
	const styles = (Array.isArray(reply.styles) ? reply.styles : [])
		.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object' && !!str((s as Record<string, unknown>).id))
		.map((s) => ({
			id: str(s.id),
			name: str(s.name) || str(s.id),
			description: str(s.description),
			instructions: str(s.instructions),
			source: SOURCES.includes(s.source as StyleSource) ? (s.source as StyleSource) : 'user',
			path: str(s.path) || null,
			truncated: s.truncated === true
		}));
	const records = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
	return {
		styles,
		default: str(reply.default) || DEFAULT_STYLE,
		dirs: records(reply.dirs).map((d) => ({ scope: str(d.scope), path: str(d.path) })),
		projectTrusted: typeof reply.projectTrusted === 'boolean' ? reply.projectTrusted : null,
		problems: records(reply.problems).map((p) => ({ path: str(p.path), message: str(p.message) }))
	};
}

const builtinId = (style: { id: string; source: string }) =>
	style.source === 'builtin' && (BUILTIN_STYLES as readonly string[]).includes(style.id);

/** The name to show: a built-in's in the app's language, else the file's. */
export function styleName(style: { id: string; name: string; source: string }, t: Translate): string {
	return builtinId(style) ? t(`settings.styles.builtin.${style.id}.name`) : style.name || style.id;
}

/** The one-line description to show, as `styleName` picks. */
export function styleDescription(style: { id: string; description: string; source: string }, t: Translate): string {
	return builtinId(style) ? t(`settings.styles.builtin.${style.id}.description`) : style.description;
}

/** The name of the style `id` in `list`, else the id itself (a style that
 *  is gone, or a list not loaded yet). */
export function nameOf(list: StyleList | null, id: string, t: Translate): string {
	const style = list?.styles.find((s) => s.id === id);
	if (style) return styleName(style, t);
	if ((BUILTIN_STYLES as readonly string[]).includes(id)) return t(`settings.styles.builtin.${id}.name`);
	return id;
}

/** Which style a conversation's menu marks: a draft's pick, else what its
 *  engine reported; a draft without a pick starts on the default. */
export function currentStyle(draft: boolean, draftPick: string | undefined, reported: ReplyStyleState | null, list: StyleList | null): string | null {
	if (draft) return draftPick ?? list?.default ?? DEFAULT_STYLE;
	return reported?.style ?? null;
}

export interface StyleDraft {
	name: string;
	description: string;
	instructions: string;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;

/** What keeps a style from being saved, as a message key; '' when nothing. */
export function styleDraftError(draft: StyleDraft): string {
	const name = draft.name.trim();
	if (!name) return 'settings.styles.errName';
	if ([...name].length > STYLE_NAME_MAX) return 'settings.styles.errNameLong';
	if ([...draft.description.trim()].length > STYLE_DESCRIPTION_MAX) return 'settings.styles.errDescriptionLong';
	if (!draft.instructions.trim()) return 'settings.styles.errInstructions';
	if (bytes(draft.instructions.trim()) > STYLE_INSTRUCTIONS_MAX_BYTES) return 'settings.styles.errInstructionsLong';
	return '';
}

/** A new draft copied from `style` (a built-in or another file), named as a
 *  copy so it does not read as the original. */
export function copyDraft(style: ReplyStyle, t: Translate): StyleDraft {
	return {
		name: t('settings.styles.copyName', { name: styleName(style, t) }).slice(0, STYLE_NAME_MAX),
		description: styleDescription(style, t),
		instructions: style.instructions
	};
}

/** A personal style file the page may edit and delete. */
export function editable(style: ReplyStyle): boolean {
	return style.source === 'user';
}

/** The home folder, from the personal styles folder the daemon names
 *  (`~/.lynshen/styles`); '' when it names another. */
export function styleHome(list: Pick<StyleList, 'dirs'>): string {
	const user = list.dirs.find((d) => d.scope === 'user')?.path ?? '';
	const m = user.match(/^(.*?)[\\/]\.lynshen[\\/]styles[\\/]?$/);
	return m ? m[1] : '';
}
