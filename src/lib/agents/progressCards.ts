// The plan card and the subagents card at the top right of the chat leaf
// (design.md §4, "Status, attention and emphasis"): when they show, where
// they sit, what their checklist and title lines say, and when the plan card
// opens by itself. Pure: ChatPane and the cards pass in the chat's state.

import { CHAT_W_MIN } from '$lib/chatWidth';
import { discardedRun, isLive, planShown, type AgentRow, type PlanSummary, type StepState } from '$lib/agentProgress';

/** The room the cards take to the right of the transcript column: 16px of
 *  gap, the card (248px) and 16px to the leaf's edge. */
export const CARD_LANE = 280;

/** Which cards show: the plan while it is worth showing (planShown), the
 *  subagents while the turn has any. Both stay until the next turn. */
export interface CardsShown {
	plan: boolean;
	agents: boolean;
}

export function cardsShown(plan: PlanSummary, rows: AgentRow[], busy: boolean, planFresh: boolean): CardsShown {
	return { plan: planShown(plan, busy, planFresh), agents: rows.length > 0 };
}

export const anyCard = (shown: CardsShown) => shown.plan || shown.agents;

/** Where the column goes while the cards show. */
export interface CardsLayout {
	/** The cards sit beside the column. False: each card is its title line at
	 *  the top right, and opens as a popover over the transcript. */
	beside: boolean;
	/** The column's width and the room left and right of it in the leaf, px. */
	width: number;
	left: number;
	right: number;
}

/**
 * The column and the cards in a chat leaf `pane` px wide, whose column is
 * `width` px (chatColumnWidth) with at least `pad` px beside it.
 *
 * The cards sit beside the column when the leaf leaves CARD_LANE px to its
 * right. A centred column that leaves less moves left until it does, and
 * narrows when it must, keeping `pad` at its left; a column that would be
 * narrower than CHAT_W_MIN stays centred and the cards become title lines.
 */
export function cardsLayout(pane: number, width: number, pad: number): CardsLayout {
	const centred = Math.max(0, Math.floor((pane - width) / 2));
	if (centred >= CARD_LANE) return { beside: true, width, left: centred, right: pane - centred - width };
	const room = pane - CARD_LANE - pad;
	if (room < CHAT_W_MIN) return { beside: false, width, left: centred, right: Math.max(0, pane - centred - width) };
	const w = Math.min(width, room);
	return { beside: true, width: w, left: pane - CARD_LANE - w, right: CARD_LANE };
}

/** A step as the plan card shows it: the four plan states, and two the plan
 *  does not send — it failed, or it waits for the reader. */
export type StepMark = StepState | 'failed' | 'waiting';

/** Why a step failed or waits. */
export type StepReason =
	| { kind: 'approval' }
	| { kind: 'question' }
	/** The subagent that owns it failed. */
	| { kind: 'agent'; name: string; error: string }
	/** The turn ended in an error while it was the current step. */
	| { kind: 'turn'; error: string };

export interface StepView {
	text: string;
	state: StepMark;
	/** The path of the subagent that owns it ('' for none). */
	agent: string;
	files: string[];
	current: boolean;
	reason: StepReason | null;
}

/** What waits for the reader: an approval or a question, and the subagent
 *  that asks ('' for the main agent). */
export interface ReaderWait {
	kind: 'approval' | 'question';
	agent: string;
}

export interface PlanCardInput {
	plan: PlanSummary;
	rows: AgentRow[];
	busy: boolean;
	wait: ReaderWait | null;
	/** The error the last turn ended in ('' for none). */
	error: string;
}

export interface PlanCard {
	steps: StepView[];
	done: number;
	total: number;
	/** The step being worked on; -1 for none. */
	current: number;
	/** The first step that failed or waits for the reader; -1 for none. */
	attention: number;
}

const firstLine = (s: string) => s.split('\n').find((l) => l.trim())?.trim() ?? '';
const open = (state: StepMark) => state !== 'done' && state !== 'skipped';

/** The plan card's checklist: the plan's steps, a step whose subagent
 *  failed or that was current when the turn failed marked failed, and the
 *  step a pending approval or question holds marked waiting. */
