import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub the Tauri-backed protocol layer (same pattern as session.test.ts).
vi.mock('$lib/protocol', () => ({
	hostSession: vi.fn(() => Promise.resolve()),
	daemon: { sessionOf: vi.fn(() => 'conv-1') },
	acpAgentsList: vi.fn(() => Promise.resolve([])),
	acpAgentCheck: vi.fn(() => Promise.resolve({ found: true, version: '1.19.0' })),
	recordOpencodeCopy: vi.fn(() => Promise.resolve()),
	sessionMeta: vi.fn(() => Promise.resolve()),
	closeSession: vi.fn(() => Promise.resolve()),
	sendOp: vi.fn(() => Promise.resolve()),
	sendLine: vi.fn(() => Promise.resolve()),
	projectRoot: vi.fn(() => Promise.resolve('/tmp/demo')),
	writeConfig: vi.fn(() => Promise.resolve()),
	git: vi.fn(() => Promise.resolve(''))
}));

import { SessionStore } from '$lib/session.svelte';
import { acpAgentCheck, acpAgentsList, hostSession, recordOpencodeCopy, sendOp, sendLine } from '$lib/protocol';
import { caps } from './index';
import { adapterFor, dispatch } from './router';
import { setLocale } from '$lib/i18n';
import type { Project } from '$lib/types';

