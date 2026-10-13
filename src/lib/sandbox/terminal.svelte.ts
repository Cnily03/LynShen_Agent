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

/** A command as it may reach a shell: line breaks as `\n`, tabs as spaces
 *  (a tab asks the shell to complete), no trailing space or line break, and
 *  no other control character: no ESC (it would end a bracketed paste early,
 *  `\x1b[201~`, or start a key sequence), no C0 control (Ctrl-C, Ctrl-J…),
 *  no DEL and no C1 control (8-bit CSI and the like). */
export function cleanCommand(command: string): string {
	return (
		command
			.replace(/\r\n?/g, '\n')
			.replace(/\t/g, ' ')
			// eslint-disable-next-line no-control-regex
			.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, '')
			.replace(/\s+$/, '')
	);
}

/** What may be typed into a shell without running anything (never with
 *  Enter). Where the shell takes a bracketed paste (it turned the mode on),
 *  the command goes as one, so its line editor inserts it as text and waits
 *  for Enter; elsewhere only a command of one line is typed. null when it
 *  cannot be typed safely (several lines and no bracketed paste) or is empty. */
export function typedCommand(command: string, bracketedPaste: boolean): string | null {
	const text = cleanCommand(command);
	if (!text) return null;
	if (bracketedPaste) return `\u001b[200~${text}\u001b[201~`;
	return text.includes('\n') ? null : text;
}
