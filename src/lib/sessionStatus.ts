// What a session wants the user to notice, most urgent first: it waits on
// them, its last turn failed, it is working, or it replied while out of view.
// No status means idle.
import type { ChatState } from '$lib/chat.svelte';

export type SessionStatus =
	/** `what`: the request in one line (the command, the question), or ''. */
	| { kind: 'input'; ask: 'approve' | 'answer'; what: string }
	| { kind: 'failed'; message: string }
	| { kind: 'running' }
	| { kind: 'unread' }
	| null;

/** The first non-empty line of a request's text. */
const firstLine = (text: string | undefined) => (text ?? '').split('\n').map((l) => l.trim()).find(Boolean) ?? '';

export function sessionStatus(chat: ChatState): SessionStatus {
	const asked = chat.pendingApproval;
	if (asked?.questions?.length) return { kind: 'input', ask: 'answer', what: firstLine(asked.questions[0].question) };
	if (asked) return { kind: 'input', ask: 'approve', what: firstLine(asked.summary) };
	if (chat.trustPrompt) return { kind: 'input', ask: 'approve', what: chat.trustPrompt.repoRoot ?? chat.trustPrompt.cwd };
	if (chat.engineState === 'exited') return { kind: 'failed', message: chat.lastError ?? '' };
	if (chat.lastError !== null) return { kind: 'failed', message: chat.lastError };
	if (chat.busy) return { kind: 'running' };
	if (chat.unseen) return { kind: 'unread' };
	return null;
}
