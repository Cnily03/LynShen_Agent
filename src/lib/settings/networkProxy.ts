// Settings → 网络 → 代理 (ticket #50): an HTTP proxy for the agent's web
// fetches and its commands (config.json `network_proxy`, LynShen CLI
// network_proxy.rs). The same rule as the engine: http://host:port, or
// host:port read as http; user:pass@ allowed; other schemes refused.

/** `value` as the engine takes it, or null when it is not one. */
export function proxyUrl(value: string): string | null {
	const v = value.trim();
	if (!v) return null;
	const m = /^(?:([a-z][a-z0-9+.-]*):\/\/)?([^/\s]+?)\/?$/i.exec(v);
	if (!m || (m[1] && m[1].toLowerCase() !== 'http')) return null;
	const authority = m[2]!;
	const hostPort = authority.includes('@') ? authority.slice(authority.lastIndexOf('@') + 1) : authority;
	const colon = hostPort.lastIndexOf(':');
	if (colon <= 0) return null;
	const port = Number(hostPort.slice(colon + 1));
	if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
	return `http://${authority}`;
}

export const proxyValid = (value: string | undefined) => proxyUrl(value ?? '') !== null;

/** What is written: the proxy, or '' (none) for an empty or unusable value. */
export function proxySetting(value: string): string {
	return proxyUrl(value) ?? '';
}
