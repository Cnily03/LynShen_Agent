import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_RULES, loadRules, openTarget, saveRules, sayViewing } from './push';
import type { DaemonClient } from '$lib/daemon';

function daemon(reply: (op: Record<string, unknown>) => Record<string, unknown>) {
	const sent: Record<string, unknown>[] = [];
	const client = {
		request: vi.fn(async (op: Record<string, unknown>) => {
			sent.push(op);
			const answer = reply(op);
			if (answer.type === 'error') throw new Error(String(answer.message));
			return answer;
		})
	} as unknown as DaemonClient;
	return { client, sent };
}

describe('openTarget', () => {
	it('reads a session on a computer, a requirement, or nothing', () => {
		expect(openTarget('/remote?host=abc&session=s-1')).toEqual({ kind: 'session', session: 's-1', host: 'abc' });
		expect(openTarget('https://app.lynshen.org/remote?session=s-2')).toEqual({ kind: 'session', session: 's-2' });
		expect(openTarget('/remote?requirement=R-3')).toEqual({ kind: 'requirement', requirement: 'R-3' });
		expect(openTarget('/remote')).toBeNull();
		expect(openTarget('http://[bad')).toBeNull();
	});
});

describe('notification rules', () => {
	it('are the computer’s, with the defaults for what it does not say', async () => {
		const { client } = daemon(() => ({ type: 'push_rules', rules: { daily_budget: 5, sent_today: 2 } }));
		expect(await loadRules(client)).toEqual({ ...DEFAULT_RULES, daily_budget: 5, sent_today: 2 });
	});

	it('are null from an engine without them', async () => {
		const { client } = daemon(() => ({ type: 'error', message: 'unknown op push_rules' }));
		expect(await loadRules(client)).toBeNull();
	});

	it('send only what changed', async () => {
		const { client, sent } = daemon((op) => ({ type: 'push_rules', rules: { ...DEFAULT_RULES, ...(op.rules as object) } }));
		const rules = await saveRules(client, { quiet_start: '22:00' });
		expect(sent).toEqual([{ op: 'push_rules_set', rules: { quiet_start: '22:00' } }]);
		expect(rules.quiet_start).toBe('22:00');
		expect(rules.daily_budget).toBe(20);
	});
});

describe('sayViewing', () => {
	it('tells the computer, and an older one refusing it changes nothing', async () => {
		const { client, sent } = daemon(() => ({ type: 'error', message: 'unknown op' }));
		sayViewing(client, 's-1');
		sayViewing(client, null);
		await Promise.resolve();
		expect(sent).toEqual([
			{ op: 'push_viewing', session: 's-1' },
			{ op: 'push_viewing', session: null }
		]);
	});
});
