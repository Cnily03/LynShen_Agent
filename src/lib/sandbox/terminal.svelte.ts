// 在终端里运行 (a sandbox request that needs admin rights): a new terminal
// tab beside the conversation, in the request's directory, with the command
// typed but not run. The card asks; the page shell opens the tab and hands
// the tab its command once (TerminalPanel types it when the shell is up).

export interface TerminalPrefill {
	cwd: string;
	command: string;
}

class TerminalRequests {
	/** The last terminal asked for, by the conversation it is beside; the
	 *  page shell opens its tab. */
	request = $state<(TerminalPrefill & { sessionId: string; n: number }) | null>(null);
	/** What each such tab gets typed, by tab id (kept while the tab lives,
	 *  so a remount does not lose its directory). */
	#prefills = new Map<string, TerminalPrefill & { typed: boolean }>();

	open(command: string, cwd: string, sessionId = '') {
		this.request = { command, cwd, sessionId, n: (this.request?.n ?? 0) + 1 };
	}

	/** Records the tab opened for a request. */
	assign(tabId: string, prefill: TerminalPrefill) {
		this.#prefills.set(tabId, { ...prefill, typed: false });
	}

	/** The directory a tab starts in, when it was opened for a request. */
	cwdOf(tabId: string): string | undefined {
		return this.#prefills.get(tabId)?.cwd;
	}

	/** The command to type in this tab, once: a remounted tab types nothing again. */
	take(tabId: string): string {
		const p = this.#prefills.get(tabId);
		if (!p || p.typed) return '';
		p.typed = true;
		return p.command;
	}
}

export const terminalRequests = new TerminalRequests();

/** What may be typed into a shell without running anything: no carriage
 *  return or other control characters, no trailing newline. A command of
 *  several lines is typed only where the shell takes a bracketed paste (it
 *  then waits for Enter); null when it cannot be typed safely. */
export function typedCommand(command: string, bracketedPaste: boolean): string | null {
	const text = command
		.replace(/\r\n?/g, '\n')
		// A tab would ask the shell to complete.
		.replace(/\t/g, ' ')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
		.replace(/\s+$/, '');
	if (!text) return null;
	if (!text.includes('\n')) return text;
	return bracketedPaste ? `\u001b[200~${text}\u001b[201~` : null;
}
