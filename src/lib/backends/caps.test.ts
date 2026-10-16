import { describe, it, expect } from 'vitest';
import { caps, CAPS, normalizeBackendId, isBackendId, BACKEND_IDS } from './index';
import { ChatState } from '$lib/chat.svelte';
import { approvalModeKeys } from '$lib/approval';
import { OPENCODE_CAPS } from './caps';

describe('caps() gating helper', () => {
	it('defaults to the native backend for missing/unknown input', () => {
		expect(caps(undefined)).toBe(CAPS.lynshen);
		expect(caps(null)).toBe(CAPS.lynshen);
		expect(caps({})).toBe(CAPS.lynshen);
		expect(caps({ backendId: 'weird' })).toBe(CAPS.lynshen);
	});

	it('resolves the backend from a ChatState', () => {
		const chat = new ChatState();
		expect(caps(chat)).toBe(CAPS.lynshen);
		chat.backendId = 'claude';
		expect(caps(chat)).toBe(CAPS.claude);
		chat.backendId = 'codex';
		expect(caps(chat)).toBe(CAPS.codex);
	});

	it('gates the UI surfaces the design calls out', () => {
		// lynshen: everything on.
		expect(caps({ backendId: 'lynshen' }).approvalModes).toBe(true);
		expect(caps({ backendId: 'lynshen' }).goals).toBe(true);
		// claude: approval picker, stop button, context ring, model picker
		// (list_models/set_model control requests), /compact (stream-json slash
		// text) and the resume picker (the daemon's session history, with transcript
		// replay) and rewind (reopened with --resume-session-at) are live;
		// so are subagents and background tasks (system/task_*), the CLI's own
		// slash commands, and its MCP servers (switch / reconnect, not edit);
		// steer (stdin is already a queue), plan/goal tabs, tree and skills stay
		// hidden.
		const cl = caps({ backendId: 'claude' });
		expect(cl.approvalModes).toBe(true);
		expect(cl.interrupt).toBe(true);
		expect(cl.contextUsage).toBe(true);
		expect(cl.steer).toBe(false);
		expect(cl.goals).toBe(false);
		expect(cl.branchTree).toBe(false);
		expect(cl.checkpoints).toBe(true); // conversation rewind via --resume-session-at respawn
		expect(cl.resume).toBe(true);
		expect(cl.skills).toBe(false);
		expect(cl.mcpManage).toBe(true);
		expect(cl.mcpEngineOwned).toBe(true);
		expect(cl.ruleScopes).toBe(true);
		expect(cl.subagents).toBe(true);
		expect(cl.modelPicker).toBe(true);
		expect(cl.slashCommands).toBe(true);
		expect(cl.compact).toBe(true);
		expect(cl.transcriptReplay).toBe(true);
		// lynshen: manual /compact stays available.
		expect(caps({ backendId: 'lynshen' }).compact).toBe(true);
		// codex: model picker, resume picker, compaction and goals are wired
		// (model/list, thread/list + thread/resume, thread/compact/start,
		// thread/goal/*); generic slash commands stay off.
		const cx = caps({ backendId: 'codex' });
		expect(cx.modelPicker).toBe(true);
		expect(cx.resume).toBe(true);
		expect(cx.compact).toBe(true);
		expect(cx.goals).toBe(true);
		expect(cx.transcriptReplay).toBe(true);
		expect(cx.slashCommands).toBe(false);
		expect(cx.checkpoints).toBe(true); // conversation rewind via thread/revert
		// steering, plan / auto modes, subagents with the agent trace and its
		// own MCP servers are wired too.
		expect(cx.steer).toBe(true);
		expect(cx.extendedApprovalModes).toBe(true);
		expect(cx.agentTrace).toBe(true);
		expect(cx.mcpEngineOwned).toBe(true);
	});

	it('every backend declares the full flag set', () => {
		const keys = Object.keys(CAPS.lynshen).sort();
		for (const id of BACKEND_IDS) {
			expect(Object.keys(CAPS[id]).sort()).toEqual(keys);
		}
	});
});

describe('backend id helpers', () => {
	it('normalizeBackendId maps unknown values to lynshen (restore path)', () => {
		expect(normalizeBackendId(undefined)).toBe('lynshen');
		expect(normalizeBackendId('claude')).toBe('claude');
		expect(normalizeBackendId('codex')).toBe('codex');
		expect(normalizeBackendId('gpt')).toBe('lynshen');
		expect(normalizeBackendId(42)).toBe('lynshen');
		expect(isBackendId('claude')).toBe(true);
		expect(isBackendId('x')).toBe(false);
	});
});

describe('OpenCode sessions', () => {
	it('have approval modes, plan among them, on top of the ACP capabilities', () => {
		const chat = new ChatState('acp');
		expect(caps(chat)).toBe(CAPS.acp);
		chat.acpOpencode = true;
		expect(caps(chat)).toBe(OPENCODE_CAPS);
		expect(approvalModeKeys(caps(chat))).toEqual(['ask', 'edits', 'plan', 'all']);
		expect(caps(chat).modelPicker).toBe(false);
		// Only an ACP session can be OpenCode.
		expect(caps({ backendId: 'claude', acpOpencode: true })).toBe(CAPS.claude);
	});
});
