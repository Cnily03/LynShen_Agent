// OpenCode (`opencode acp`) as an ACP agent: finding the registered one,
// refusing 2.x before a session starts, and having OpenCode copy one of its
// conversations into a daemon session (Settings → 导入, the history picker).
// The daemon does the rest (LynShen-CLI `engines/opencode.rs`).

import { t } from '$lib/i18n';
import { acpAgentCheck, acpAgentsList, daemon, recordOpencodeCopy, type AcpAgent } from '$lib/protocol';
import { agentEnv, isOpencodeAgent, opencodeRefusal } from './acp-agents';
import { buildBackendOpts } from './settings';

/** Whether a new OpenCode conversation runs on the LynShen gateway: when this
 *  computer is signed in to LynShen, as the account row last read it
 *  (accountSession.svelte.ts keeps that identity under `lynshen-account`). */
export function gatewayByDefault(): boolean {
	try {
		const kept = JSON.parse(localStorage.getItem('lynshen-account') ?? 'null') as { id?: unknown } | null;
		return typeof kept?.id === 'string' && kept.id !== '';
	} catch {
		return false;
	}
}

/** The registered OpenCode agent, if any. */
export async function opencodeAgent(): Promise<AcpAgent | undefined> {
	return (await acpAgentsList().catch(() => [] as AcpAgent[])).find(isOpencodeAgent);
}

/** Versions read lately, by command (`--version` takes a moment; a restore
 *  starts several sessions at once). */
const versions = new Map<string, { at: number; version: string }>();

/** Refuses OpenCode 2.x (`@opencode/cli`): its ACP differs, and it migrates
 *  OpenCode's database one way. An agent whose version cannot be read is
 *  left to start (the daemon refuses 2.x when it says so). */
export async function checkOpencode(entry: AcpAgent): Promise<void> {
	const known = versions.get(entry.command);
	let version = known && Date.now() - known.at < 60_000 ? known.version : undefined;
	if (version === undefined) {
		version = (await acpAgentCheck(entry.id).catch(() => null))?.version ?? '';
		versions.set(entry.command, { at: Date.now(), version });
	}
	const refused = opencodeRefusal(version);
	if (refused) throw new Error(t('shell.backend.opencodeV2', { version: refused }));
}

/** Has OpenCode copy conversation `original` (of folder `cwd`) into a
 *  daemon session without opening a tab: the copy waits in the daemon,
 *  listed under its folder's project, on the LynShen gateway when signed in.
 *  The copy is recorded, so opening the original again opens it. Returns
 *  its session id. */
export async function copyOpencode(cwd: string, original: string, title: string): Promise<string> {
	const entry = await opencodeAgent();
	if (!entry) throw new Error(t('shell.historySource.opencodeMissing'));
	await checkOpencode(entry);
	const base = buildBackendOpts('acp');
	const copy = await daemon.copyAcp(
		cwd,
		{
			engine: 'acp',
			options: {
				command: entry.command,
				args: entry.args,
				env: agentEnv(entry, base?.env),
				acp_agent: { id: entry.id, name: entry.name },
				lynshen_gateway: gatewayByDefault(),
				fork: original
			}
		},
		title
	);
	await recordOpencodeCopy(original, copy).catch(() => {});
	return copy;
}
