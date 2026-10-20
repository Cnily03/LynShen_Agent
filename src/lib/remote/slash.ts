// "/" commands on the phone page, as the desktop composer offers them
// (Composer.svelte `slashMatches`, ChatPane `submit`): the engine's command
// list completes what is typed, and a typed command goes to the engine as a
// command, not as a message (ticket #46).
import type { CommandItem } from '$lib/chat.svelte';

/** The commands matching what is typed: names starting with it first, then
 *  names containing it. Empty unless the text is one word starting with "/". */
export function slashMatches(typed: string, commands: CommandItem[]): CommandItem[] {
	const t = typed.trim().toLowerCase();
	if (!t.startsWith('/') || /\s/.test(t)) return [];
	const all = commands.filter((c) => c.command.toLowerCase() !== t && !COMPUTER_ONLY.has(c.command));
	const head = all.filter((c) => c.command.toLowerCase().startsWith(t));
	const q = t.slice(1);
	return q ? [...head, ...all.filter((c) => !head.includes(c) && c.command.toLowerCase().includes(q))] : head;
}

/** Commands that act on the computer's screen or its terminal (a login in
 *  its browser, leaving the TUI, a file path on the computer): the phone
 *  does not list them and says where to run them. */
const COMPUTER_ONLY = new Set(['/login', '/login-paste', '/quit', '/exit', '/image', '/new', '/resume', '/tree', '/checkout', '/fork', '/delete']);

export type PhoneCommand = { kind: 'command' } | { kind: 'computer'; name: string } | { kind: 'message' };

/** What a typed line starting with "/" is: a command of the engine's list
 *  (sent as a command), one only the computer runs, or a message that
 *  happens to start with "/" (a path: "/usr/bin 怎么…"). */
export function phoneCommand(typed: string, commands: CommandItem[]): PhoneCommand {
	const name = typed.trim().split(/\s+/)[0] ?? '';
	if (COMPUTER_ONLY.has(name)) return { kind: 'computer', name };
	if (commands.some((c) => c.command === name)) return { kind: 'command' };
	return { kind: 'message' };
}
