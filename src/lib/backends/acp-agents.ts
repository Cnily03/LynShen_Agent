// Pure helpers for ACP agents (kept DOM-free for unit tests): the settings
// form fields, and the environment a session of an agent starts with. The
// registry itself lives Rust-side (acp_registry.rs).

import type { AcpAgent } from '$lib/protocol';

/** Splits an argument line into argv entries, honoring single/double quotes
 *  (`--flag "a b"` → ['--flag', 'a b']). No escapes, no expansion — this is a
 *  form-field convenience, not a shell. */
export function tokenizeArgs(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quote: '"' | "'" | null = null;
	let started = false;
	for (const ch of line) {
		if (quote) {
			if (ch === quote) quote = null;
			else cur += ch;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			started = true;
		} else if (ch === ' ' || ch === '\t') {
			if (started || cur) out.push(cur);
			cur = '';
			started = false;
		} else {
			cur += ch;
		}
	}
	if (started || cur) out.push(cur);
	return out.filter((a) => a.length > 0);
}

/** argv entries → an editable argument line (quotes entries with spaces). */
export function formatArgs(args: string[]): string {
	return args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ');
}

/** A registry id from a display name: lowercase slug, deduplicated against
 *  `taken` with a numeric suffix. */
export function slugifyAgentId(name: string, taken: Set<string> = new Set()): string {
	const base =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 48) || 'agent';
	if (!taken.has(base)) return base;
	for (let n = 2; ; n++) {
		const candidate = `${base}-${n}`;
		if (!taken.has(candidate)) return candidate;
	}
}

/** Whether an agent runs OpenCode's ACP server (`opencode acp`): its program
 *  by name or path, with or without a Windows extension. */
export function isOpencodeAgent(agent: Pick<AcpAgent, 'command' | 'args'>): boolean {
	const file = agent.command.split(/[\\/]/).pop() ?? '';
	const stem = file.replace(/\.(exe|cmd|bat|ps1)$/i, '');
	return stem.toLowerCase() === 'opencode' && agent.args[0] === 'acp';
}

function randomSecret(): string {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The environment a session of `agent` starts with: the backend's custom
 *  environment, then the agent's own. `opencode acp` also serves its HTTP API
 *  on 127.0.0.1 (port 4096 when free) with no password unless
 *  OPENCODE_SERVER_PASSWORD is set, so each OpenCode session gets a random
 *  one: other programs on this computer cannot drive it. */
export function agentEnv(
	agent: AcpAgent,
	base: Record<string, string> = {},
	secret: () => string = randomSecret
): Record<string, string> {
	const env = { ...base, ...agent.env };
	if (isOpencodeAgent(agent) && !env.OPENCODE_SERVER_PASSWORD) env.OPENCODE_SERVER_PASSWORD = secret();
	return env;
}
