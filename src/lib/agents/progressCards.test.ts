import { describe, expect, it } from 'vitest';
import { planSummary, type AgentRow } from '$lib/agentProgress';
import { CHAT_PAD, CHAT_PAD_RAIL, CHAT_W_MIN, chatColumnPad, chatColumnWidth } from '$lib/chatWidth';
import {
	CARD_LANE,
	CARDS_DEFAULT,
	agentsTitle,
	anyCard,
	attentionKey,
	cardsLayout,
	cardsShown,
	dotTone,
	loadCards,
	opensItself,
	planCard,
	planTitle,
	saveCards,
	type CardsState,
	type PlanCardInput
} from './progressCards';

const row = (over: Partial<AgentRow> = {}): AgentRow => ({
	id: '/root/worker-1',
	label: 'worker-1',
	model: '',
	state: 'running',
	startedAt: 0,
	durationMs: 0,
	endedAt: 0,
	activity: '',
	toolUseId: '',
	prompt: '',
	result: '',
	error: '',
	type: '',
	tokens: 0,
	toolCalls: 0,
	...over
});

/** The cards' layout in a chat leaf `pane` px wide, its column as the
 *  conversation computes it (自适应, with or without the turn rail). */
function layoutIn(pane: number, rail = true) {
	const pad = rail ? CHAT_PAD_RAIL : CHAT_PAD;
	const width = chatColumnWidth(pane, 'auto', pad);
	return cardsLayout(pane, width, chatColumnPad(pane, width, pad));
}

describe('wide and narrow chat leaves', () => {
	it('puts the cards beside a centred column that leaves their lane', () => {
		// A 2200px leaf: the 1120px column, centred, leaves 540px each side.
		expect(layoutIn(2200)).toMatchObject({ beside: true, width: 1120, left: 540, right: 540 });
		// A 1920 window with the navigator open (1628px leaf): centred, the
		// column would leave 254px; it moves 26px left and keeps its width.
		expect(layoutIn(1628)).toMatchObject({ beside: true, width: 1120, left: 228, right: CARD_LANE });
	});

	it('moves the column left, and narrows it, to make the lane at 1440 × 900', () => {
		// 1440 window, 292px navigator: a 1148px leaf. Centred, the 861px
		// column leaves 143px at its right: too little.
		const centred = layoutIn(1148);
		expect(centred.beside).toBe(true);
		expect(centred.right).toBe(CARD_LANE);
		expect(centred.left).toBe(CHAT_PAD_RAIL);
		expect(centred.width).toBe(1148 - CARD_LANE - CHAT_PAD_RAIL);
		expect(centred.left + centred.width + centred.right).toBe(1148);
		// Without the turn rail the column keeps 32px at its left.
		const plain = layoutIn(1148, false);
		expect(plain).toMatchObject({ beside: true, left: CHAT_PAD, right: CARD_LANE, width: 1148 - CARD_LANE - CHAT_PAD });
	});

	it('keeps a column that already fits as it is', () => {
		const at = cardsLayout(1400, 800, 32);
		expect(at).toEqual({ beside: true, width: 800, left: 300, right: 300 });
	});

	it('makes the cards title lines when the column would drop under its least width', () => {
		// 1100 × 760 and 1040 × 680 windows (808 and 748px leaves), and a
		// 1440 window with a tool leaf open beside the chat (58%: 666px).
		for (const pane of [808, 748, 666]) {
			const at = layoutIn(pane);
			expect(at.beside, `${pane}px leaf`).toBe(false);
			// The column stays where the conversation put it.
			expect(at.width).toBe(chatColumnWidth(pane, 'auto', CHAT_PAD_RAIL));
			expect(at.left + at.width + at.right).toBe(pane);
		}
	});

	it('switches at the leaf that leaves the lane beside the least column', () => {
		const edge = CHAT_W_MIN + CARD_LANE + CHAT_PAD;
		expect(cardsLayout(edge, CHAT_W_MIN, CHAT_PAD).beside).toBe(true);
		expect(cardsLayout(edge - 1, CHAT_W_MIN, CHAT_PAD).beside).toBe(false);
	});
});

