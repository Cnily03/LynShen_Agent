// Chat connectors (Settings → 聊天连接): what the daemon's `connectors` list
// holds and the checks the page makes before it sends an op. The daemon owns
// the bots and their tokens (LynShen-CLI docs/chat-connectors.md); the page
// never gets a token back.

export type ConnectorState = 'stopped' | 'connecting' | 'connected' | 'error';
export type Platform = 'telegram' | 'discord' | 'qq';

/** The platforms the daemon connects to, in the order the page offers them. */
export const PLATFORMS: Platform[] = ['telegram', 'discord', 'qq'];
export type MaxMode = 'plan' | 'manual' | 'auto-edit' | 'auto';
export type ProxySource = 'setting' | 'environment' | 'none';

/** The approval modes a chat may use, strictest first; full access never. */
export const MAX_MODES: MaxMode[] = ['plan', 'manual', 'auto-edit', 'auto'];

export interface ChatBinding {
	device: string;
	name: string;
	paired_at: number;
	/** The last message from the account since the daemon started (ms). */
	last_seen: number | null;
}

export interface ConnectorSettings {
	approvals: boolean;
	notify: boolean;
	max_mode: MaxMode;
}

export interface Connector {
	id: string;
	platform: Platform;
	/** The bot as people see it, `@name`. */
	name: string;
	/** Where the bot opens (`https://t.me/<bot>`). */
	link: string | null;
	enabled: boolean;
	/** The connector's own proxy setting: null (the environment's), `direct` or a URL. */
	proxy: string | null;
	proxySource: ProxySource;
	/** The proxy in use, without user name or password. */
	proxyShown: string | null;
	state: ConnectorState;
	error: string | null;
	settings: ConnectorSettings;
	bindings: ChatBinding[];
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null);
const STATES: ConnectorState[] = ['stopped', 'connecting', 'connected', 'error'];

/** The connectors of a `connectors` reply, with anything malformed dropped. */
export function parseConnectors(reply: Record<string, unknown>): Connector[] {
	const list = Array.isArray(reply.connectors) ? reply.connectors : [];
	return list
		.filter((c): c is Record<string, any> => !!c && typeof c === 'object' && typeof c.id === 'string')
		.map((c) => {
			const settings = (c.settings ?? {}) as Record<string, unknown>;
			const mode = MAX_MODES.includes(settings.max_mode as MaxMode) ? (settings.max_mode as MaxMode) : 'auto';
			const source = ['setting', 'environment', 'none'].includes(c.proxy_source) ? (c.proxy_source as ProxySource) : 'none';
			return {
				id: c.id,
				platform: PLATFORMS.includes(c.platform) ? (c.platform as Platform) : 'telegram',
				name: str(c.name),
				link: strOrNull(c.link),
				enabled: c.enabled !== false,
				proxy: strOrNull(c.proxy),
				proxySource: source,
				proxyShown: strOrNull(c.proxy_shown),
				state: STATES.includes(c.state) ? (c.state as ConnectorState) : 'connecting',
				error: strOrNull(c.error),
				settings: { approvals: settings.approvals !== false, notify: settings.notify !== false, max_mode: mode },
				bindings: (Array.isArray(c.bindings) ? c.bindings : [])
					.filter((b: any) => b && typeof b.device === 'string')
					.map((b: any) => ({
						device: b.device,
						name: str(b.name),
						paired_at: Number(b.paired_at) || 0,
						last_seen: typeof b.last_seen === 'number' ? b.last_seen : null
					}))
			};
		});
}

/** A token as @BotFather gives it: digits, a colon, then at least 30
 *  letters, digits, `_` or `-`. */
export function isTelegramToken(token: string): boolean {
	return /^\d+:[A-Za-z0-9_-]{30,}$/.test(token.trim());
}

/** A Discord bot token: three parts joined by dots. */
export function isDiscordToken(token: string): boolean {
	const t = token.trim();
	return t.length >= 50 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t);
}

/** A QQ bot's AppID (digits) and AppSecret (one word of 8 or more). */
export function isQqAppId(id: string): boolean {
	return /^\d+$/.test(id.trim());
}
export function isQqSecret(secret: string): boolean {
	return /^\S{8,}$/.test(secret.trim());
}

/** What `connector_add` needs for a platform: the fields as typed, checked.
 *  Null while something is missing or malformed. */
export function addOp(
	platform: Platform,
	fields: { token: string; appId: string; secret: string; proxy: string }
): Record<string, unknown> | null {
	const proxy = proxyValue(fields.proxy);
	if (!proxy.ok) return null;
	const withProxy = proxy.value ? { proxy: proxy.value } : {};
	switch (platform) {
		case 'telegram':
			return isTelegramToken(fields.token) ? { op: 'connector_add', platform, token: fields.token.trim(), ...withProxy } : null;
		case 'discord':
			return isDiscordToken(fields.token) ? { op: 'connector_add', platform, token: fields.token.trim(), ...withProxy } : null;
		case 'qq':
			return isQqAppId(fields.appId) && isQqSecret(fields.secret)
				? { op: 'connector_add', platform, app_id: fields.appId.trim(), secret: fields.secret.trim() }
				: null;
	}
}

/** The proxy field as the daemon takes it: empty (the environment's proxy),
 *  `direct`, or an `http://` URL. SOCKS is not supported. */
export function proxyValue(input: string): { ok: true; value: string | null } | { ok: false } {
	const value = input.trim();
	if (!value) return { ok: true, value: null };
	if (value === 'direct') return { ok: true, value };
	if (/^http:\/\/[^\s/]+(:\d+)?\/?$/.test(value)) return { ok: true, value: value.replace(/\/+$/, '') };
	return { ok: false };
}

/** `m:ss` left until `expiresAt` (ms). */
export function remaining(expiresAt: number, now: number): string {
	const s = Math.max(0, Math.round((expiresAt - now) / 1000));
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** A daemon too old for connectors answers the op as a session op. */
export function isOldDaemon(error: string): boolean {
	return /connector_\w+ requires session|unknown op connector_/.test(error);
}

/** Whether a `device_list` entry is a chat binding (shown on this page, not
 *  among the phones). */
export function isChatDevice(device: { kind?: unknown }): boolean {
	return device.kind === 'chat';
}
