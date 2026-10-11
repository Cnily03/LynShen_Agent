import { t } from '$lib/i18n';
import { invoke } from '@tauri-apps/api/core';
import type { McpServerEntry } from './mcp';
import { DaemonClient, type DaemonEndpoint, type EngineSpec, type SocketLike } from './daemon';
import { buildBackendOpts } from './backends/settings';

// Started when needed with the lynshen backend's binary and environment (the
// daemon runs lynshen sessions itself).
const daemonEndpoint = () => {
	const opts = buildBackendOpts('lynshen');
	return invoke<DaemonEndpoint>('daemon_endpoint', { binOverride: opts?.bin_override, env: opts?.env });
};

/** The desktop's connection to the local `lynshen daemon`, which runs every
 *  session; the page wires its `onFrame` / `onExit` into the session store.
 *  The remote page makes one connection per computer (remote/connection). */
export const daemon = new DaemonClient(daemonEndpoint, (url) => new WebSocket(url) as unknown as SocketLike);

/** Starts (or, with `resume`, reopens) a session hosted by the daemon;
 *  `agent` starts it as that long-lived agent, `chat` as a chat. */
/** Renames, (un)archives or hides a daemon session for every client. */
export function sessionMeta(
	session: string,
	changes: { title?: string; archived?: boolean; hidden?: boolean; group?: string }
): Promise<void> {
	return daemon.post({ op: 'session_meta', session, ...changes });
}

export function hostSession(
	session: string,
	cwd: string,
	resume?: string,
	agent?: string,
	chat = false,
	engine?: EngineSpec
): Promise<void> {
	return daemon.open(session, cwd, resume, agent, chat, engine);
}

// Commands the GUI sends to a session's engine.
export type Op =
	| { op: 'user_message'; content: string; images?: string[] }
	| { op: 'command'; input: string }
	| { op: 'steer' }
	/** Takes the queued message at `index` (with this text) back before it runs. */
	| { op: 'unqueue'; index: number; text: string }
	// LynShen: runs a failed turn again with no new message (SessionStore.retryTurn).
	| { op: 'continue' }
	| { op: 'interrupt' }
	| { op: 'shutdown' }
	// Structured approval answer: `hunks` (edit tools, partial approval) is only
	// valid with decision "allow"; `always` is whole-call only (never with hunks).
	// claude: `always_scope` saves the always-allow rule for the project or the user.
	| {
			op: 'approve';
			call_id: string;
			decision: 'allow' | 'deny';
			hunks?: string[];
			always?: boolean;
			always_scope?: 'session' | 'project' | 'user' | 'rule';
			answers?: Record<string, string>;
	  }
	// Engine-level auto-approval policy; acknowledged by an `approval_mode` event.
	| { op: 'set_approval_mode'; mode: 'read-only' | 'plan' | 'auto' | 'auto-edit' | 'full-auto' }
	// MCP server management (engine config is global; any live session's engine
	// can answer). Each op is acknowledged by an `mcp_servers` event.
	| { op: 'mcp_list' }
	// What the context holds, by category (caps.contextBreakdown): a `context_breakdown` event.
	| { op: 'context_usage' }
	| { op: 'mcp_set'; server: McpServerEntry }
	| { op: 'mcp_remove'; name: string }
	| { op: 'mcp_toggle'; name: string; enabled: boolean }
	// claude: a session's own servers (Claude Code's config), its background
	// tasks and its permission rules.
	| { op: 'mcp_reconnect'; name: string }
	| { op: 'mcp_login'; name: string }
	| { op: 'stop_task'; task_id: string }
	| { op: 'task_output'; task_id: string }
	| { op: 'permission_rules' }
	// claude: the agent trace (Workflows, Task subagents) and one subagent's conversation.
	| { op: 'agent_runs' }
	| { op: 'subagent_transcript'; agent_id: string }
	// lynshen agent team: merge a subagent's worktree into the project, or drop
	// it; answered with `merge_result`.
	| { op: 'merge_agent'; target: string; action: 'apply' | 'discard' }
	// lynshen agent team: stop one subagent (answered by its lifecycle).
	| { op: 'close_agent'; target: string }
	// lynshen best-of-N: merge the chosen attempt of a group, discard the
	// others; answered by one `merge_result` per attempt.
	| { op: 'pick_attempt'; group: string; target: string }
	// lynshen plan mode: run a proposed plan in `mode`, or revise it with `feedback`.
	| {
			op: 'approve_plan';
			id: string;
			decision: 'approve' | 'revise';
			mode?: 'read-only' | 'auto' | 'auto-edit' | 'full-auto';
			feedback?: string;
	  };