describe('which cards show', () => {
	const plan = planSummary([
		{ step: '读代码', status: 'completed' },
		{ step: '跑单元测试', status: 'in_progress' }
	]);
	const empty = planSummary([]);

	it('shows the plan while the turn has one, the subagents while it runs any', () => {
		expect(cardsShown(plan, [], true, true)).toEqual({ plan: true, agents: false });
		expect(cardsShown(empty, [row()], true, false)).toEqual({ plan: false, agents: true });
		expect(anyCard(cardsShown(empty, [], true, false))).toBe(false);
	});

	it('keeps them until the next turn, but not an old plan', () => {
		// The turn ended: the plan it wrote and the agents it ran stay.
		expect(cardsShown(plan, [row({ state: 'done' })], false, true)).toEqual({ plan: true, agents: true });
		// A plan from an earlier turn does not come back.
		expect(cardsShown(plan, [], false, false).plan).toBe(false);
	});
});

describe('the plan card', () => {
	const steps = [
		{ step: '读代码', status: 'completed' },
		{ step: '改缓存', status: 'in_progress', agent: '/root/worker-1' },
		{ step: '跑单元测试', status: 'pending' },
		{ step: '写发布说明', status: 'pending' }
	];
	const input = (over: Partial<PlanCardInput> = {}): PlanCardInput => ({
		plan: planSummary(steps),
		rows: [row()],
		busy: true,
		wait: null,
		error: '',
		...over
	});

	it('writes its title line: label, count and the current step', () => {
		const card = planCard(input());
		expect(card.current).toBe(1);
		expect(card.attention).toBe(-1);
		expect(planTitle(card)).toEqual({ count: '1/4', step: '改缓存', tone: '', allDone: false });
		const done = planSummary(steps.map((s) => ({ ...s, status: 'completed' })));
		expect(planTitle(planCard(input({ plan: done, busy: false })))).toMatchObject({ count: '4/4', allDone: true });
	});

	it('marks the step whose subagent failed', () => {
		const card = planCard(input({ rows: [row({ state: 'failed', error: 'tests failed\nat line 3' })] }));
		expect(card.steps[1]).toMatchObject({ state: 'failed', reason: { kind: 'agent', name: 'worker-1', error: 'tests failed' } });
		expect(card.attention).toBe(1);
		expect(planTitle(card).tone).toBe('failed');
	});

	it('marks the current step failed when the turn ended in an error', () => {
		const card = planCard(input({ busy: false, error: 'rate limited' }));
		expect(card.steps[1]).toMatchObject({ state: 'failed', reason: { kind: 'turn', error: 'rate limited' } });
		// Still running: an old error says nothing about this turn.
		expect(planCard(input({ error: 'rate limited' })).attention).toBe(-1);
	});

	it('marks the step that waits for the reader', () => {
		// The main agent asks: its current step waits.
		const main = planCard(input({ wait: { kind: 'approval', agent: '' } }));
		expect(main.steps[1]).toMatchObject({ state: 'waiting', reason: { kind: 'approval' } });
		expect(planTitle(main)).toMatchObject({ step: '改缓存', tone: 'waiting' });
		// A subagent asks: the open step it owns waits, wherever the plan is.
		const plan = planSummary([steps[0], { ...steps[1], status: 'pending' }, { ...steps[2], status: 'in_progress' }, steps[3]]);
		const sub = planCard(input({ plan, wait: { kind: 'question', agent: '/root/worker-1' } }));
		expect(sub.current).toBe(2);
		expect(sub.attention).toBe(1);
		expect(sub.steps[1].reason).toEqual({ kind: 'question' });
		// The turn is over: nothing waits.
		expect(planCard(input({ busy: false, wait: { kind: 'approval', agent: '' } })).attention).toBe(-1);
	});
});