export function planCard({ plan, rows, busy, wait, error }: PlanCardInput): PlanCard {
	const byId = new Map(rows.map((r) => [r.id, r]));
	const steps: StepView[] = plan.steps.map((s, i) => {
		const view: StepView = { text: s.text, state: s.state, agent: s.agent, files: s.files, current: i === plan.current, reason: null };
		const owner = s.agent ? byId.get(s.agent) : undefined;
		if (owner?.state === 'failed' && open(s.state))
			return { ...view, state: 'failed', reason: { kind: 'agent', name: owner.label, error: firstLine(owner.error || owner.activity) } };
		if (!busy && error && i === plan.current && open(s.state)) return { ...view, state: 'failed', reason: { kind: 'turn', error: firstLine(error) } };
		return view;
	});
	if (busy && wait) {
		const asker = wait.agent ? steps.findIndex((s) => s.agent === wait.agent && open(s.state)) : -1;
		const at = asker >= 0 ? asker : plan.current;
		const step = steps[at];
		if (step && open(step.state) && step.state !== 'failed') steps[at] = { ...step, state: 'waiting', reason: { kind: wait.kind } };
	}
	return {
		steps,
		done: plan.done,
		total: plan.total,
		current: plan.current,
		attention: steps.findIndex((s) => s.state === 'failed' || s.state === 'waiting')
	};
}

/** What makes the plan card open by itself: the step that fails or waits,
 *  by its place and text ('' while none does). The same step waiting again
 *  does not open it again. */
export function attentionKey(card: PlanCard): string {
	const s = card.steps[card.attention];
	return s ? `${s.state}:${card.attention}:${s.text}` : '';
}

/** The plan card opens by itself when a step newly fails or waits:
 *  `key` is attentionKey now, `seen` the last one handled. */
export const opensItself = (seen: string, key: string) => key !== '' && key !== seen;

/** The plan card's title line: "计划 3/7 · 跑单元测试". `step` is the step
 *  that fails or waits, else the current one; `allDone` once every step is
 *  done or skipped. */
export interface PlanTitle {
	count: string;
	step: string;
	tone: '' | 'failed' | 'waiting';
	allDone: boolean;
}

export function planTitle(card: PlanCard): PlanTitle {
	const at = card.attention >= 0 ? card.attention : card.current;
	const step = card.steps[at];
	const tone = step?.state === 'failed' || step?.state === 'waiting' ? step.state : '';
	return { count: `${card.done}/${card.total}`, step: step?.text ?? '', tone, allDone: card.total > 0 && card.done === card.total };
}

/** The subagents card's title line: how many, and how many still run (or
 *  failed, once none runs). */
export interface AgentsTitle {
	count: number;
	running: number;
	failed: number;
}

export function agentsTitle(rows: AgentRow[]): AgentsTitle {
	return { count: rows.length, running: rows.filter(isLive).length, failed: rows.filter((r) => r.state === 'failed').length };
}

/** A subagent's 6px state dot: running pulses; a state the team words
 *  beyond the five (a conflict, its budget used up) is a caution; one whose
 *  worktree was discarded is grey. */
export type DotTone = 'live' | 'idle' | 'ok' | 'err' | 'warn';

export function dotTone(row: Pick<AgentRow, 'state' | 'status'>): DotTone {
	if (row.status === 'conflict' || row.status === 'budget_exhausted') return 'warn';
	if (discardedRun(row)) return 'idle';
	switch (row.state) {
		case 'running':
			return 'live';
		case 'done':
			return 'ok';
		case 'failed':
			return 'err';
		default:
			return 'idle';
	}
}

/** Per session, what the reader chose: a card collapsed to its title line
 *  (both are open unless collapsed), and the last attention key handled. */
export interface CardsState {
	plan: boolean;
	agents: boolean;
	seen: string;
}

export const CARDS_DEFAULT: CardsState = { plan: true, agents: true, seen: '' };

const storageKey = (sessionId: string) => `lynshen-progress-cards:${sessionId}`;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const storage = (): Store | null => {
	try {
		return typeof localStorage === 'undefined' ? null : localStorage;
	} catch {
		return null;
	}
};

export function loadCards(sessionId: string, store: Store | null = storage()): CardsState {
	try {
		const v = JSON.parse(store?.getItem(storageKey(sessionId)) ?? '{}') as Partial<Record<keyof CardsState, unknown>>;
		return {
			plan: v.plan !== false,
			agents: v.agents !== false,
			seen: typeof v.seen === 'string' ? v.seen : ''
		};
	} catch {
		return { ...CARDS_DEFAULT };
	}
}

/** Keeps what differs from the default; nothing when nothing does. */
export function saveCards(sessionId: string, state: CardsState, store: Store | null = storage()) {
	const out: Partial<CardsState> = {};
	if (!state.plan) out.plan = false;
	if (!state.agents) out.agents = false;
	if (state.seen) out.seen = state.seen;
	try {
		if (Object.keys(out).length) store?.setItem(storageKey(sessionId), JSON.stringify(out));
		else store?.removeItem(storageKey(sessionId));
	} catch {
		/* storage full or unavailable */
	}
}