/** Saves an MCP server change (`mcp_set` / `mcp_remove` / `mcp_toggle`) for
 *  every session; open LynShen sessions apply it at once. */
export async function changeMcpServers(op: Op): Promise<void> {
	await daemon.connect();
	await daemon.request(op);
}

export function closeSession(session: string): Promise<void> {
	return daemon.close(session);
}

export function sendOp(session: string, op: Op): Promise<void> {
	return daemon.send(session, JSON.stringify(op));
}

/** Writes one protocol frame to the session's engine. */
export function sendLine(session: string, line: string): Promise<void> {
	return daemon.send(session, line);
}

/** Availability probe for a backend binary (`<bin> --version`). */
export interface BackendStatus {
	found: boolean;
	path?: string | null;
	version?: string | null;
	/** Claude Code / Codex: signed in to an account of their own. */
	signed_in?: boolean;
}
export function checkBackend(backend: string, binOverride?: string): Promise<BackendStatus> {
	return invoke('check_backend', { backend, binOverride });
}

// ACP agent registry (Rust-owned: ~app-config/acp-agents.json). command/args/
// env are validated Rust-side on every read and write; a session starts the
// entry's command line in the daemon.
export interface AcpAgent {
	id: string;
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
}
export function acpAgentsList(): Promise<AcpAgent[]> {
	return invoke('acp_agents_list');
}
export function acpAgentUpsert(agent: AcpAgent): Promise<AcpAgent[]> {
	return invoke('acp_agent_upsert', { agent });
}
export function acpAgentRemove(id: string): Promise<AcpAgent[]> {
	return invoke('acp_agent_remove', { id });
}
/** Availability probe for one registered ACP agent (`<command> --version`). */
export function acpAgentCheck(id: string): Promise<BackendStatus> {
	return invoke('acp_agent_check', { id });
}

/** Login-shell environment snapshot state (see src-tauri/src/shell_env.rs). */
export interface ShellEnvStatus {
	supported: boolean;
	captured: boolean;
	count: number;
	captured_at_ms?: number | null;
	shell?: string | null;
}
export function shellEnvStatus(): Promise<ShellEnvStatus> {
	return invoke('shell_env_status');
}
export function refreshShellEnv(): Promise<ShellEnvStatus> {
	return invoke('refresh_shell_env');
}

/** Makes `lynshen` a terminal command running the app's bundled CLI; the
 *  command's location. */
export function installCliCommand(): Promise<string> {
	return invoke('install_cli_command');
}

// Conversations Claude Code / Codex saved in their own apps, imported as a
// cleaned copy that LynShen resumes (src-tauri/src/native_import.rs).
export type NativeSource = 'claude' | 'codex';
export interface NativeSession {
	id: string;
	title: string;
	mtime_ms: number;
	origin: string;
	/** The LynShen copy when it was imported before. */
	imported: string | null;
}
export function nativeSessions(source: NativeSource, cwd: string): Promise<NativeSession[]> {
	return invoke('native_sessions', { source, cwd });
}
export function importNativeSession(source: NativeSource, cwd: string, id: string): Promise<{ id: string; title: string }> {
	return invoke('import_native_session', { source, cwd, id });
}

// 一键导入: what the other coding agents on this machine have — conversations
// in every folder, skills and MCP servers (src-tauri/src/agent_import).
export type ImportSource = 'claude' | 'codex' | 'opencode' | 'zcode' | 'omp';
export interface ImportSession {
	source: ImportSource;
	id: string;
	title: string;
	cwd: string;
	updated_at_ms: number;
	/** Prompts the user sent. */
	messages: number;
	/** Imported before: importing again opens that copy. */
	imported: boolean;
}
export interface ImportSkill {
	source: ImportSource;
	name: string;
	description: string;
	path: string;
	/** The plugin it comes with. */
	plugin: string | null;
	/** LynShen already has a skill of this name. */
	present: boolean;
}
export interface ImportMcp {
	source: ImportSource;
	/** The plugin or project folder it is set for; empty for the tool's own settings. */
	from: string;
	name: string;
	transport: 'stdio' | 'http';
	command: string | null;
	args: string[] | null;
	url: string | null;
	present: boolean;
	/** The `mcp_servers` entry to add. */
	entry: McpServerEntry;
}
export interface ImportScan {
	sessions: ImportSession[];
	skills: ImportSkill[];
	mcp: ImportMcp[];
}
export interface ImportOutcome {
	kind: 'session' | 'skill';
	source: ImportSource;
	/** Session id or skill folder, as the scan named it. */
	key: string;
	status: 'imported' | 'existing' | 'failed';
	/** Session: the copy to open. Skill: where it was copied. */
	target: string | null;
	title: string | null;
	cwd: string | null;
	/** The backend the copy continues on. */
	engine: 'lynshen' | 'claude' | 'codex' | null;
	cwd_exists: boolean;
	error: string | null;
}
export function importScan(): Promise<ImportScan> {
	return invoke('import_scan');
}
export function importApply(selection: {
	sessions: { source: ImportSource; id: string; cwd: string }[];
	skills: { source: ImportSource; path: string }[];
}): Promise<ImportOutcome[]> {
	return invoke('import_apply', { selection });
}

