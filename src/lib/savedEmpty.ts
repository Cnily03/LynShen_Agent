// A conversation the daemon lists with nothing in it. LynShen saves a new
// session as soon as it opens, so one opened without a first message (a
// command typed into a new conversation, an older version of this app) is on
// disk with no message, reply or goal. The session lists and the history
// leave such a conversation out until it has something; nothing is deleted.

/** What the daemon reports of a saved conversation: `entries` is how many
 *  entries its engine saved (LynShen conversations in `session_history`, and
 *  in the session list of newer daemons); null or absent when unknown. */
export interface SavedFacts {
	session: string;
	title?: string | null;
	entries?: number | null;
}

/** Saved with no entry and never named (the daemon names a conversation
 *  after its first message; older daemons label one by its id). An unknown
 *  count (other engines, older daemons) is never empty. */
export function savedEmpty(s: SavedFacts): boolean {
	return s.entries === 0 && (!s.title || s.title === s.session);
}
