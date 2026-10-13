import { describe, it, expect } from 'vitest';
import {
	allHunkIds,
	approvalModeKeys,
	buildApproveOp,
	buildSetApprovalModeOp,
	fromEngineMode,
	initialApprovalMode,
	MODE_ORDER,
	modeOfEngineName,
	needsClaudeYoloRespawn,
	nextApprovalMode,
	parseHunks,
	reconcileMode,
	refusedApprovalMode,
	selectionState,
	toEngineMode,
	toggleHunk,
	type ApprovalHunk,
	type ApprovalMode
} from './approval';

const HUNKS: ApprovalHunk[] = [
	{ id: 'f0h1', file: 'src/a.rs', header: '@@ -1,3 +1,3 @@', lines: [' a', '-b', '+c'] },
	{ id: 'f0h2', file: 'src/a.rs', header: '@@ -9,2 +9,3 @@', lines: ['+d'] },
	{ id: 'f1h1', file: 'src/b.rs', header: '@@ -1,1 +1,1 @@', lines: ['-e', '+f'] }
];

describe('approval mode mapping', () => {
	it('maps each desktop mode to its engine mode and back (round trip)', () => {
		const modes: ApprovalMode[] = ['ask', 'plan', 'auto', 'edits', 'all'];
		for (const m of modes) expect(fromEngineMode(toEngineMode(m))).toBe(m);
		expect(toEngineMode('ask')).toBe('read-only');
		expect(toEngineMode('plan')).toBe('plan');
		expect(toEngineMode('auto')).toBe('auto');
		expect(toEngineMode('edits')).toBe('auto-edit');
		expect(toEngineMode('all')).toBe('full-auto');
	});

	it('routes only a claude switch to full-auto through a respawn', () => {
		// claude's runtime bypassPermissions switch is ignored → respawn.
		expect(needsClaudeYoloRespawn('claude', 'full-auto')).toBe(true);
		// Every other claude mode switches live.
		for (const m of ['read-only', 'plan', 'auto', 'auto-edit'] as const)
			expect(needsClaudeYoloRespawn('claude', m)).toBe(false);
		// Other backends never respawn.
		expect(needsClaudeYoloRespawn('lynshen', 'full-auto')).toBe(false);
		expect(needsClaudeYoloRespawn('codex', 'full-auto')).toBe(false);
	});

	it('returns null for an unknown engine mode', () => {
		expect(fromEngineMode('yolo')).toBeNull();
		expect(fromEngineMode('')).toBeNull();
	});

	it('reconciles from an approval_mode event, keeping the current mode on garbage', () => {
		expect(reconcileMode('ask', 'full-auto')).toBe('all');
		expect(reconcileMode('all', 'read-only')).toBe('ask');
		expect(reconcileMode('edits', 'not-a-mode')).toBe('edits');
	});

	it('builds the set_approval_mode op', () => {
		expect(buildSetApprovalModeOp('edits')).toEqual({ op: 'set_approval_mode', mode: 'auto-edit' });
	});
});

describe('parseHunks', () => {
	it('parses the approval_request hunks array', () => {
		expect(
			parseHunks([{ id: 'f0h1', file: 'x.ts', header: '@@', lines: [' a', '+b'] }])
		).toEqual([{ id: 'f0h1', file: 'x.ts', header: '@@', lines: [' a', '+b'] }]);
	});

	it('collapses null / absent / malformed hunks to null (whole-call approval)', () => {
		expect(parseHunks(null)).toBeNull();
		expect(parseHunks(undefined)).toBeNull();
		expect(parseHunks('f0h1')).toBeNull();
		expect(parseHunks([{ file: 'x.ts' }])).toBeNull(); // missing id
		expect(parseHunks([{ id: '' }])).toBeNull();
	});
});

describe('hunk selection', () => {
	it('toggles a hunk in and out of the selection', () => {
		let sel = allHunkIds(HUNKS);
		sel = toggleHunk(sel, 'f0h2');
		expect(sel).toEqual(['f0h1', 'f1h1']);
		sel = toggleHunk(sel, 'f0h2');
		expect(sel).toContain('f0h2');
		expect(sel).toHaveLength(3);
	});

	it('classifies all / some / none selections', () => {
		expect(selectionState(HUNKS, allHunkIds(HUNKS))).toBe('all');
		expect(selectionState(HUNKS, ['f0h1'])).toBe('some');
		expect(selectionState(HUNKS, [])).toBe('none');
		// ids not in the hunk list don't count towards the selection
		expect(selectionState(HUNKS, ['ghost'])).toBe('none');
	});
});