/** One conversation saved in a directory, by any engine, as the daemon
 *  lists it (`session_history`). `updated_at` is in milliseconds. */
export interface HistoryItem {
	session: string;
	title: string;
	updated_at: number;
	entries: number;
	archived: boolean;
	agent: string | null;
	/** Hosted by the daemon right now. */
	open: boolean;
	/** `lynshen`, `claude` or `codex`. */
	engine?: string;
}
export async function sessionHistory(cwd: string): Promise<HistoryItem[]> {
	const reply = await daemon.request({ op: 'session_history', cwd });
	return (reply.sessions as HistoryItem[]) ?? [];
}

// Config / auth (read & write ~/.lynshen/{config.json,auth.json} via Tauri fs).
export function readConfig(): Promise<Record<string, unknown>> {
	return invoke('read_config');
}
export function writeConfig(patch: Record<string, unknown>): Promise<void> {
	return invoke('write_config', { patch });
}
// The engine's shell hooks (~/.lynshen/hooks.json): read as an object ({}
// when there is no file; a file that does not parse rejects), written by
// replacing top-level keys only (the others stay as they are).
export function readHooks(): Promise<Record<string, unknown>> {
	return invoke('read_hooks');
}
export function writeHooks(patch: Record<string, unknown[]>): Promise<void> {
	return invoke('write_hooks', { patch });
}
export function readAuthProviders(): Promise<string[]> {
	return invoke('read_auth_providers');
}
// Desktop app-data files (workspaces / layout), stored under the per-app
// config dir. Read resolves null when the file doesn't exist yet; write is
// atomic (write-then-rename) Rust-side.
export function appDataRead(file: string): Promise<string | null> {
	return invoke('app_data_read', { file });
}
export function appDataWrite(file: string, content: string): Promise<void> {
	return invoke('app_data_write', { file, content });
}
export function setAuthKey(provider: string, key: string): Promise<void> {
	return invoke('set_auth_key', { provider, key });
}
export function removeAuthKey(provider: string): Promise<void> {
	return invoke('remove_auth_key', { provider });
}

// Skills marketplace: the daemon combines github.com/anthropics/skills with
// community skill repositories and installs into the backend's personal skills
// directory.
/** `anthropic`, or a community repository's `owner/repo`. */
export type SkillSource = string;
export interface MarketSkill {
	id: string;
	name: string;
	description: string;
	tags: string[];
	source: SkillSource;
	/** The source as shown: Anthropic, Ikaleio, Superpowers… */
	sourceName?: string;
	isDefault: boolean;
	installed: boolean;
	license: string;
	redistributable: boolean;
	homepage: string;
}
export interface SkillCatalog {
	skills: MarketSkill[];
	warnings: string[];
	installDir: string;
}
export async function fetchMarketplace(backend: string): Promise<SkillCatalog> {
	await daemon.connect();
	return (await daemon.request({ op: 'skills_catalog', backend })) as unknown as SkillCatalog;
}
export async function installMarketplaceSkill(source: SkillSource, id: string, backend: string): Promise<string> {
	await daemon.connect();
	const reply = await daemon.request({ op: 'skill_install', source, skill: id, backend });
	return reply.path as string;
}

// LynShen account: plan / balance / usage / call-details, fetched via the
// OAuth read endpoints using the stored device access token (auto-refreshed).
export interface AccountInfo {
	email?: string;
	nickname?: string | null;
	balance?: string;
	currency?: string;
	active_plan?: { name?: string; type?: string; expire_at?: string } | null;
}
export interface PlanUsage {
	has_active_plan?: boolean;
	plan_name?: string;
	currency?: string;
	quota_5h?: string;
	used_5h?: string;
	quota_weekly?: string;
	used_weekly?: string;
	quota_monthly?: string;
	used_monthly?: string;
}
/** Token counts of a usage row: cached ⊆ input, reasoning ⊆ output. */
export interface UsageTokens {
	input_tokens: number;
	cached_input_tokens: number;
	cache_write_tokens: number;
	output_tokens: number;
	reasoning_tokens: number;
	turns: number;
	/** Gateway cost (account currency), cloud rows only. */
	cost?: string;
}
/** lynshen: the LynShen gateway; third_party: a built-in catalog provider;
 *  local: the user's own logins and providers; legacy: older local counts
 *  that cannot be told apart. */
