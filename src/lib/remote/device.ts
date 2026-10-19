// This phone as a device of one computer: what it may do there (its scopes,
// granted on the computer) and forgetting it there.

import type { DaemonClient } from '$lib/daemon';

/** The elevated scopes a computer may grant a phone (LynShen-CLI scopes.rs). */
export type Scope = 'full_auto' | 'full_access' | 'add_folder' | 'terminal';
export const SCOPES: readonly Scope[] = ['full_auto', 'full_access', 'add_folder', 'terminal'];

/** What this phone may do on `daemon`: its granted scopes; null from an
 *  engine before scopes (which limits nothing). */
export async function loadScopes(daemon: DaemonClient): Promise<Scope[] | null> {
	try {
		const reply = await daemon.request({ op: 'device_me' });
		return Array.isArray(reply.scopes) ? (reply.scopes as Scope[]) : [];
	} catch {
		return null;
	}
}

/** The computer forgets this phone (revokes it). True once it did. */
export async function forgetOnComputer(daemon: DaemonClient): Promise<boolean> {
	try {
		const reply = await Promise.race([
			daemon.request({ op: 'device_forget_me' }),
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
		]);
		return reply.type === 'device_forgotten';
	} catch {
		return false;
	}
}

/** The scope an error names (`scope_required:<scope>:…`), or null. */
export function scopeOfError(message: string): Scope | null {
	const match = /^scope_required:([a-z_]+):/.exec(message);
	return match && (SCOPES as readonly string[]).includes(match[1]) ? (match[1] as Scope) : null;
}