describe('buildApproveOp', () => {
	it('carries where an always-allow rule is kept, never the session default', () => {
		expect(buildApproveOp('c', 'allow', { always: true, scope: 'project' })).toEqual({
			op: 'approve',
			call_id: 'c',
			decision: 'allow',
			always: true,
			always_scope: 'project'
		});
		expect(buildApproveOp('c', 'allow', { always: true, scope: 'session' })).toEqual({
			op: 'approve',
			call_id: 'c',
			decision: 'allow',
			always: true
		});
	});

	it('builds a whole-call allow (no hunks / always keys)', () => {
		expect(buildApproveOp('call_1', 'allow')).toEqual({
			op: 'approve',
			call_id: 'call_1',
			decision: 'allow'
		});
	});

	it('builds a subset allow with the checked hunk ids', () => {
		expect(buildApproveOp('call_1', 'allow', { hunks: ['f0h1', 'f1h1'] })).toEqual({
			op: 'approve',
			call_id: 'call_1',
			decision: 'allow',
			hunks: ['f0h1', 'f1h1']
		});
	});

	it('builds a deny and an always-allow', () => {
		expect(buildApproveOp('call_9', 'deny')).toEqual({
			op: 'approve',
			call_id: 'call_9',
			decision: 'deny'
		});
		expect(buildApproveOp('call_9', 'allow', { always: true })).toEqual({
			op: 'approve',
			call_id: 'call_9',
			decision: 'allow',
			always: true
		});
	});

	it('rejects always with hunks (always is whole-call only)', () => {
		expect(() => buildApproveOp('c', 'allow', { always: true, hunks: ['f0h1'] })).toThrow();
	});

	it('rejects hunks on a deny (partial approval is allow-only)', () => {
		expect(() => buildApproveOp('c', 'deny', { hunks: ['f0h1'] })).toThrow();
	});
});

describe('approval modes per backend', () => {
	const lynshen = { sandbox: true, extendedApprovalModes: false, planMode: true };
	const claude = { sandbox: false, extendedApprovalModes: true, planMode: true };
	const acpLike = { sandbox: false, extendedApprovalModes: false, planMode: false };

	it('offers five modes in Claude Code\'s order: 谨慎 / 自动改文件 / 计划 / 自动 / 全自动', () => {
		expect(MODE_ORDER).toEqual(['ask', 'edits', 'plan', 'auto', 'all']);
		expect(approvalModeKeys(lynshen)).toEqual(['ask', 'edits', 'plan', 'auto', 'all']);
		// An agent's session shows the agent's modes, in the same order.
		expect(approvalModeKeys(lynshen, true)).toEqual(['ask', 'edits', 'auto', 'all']);
		expect(approvalModeKeys(claude)).toEqual(['ask', 'edits', 'plan', 'auto', 'all']);
		expect(approvalModeKeys({ sandbox: false, extendedApprovalModes: false, planMode: true })).toEqual(['ask', 'edits', 'plan', 'all']);
		expect(approvalModeKeys(acpLike)).toEqual(['ask', 'edits', 'all']);
		// Every list keeps the shared order.
		for (const keys of [approvalModeKeys(lynshen, true), approvalModeKeys(acpLike)])
			expect([...keys].sort((a, b) => MODE_ORDER.indexOf(a) - MODE_ORDER.indexOf(b))).toEqual(keys);
	});

	it('cycles to the next mode (Shift+Tab), skipping the ones the engine refused', () => {
		const keys = approvalModeKeys(lynshen);
		expect(nextApprovalMode(keys, 'ask')).toBe('edits');
		expect(nextApprovalMode(keys, 'auto')).toBe('all');
		expect(nextApprovalMode(keys, 'all')).toBe('ask');
		expect(nextApprovalMode(keys, 'edits', ['plan', 'auto'])).toBe('all');
		// A mode outside the list (an agent's) starts the list over.
		expect(nextApprovalMode(['ask', 'all'], 'plan')).toBe('ask');
		expect(nextApprovalMode(['ask'], 'ask')).toBe('ask');
	});

	it('reads the mode an older engine refused', () => {
		expect(refusedApprovalMode("unknown approval mode 'auto': use manual, auto-edit, full-access, or plan")).toBe('auto');
		expect(refusedApprovalMode("unknown approval mode 'auto-edit': use manual, full-access")).toBe('edits');
		expect(refusedApprovalMode("unknown approval mode 'full-access'")).toBe('all');
		expect(refusedApprovalMode("unknown approval mode 'manual'")).toBe('ask');
		expect(refusedApprovalMode('unknown op: set_sandbox')).toBeNull();
		expect(refusedApprovalMode("unknown approval mode 'yolo'")).toBeNull();
		expect(modeOfEngineName('read-only')).toBe('ask');
		expect(modeOfEngineName('full-auto')).toBe('all');
	});

	it('starts a LynShen session in 自动, keeping only a saved 全自动', () => {
		expect(initialApprovalMode(null, true)).toBe('auto');
		for (const saved of ['ask', 'plan', 'auto', 'edits', 'junk']) expect(initialApprovalMode(saved, true)).toBe('auto');
		expect(initialApprovalMode('all', true)).toBe('all');
	});

	it('keeps the other backends as they were', () => {
		expect(initialApprovalMode(null, false)).toBe('ask');
		expect(initialApprovalMode('auto', false)).toBe('ask');
		expect(initialApprovalMode('plan', false)).toBe('ask');
		expect(initialApprovalMode('edits', false)).toBe('edits');
		expect(initialApprovalMode('all', false)).toBe('all');
	});
});