export type ChannelKind = 'lynshen' | 'third_party' | 'local' | 'legacy';
/** Coding-agent usage over a range: the account's (cloud, every computer)
 *  or this computer's (the daemon's `usage_local`, with projects). */
export interface UsageSummary {
	totals: UsageTokens;
	days: (UsageTokens & { day: string })[];
	by_channel: (UsageTokens & { channel_kind: ChannelKind; channel: string; group?: string })[];
	by_model: (UsageTokens & { model: string })[];
	by_engine: (UsageTokens & { engine: string })[];
	by_device?: (UsageTokens & { authorization_id: string | null; name: string })[];
	by_project?: (UsageTokens & { cwd: string })[];
}
/** One coding-agent turn as the account recorded it. */
export interface AgentTurnRow extends Omit<UsageTokens, 'turns'> {
	turn_id: string;
	engine: string;
	channel_kind: ChannelKind;
	channel: string;
	group: string;
	model: string;
	requests: number;
	device: { id: string; name: string } | null;
	started_at: number | null;
	ended_at: number | null;
}
/** A model the LynShen account can use (GET /v1/models). */
export type LynShenModel = {
	id: string;
	/** Smallest window among the gateway accounts serving the model; absent
	 *  when the gateway has none configured. */
	context_window?: number;
	/** Largest; the user may raise their window up to this. */
	max_context_window?: number;
	/** Input and output together, when the gateway records it; the window
	 *  above is the input part and can be far smaller. */
	context_total?: number;
	max_output_tokens?: number;
	reasoning_efforts?: string[];
	/** What the model is called for people; absent: the id. */
	display_name?: string;
	/** The window range through each of the account's groups, by group id. */
	group_context_windows?: Record<string, { context_window: number; max_context_window: number }>;
};
export async function fetchLynShenModels(): Promise<LynShenModel[]> {
	const v = await invoke<{ data?: LynShenModel[] }>('fetch_lynshen_models');
	return Array.isArray(v.data) ? v.data : [];
}
export type LynShenGroup = {
	id: string;
	name: string;
	description?: string;
	billing_source?: 'plan_only' | 'balance_only' | '';
	rate_multiplier: number;
	models?: string[];
	/** Each model's window range through this group, by model name. */
	context_windows?: Record<string, { context_window: number; max_context_window: number }>;
};
export async function fetchLynShenGroups(): Promise<LynShenGroup[]> {
	const v = await invoke<{ groups?: LynShenGroup[] }>('fetch_lynshen_groups');
	return Array.isArray(v.groups) ? v.groups : [];
}
export function fetchAccountInfo(): Promise<AccountInfo> {
	return invoke('fetch_account_info');
}

// DeepSeek balance (api.deepseek.com/user/balance), keyed by the stored API key.
export interface DeepseekBalance {
	is_available: boolean;
	balance_infos: { currency: string; total_balance: string; granted_balance: string; topped_up_balance: string }[];
}
export function fetchDeepseekBalance(): Promise<DeepseekBalance> {
	return invoke('fetch_deepseek_balance');
}

// Monoize 网关（LynShen Console）。余额走 /user/balance——网关按 DeepSeek
// /user/balance 的格式作答，所以直接复用上面的类型；模型列表走 /v1/models。
export function fetchMonoizeBalance(): Promise<DeepseekBalance> {
	return invoke('fetch_monoize_balance');
}
/** A Provider the key may route this model through (DA-8a). */
export type MonoizeRoute = { id: string; name: string; group: string; account_class: string };
export type MonoizeModel = {
	id: string;
	owned_by?: string;
	groups?: string[];
	routing_status?: string;
	providers?: MonoizeRoute[];
	/** The window the gateway registers for the model (DA-8d); null: none registered. */
	context_window?: number | null;
	/** Input and output together, when the gateway records it; the window
	 *  above is the input part and can be far smaller (DA-8d). */
	context_total?: number | null;
	max_output_tokens?: number | null;
};
export async function fetchMonoizeModels(): Promise<MonoizeModel[]> {
	const v = await invoke<{ data?: MonoizeModel[] }>('fetch_monoize_models');
	return Array.isArray(v.data) ? v.data : [];
}

