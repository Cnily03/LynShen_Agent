// A turn is everything between two user messages: the assistant's replies,
// its reasoning and tool calls. The reply copy button (MessageList) and the
// context menu's "copy the whole reply" copy the turn's assistant text.
import type { Msg } from '$lib/chat.svelte';

type Reply = Extract<Msg, { kind: 'assistant' }>;
const hasText = (m: Msg): m is Reply => m.kind === 'assistant' && /\S/.test(m.text);

/** The assistant text of the turn `index` is in, as Markdown source: every
 *  assistant message of the turn without its blank lead and trailing space
 *  (a first line's indent is Markdown), joined by a blank line. A user
 *  message's index stands for the turn that answers it. */
export function turnText(messages: readonly Msg[], index: number): string {
	let start = 0;
	for (let i = Math.min(index, messages.length - 1); i >= 0; i--) {
		if (messages[i]!.kind === 'user') {
			start = i + 1;
			break;
		}
	}
	const parts: string[] = [];
	for (let i = start; i < messages.length; i++) {
		const m = messages[i]!;
		if (m.kind === 'user') break;
		if (hasText(m)) parts.push(m.text.replace(/^(?:[ \t]*\n)+/, '').trimEnd());
	}
	return parts.join('\n\n');
}

/** The last assistant message with text in each turn: where the turn's copy
 *  button goes. */
export function turnEnds(messages: readonly Msg[]): Set<Msg> {
	const ends = new Set<Msg>();
	let last: Msg | null = null;
	for (const m of messages) {
		if (m.kind === 'user') {
			if (last) ends.add(last);
			last = null;
		} else if (hasText(m)) last = m;
	}
	if (last) ends.add(last);
	return ends;
}

/** Index of the first message of the last turn: messages from here on belong
 *  to the turn that may still be running. */
export function lastTurnStart(messages: readonly Msg[]): number {
	for (let i = messages.length - 1; i >= 0; i--) if (messages[i]!.kind === 'user') return i + 1;
	return 0;
}
