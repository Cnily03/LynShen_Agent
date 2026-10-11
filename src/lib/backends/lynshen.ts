// Native-engine adapter: the desktop's Op / AgentEvent dialect is the lynshen
// wire protocol, so events pass through untouched except for two things: the
// `hello` version frame, and approval-mode names (the engine says manual /
// full-access where the desktop says read-only / full-auto; plan and auto are
// the same on both sides).

import type { Op } from '$lib/protocol';
import type { BackendCaps, EngineAdapter, NormalizedEvent } from './types';

export const LYNSHEN_CAPS: BackendCaps = {
	approvalModes: true,
	extendedApprovalModes: false,
	// Plan mode: proposed_plan cards, approve_plan.
	planMode: true,
	hunkApproval: true,
	steer: true,
	unqueue: true,
	interrupt: true,
	branchTree: true,
	goals: true,
	skills: true,
	mcpManage: true,
	checkpoints: true,
	contextUsage: true,
	compact: true,
	modelPicker: true,
	resume: true,
	subagents: true,
	transcriptReplay: true,
	slashCommands: true,
	mcpEngineOwned: false,
	ruleScopes: false,
	sideQuestions: false,
	// agent_runs / subagent_transcript (an older engine refuses both: ChatState
	// drops the refusal and the spawn calls report the agents).
	agentTrace: true,
	// An older engine refuses context_usage: the panel shows the total only.
	contextBreakdown: true
};

/** Wire protocol version this desktop speaks (`hello.protocol`). */
export const LYNSHEN_PROTOCOL = 2;

const TO_ENGINE_MODE: Record<string, string> = {
	'read-only': 'manual',
	'auto-edit': 'auto-edit',
	auto: 'auto',
	plan: 'plan',
	'full-auto': 'full-access'
};
const FROM_ENGINE_MODE: Record<string, string> = {
	manual: 'read-only',
	'full-access': 'full-auto'
};

export function createLynShenAdapter(): EngineAdapter {
	return {
		id: 'lynshen',
		caps: LYNSHEN_CAPS,
		onStart() {
			/* no handshake — the daemon sends the session's startup events */
		},
		translate(raw: unknown): NormalizedEvent[] {
			const ev = raw as Record<string, unknown>;
			if (ev.type === 'hello') {
				if (ev.protocol === LYNSHEN_PROTOCOL) return [];
				return [
					{
						type: 'error',
						message: `lynshen speaks protocol ${String(ev.protocol)}, this desktop speaks ${LYNSHEN_PROTOCOL}; update both to the same release`
					}
				];
			}
			if (ev.type === 'approval_mode' && typeof ev.mode === 'string' && ev.mode in FROM_ENGINE_MODE) {
				return [{ ...(raw as NormalizedEvent), mode: FROM_ENGINE_MODE[ev.mode] }];
			}
			return [raw as NormalizedEvent];
		},
		encodeOp(op: Op): string[] {
			if (op.op === 'set_approval_mode') {
				return [JSON.stringify({ ...op, mode: TO_ENGINE_MODE[op.mode] ?? op.mode })];
			}
			if (op.op === 'approve_plan' && op.mode) {
				return [JSON.stringify({ ...op, mode: TO_ENGINE_MODE[op.mode] ?? op.mode })];
			}
			return [JSON.stringify(op)];
		}
	};
}