// Monoize 账号体系：与 web 网关同一套登录/注册。登录成功后网关会话由桌面端
// 保管，并自动创建一条仅客户端使用的 API key（界面不展示、退出即吊销）。
export type MonoizeUser = {
	id: string;
	username: string;
	role: string;
	email?: string | null;
	balance_usd?: string;
	balance_unlimited?: boolean;
	/** The subscription plan, where the gateway reports one (the dashboard
	 *  session's /api/dashboard/auth/me does; the device login's
	 *  /api/desktop/oauth/me does not yet). */
	billing_plan?: { name?: string } | null;
};
export async function monoizeLogout(): Promise<void> {
	return invoke('monoize_logout');
}
export async function monoizeSession(): Promise<{ logged_in: boolean; session?: { user: MonoizeUser } }> {
	return invoke('monoize_session');
}
/** The account's own requests over the last 60 seconds, as the console's
 *  account menu shows them (body of GET /api/dashboard/me/live-usage). */
export interface LiveUsage {
	rpm: number;
	tpm: number;
	/** cache_read / input tokens, 0–1; null when the window had no input. */
	cache_hit_rate: number | null;
}
/** A refusal from the gateway with its error code (`insufficient_balance`,
 *  `email_unverified`, `invite_code_invalid`, `not_signed_in`…). */
export class GatewayError extends Error {
	constructor(
		message: string,
		readonly code: string | null,
		readonly status: number | null
	) {
		super(message);
	}
}

/** A device-key call whose failure keeps the gateway's code (monoize_auth `gateway_key_call`). */
async function gatewayCall<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
	try {
		return await invoke<T>(cmd, args);
	} catch (error) {
		const raw = String(error);
		let parsed: { message?: unknown; code?: unknown; status?: unknown } | null = null;
		try {
			parsed = JSON.parse(raw);
		} catch {
			parsed = null;
		}
		if (parsed && typeof parsed === 'object') {
			throw new GatewayError(
				String(parsed.message ?? raw),
				typeof parsed.code === 'string' ? parsed.code : null,
				typeof parsed.status === 'number' ? parsed.status : null
			);
		}
		throw new GatewayError(raw, null, null);
	}
}

/** The invite program (gateway DA-9, RF-API-1): amounts in CNY fen, times in Unix ms. */
export interface ReferralOverview {
	code: string;
	invite_url?: string;
	enabled: boolean;
	/** Masked username of the inviter, or null. */
	invited_by: string | null;
	/** An inviter's code can still be added (within 7 days of signing up). */
	can_bind: boolean;
	bind_until: number;
	rules: { bonus_fen: number; share_bp: number; window_days: number; min_usage_hours: number; min_consumption_fen: number };
	stats: { invited: number; qualified: number; pending: number; earned_fen: number };
	invitees: { username: string; registered_at: number; status: 'pending' | 'qualified' | 'reviewing' | 'rejected'; earned_fen: number; window_ends_at: number | null }[];
}
export const fetchReferrals = () => gatewayCall<ReferralOverview>('monoize_referrals');
export const bindReferral = (code: string) => gatewayCall<ReferralOverview>('monoize_bind_referral', { code });

/** The account's authorized devices (gateway DA-10, AD-API-1); times in Unix ms. */
export interface DeviceOverview {
	devices: { id: string; name: string; api_key_id: string; created_at: number; last_used_at: string | null; expires_at: string | null; active: boolean; revokes_at: number }[];
	ips: { ip: string; first_seen_at: number; last_seen_at: number; active: boolean; expires_at: number }[];
	seats: { id: string; kind: 'device' | 'ip'; starts_at: number; expires_at: number; price_nano_usd: string; source: string; active: boolean }[];
	limits: { device: { used: number; limit: number }; ip: { used: number; limit: number } };
	prices: { days: number; ip_cny_fen: number; device_cny_fen: number }[];
	device_idle_days: number;
	ip_idle_days: number;
	/** This app's own key: its row is "this device". */
	current_api_key_id: string;
}
export const fetchDevices = () => gatewayCall<DeviceOverview>('monoize_devices');
export const buySeat = (kind: 'device' | 'ip', days: number, requestId: string) =>
	gatewayCall<{ balance_nano_usd: string }>('monoize_buy_seat', { kind, days, requestId });

/** The account's own requests over the last 60 seconds, for the account
 *  card's RPM / TPM / cache-hit tiles (GET /api/desktop/oauth/live-usage with
 *  the device key); null when unavailable (signed out, an older gateway), and
 *  the tiles show "—". */
export async function fetchMonoizeLiveUsage(): Promise<LiveUsage | null> {
	const v = await invoke<Partial<LiveUsage>>('fetch_monoize_live_usage');
	if (typeof v?.rpm !== 'number' || typeof v.tpm !== 'number') return null;
	return { rpm: v.rpm, tpm: v.tpm, cache_hit_rate: typeof v.cache_hit_rate === 'number' ? v.cache_hit_rate : null };
}
/** 模型广场：登录用户各分组内可调用的模型（服务端已按分组过滤）。
 *  `groups` 是该模型出现的分组；跨分组同名模型以 `模型@分组` 区分。 */
