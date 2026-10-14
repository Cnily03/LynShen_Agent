// The daemon's `shells` reply, shared by the settings page and the terminal
// panel (it opens the terminal shell the reply names). Loaded once at start
// and again after a settings change; a daemon before the op leaves it
// `unsupported`, and the terminal panel then opens the app's own default.
import { daemon, isUnknownOp } from '$lib/protocol';
import type { ShellsReply, TerminalShell } from '$lib/shells';

class Shells {
	reply = $state<ShellsReply | null>(null);
	/** The daemon has no `shells` op. */
	unsupported = $state(false);
	error = $state('');
	loading = $state(false);
	#pending: Promise<ShellsReply | null> | null = null;

	/** Asks the daemon again; `refresh` detects shells, versions and the
	 *  login environment anew. One request at a time. */
	load(refresh = false): Promise<ShellsReply | null> {
		if (this.#pending && !refresh) return this.#pending;
		this.loading = true;
		const pending: Promise<ShellsReply | null> = this.#ask(refresh).finally(() => {
			if (this.#pending !== pending) return;
			this.#pending = null;
			this.loading = false;
		});
		this.#pending = pending;
		return pending;
	}

	async #ask(refresh: boolean): Promise<ShellsReply | null> {
		try {
			await daemon.connect();
			const reply = (await daemon.request({ op: 'shells', ...(refresh ? { refresh: true } : {}) })) as unknown as ShellsReply;
			this.reply = reply;
			this.unsupported = false;
			this.error = '';
			return reply;
		} catch (e) {
			if (isUnknownOp(e, 'shells')) this.unsupported = true;
			else this.error = e instanceof Error ? e.message : String(e);
			return null;
		}
	}

	/** What a new terminal opens: the reply's, waiting for a first reply at
	 *  most `wait` ms; null for the app's own default (no reply, an older
	 *  daemon). */
	async terminal(wait = 3000): Promise<TerminalShell | null> {
		if (this.reply) return this.reply.terminal;
		if (this.unsupported) return null;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<null>((resolve) => (timer = setTimeout(() => resolve(null), wait)));
		const reply = await Promise.race([this.load(), timeout]);
		clearTimeout(timer);
		return reply?.terminal ?? null;
	}
}

export const shells = new Shells();
