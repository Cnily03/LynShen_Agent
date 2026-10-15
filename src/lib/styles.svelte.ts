// The reply styles the daemon lists (see $lib/styles), shared by the settings
// page and the composer's "+" menu: one list per project (its own styles
// load once it is trusted), loaded on first use and again after any change
// made here. A daemon before the style ops leaves it `unsupported`, and the
// app then shows no style choice.
import { deleteStyle, isUnknownOp, listStyles, saveStyle, writeConfig } from '$lib/protocol';
import type { StyleDraft, StyleList } from '$lib/styles';

class ReplyStyles {
	/** Lists by project folder; '' is the list without a project. */
	lists = $state<Record<string, StyleList>>({});
	/** The daemon has no style ops. */
	unsupported = $state(false);
	error = $state('');
	loading = $state(false);
	#pending = new Map<string, Promise<StyleList | null>>();

	/** The list for `cwd`, null until it has loaded. */
	list(cwd = ''): StyleList | null {
		return this.lists[cwd] ?? null;
	}

	/** Asks the daemon for `cwd`'s list; one request per folder at a time. */
	load(cwd = ''): Promise<StyleList | null> {
		const running = this.#pending.get(cwd);
		if (running) return running;
		this.loading = true;
		const pending = this.#ask(cwd).finally(() => {
			this.#pending.delete(cwd);
			this.loading = this.#pending.size > 0;
		});
		this.#pending.set(cwd, pending);
		return pending;
	}

	/** Loads `cwd`'s list unless it is there already. */
	ensure(cwd = ''): void {
		if (!this.unsupported && !this.lists[cwd]) void this.load(cwd);
	}

	async #ask(cwd: string): Promise<StyleList | null> {
		try {
			const list = await listStyles(cwd || undefined);
			this.lists = { ...this.lists, [cwd]: list };
			this.unsupported = false;
			this.error = '';
			return list;
		} catch (e) {
			if (isUnknownOp(e, 'styles_list')) this.unsupported = true;
			else this.error = e instanceof Error ? e.message : String(e);
			return null;
		}
	}

	/** Every list loaded so far, read again (a style was saved or deleted, or
	 *  the default changed). */
	async reload(): Promise<void> {
		const folders = Object.keys(this.lists);
		await Promise.all((folders.length ? folders : ['']).map((cwd) => this.load(cwd)));
	}

	/** Writes a personal style (`style` replaces that one); resolves with its id. */
	async save(draft: StyleDraft, style?: string): Promise<string> {
		const id = await saveStyle({
			...(style ? { style } : {}),
			name: draft.name.trim(),
			description: draft.description.trim(),
			instructions: draft.instructions.trim()
		});
		await this.reload();
		return id;
	}

	async remove(style: string): Promise<void> {
		await deleteStyle(style);
		await this.reload();
	}

	/** The style of new conversations (`reply_style` in config.json). Engines
	 *  read it at each turn; a conversation that chose its own keeps it. */
	async setDefault(style: string): Promise<void> {
		await writeConfig({ reply_style: style });
		const lists: Record<string, StyleList> = {};
		for (const [cwd, list] of Object.entries(this.lists)) lists[cwd] = { ...list, default: style };
		this.lists = lists;
	}
}

export const replyStyles = new ReplyStyles();