export type MonoizeMarketplaceModel = {
	model_id: string;
	models_dev_provider?: string | null;
	mode?: string | null;
	input_cost_per_token_nano?: number | string | null;
	output_cost_per_token_nano?: number | string | null;
	max_input_tokens?: number | null;
	max_output_tokens?: number | null;
	groups?: string[];
	routing_status?: string;
	providers?: MonoizeRoute[];
};
/** Group labels are presentation only; model_id remains the request identifier. */
export function monoizeModelEntries(m: MonoizeMarketplaceModel): string[] {
	const groups = m.groups ?? [];
	return groups.length ? groups.map((g) => `${m.model_id}（${g}）`) : [`${m.model_id}（${t('settings.account.groupUnresolved')}）`];
}
export async function monoizeMarketplace(): Promise<MonoizeMarketplaceModel[]> {
	const v = await invoke<MonoizeMarketplaceModel[] | { data?: MonoizeMarketplaceModel[] }>('monoize_marketplace');
	return Array.isArray(v) ? v : Array.isArray((v as { data?: unknown }).data) ? (v as { data: MonoizeMarketplaceModel[] }).data : [];
}
export function fetchUsage(): Promise<PlanUsage> {
	return invoke('fetch_usage');
}
export function fetchAgentUsageSummary(days: number): Promise<UsageSummary> {
	return invoke('fetch_agent_usage_summary', { days, tzOffset: new Date().getTimezoneOffset() });
}
export async function fetchAgentUsageRecent(limit = 10): Promise<AgentTurnRow[]> {
	const v = await invoke<{ items?: AgentTurnRow[] }>('fetch_agent_usage_recent', { limit });
	return Array.isArray(v.items) ? v.items : [];
}
/** This computer's usage, from the daemon, with the project of each turn. */
export async function fetchLocalUsage(days: number): Promise<UsageSummary> {
	await daemon.connect();
	const reply = await daemon.request({ op: 'usage_local', days, tz_offset: new Date().getTimezoneOffset() });
	return reply as unknown as UsageSummary;
}
/** Copies the picked image to the app data dir (the canvas background) and
 *  returns the stored copy's path. */
export function setBackgroundImage(path: string): Promise<string> {
	return invoke('set_background_image', { path });
}
/** Deletes the stored background image. */
export function clearBackgroundImage(): Promise<void> {
	return invoke('clear_background_image');
}
/** Launch at login (src-tauri/src/autostart.rs): whether the login item is
 *  registered, and whether it starts the app in the tray without a window. */
export type Autostart = { enabled: boolean; silent: boolean };
export function autostartGet(): Promise<Autostart> {
	return invoke('autostart_get');
}
/** Registers or removes the login item and saves the start mode; resolves to
 *  the state the system reports afterwards. */
export function autostartSet(enabled: boolean, silent: boolean): Promise<Autostart> {
	return invoke('autostart_set', { enabled, silent });
}
export type CloudSettings = Record<string, { value: unknown; updated_at: number }>;
export async function fetchCloudSettings(): Promise<CloudSettings> {
	const v = await invoke<{ settings?: CloudSettings }>('fetch_cloud_settings');
	return v.settings ?? {};
}
export async function putCloudSettings(settings: Record<string, unknown>): Promise<CloudSettings> {
	const v = await invoke<{ settings?: CloudSettings }>('put_cloud_settings', { settings });
	return v.settings ?? {};
}

// IDE features (Tauri layer, operating on the project working directory).
export function projectRoot(): Promise<string> {
	return invoke('project_root');
}

/** `~/Documents/LynShen`, where conversations outside any project run;
 *  `create` makes it when missing. */
export function defaultWorkspaceDir(create = false): Promise<string> {
	return invoke('default_workspace_dir', { create });
}
/** Makes `<root>/<name>` (or `<name> 2`, …) for a conversation; `root` must be
 *  the default workspace dir. Returns the folder made. */
