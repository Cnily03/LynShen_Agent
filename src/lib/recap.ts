// The recap card at the end of a turn (RecapCard.svelte, design.md
// "Workbench canvas"). A turn that ended normally and changed files, or
// after which the engine suggested the next prompt (`prompt_suggestion`),
// hands control back with a card above the composer: a result line, a
// question, the next step as the one primary button, "not now" and ×.
// After a choice the card collapses and the turn keeps a one-line receipt
// under its reply. The outcome lives on the reply message, in memory only
// (a reloaded transcript has none).
import type { Msg, TurnStats } from './chat.svelte';

type Reply = Extract<Msg, { kind: 'assistant' }>;
/** What the reader did with a turn's card: picked its primary action,
 *  skipped it ("not now"), or closed it (×, Esc: no receipt). `what` is the
 *  suggestion picked or skipped; empty: the changes were the action. */
export type RecapOutcome = NonNullable<Reply['recap']>;

/** A card to show: the turn's last reply (where the outcome goes), its
 *  totals, the reply's last paragraph as plain text, the suggested next
 *  prompt ('' for none) and whether the changes can be opened. */
export interface Recap {
	reply: Reply;
	turn: TurnStats;
	summary: string;
	suggestion: string;
	review: boolean;
}

export interface RecapContext {
	/** A turn runs, or something else waits for the reader or is about to
	 *  start a turn (an approval, a queued message, a retry …). */
	busy: boolean;
	/** The last turn ended in an error. */
	failed: boolean;
	/** The engine's suggested next prompt ('' for none). */
	suggestion: string;
	/** The Changes panel can be opened from here. */
	review: boolean;
}

// Turns the user stopped, by their user message: such a turn ends like any
// other, so the stop is noted when it is asked for.
const stopped = new WeakSet<object>();

/** The running turn is being stopped: it gets no card. */
export function markStopped(messages: readonly Msg[]) {
	const user = messages.findLast((m) => m.kind === 'user');
	if (user) stopped.add(user);
}

/** The card for the latest turn, or null: none while busy, after a failed
 *  or stopped turn, once the reader chose, or with nothing to offer (no
 *  suggestion, and no changes to review). */
export function recapOf(messages: readonly Msg[], c: RecapContext): Recap | null {
	if (c.busy || c.failed) return null;
	let reply: Reply | null = null;
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i];
		if (m.kind === 'user') {
			if (stopped.has(m)) return null;
			break;
		}
		if (m.kind === 'error') return null;
		// The turn's totals are stamped on its last reply when it ends.
		if (!reply && m.kind === 'assistant' && m.turn && !m.interrupted) reply = m;
	}
	if (!reply?.turn || reply.recap) return null;
	const suggestion = oneLine(c.suggestion);
	const review = c.review && reply.turn.files > 0;
	if (!suggestion && !review) return null;
	return { reply, turn: reply.turn, summary: lastParagraph(reply.text), suggestion, review };
}

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The longest summary kept; the card shows two lines of it. */
const SUMMARY_MAX = 280;

/** The last paragraph of a Markdown reply that reads as prose, as plain
 *  text: code blocks, tables and rules are skipped, list items and quotes
 *  join into one line. */
export function lastParagraph(markdown: string): string {
	// Blocks of lines between blank lines; a fenced code block is left out
	// and ends the block before it.
	const blocks: string[][] = [[]];
	let fence = '';
	for (const line of markdown.replace(/\r\n?/g, '\n').split('\n')) {
		const mark = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
		if (fence) {
			if (mark && mark[0] === fence[0] && mark.length >= fence.length) fence = '';
		} else if (mark) {
			fence = mark;
			blocks.push([]);
		} else if (line.trim() === '') blocks.push([]);
		else blocks[blocks.length - 1].push(line);
	}
	for (let i = blocks.length - 1; i >= 0; i--) {
		const lines = blocks[i];
		// A table, a rule or an indented code block.
		if (lines.every((l) => /^\s*\|/.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) || /^( {4}|\t)/.test(l))) continue;
		const plain = oneLine(lines.map(plainLine).join(' '));
		if (plain) return plain.length > SUMMARY_MAX ? `${plain.slice(0, SUMMARY_MAX - 1)}…` : plain;
	}
	return '';
}

/** One Markdown line as the text it reads. */
function plainLine(line: string): string {
	return (
		line
			// Block markers: headings, quotes, list items, task boxes.
			.replace(/^\s{0,3}#{1,6}\s+/, '')
			.replace(/^\s*(>\s?)+/, '')
			.replace(/^\s*([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '')
			// Images and links keep their text; autolinks their address.
			.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
			.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
			.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
			.replace(/<((?:https?|mailto):[^>\s]+)>/g, '$1')
			// Inline code keeps its text; HTML tags go.
			.replace(/`+([^`]+)`+/g, '$1')
			.replace(/<\/?[a-zA-Z][^>]*>/g, '')
			// Emphasis: ** __ * _ ~~ around words (not inside snake_case).
			.replace(/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2')
			.replace(/(^|[^\w*])\*(?=\S)([^*]*?\S)\*(?!\w)/g, '$1$2')
			.replace(/(^|[^\w])_(?=\S)([^_]*?\S)_(?!\w)/g, '$1$2')
			.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '$1')
			// A hard break's backslash or trailing spaces.
			.replace(/\\$/, '')
	);
}

/** ⌘↵ on macOS, Ctrl+↵ elsewhere: picks the card's primary action. */
export function isPickKey(e: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, mac: boolean): boolean {
	return e.key === 'Enter' && !e.altKey && !e.shiftKey && (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey);
}

/** How the pick key reads in a tooltip. */
export const pickKeyLabel = (mac: boolean) => (mac ? '⌘↵' : 'Ctrl+Enter');

/** Whether the card may take a key now: not while focus is in another
 *  field (the composer only while its menu is closed), nor while a menu,
 *  a list or a dialog is open, which keep their own keys. */
export function keysFree(active: Element | null, composer: Element | null, doc: Pick<Document, 'querySelector' | 'body'>): boolean {
	if (doc.querySelector('.pop, [role="menu"], [role="listbox"], [role="dialog"]')) return false;
	if (!active || active === doc.body) return true;
	if (composer && composer.contains(active)) return active.getAttribute('aria-expanded') !== 'true';
	const field = (active as HTMLElement).isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName);
	return !field;
}