const proj = (id = 'p1'): Project => ({ id, name: id, path: `/tmp/${id}`, sessions: [] });
/** A new session is a draft; its first message starts the engine. */
const begin = (id: string) => dispatch(id, { op: 'user_message', content: 'hi' });
/** The engine spec resolves before the daemon is asked. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	vi.clearAllMocks();
	setLocale('zh');
});

describe('SessionStore × backends', () => {
	it('every backend runs in the daemon behind the lynshen adapter', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		expect(hostSession).not.toHaveBeenCalled();
		begin(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, undefined, undefined, false, undefined);
		expect(adapterFor(id)?.id).toBe('lynshen');
		expect(p.lastBackend).toBe('lynshen');
		const cl = store.addSession(p, undefined, 'claude');
		expect(adapterFor(cl)?.id).toBe('lynshen');
	});

	it('an explicit backend becomes the engine spec and the project default', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		expect(p.lastBackend).toBeUndefined(); // a draft belongs to no backend yet
		// Sent as the composer sends it: shown at once, then to the engine.
		p.sessions[0].chat.optimisticUser('hi');
		begin(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, undefined, undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'read-only' }
		});
		expect(p.lastBackend).toBe('claude');
		// The daemon names the conversation.
		expect(p.sessions[0].chat.sessionId).toBe('conv-1');
		// The next plain addSession inherits the project's last-used backend.
		const id2 = store.addSession(p);
		expect(p.sessions[1].backendId).toBe('claude');
		begin(id2);
		await flush();
		expect(hostSession).toHaveBeenLastCalledWith(id2, p.path, undefined, undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'read-only' }
		});
	});

	it('ops of any backend go out as lynshen lines', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p, '你好', 'codex');
		await flush();
		expect(sendOp).not.toHaveBeenCalled();
		const lines = vi.mocked(sendLine).mock.calls.map(([, l]) => JSON.parse(l));
		expect(lines).toContainEqual({ op: 'user_message', content: '你好' });
	});

	it('serialize records the backend only for non-lynshen tabs and lastBackend', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		begin(store.addSession(p, undefined, 'lynshen'));
		begin(store.addSession(p, undefined, 'codex'));
		for (const [i, s] of p.sessions.entries()) {
			s.chat.sessionId = `sid-${i}`;
			s.chat.title = `t${i}`;
		}
		const snap = store.serialize();
		expect(snap[0].lastBackend).toBe('codex');
		expect(snap[0].tabs).toEqual([
			{ id: p.sessions[0].id, sid: 'sid-0', title: 't0', backend: 'codex' },
			{ id: p.sessions[1].id, sid: 'sid-1', title: 't1' }
		]);
	});

	it('restore maps saved backends (missing / unknown → lynshen) and reopens them by id when shown', async () => {
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				lastBackend: 'claude',
				tabs: [
					{ sid: 's-a', title: 'A' }, // pre-multi-backend tab
					{ sid: 's-b', title: 'B', backend: 'claude' },
					{ sid: 's-c', title: 'C', backend: 'not-a-backend' }
				]
			}
		]);
		const sessions = store.projects[0].sessions;
		expect(sessions.map((s) => s.backendId)).toEqual(['lynshen', 'claude', 'lynshen']);
		expect(store.projects[0].lastBackend).toBe('claude');
		// Listed, not started: each opens when it is first shown.
		expect(sessions.every((s) => s.dormant)).toBe(true);
		expect(hostSession).not.toHaveBeenCalled();
		store.wake(sessions[1].id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(sessions[1].id, '/tmp/p1', 's-b', undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'read-only' }
		});
		expect(sendLine).not.toHaveBeenCalledWith(sessions[1].id, expect.stringContaining('/resume'));
	});

	it('a crash restart reopens the conversation by id', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'codex');
		begin(id);
		await flush();
		const s = p.sessions[0];
		s.chat.sessionId = 'thread-1';
		vi.clearAllMocks();
		store.restartSession(id, true);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, 'thread-1', undefined, false, {
			engine: 'codex',
			options: { approval_mode: 'read-only' }
		});
		expect(sendLine).not.toHaveBeenCalledWith(id, expect.stringContaining('/resume'));
	});

	it('removeSession unregisters the adapter', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'codex');
		expect(adapterFor(id)).toBeDefined();
		store.removeSession(id);
		expect(adapterFor(id)).toBeUndefined();
	});

	describe('OpenCode', () => {
		const opencode = { id: 'opencode', name: 'OpenCode', command: '/opt/homebrew/bin/opencode', args: ['acp'], env: {} };
		const settle = async () => {
			for (let i = 0; i < 5; i++) await flush();
		};

		it('starts with its approval mode, the gateway when signed in, and its agent', async () => {
			vi.mocked(acpAgentsList).mockResolvedValue([opencode]);
			vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ id: 'u1', username: 'x' }) });
			try {
				const store = new SessionStore();
				const p = proj();
				store.projects.push(p);
				const id = store.addSession(p, undefined, 'acp', { id: 'opencode', name: 'OpenCode' });
				begin(id);
				await settle();
				const spec = vi.mocked(hostSession).mock.calls[0][5] as { engine: string; options: Record<string, unknown> };
				expect(spec).toMatchObject({
					engine: 'acp',
					options: {
						command: opencode.command,
						args: ['acp'],
						approval_mode: 'read-only',
						lynshen_gateway: true,
						acp_agent: { id: 'opencode', name: 'OpenCode' }
					}
				});
				expect((spec.options.env as Record<string, string>).OPENCODE_SERVER_PASSWORD).toMatch(/^[0-9a-f]{48}$/);
				const s = p.sessions[0];
				expect(s.chat.acpOpencode).toBe(true);
				expect(s.acpAgent).toEqual({ id: 'opencode', name: 'OpenCode', opencode: true });
				expect(caps(s.chat).approvalModes).toBe(true);
				// Saved with the flag, so a restored tab knows before it starts.
				s.chat.sessionId = 'sid-1';
				expect(store.serialize()[0].tabs?.[0].acpAgent).toEqual({ id: 'opencode', name: 'OpenCode', opencode: true });
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it('refuses OpenCode 2.x before the daemon is asked, in the UI language', async () => {
			vi.mocked(acpAgentsList).mockResolvedValue([{ ...opencode, command: 'opencode' }]);
			vi.mocked(acpAgentCheck).mockResolvedValue({ found: true, version: '2.0.29' });
			const store = new SessionStore();
			const p = proj();
			store.projects.push(p);
			const id = store.addSession(p, undefined, 'acp', { id: 'opencode', name: 'OpenCode', opencode: true });
			begin(id);
			await settle();
			expect(hostSession).not.toHaveBeenCalled();
			const errors = p.sessions[0].chat.messages.filter((m) => m.kind === 'error');
			expect(JSON.stringify(errors)).toContain('只支持 OpenCode 1.x');
		});

		it('continues an OpenCode conversation in a new tab on a copy, and records it', async () => {
			vi.mocked(acpAgentsList).mockResolvedValue([{ ...opencode, command: '/usr/bin/opencode' }]);
			vi.mocked(acpAgentCheck).mockResolvedValue({ found: true, version: '1.19.0' });
			const store = new SessionStore();
			const p = proj();
			store.projects.push(p);
			const id = store.openForked(p, 'ses_orig', 'Fix it', { id: 'opencode', name: 'OpenCode' });
			await settle();
			expect(store.activeId).toBe(id);
			const spec = vi.mocked(hostSession).mock.calls[0][5] as { options: Record<string, unknown> };
			expect(spec.options.fork).toBe('ses_orig');
			expect(p.sessions[0].chat.title).toBe('Fix it');
			expect(recordOpencodeCopy).toHaveBeenCalledWith('ses_orig', 'conv-1');
		});
	});
});