export function createChatDir(root: string, name: string): Promise<string> {
	return invoke('create_chat_dir', { root, name });
}
export interface FsEntry {
	name: string;
	path: string;
	is_dir: boolean;
}
export function listDir(path?: string, root?: string): Promise<FsEntry[]> {
	return invoke('list_dir', { path, root });
}
// The editor's file IO is confined to the project the file belongs to
// (`root`; without it, the app's launch directory).
export function readText(path: string, root?: string): Promise<string> {
	return invoke('read_text', { path, root });
}
// Editor file IO (root-confined like read_text). `write_text` rejects with a
// structured `conflict:<mtime_ms>` error when the file changed on disk since
// `expectedMtime` — pass undefined to force-overwrite.
export interface FileStat {
	mtime_ms: number;
	size: number;
}
export function statText(path: string, root?: string): Promise<FileStat> {
	return invoke('stat_text', { path, root });
}
export function writeText(path: string, content: string, expectedMtime?: number, root?: string): Promise<FileStat> {
	return invoke('write_text', { path, content, expectedMtime, root });
}
export const isConflictError = (e: unknown) => String(e).startsWith('conflict:');
// File content at git HEAD (diff gutter baseline); rejects paths outside the
// project root / repository.
export function gitHeadText(path: string, cwd?: string): Promise<string> {
	return invoke('git_head_text', { path, cwd });
}

// Persists pasted image bytes to a temp file; returns the path to attach.
export function saveTempImage(data: Uint8Array, ext: string): Promise<string> {
	return invoke('save_temp_image', { data: Array.from(data), ext });
}

// First-run environment check + best-effort dependency install (setup wizard).
export interface DepStatus {
	present: boolean;
	detail: string;
}
// How the setup wizard should offer to install git on this platform:
// 'auto' (one-click button works: macOS CLT dialog / Windows winget),
// 'manual-command' (show a copyable command — we never run sudo GUI-side),
// 'open-url' (official download page only).
export interface InstallAdvice {
	kind: 'auto' | 'manual-command' | 'open-url';
	command: string | null;
	url: string;
}
export interface EnvReport {
	os: string;
	arch: string;
	git: DepStatus;
	engine: DepStatus;
	git_install: InstallAdvice;
}
export function checkEnvironment(): Promise<EnvReport> {
	return invoke('check_environment');
}
// What install_dependency actually did (or wants the UI to do).
export type InstallOutcome =
	| { kind: 'installed'; message: string }
	| { kind: 'started-install'; message: string }
	| { kind: 'manual-command'; command: string; message: string }
	| { kind: 'open-url'; url: string; message: string };
export function installDependency(name: string): Promise<InstallOutcome> {
	return invoke('install_dependency', { name });
}

// --- external tool dependencies (node/npm, ffmpeg, git, gh, codex, lynshen, claude) ---

// What installing a tool entails on this machine (mirrors installer::Plan).
export type InstallPlan =
	| { kind: 'run'; program: string; args: string[] }
	| { kind: 'manual'; command: string }
	| { kind: 'system-dialog'; program: string; args: string[] }
	| { kind: 'open-url'; url: string }
	| { kind: 'needs-prereq'; prereq: string };
export interface DepReport {
	id: string;
	present: boolean;
	detail: string;
	plan: InstallPlan;
}
export function checkDependencies(): Promise<DepReport[]> {
	return invoke('check_dependencies');
}
// Outcome of triggering run_install. 'running' → the app is streaming output
// via install-output events and will emit install-done when finished.
// 'system-dialog' → an OS installer window opened; the user re-checks after.
export type InstallStart =
	| { kind: 'running' }
	| { kind: 'system-dialog' }
	| { kind: 'manual-command'; command: string }
	| { kind: 'open-url'; url: string }
	| { kind: 'needs-prereq'; prereq: string };
export function runInstall(name: string): Promise<InstallStart> {
	return invoke('run_install', { name });
}
// Claude Code / Codex: the latest release and whether the installed one is
// older; run_upgrade streams like run_install (same events, same id).
export interface AgentUpdate {
	latest: string;
	available: boolean;
}
export function checkAgentUpdate(backend: string, binOverride?: string): Promise<AgentUpdate> {
	return invoke('check_agent_update', { backend, binOverride });
}
export function runUpgrade(backend: string, binOverride?: string): Promise<InstallStart> {
	return invoke('run_upgrade', { backend, binOverride });
}
export interface InstallOutputEvent {
	id: string;
	line: string;
	stream: 'stdout' | 'stderr';
}
export interface InstallDoneEvent {
	id: string;
	success: boolean;
	code: number | null;
}

export function listFiles(cwd?: string): Promise<string[]> {
	return invoke('list_files', { cwd });
}
/** A reply's relative path → the one file it names under `root` (maybe in a nested repo). */
/** `rel` under the project `root`: directly, in one of the directories the
 *  reply mentioned (`hints`), or the newest match below the root. */
export function resolveFileRef(root: string, rel: string, hints?: string[]): Promise<string | null> {
	return invoke('resolve_file_ref', { root, rel, hints: hints ?? null });
}

