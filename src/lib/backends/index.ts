// Backend registry: the capability table and its gating helper.

import type { BackendCaps, BackendId } from './types';
import { LYNSHEN_CAPS } from './lynshen';
import { ACP_CAPS, CLAUDE_CAPS, CODEX_CAPS, OPENCODE_CAPS } from './caps';

export type { AcpAgentRef, BackendCaps, BackendId, EngineAdapter, AdapterIO, SessionCtx, NormalizedEvent } from './types';
export { BACKEND_IDS, NATIVE_BACKEND_IDS, BACKEND_LABELS, isBackendId, normalizeBackendId } from './types';

/** Static capability table. */
export const CAPS: Record<BackendId, BackendCaps> = {
	lynshen: LYNSHEN_CAPS,
	codex: CODEX_CAPS,
	claude: CLAUDE_CAPS,
	acp: ACP_CAPS
};

/**
 * THE capability-gating helper: every UI surface asks this one function.
 * Accepts anything carrying a `backendId` (ChatState does) — or nothing, which
 * gates like the native backend so pre-existing UI behavior is unchanged. An
 * ACP session of OpenCode (`acpOpencode`) has OpenCode's capabilities.
 */
export function caps(chat?: { backendId?: string; acpOpencode?: boolean } | null): BackendCaps {
	const id = chat?.backendId;
	if (id === 'acp' && chat?.acpOpencode) return OPENCODE_CAPS;
	return (id && id in CAPS ? CAPS[id as BackendId] : CAPS.lynshen);
}