describe('the plan card opens by itself', () => {
	const plan = planSummary([
		{ step: '改缓存', status: 'in_progress' },
		{ step: '跑单元测试', status: 'pending' }
	]);
	const base: PlanCardInput = { plan, rows: [], busy: true, wait: null, error: '' };

	it('when a step newly fails or waits, once per step and reason', () => {
		const calm = attentionKey(planCard(base));
		expect(calm).toBe('');
		expect(opensItself('', calm)).toBe(false);

		const waiting = attentionKey(planCard({ ...base, wait: { kind: 'approval', agent: '' } }));
		expect(opensItself('', waiting)).toBe(true);
		// The same step waiting again (the next approval of that step) does not.
		expect(opensItself(waiting, attentionKey(planCard({ ...base, wait: { kind: 'approval', agent: '' } })))).toBe(false);

		// The same step failing is news.
		const failed = attentionKey(planCard({ ...base, busy: false, error: 'boom' }));
		expect(failed).not.toBe(waiting);
		expect(opensItself(waiting, failed)).toBe(true);

		// Another step waiting is news too.
		const next = planSummary([
			{ step: '改缓存', status: 'completed' },
			{ step: '跑单元测试', status: 'in_progress' }
		]);
		expect(opensItself(waiting, attentionKey(planCard({ ...base, plan: next, wait: { kind: 'approval', agent: '' } })))).toBe(true);
	});

	it('re-opens a card the reader collapsed, and remembers it did', () => {
		const store = memoryStore();
		saveCards('s1', { ...CARDS_DEFAULT, plan: false }, store);
		const key = attentionKey(planCard({ ...base, wait: { kind: 'question', agent: '' } }));
		const st = loadCards('s1', store);
		expect(st.plan).toBe(false);
		expect(opensItself(st.seen, key)).toBe(true);
		// What ProgressCards does then.
		saveCards('s1', { ...st, plan: true, seen: key }, store);
		const after = loadCards('s1', store);
		expect(after).toEqual({ plan: true, agents: true, seen: key });
		// Reloaded, the same step does not open it again.
		expect(opensItself(after.seen, key)).toBe(false);
	});
});

describe('collapsing, per session', () => {
	it('opens both cards unless the reader collapsed them', () => {
		const store = memoryStore();
		expect(loadCards('s1', store)).toEqual(CARDS_DEFAULT);
		saveCards('s1', { plan: false, agents: true, seen: '' }, store);
		saveCards('s2', { plan: true, agents: false, seen: '' }, store);
		expect(loadCards('s1', store)).toMatchObject({ plan: false, agents: true });
		expect(loadCards('s2', store)).toMatchObject({ plan: true, agents: false });
		expect(loadCards('s3', store)).toEqual(CARDS_DEFAULT);
	});

	it('keeps nothing for the default, and survives bad storage', () => {
		const store = memoryStore();
		saveCards('s1', { plan: false, agents: false, seen: '' }, store);
		saveCards('s1', { ...CARDS_DEFAULT }, store);
		expect(store.data.size).toBe(0);
		store.data.set('lynshen-progress-cards:s1', '{not json');
		expect(loadCards('s1', store)).toEqual(CARDS_DEFAULT);
		expect(loadCards('s1', null)).toEqual(CARDS_DEFAULT);
		const full = { ...memoryStore(), setItem: () => { throw new Error('quota'); } };
		expect(() => saveCards('s1', { plan: false, agents: true, seen: '' } satisfies CardsState, full)).not.toThrow();
	});
});

describe('the subagents card', () => {
	it('writes its title line: how many, how many run or failed', () => {
		const rows = [row(), row({ id: 'b', state: 'queued' }), row({ id: 'c', state: 'failed' }), row({ id: 'd', state: 'done' })];
		expect(agentsTitle(rows)).toEqual({ count: 4, running: 2, failed: 1 });
	});

	it('gives each subagent one 6px dot tone', () => {
		expect(dotTone({ state: 'running' })).toBe('live');
		expect(dotTone({ state: 'queued' })).toBe('idle');
		expect(dotTone({ state: 'done' })).toBe('ok');
		expect(dotTone({ state: 'failed' })).toBe('err');
		expect(dotTone({ state: 'done', status: 'conflict' })).toBe('warn');
		expect(dotTone({ state: 'failed', status: 'budget_exhausted' })).toBe('warn');
		// A discarded worktree is no success: grey. A run that failed stays red.
		expect(dotTone({ state: 'done', status: 'discarded' })).toBe('idle');
		expect(dotTone({ state: 'failed', status: 'discarded' })).toBe('err');
		expect(dotTone({ state: 'done', status: 'merged' })).toBe('ok');
	});
});

function memoryStore() {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k)
	};
}