export interface ProviderInfo {
	id: string;
	base_url: string;
	protocol: string;
	models: {
		name: string;
		display_name?: string | null;
		context_window?: number;
		max_context_window?: number;
		max_output_tokens?: number;
		reasoning_efforts?: string[];
	}[];
}
export function listProviders(): Promise<ProviderInfo[]> {
	return invoke('list_providers');
}
export function git(args: string[], cwd?: string): Promise<string> {
	return invoke('git', { args, cwd });
}
/** Undoes only the agent's edits to `path` (its recorded diffs), keeping the user's. */
export function revertAgentEdits(cwd: string, path: string, diffs: string[]): Promise<void> {
	return invoke('revert_agent_edits', { cwd, path, diffs });
}
// 并行任务 worktree 的容器目录（<repo-parent>/.lynshen-worktrees/<repo-name>）。
export function worktreeBase(cwd: string): Promise<string> {
	return invoke('worktree_base', { cwd });
}
/** Non-shell pty target: `command` must be an allowlisted backend name
 *  (lynshen / codex / claude). The Rust side validates it and `args` against
 *  fixed allowlists and resolves the binary like engine spawns — a missing
 *  binary rejects with `binary-missing:<name>`. */
export interface PtyCommand {
	command: string;
	args?: string[];
	binOverride?: string;
}
export function ptyOpen(
	id: string,
	cols: number,
	rows: number,
	cwd?: string,
	cmd?: PtyCommand
): Promise<void> {
	return invoke('pty_open', {
		id,
		cols,
		rows,
		cwd,
		command: cmd?.command,
		args: cmd?.args,
		binOverride: cmd?.binOverride
	});
}
export function ptyWrite(id: string, data: string): Promise<void> {
	return invoke('pty_write', { id, data });
}
export function ptyResize(id: string, cols: number, rows: number): Promise<void> {
	return invoke('pty_resize', { id, cols, rows });
}
export function ptyClose(id: string): Promise<void> {
	return invoke('pty_close', { id });
}

// Screen capture / recording / video keyframe extraction (Tauri layer).
export function captureScreenshot(): Promise<string | null> {
	return invoke('capture_screenshot');
}
export function startScreenRecording(): Promise<void> {
	return invoke('start_screen_recording');
}
export function stopScreenRecording(): Promise<string> {
	return invoke('stop_screen_recording');
}
export interface VideoInfo {
	path: string;
	duration: number;
	width: number;
	height: number;
	frames: string[];
}
export function processVideo(path: string, maxFrames?: number): Promise<VideoInfo> {
	return invoke('process_video', { path, maxFrames });
}

// Speech-to-text via the ASR provider selected in config.json. Keys remain in
// auth.json; the HTTP call happens in the Tauri backend to bypass CSP/CORS.
export function transcribeAudio(audioBase64: string, mime?: string, language?: string): Promise<string> {
	return invoke('transcribe_audio', { audioBase64, mime, language });
}

/** Snapshot the working tree as a dangling checkpoint commit (returns its sha).
 *  Non-destructive: it never touches the index or working tree. */
export function gitCheckpointCapture(cwd: string): Promise<string> {
	return invoke('git_checkpoint_capture', { cwd });
}

/** Restore the working tree to a checkpoint sha. Snapshots the current state
 *  first (returns that recovery sha) so nothing is unrecoverable. */
export function gitCheckpointRestore(cwd: string, checkpoint: string): Promise<string> {
	return invoke('git_checkpoint_restore', { cwd, checkpoint });
}

/** One-shot LLM completion (no agent / no chat pollution) — powers AI commit
 *  messages and PR text. The key is read engine-side from auth.json by provider. */
export function generateText(
	provider: string,
	baseUrl: string,
	format: string,
	model: string,
	system: string,
	prompt: string
): Promise<string> {
	return invoke('generate_text', { provider, baseUrl, format, model, system, prompt });
}

// Events the engine emits on stdout, tagged with the originating session.
export interface AgentEvent {
	type: string;
	[key: string]: unknown;
}

/** The end of the engine's and the daemon's logs, for a bug report. */
export function diagnosticLogs(): Promise<{ name: string; size: number; text: string }[]> {
	return invoke('diagnostic_logs');
}

/** A bug report or suggestion, as a ticket of the signed-in user. */
export function submitFeedback(ticket: Record<string, unknown>): Promise<Record<string, unknown>> {
	return invoke('submit_feedback', { ticket });
}

/** Anonymous usage counts by day (telemetry.svelte.ts). */
export function sendTelemetry(install: string, days: { day: string; events: Record<string, number> }[]): Promise<void> {
	return invoke('send_telemetry', { install, days });
}
