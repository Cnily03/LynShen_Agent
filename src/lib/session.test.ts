import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Stub the Tauri-backed protocol layer so the store's lifecycle is testable in node.
vi.mock('./protocol', () => ({
	hostSession: vi.fn(() => Promise.resolve()),
	acpAgentsList: vi.fn(() => Promise.resolve([{ id: 'gemini', name: 'Gemini', command: 'gemini', args: ['--experimental-acp'], env: {} }])),
	// The daemon names a new session after its desktop id.
	daemon: { sessionOf: vi.fn((id: string) => `conv-${id}`), request: vi.fn(() => Promise.resolve({})), unwatch: vi.fn() },
	closeSession: vi.fn(() => Promise.resolve()),
	sendOp: vi.fn(() => Promise.resolve()),
	sendLine: vi.fn(() => Promise.resolve()),
	sessionMeta: vi.fn(() => Promise.resolve()),
	projectRoot: vi.fn(() => Promise.resolve('/tmp/demo')),
	chatsDir: vi.fn(() => Promise.resolve('/home/u/.lynshen/chats')),
	defaultWorkspaceDir: vi.fn(() => Promise.resolve('/home/u/Documents/LynShen')),
	createChatDir: vi.fn((root: string, name: string) => Promise.resolve(`${root}/${name}`)),
	listDir: vi.fn(() => Promise.resolve([{ name: '2026-10-01 old', path: '/home/u/Documents/LynShen/2026-10-01 old', is_dir: true }])),
	writeConfig: vi.fn(() => Promise.resolve()),
	git: vi.fn(() => Promise.resolve('')),
	sessionHistory: vi.fn(() =>
		Promise.resolve([
			{ session: 's6old', title: 'old chat', updated_at: 1_700_000_000_000, entries: 4, archived: false, agent: null, open: false, engine: 'lynshen' },
			{ session: 'claude-old', title: 'claude chat', updated_at: 1_700_000_000_000, entries: 2, archived: false, agent: null, open: false, engine: 'claude' }
		])
	)
}));

import { RELEASE_AFTER_MS, SessionStore, listedSessions, type SavedProject } from './session.svelte';
import { UNTITLED } from './chat.svelte';
import { dispatch, startDraft } from './backends/router';
import { daemon, hostSession, closeSession, sendLine, git, writeConfig, sessionHistory, sessionMeta } from './protocol';
import type { EngineSpec } from './daemon';
import { setLocale } from './i18n';
import type { Project, Session, WorktreeMeta } from './types';

const proj = (id = 'p1'): Project => ({ id, name: id, path: `/tmp/${id}`, sessions: [] });
/** A new session is a draft; its first message starts the engine. */
const begin = (id: string) => dispatch(id, { op: 'user_message', content: 'hi' });
/** Lets a spawn's promise chain (spec → hostSession → onStart) run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The engine spec of the last hostSession call. */
const lastSpec = () => vi.mocked(hostSession).mock.calls.at(-1)![5] as EngineSpec | undefined;

beforeEach(() => {
	vi.clearAllMocks();
	// Pin the locale so user-facing strings are deterministic regardless of the
	// host's navigator.language.
	setLocale('zh');
});

describe('SessionStore lifecycle', () => {
	it('addSession makes a draft active; its first message opens it in the daemon', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		expect(p.sessions.map((s) => s.id)).toEqual([id]);
		expect(store.activeId).toBe(id);
		expect(store.chat).toBe(p.sessions[0].chat);
		expect(p.sessions[0].draft).toBe(true);
		expect(p.sessions[0].chat.booting).toBe(false);
		expect(hostSession).not.toHaveBeenCalled();
		begin(id);
		expect(p.sessions[0].draft).toBe(false);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, undefined, undefined, false, undefined);
		// The daemon named the new session.
		expect(p.sessions[0].chat.sessionId).toBe(`conv-${id}`);
	});

	it('a draft records backend, model and effort, and applies them when it starts', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		await store.switchBackend(id, 'claude');
		expect(hostSession).not.toHaveBeenCalled();
		expect(closeSession).not.toHaveBeenCalled();
		const s = p.sessions[0];
		expect(s.backendId).toBe('claude');
		expect(s.draft).toBe(true);
		expect(p.lastBackend).toBeUndefined();
		s.draftPick = { model: 'opus', effort: 'high' };
		begin(id);
		expect(p.lastBackend).toBe('claude');
		await flush();
		const lines = vi.mocked(sendLine).mock.calls.filter(([sid]) => sid === id).map(([, l]) => l);
		expect(lines).toEqual([
			JSON.stringify({ op: 'command', input: '/model opus high' }),
			JSON.stringify({ op: 'user_message', content: 'hi' })
		]);
	});

	it('a model picked on the home page goes before the first message', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, 'hello', 'lynshen', undefined, 'claude-opus-5-5');
		expect(p.sessions[0].chat.model).toBe('claude-opus-5-5');
		await flush();
		const lines = vi.mocked(sendLine).mock.calls.filter(([sid]) => sid === id).map(([, l]) => l);
		expect(lines).toEqual([
			JSON.stringify({ op: 'command', input: '/model claude-opus-5-5' }),
			JSON.stringify({ op: 'user_message', content: 'hello' })
		]);
		// Another backend has other models: the pick is not sent there.
		const other = store.addSession(p, undefined, 'claude', undefined, 'claude-opus-5-5');
		expect(p.sessions.find((x) => x.id === other)!.draftPick).toBeUndefined();
	});

	it('ops of every backend go out as lynshen lines, approval modes in lynshen names', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'codex');
		begin(id);
		await flush();
		vi.mocked(sendLine).mockClear();
		dispatch(id, { op: 'set_approval_mode', mode: 'read-only' });
		dispatch(id, { op: 'set_approval_mode', mode: 'full-auto' });
		expect(vi.mocked(sendLine).mock.calls).toEqual([
			[id, JSON.stringify({ op: 'set_approval_mode', mode: 'manual' })],
			[id, JSON.stringify({ op: 'set_approval_mode', mode: 'full-access' })]
		]);
	});

	it('the LynShen gateway goes to this session\'s process only, and is kept', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		begin(id);
		await flush();
		vi.mocked(hostSession).mockClear();
		await store.applyToolProfile(id, 'lynshen', 'claude-sonnet-5-5');
		expect(closeSession).toHaveBeenCalledWith(id);
		const call = vi.mocked(hostSession).mock.calls.at(-1)!;
		// The same conversation reopens, now on the gateway.
		expect(call[2]).toBe(`conv-${id}`);
		expect(call[5]).toEqual({ engine: 'claude', options: { approval_mode: 'read-only', lynshen_gateway: true } });
		expect(writeConfig).not.toHaveBeenCalled();
		const tab = store.serialize()[0].tabs![0];
		expect(tab.gateway).toBe(true);
		await store.applyToolProfile(id, 'system');
		expect(lastSpec()?.options?.lynshen_gateway).toBe(false);
		expect(store.serialize()[0].tabs![0].gateway).toBeUndefined();
	});

	it('a draft switched to the gateway starts on it', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'codex');
		void store.applyToolProfile(id, 'lynshen', 'gpt-5.5');
		expect(hostSession).not.toHaveBeenCalled();
		begin(id);
		await flush();
		expect(lastSpec()).toEqual({ engine: 'codex', options: { approval_mode: 'read-only', lynshen_gateway: true } });
	});

	it('a draft renamed before it starts gives the daemon its name', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		store.renameSession(id, 'Release train');
		expect(sessionMeta).not.toHaveBeenCalled(); // no daemon session yet
		begin(id);
		await flush();
		expect(sessionMeta).toHaveBeenCalledWith(p.sessions[0].chat.sessionId, { title: 'Release train' });
	});

	it('removing a draft closes no engine', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		store.removeSession(id);
		expect(closeSession).not.toHaveBeenCalled();
		expect(dispatch(id, { op: 'user_message', content: 'late' })).toBe(true);
		expect(hostSession).not.toHaveBeenCalled();
	});

	it('removeSession re-points activeId to a surviving session', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const a = store.addSession(p, 'hi');
		const b = store.addSession(p);
		expect(store.activeId).toBe(b);
		store.removeSession(b);
		expect(store.activeId).toBe(a);
		store.removeSession(a);
		expect(store.activeId).toBe('');
	});

	it('archiveSession hides a thread and re-points activeId to a live sibling', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const a = store.addSession(p, 'hi');
		const b = store.addSession(p, 'hello');
		expect(store.activeId).toBe(b);
		store.archiveSession(b);
		expect(p.sessions.find((s) => s.id === b)?.archived).toBe(true);
		expect(store.activeId).toBe(a); // moved off the archived one
		store.unarchiveSession(b);
		expect(p.sessions.find((s) => s.id === b)?.archived).toBe(false);
	});

	it('serialize persists the archived flag and restore re-applies it', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		p.sessions[0].chat.sessionId = 'sid-0';
		p.sessions[0].chat.title = 'kept';
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		store.archiveSession(id);
		const snap = store.serialize();
		expect(snap[0].tabs).toEqual([{ id, sid: 'sid-0', title: 'kept', archived: true }]);

		const store2 = new SessionStore();
		await store2.restore(snap);
		expect(store2.projects[0].sessions.find((s) => s.chat.sessionId === 'sid-0')!.archived).toBe(true);
	});

	it('a flagged resume failure makes the next claude restart come up fresh', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		const s = p.sessions.find((x) => x.id === id)!;
		s.chat.sessionId = 'sid-x';
		s.chat.messages.push({ kind: 'user', text: 'hi' });
		s.chat.resumeBroken = true;
		vi.clearAllMocks();
		store.restartSession(id);
		// Opened without a session to reopen, and the one-shot flag is consumed.
		expect(s.chat.sessionId).toBe('');
		expect(s.chat.resumeBroken).toBe(false);
		await flush();
		expect(vi.mocked(hostSession).mock.calls.at(-1)![2]).toBeUndefined();
		// A later restart never goes back to the failed conversation.
		s.chat.engineState = 'exited';
		store.restartSession(id);
		await flush();
		expect(vi.mocked(hostSession).mock.calls.at(-1)![2]).not.toBe('sid-x');
	});

	it('restored lynshen tabs keep their saved id before the engine reports one', async () => {
		const store = new SessionStore();
		await store.restore([
			{ id: 'p', name: 'p', path: '/tmp/p', tabs: [
				// Files written before every session ran in the daemon still carry `hosted`.
				{ id: 't1', sid: 's6abc86b2069f0d98', title: 'legacy hosted', hosted: true },
				{ id: 't2', sid: 's6abc77400cc77818', title: 'local' }
			] }
		] as never);
		const tabs = store.serialize()[0]?.tabs ?? [];
		expect(tabs.map((t) => t.sid)).toEqual(['s6abc86b2069f0d98', 's6abc77400cc77818']);
		expect(tabs.some((t) => 'hosted' in t)).toBe(false);
	});

	it('history opens as a picker of the daemon\'s lynshen conversations without a new session', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		await store.openHistory(p);
		expect(sessionHistory).toHaveBeenCalledWith(p.path);
		expect(p.sessions.length).toBe(1);
		const chat = p.sessions[0]!.chat;
		expect(store.activeId).toBe(id);
		// Other engines' conversations are left out; updated_at is in ms.
		expect(chat.picker).toEqual({
			kind: 'resume',
			backend: 'lynshen',
			history: true,
			source: 'lynshen',
			items: [{ id: 's6old', label: 'old chat', detail: new Date(1_700_000_000_000).toLocaleString(), active: false }]
		});
	});

	it('a picked lynshen conversation opens once, reopened by the daemon', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.openSaved(p, 's6old', 'old chat', 'lynshen');
		await flush();
		expect(hostSession).toHaveBeenCalledWith(store.activeId, p.path, 's6old', undefined, false, undefined);
		const first = store.activeId;
		store.openSaved(p, 's6old', 'old chat', 'lynshen');
		expect(store.activeId).toBe(first);
		expect(p.sessions.length).toBe(1);
		expect(hostSession).toHaveBeenCalledTimes(1);
	});

	it('a message sent while the engine restarts is delivered once it is up', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		begin(id);
		await flush();
		const s = p.sessions[0]!;
		s.chat.engineState = 'exited';
		store.restartSession(id);
		vi.mocked(sendLine).mockClear();
		expect(dispatch(id, { op: 'user_message', content: 'still there?' })).toBe(true);
		expect(sendLine).not.toHaveBeenCalledWith(id, expect.stringContaining('still there?'));
		await flush();
		expect(sendLine).toHaveBeenCalledWith(id, expect.stringContaining('still there?'));
	});

	it('after auto-restart gives up, messages wait for the manual restart', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		begin(id);
		await flush();
		const s = p.sessions[0]!;
		s.chat.restarts = 3;
		store.handleExit(id);
		vi.mocked(sendLine).mockClear();
		dispatch(id, { op: 'user_message', content: 'later' });
		expect(sendLine).not.toHaveBeenCalled();
		store.restartSession(id, true);
		await flush();
		expect(sendLine).toHaveBeenCalledWith(id, expect.stringContaining('later'));
	});

	it('an engine the daemon cannot start shows why at once instead of waiting for the daemon', async () => {
		vi.mocked(hostSession).mockRejectedValueOnce(new Error('cannot start codex: No such file or directory (os error 2)'));
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		begin(store.addSession(p, undefined, 'codex'));
		const s = p.sessions[0]!;
		await flush();
		expect(s.chat.daemonRetries).toBe(0);
		expect(s.chat.messages.some((m) => m.kind === 'error' && m.text.includes('cannot start codex'))).toBe(true);
	});

	it.each(['lynshen', 'claude'] as const)(
		'a %s session keeps retrying an unreachable daemon without spending its crash budget',
		async (backend) => {
			vi.useFakeTimers();
			vi.mocked(hostSession).mockRejectedValue(new Error('cannot reach lynshen daemon'));
			const store = new SessionStore();
			const p = proj();
			store.projects.push(p);
			begin(store.addSession(p, undefined, backend));
			const s = p.sessions[0]!;
			await vi.advanceTimersByTimeAsync(0);
			expect(s.chat.daemonRetries).toBe(1);
			await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
			expect(vi.mocked(hostSession).mock.calls.length).toBe(4);
			expect(s.chat.restarts).toBe(0);
			expect(s.chat.messages.filter((m) => m.kind === 'error')).toHaveLength(0);
			vi.mocked(hostSession).mockReset();
			vi.mocked(hostSession).mockResolvedValue(undefined);
			vi.useRealTimers();
		}
	);

	it('an engine switch awaiting its config write does not spawn for a closed tab', async () => {
		let release!: () => void;
		vi.mocked(writeConfig).mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		begin(id);
		await flush();
		vi.mocked(hostSession).mockClear();
		const switching = store.switchProvider(id, { id: 'x', base_url: 'u', format: 'openai', models: [{ name: 'm' }] }, 'm');
		store.removeSession(id);
		release();
		await switching;
		await flush();
		expect(hostSession).not.toHaveBeenCalled();
	});

	it('a new claude session is spawned in the desktop approval mode', async () => {
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => (k === 'lynshen-approval-mode' ? 'all' : null),
			setItem: () => {}
		});
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		vi.clearAllMocks();
		begin(store.addSession(p, undefined, 'claude'));
		await flush();
		// Spawned yolo up front: no mid-turn respawn when claude's init reports it.
		expect(lastSpec()).toEqual({ engine: 'claude', options: { approval_mode: 'full-auto' } });
		expect(p.sessions[0].spawnedMode).toBe('bypassPermissions');
		vi.unstubAllGlobals();
	});

	it('switchBackend swaps a virgin session in place (same id, new engine)', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		// Started by a command, so still without a user turn.
		dispatch(id, { op: 'command', input: '/login lynshen' });
		await flush();
		expect(p.sessions[0].backendId).toBe('lynshen');
		vi.mocked(hostSession).mockClear();
		await store.switchBackend(id, 'claude');
		const s = p.sessions[0];
		expect(s.id).toBe(id); // same tab
		expect(s.backendId).toBe('claude');
		expect(s.chat.backendId).toBe('claude');
		// The daemon translates claude into lynshen events.
		expect(s.adapter.id).toBe('lynshen');
		expect(p.lastBackend).toBe('claude');
		expect(closeSession).toHaveBeenCalledWith(id);
		// A new claude conversation, not the lynshen one reopened.
		const call = vi.mocked(hostSession).mock.calls.at(-1)!;
		expect(call[2]).toBeUndefined();
		expect(call[5]).toMatchObject({ engine: 'claude' });
		expect(s.chat.sessionId).toBe(`conv-${id}`);
	});

	it('switchBackend refuses once the first user turn exists or the session was restored', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		await store.switchBackend(id, 'codex');
		expect(p.sessions[0].backendId).toBe('lynshen');

		const rid = store.restoreSession(p, 'sid-1', 'old', 'lynshen');
		await store.switchBackend(rid, 'codex');
		expect(p.sessions.find((s) => s.id === rid)?.backendId).toBe('lynshen');
	});

	it('switchProvider honors a valid effort override and falls back otherwise', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		const provider = {
			id: 'byo',
			base_url: 'https://api.example.com',
			format: 'openai',
			models: [{ name: 'm1', reasoning_efforts: ['low', 'high'] }]
		};
		// A chip pick carries an explicit effort — written verbatim when valid.
		await store.switchProvider(id, provider, 'm1', 'high');
		expect(writeConfig).toHaveBeenCalledWith(
			expect.objectContaining({ provider: 'byo', model: 'm1', reasoning_effort: 'high' })
		);
		// An unknown effort falls back to the default (no medium → first listed).
		await store.switchProvider(id, provider, 'm1', 'bogus');
		expect(writeConfig).toHaveBeenLastCalledWith(
			expect.objectContaining({ reasoning_effort: 'low' })
		);
		// No effort argument keeps the medium-first default.
		await store.switchProvider(
			id,
			{ ...provider, models: [{ name: 'm1', reasoning_efforts: ['low', 'medium', 'high'] }] },
			'm1'
		);
		expect(writeConfig).toHaveBeenLastCalledWith(
			expect.objectContaining({ reasoning_effort: 'medium' })
		);
	});

	it('switchProvider on a running session closes it and reopens the same conversation', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		begin(id);
		await flush();
		vi.mocked(hostSession).mockClear();
		await store.switchProvider(id, { id: 'x', base_url: 'u', format: 'openai', models: [{ name: 'm' }] }, 'm');
		expect(closeSession).toHaveBeenCalledWith(id);
		expect(hostSession).toHaveBeenCalledWith(id, p.path, `conv-${id}`, undefined, false, undefined);
		expect(sendLine).not.toHaveBeenCalledWith(id, expect.stringContaining('/resume'));
	});

	it('removeProject tears down its sessions and clears a dangling activeId', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		store.addSession(p);
		store.removeProject(p);
		expect(store.projects).toEqual([]);
		expect(store.activeId).toBe('');
	});

	it('auto-restart is capped at 3 within the window, then pauses', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		begin(id);
		for (let i = 0; i < 4; i++) store.handleExit(id);
		await flush();
		// 1 spawn + 3 restarts; the 4th exit pauses instead of restarting.
		expect(hostSession).toHaveBeenCalledTimes(4);
		const msgs = p.sessions[0].chat.messages;
		expect(msgs.findLast((m) => m.kind === 'error')).toMatchObject({ kind: 'error', text: expect.stringContaining('已暂停自动重启') });
	});

	it('serialize writes every tab with its desktop id; sid once the daemon named the session', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		// A backend asked for: a new session each time.
		store.addSession(p, undefined, 'lynshen');
		store.addSession(p, undefined, 'lynshen');
		store.addSession(p, undefined, 'lynshen');
		const [a, b, c] = p.sessions;
		a.chat.sessionId = 'sid-0';
		a.chat.title = 'first';
		a.chat.messages.push({ kind: 'user', text: 'hi' });
		// No user turn yet, but the session exists in the daemon from its first
		// moment, so its id is kept.
		b.chat.sessionId = 'sid-1';
		// A draft has no daemon session: an empty window under its desktop id.
		const snap = store.serialize();
		expect(snap).toEqual([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [
					{ id: a.id, sid: 'sid-0', title: 'first' },
					{ id: b.id, sid: 'sid-1', title: 'New session' },
					{ id: c.id, title: 'New session' }
				]
			}
		]);
	});

	it('a restored session serializes its sid even before the replay lands', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		// restore pins chat.sessionId immediately; the transcript replay is async
		// (and may fail), so messages are still empty here.
		const id = store.restoreSession(p, 'sid-r', 'old', 'claude');
		const s = p.sessions[0];
		expect(s.restored).toBe(true);
		expect(s.chat.sessionId).toBe('sid-r');
		expect(s.chat.messages.some((m) => m.kind === 'user')).toBe(false);
		const tab = store.serialize()[0].tabs![0];
		expect(tab).toEqual({ id, sid: 'sid-r', title: 'old', backend: 'claude' });
	});

	it('serialize includes the acp agent and restore reapplies it on the session', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const agent = { id: 'gemini', name: 'Gemini CLI' };
		const id = store.addSession(p, undefined, 'acp', agent);
		const snap = store.serialize();
		expect(snap[0].tabs).toEqual([{ id, title: 'New session', backend: 'acp', acpAgent: agent }]);

		const store2 = new SessionStore();
		await store2.restore(snap);
		const s = store2.projects[0].sessions[0];
		expect(s.backendId).toBe('acp');
		expect(s.acpAgent).toEqual(agent);
		expect(s.chat.acpAgentId).toBe('gemini');
		expect(s.chat.acpAgentName).toBe('Gemini CLI');
		// Never started, so it comes back a draft; its start runs the agent's
		// registry command in the daemon.
		expect(s.draft).toBe(true);
		begin(s.id);
		await flush();
		expect(lastSpec()).toEqual({ engine: 'acp', options: { command: 'gemini', args: ['--experimental-acp'], env: {} } });
	});

	it('a restored acp tab with a sid reopens its conversation right away', async () => {
		const agent = { id: 'gemini', name: 'Gemini CLI' };
		const store = new SessionStore();
		await store.restore([
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [{ id: 't1', sid: 'acp-1', title: 'A', backend: 'acp', acpAgent: agent }] }
		]);
		const s = store.projects[0].sessions[0];
		expect(s.dormant).toBeUndefined();
		await flush();
		expect(hostSession).toHaveBeenCalledWith('t1', '/tmp/p1', 'acp-1', undefined, false, expect.objectContaining({ engine: 'acp' }));
	});

	it('acp tabs without a saved agent fall back to the project lastAcpAgent', async () => {
		const agent = { id: 'g', name: 'G' };
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				lastBackend: 'acp',
				lastAcpAgent: agent,
				tabs: [{ id: 't1', title: 'A', backend: 'acp' }]
			}
		]);
		expect(store.projects[0].sessions[0].acpAgent).toEqual(agent);
		expect(store.projects[0].sessions[0].backendId).toBe('acp');
	});

	it('a first run opens no project and no session (the home page shows)', async () => {
		const store = new SessionStore();
		await store.restore([]);
		expect(store.loaded).toBe(true);
		expect(store.projects).toHaveLength(0);
		expect(store.activeId).toBe('');
	});

	it('restore re-opens saved tabs and activates the first', async () => {
		const store = new SessionStore();
		await store.restore([
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [{ sid: 's-a', title: 'A' }, { sid: 's-b', title: 'B' }] }
		]);
		expect(store.projects[0].sessions).toHaveLength(2);
		expect(store.activeId).toBe(store.projects[0].sessions[0].id);
		expect(store.loaded).toBe(true);
	});

	it('restore reuses persisted desktop ids so a saved chat split still matches', async () => {
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [
					{ id: 'live-a', sid: 's-a', title: 'A' },
					{ id: 'live-b', title: 'B' } // empty window — nothing to resume
				]
			}
		]);
		const [a, b] = store.projects[0].sessions;
		expect([a.id, b.id]).toEqual(['live-a', 'live-b']);
		expect(store.activeId).toBe('live-a');
		// The conversation waits in the daemon until shown; the empty window is a draft.
		expect(a.dormant).toBe(true);
		expect(a.chat.sessionId).toBe('s-a');
		expect(b.draft).toBe(true);
		expect(b.chat.title).toBe('B');
		await flush();
		expect(hostSession).not.toHaveBeenCalled();
		expect(sendLine).not.toHaveBeenCalled();
	});

	it('restore mints a fresh id when the persisted one is already live', async () => {
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [
					{ id: 'dup', sid: 's-a', title: 'A' },
					{ id: 'dup', sid: 's-b', title: 'B' }
				]
			}
		]);
		const ids = store.projects[0].sessions.map((s) => s.id);
		expect(ids[0]).toBe('dup');
		expect(ids[1]).not.toBe('dup');
	});

	it('serialize includes tab chrome only when set, and restore re-applies it', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		p.sessions[0].chat.sessionId = 'sid-0';
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		store.renameSession(id, ' Release train ');
		store.setSessionChrome(id, { color: '#DB2777', icon: { kind: 'slug', value: '🚀' } });
		const snap = store.serialize();
		expect(snap[0].tabs).toEqual([
			{
				id,
				sid: 'sid-0',
				title: 'Release train',
				color: '#db2777',
				icon: { kind: 'slug', value: '🚀' }
			}
		]);

		const store2 = new SessionStore();
		await store2.restore(snap);
		const s = store2.projects[0].sessions[0];
		expect(s.color).toBe('#db2777');
		expect(s.icon).toEqual({ kind: 'slug', value: '🚀' });
		expect(s.chat.title).toBe('Release train');
	});

	it('setSessionChrome null clears and invalid values are dropped', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		store.setSessionChrome(id, { color: '#abc', icon: { kind: 'builtin', id: 'star' } });
		expect(p.sessions[0].color).toBe('#abc');
		store.setSessionChrome(id, { color: null, icon: { kind: 'builtin', id: 'bogus' } });
		expect(p.sessions[0].color).toBeUndefined();
		expect(p.sessions[0].icon).toBeUndefined();
		// chrome never set → serialize omits the keys entirely
		p.sessions[0].chat.sessionId = 'sid-0';
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		const tab = store.serialize()[0].tabs![0];
		expect('color' in tab).toBe(false);
		expect('icon' in tab).toBe(false);
		expect('titleLocked' in tab).toBe(false);
	});
});

describe('SessionStore claude and codex in the daemon', () => {
	it('claude and codex specs carry the desktop approval mode', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const claude = store.addSession(p, undefined, 'claude');
		begin(claude);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(claude, p.path, undefined, undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'read-only' }
		});
		const codex = store.addSession(p, undefined, 'codex');
		begin(codex);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(codex, p.path, undefined, undefined, false, {
			engine: 'codex',
			options: { approval_mode: 'read-only' }
		});
	});

	it('a restored gateway tab reopens on the gateway', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.restoreSession(p, 'codex-1', 'old', 'codex', false, undefined, undefined, undefined, undefined, true);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, 'codex-1', undefined, false, {
			engine: 'codex',
			options: { approval_mode: 'read-only', lynshen_gateway: true }
		});
	});

	it('a saved Claude Code tab keeps its gateway and model when it reopens', async () => {
		const store = new SessionStore();
		const sid = '0b7c6a52-6f0e-4a8e-9a43-1d2f3c4b5a69';
		await store.restore([
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [{ id: 't1', sid, title: 'x', backend: 'claude', gateway: true, model: 'glm-5' }] }
		]);
		const s = store.projects[0].sessions[0];
		expect(s.dormant).toBe(true);
		expect(s.gateway).toBe(true);
		expect(store.serialize()[0].tabs![0]).toMatchObject({ gateway: true, model: 'glm-5' });
		store.wake(s.id);
		await flush();
		expect(lastSpec()?.options).toMatchObject({ lynshen_gateway: true, model: 'glm-5' });
	});

	it('a Claude Code restart keeps the model it ran on; a profile switch does not', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.restoreSession(p, 'claude-1', 'old', 'claude');
		await flush();
		const s = p.sessions[0];
		s.chat.model = 'claude-opus-4-8[1m]';
		store.restartSession(id, true);
		await flush();
		expect(lastSpec()?.options?.model).toBe('claude-opus-4-8[1m]');
		await store.applyToolProfile(id, 'lynshen');
		expect(lastSpec()?.options?.model).toBeUndefined();
	});

	it('the yolo respawn reopens the claude conversation in full-auto', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.restoreSession(p, 'claude-1', 'old', 'claude');
		await flush();
		vi.mocked(hostSession).mockClear();
		await store.respawnClaudeYolo(id);
		expect(closeSession).toHaveBeenCalledWith(id);
		expect(hostSession).toHaveBeenCalledWith(id, p.path, 'claude-1', undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'full-auto' }
		});
		expect(p.sessions[0].spawnedMode).toBe('bypassPermissions');
		expect(p.sessions[0].chat.switching).toBe(false);
	});

	it('a claude rewind reopens at the turn, or starts over before the first one', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.restoreSession(p, 'claude-1', 'old', 'claude');
		const s = p.sessions[0];
		s.chat.messages.push({ kind: 'user', text: 'one' }, { kind: 'assistant', text: 'a' }, { kind: 'user', text: 'two' });
		await flush();
		vi.mocked(hostSession).mockClear();
		await store.rewindClaudeSession(id, 'uuid-a', 1);
		expect(hostSession).toHaveBeenLastCalledWith(id, p.path, 'claude-1', undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'read-only', resume_at: 'uuid-a' }
		});
		expect(s.chat.userTurns).toBe(1);

		await store.rewindClaudeSession(id, null, 0);
		const call = vi.mocked(hostSession).mock.calls.at(-1)!;
		expect(call[2]).toBeUndefined();
		expect(call[5]).toEqual({ engine: 'claude', options: { approval_mode: 'read-only' } });
		expect(s.chat.sessionId).toBe(`conv-${id}`);
	});

	it('a claude conversation with messages keeps them over the replay when reopened', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		begin(id);
		await flush();
		const s = p.sessions[0];
		expect(s.chat.keepNextTranscript).toBe(false); // no message before its first start
		s.chat.messages.push({ kind: 'user', text: 'hi' }, { kind: 'assistant', text: 'with tool cards' });
		s.chat.engineState = 'exited';
		store.restartSession(id);
		expect(s.chat.keepNextTranscript).toBe(true);
		await flush();
		const before = s.chat.messages.map((m) => m.kind);
		s.chat.handle({ type: 'transcript', items: [{ role: 'user', content: 'plain replay' }] });
		expect(s.chat.messages.map((m) => m.kind)).toEqual(before);
		expect(s.chat.keepNextTranscript).toBe(false);
		// One-shot: a later transcript replaces the messages.
		s.chat.handle({ type: 'transcript', items: [{ role: 'user', content: 'plain replay' }] });
		expect(s.chat.messages).toEqual([{ kind: 'user', text: 'plain replay' }]);
	});

	it('a lynshen conversation takes the daemon replay as is', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		begin(id);
		await flush();
		const s = p.sessions[0];
		s.chat.engineState = 'exited';
		store.restartSession(id);
		expect(s.chat.keepNextTranscript).toBe(false);
	});
});

describe('project order', () => {
	it('moves whole projects before or after a target and keeps their order after restore', async () => {
		const store = new SessionStore();
		store.projects = [proj('a'), proj('b'), proj('c')];
		const id = store.addSession(store.projects[2]);
		store.renameSession(id, 'keep this session');
		store.moveProject('c', 'a', false);
		expect(store.shownProjects.map((p) => p.id)).toEqual(['c', 'a', 'b']);
		expect(store.projects[0].sessions[0].id).toBe(id);
		expect(store.activeId).toBe(id);
		const again = new SessionStore();
		await again.restore(store.serialize());
		expect(again.shownProjects.map((p) => p.id)).toEqual(['c', 'a', 'b']);
		expect(again.projects[0].sessions[0].chat.title).toBe('keep this session');
		store.moveProject('c', 'b', true);
		expect(store.shownProjects.map((p) => p.id)).toEqual(['a', 'b', 'c']);
		store.moveProject('c', 'c', false);
		store.moveProject('c', 'missing', false);
		store.moveProject('missing', 'a', false);
		expect(store.shownProjects.map((p) => p.id)).toEqual(['a', 'b', 'c']);
	});
});

describe('session order and pins', () => {
	const titles = (p: Project) => listedSessions(p).map((s) => s.chat.title);
	function three() {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		for (const title of ['c', 'b', 'a']) store.renameSession(store.addSession(p), title);
		return { store, p, id: (title: string) => p.sessions.find((s) => s.chat.title === title)!.id };
	}

	it('lists pinned sessions first, each group in the project order, archived ones left out', () => {
		const { store, p, id } = three();
		expect(titles(p)).toEqual(['a', 'b', 'c']);
		store.setPinned(id('c'), true);
		store.setPinned(id('b'), true);
		expect(titles(p)).toEqual(['b', 'c', 'a']);
		store.archiveSession(id('b'));
		expect(titles(p)).toEqual(['c', 'a']);
		// Unpinned, a session goes back to its place.
		store.setPinned(id('c'), false);
		expect(titles(p)).toEqual(['a', 'c']);
		expect(p.sessions.find((s) => s.chat.title === 'c')!.pinned).toBeUndefined();
	});

	it('a dragged session lands before or after its target; new sessions join at the start', () => {
		const { store, p, id } = three();
		store.moveSession(id('c'), id('a'), false);
		expect(titles(p)).toEqual(['c', 'a', 'b']);
		store.moveSession(id('c'), id('b'), true);
		expect(titles(p)).toEqual(['a', 'b', 'c']);
		store.moveSession(id('a'), id('a'), true);
		expect(titles(p)).toEqual(['a', 'b', 'c']);
		store.setPinned(id('b'), true);
		store.setPinned(id('c'), true);
		store.moveSession(id('c'), id('b'), false);
		expect(titles(p)).toEqual(['c', 'b', 'a']);
		store.renameSession(store.addSession(p), 'd');
		expect(titles(p)).toEqual(['c', 'b', 'd', 'a']);
	});

	it('order and pins survive serialize and restore', async () => {
		const { store, id } = three();
		store.moveSession(id('a'), id('c'), true);
		store.setPinned(id('c'), true);
		const saved = store.serialize();
		expect(saved[0].tabs!.map((t) => [t.title, t.pinned])).toEqual([
			['b', undefined],
			['c', true],
			['a', undefined]
		]);
		const again = new SessionStore();
		await again.restore(saved);
		expect(titles(again.projects[0])).toEqual(['c', 'b', 'a']);
	});
});

describe('hidden chats', () => {
	it('a saved chats group stays in the data but is never listed or activated', async () => {
		const store = new SessionStore();
		await store.restore([
			{ id: 'c', name: '对话', path: '/home/u/.lynshen/chats', chats: true, tabs: [{ id: 'c1', sid: 's-chat', title: 'chat' }] },
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [{ id: 'k1', sid: 's-code', title: 'code' }] }
		]);
		expect(store.shownProjects.map((p) => p.id)).toEqual(['p1']);
		expect(store.activeId).toBe('k1');
		// Closing the last coding session does not fall back to the chat.
		store.removeSession('k1');
		expect(store.activeId).toBe('');
		// The chats group is written back unchanged.
		expect(store.serialize()[0]).toMatchObject({ chats: true, tabs: [{ id: 'c1', sid: 's-chat', title: 'chat' }] });
	});

	it('with only a chats group saved, nothing opens', async () => {
		const store = new SessionStore();
		await store.restore([{ id: 'c', name: '对话', path: '/home/u/.lynshen/chats', chats: true, tabs: [{ id: 'c1', sid: 's-chat', title: 'chat' }] }]);
		expect(store.shownProjects).toEqual([]);
		expect(store.activeId).toBe('');
	});
});

describe('SessionStore conversations outside a project', () => {
	it('newChat runs each conversation in a folder of its own, made from its first message', async () => {
		const store = new SessionStore();
		store.projects.push(proj());
		const id = await store.newChat();
		const home = store.projects.find((p) => p.sessions.some((s) => s.id === id))!;
		expect(home.home).toBe(true);
		expect(home.path).toBe('/home/u/Documents/LynShen');
		expect(store.codeProjects.map((p) => p.id)).toEqual(['p1']);
		begin(id);
		await flush();
		await flush();
		// A coding session like any other, in a folder named by the day and the message.
		expect(home.path).toMatch(/^\/home\/u\/Documents\/LynShen\/\d{4}-\d{2}-\d{2} hi$/);
		expect(home.newFolder).toBeUndefined();
		expect(hostSession).toHaveBeenCalledWith(id, home.path, undefined, undefined, false, undefined);
		const second = await store.newChat();
		const other = store.projects.find((p) => p.sessions.some((s) => s.id === second))!;
		expect(other.id).not.toBe(home.id);
		expect(store.projects.filter((p) => p.home)).toHaveLength(2);
		// 历史 lists the conversations of every folder, and one opens where it ran.
		const items = await store.historyItems(other, other.sessions[0].chat);
		expect(items.map((x) => x.id)).toContain('s6old');
		expect(vi.mocked(sessionHistory)).toHaveBeenCalledWith('/home/u/Documents/LynShen/2026-10-01 old');
	});

	it('the group survives serialize/restore, and 最近 orders sessions by last activity', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const older = store.addSession(p);
		store.renameSession(older, 'older');
		const chat = await store.newChat('hello');
		await flush();
		await flush();
		const saved = store.serialize();
		expect(saved.find((x) => x.home)?.tabs?.[0]).toMatchObject({ id: chat });
		const again = new SessionStore();
		await again.restore(saved);
		expect(again.home?.sessions.map((s) => s.id)).toEqual([chat]);
		// The chat that sent a message is the most recent; it opens first.
		expect(again.recentSessions[0].id).toBe(chat);
		expect(again.activeId).toBe(chat);
		expect(again.recentSessions.map((s) => s.id)).toContain(older);
	});
});

describe('SessionStore GUI ⇄ TUI handoff', () => {
	const SID = '0f3d7a1c-9e2b-4b7e-9d4d-2a1b3c4d5e6f';

	/** A session whose engine conversation is resumable (sid + one user turn). */
	function readySession(store: SessionStore, p: Project, backend: 'lynshen' | 'claude' | 'codex') {
		const id = store.addSession(p, undefined, backend);
		const s = p.sessions.find((x) => x.id === id)!;
		s.chat.sessionId = SID;
		s.chat.messages.push({ kind: 'user', text: 'hi' });
		return s;
	}

	it('openInTui hands the tile to the daemon-run TUI without closing the session', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'claude');
		vi.mocked(closeSession).mockClear();
		store.openInTui(s.id);
		expect(s.surface).toBe('tui');
		// The daemon stops the engine itself; the session stays open for every client.
		expect(closeSession).not.toHaveBeenCalled();
	});

	it('openInTui waits for a conversation to resume, not for the turn to end', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const freshId = store.addSession(p, undefined, 'claude');
		const fresh = p.sessions.find((x) => x.id === freshId)!;
		store.openInTui(fresh.id);
		expect(fresh.surface).toBeUndefined();
		const busy = readySession(store, p, 'codex');
		busy.chat.handle({ type: 'connecting' });
		// The page asked the user first: the daemon cuts the turn short.
		store.openInTui(busy.id);
		expect(busy.surface).toBe('tui');
	});

	it('addTuiSession starts a new conversation in its TUI at once', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addTuiSession(p, 'codex');
		const s = p.sessions.find((x) => x.id === id)!;
		expect(s.backendId).toBe('codex');
		expect(s.surface).toBe('tui');
		// No first message: the engine starts now, for the TUI to take over.
		expect(s.draft).toBe(false);
	});

	it('returnToGui shows the whole conversation again, the TUI turns included', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'claude');
		store.openInTui(s.id);
		s.chat.keepNextTranscript = true;
		store.returnToGui(s.id);
		expect(s.surface).toBe('gui');
		expect(s.chat.keepNextTranscript).toBe(false);
	});

	it('a tab saved in the TUI comes back in the GUI', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const s = readySession(store, p, 'claude');
		store.openInTui(s.id);
		const saved = store.serialize();
		expect(JSON.stringify(saved)).not.toContain('"surface"');
	});
});

describe('SessionStore parallel-task worktrees', () => {
	const meta: WorktreeMeta = {
		isWorktree: true,
		mainRepoPath: '/tmp/repo',
		branch: 'task/fix-login',
		baseBranch: 'main',
		slug: 'fix-login'
	};
	const wtPath = '/tmp/.lynshen-worktrees/repo/fix-login';

	it('createProject with worktree meta sends the task description as first message', async () => {
		const store = new SessionStore();
		const p = store.createProject(wtPath, meta, '修复登录问题');
		expect(p.worktree).toEqual(meta);
		expect(p.name).toBe('fix-login');
		// first message is sent once the daemon opened the session
		await flush();
		const id = p.sessions[0].id;
		expect(sendLine).toHaveBeenCalledWith(id, JSON.stringify({ op: 'user_message', content: '修复登录问题' }));
		expect(p.sessions[0].chat.messages.some((m) => m.kind === 'user' && m.text === '修复登录问题')).toBe(true);
	});

	it('worktree metadata round-trips through serialize/restore', async () => {
		const store = new SessionStore();
		const p = store.createProject(wtPath, meta);
		p.sessions[0].chat.sessionId = 'sid-wt';
		p.sessions[0].chat.title = 'task';
		p.sessions[0].chat.messages.push({ kind: 'user', text: 'hi' });
		const snap = store.serialize();
		expect(snap[0].worktree).toEqual(meta);

		const store2 = new SessionStore();
		await store2.restore(snap);
		expect(store2.projects[0].worktree).toEqual(meta);
		expect(store2.projects[0].stale).toBeUndefined();
		expect(store2.projects[0].sessions).toHaveLength(1);
	});

	it('plain projects serialize without a worktree key', () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		expect('worktree' in store.serialize()[0]).toBe(false);
	});

	it('restore marks a vanished worktree project stale and spawns no sessions', async () => {
		vi.mocked(git).mockRejectedValueOnce(new Error('failed to run git: No such file or directory'));
		const store = new SessionStore();
		await store.restore([
			{ id: 'w1', name: 'fix-login', path: wtPath, worktree: meta, tabs: [{ sid: 's-a', title: 'A' }] },
			{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [] }
		]);
		const stale = store.projects[0];
		expect(stale.stale).toBe(true);
		expect(stale.sessions).toHaveLength(0);
		// 不因 stale 项目崩溃；没有会话时不再自动新建（显示主页）
		expect(store.projects[1].sessions).toHaveLength(0);
		expect(store.activeId).toBe('');
		expect(store.loaded).toBe(true);
	});
});

describe('sessions in the lynshen daemon', () => {
	it('every backend opens in the daemon; ACP agents from their registry command', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		expect(hostSession).not.toHaveBeenCalled(); // a draft is in no daemon yet
		begin(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, undefined, undefined, false, undefined);
		const acp = store.addSession(p, undefined, 'acp', { id: 'gemini', name: 'Gemini' });
		begin(acp);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(acp, p.path, undefined, undefined, false, {
			engine: 'acp',
			options: { command: 'gemini', args: ['--experimental-acp'], env: {} }
		});
	});

	it('a gateway draft takes a group, and hands it over once the daemon names it', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'codex');
		await store.applyToolProfile(id, 'lynshen', 'gpt-5.5');
		expect(store.takesSessionGroup(p.sessions[0])).toBe(true);
		store.setSessionGroup(id, 'GPT · Azure');
		expect(sessionMeta).not.toHaveBeenCalled();
		begin(id);
		await flush();
		expect(sessionMeta).toHaveBeenCalledWith(`conv-${id}`, { group: 'GPT · Azure' });
	});

	it('claude sessions are named by the daemon and translated by it', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p, undefined, 'claude');
		begin(id);
		await flush();
		const s = p.sessions[0];
		expect(s.chat.sessionId).toBe(`conv-${id}`);
		expect(s.chat.backendId).toBe('claude');
		expect(s.adapter.id).toBe('lynshen');

		// A claude conversation picked from history reopens by its id.
		vi.mocked(hostSession).mockClear();
		const picked = store.restoreSession(p, 'conv-2', '', 'claude');
		await flush();
		expect(hostSession).toHaveBeenCalledWith(picked, p.path, 'conv-2', undefined, false, expect.objectContaining({ engine: 'claude' }));
		expect(p.sessions.find((x) => x.id === picked)!.chat.sessionId).toBe('conv-2');
	});

	it('a restart reopens the daemon session instead of sending /resume', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		begin(id);
		const s = p.sessions[0];
		await flush();
		s.chat.messages.push({ kind: 'user', text: 'hi' });
		vi.mocked(hostSession).mockClear();
		store.handleExit(id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, p.path, `conv-${id}`, undefined, false, undefined);
		expect(sendLine).not.toHaveBeenCalledWith(id, expect.stringContaining('/resume'));
	});

	it('serialize keeps the daemon session and restore lists it until shown', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		begin(store.addSession(p));
		await flush();
		// The daemon named it; no user turn yet.
		const sid = p.sessions[0].chat.sessionId;
		const saved = store.serialize();
		expect(saved[0].tabs?.[0]).toMatchObject({ sid });
		expect('hosted' in saved[0].tabs![0]).toBe(false);

		vi.mocked(hostSession).mockClear();
		const restored = new SessionStore();
		await restored.restore(saved);
		const s = restored.projects[0].sessions[0];
		// Listed, not opened: the daemon keeps it until it is shown.
		expect(s.dormant).toBe(true);
		await flush();
		expect(hostSession).not.toHaveBeenCalled();
		restored.wake(s.id);
		expect(s.dormant).toBe(false);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(s.id, p.path, sid, undefined, false, undefined);
		expect(sendLine).not.toHaveBeenCalledWith(s.id, expect.stringContaining('/resume'));
	});

	it('restore lists claude, codex and lynshen tabs with a sid dormant, with or without a legacy hosted flag', async () => {
		const store = new SessionStore();
		await store.restore([
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [
					{ id: 't-claude', sid: 'claude-1', title: 'C', backend: 'claude' },
					{ id: 't-codex', sid: 'codex-1', title: 'X', backend: 'codex', hosted: true },
					{ id: 't-lynshen', sid: 'lynshen-1', title: 'J' },
					{ id: 't-old', sid: 'lynshen-2', title: 'O', hosted: false }
				]
			}
		] as never);
		const sessions = store.projects[0].sessions;
		expect(sessions.map((s) => [s.id, s.backendId, s.dormant, s.chat.sessionId])).toEqual([
			['t-claude', 'claude', true, 'claude-1'],
			['t-codex', 'codex', true, 'codex-1'],
			['t-lynshen', 'lynshen', true, 'lynshen-1'],
			['t-old', 'lynshen', true, 'lynshen-2']
		]);
		await flush();
		expect(hostSession).not.toHaveBeenCalled();

		for (const s of sessions) store.wake(s.id);
		await flush();
		expect(hostSession).toHaveBeenCalledWith('t-claude', '/tmp/p1', 'claude-1', undefined, false, {
			engine: 'claude',
			options: { approval_mode: 'read-only' }
		});
		expect(hostSession).toHaveBeenCalledWith('t-codex', '/tmp/p1', 'codex-1', undefined, false, {
			engine: 'codex',
			options: { approval_mode: 'read-only' }
		});
		expect(hostSession).toHaveBeenCalledWith('t-lynshen', '/tmp/p1', 'lynshen-1', undefined, false, undefined);
		expect(hostSession).toHaveBeenCalledWith('t-old', '/tmp/p1', 'lynshen-2', undefined, false, undefined);
		// Woken once: a second wake opens nothing.
		vi.mocked(hostSession).mockClear();
		store.wake('t-claude');
		await flush();
		expect(hostSession).not.toHaveBeenCalled();
	});
});

describe('agent sessions', () => {
	it("opens a new session as the agent in a hidden project for its directory", async () => {
		const store = new SessionStore();
		const id = store.openAgentSession({ id: 'ops', name: 'Ops', cwd: '/srv/ops' });
		expect(store.projects.map((p) => [p.path, p.agents])).toEqual([['/srv/ops', true]]);
		const s = store.projects[0].sessions[0];
		expect(s.id).toBe(id);
		// Named by the daemon after its first message, not after the agent.
		expect(s.chat.title).toBe(UNTITLED);
		expect(s.chat.agent).toBe('ops');
		expect(store.activeId).toBe(id);
		// The workbench shows it; the sidebar, canvas, save and sync do not.
		expect(store.shownSessions).toEqual([]);
		expect(store.serialize()).toEqual([]);
		await flush();
		expect(hostSession).toHaveBeenCalledWith(id, '/srv/ops', undefined, 'ops', false, undefined);
	});

	it("reuses the open session of the agent, or reopens it by id, apart from the user's project", async () => {
		const store = new SessionStore();
		const p = proj();
		p.path = '/srv/ops';
		store.projects.push(p);
		const first = store.openAgentSession({ id: 'ops', name: 'Ops', cwd: '/srv/ops' }, 'daemon-1', '处理今日工单');
		expect(store.allSessions.find((x) => x.id === first)?.chat.title).toBe('处理今日工单');
		await flush();
		expect(hostSession).toHaveBeenCalledWith(first, '/srv/ops', 'daemon-1', undefined, false, undefined);
		expect(p.sessions.some((s) => s.id === first)).toBe(false);
		expect(store.projects.filter((x) => x.agents)).toHaveLength(1);
		vi.mocked(hostSession).mockClear();
		expect(store.openAgentSession({ id: 'ops', name: 'Ops', cwd: '/srv/ops' }, 'daemon-1')).toBe(first);
		await flush();
		expect(hostSession).not.toHaveBeenCalled();
		// A plain hosted session (no agent) still opens in the user's project.
		const plain = store.openAgentSession({ id: '', name: 'p', cwd: '/srv/ops' }, 'daemon-2');
		expect(p.sessions.some((s) => s.id === plain)).toBe(true);
	});

	it("moves an agent's session out of a user project", () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		store.adoptAgentSession(id, '/srv/ops');
		expect(p.sessions).toHaveLength(0);
		const host = store.projects.find((x) => x.agents)!;
		expect([host.path, host.sessions.map((s) => s.id)]).toEqual(['/srv/ops', [id]]);
	});
});

describe('SessionStore: a session started on a requirement', () => {
	it('begins the requirement once the daemon names it, in the mode the work runs in', async () => {
		const store = new SessionStore();
		const p = proj('rq');
		store.projects.push(p);
		const id = store.addSession(store.projects[0]);
		const s = store.allSessions.find((x) => x.id === id)!;
		s.chat.approvalMode = 'plan';
		s.requirement = 'R-7';
		s.requirementStart = { plan: true, text: 'only the API' };
		startDraft(id);
		await flush();
		expect(vi.mocked(daemon.request)).toHaveBeenCalledWith(
			expect.objectContaining({
				op: 'requirement_begin',
				requirement: 'R-7',
				session: `conv-${id}`,
				plan: true,
				mode: 'edits',
				text: 'only the API'
			})
		);
		expect(s.requirement).toBeUndefined();
		expect(s.requirementStart).toBeUndefined();
	});
});

describe('letting go of hidden conversations', () => {
	/** A started LynShen session with one tool call, idle. */
	const started = async (store: SessionStore, p: Project) => {
		const id = store.addSession(p);
		begin(id);
		await flush();
		const s = p.sessions.find((x) => x.id === id)!;
		s.chat.handle({ type: 'tool_start', call_id: 'c1', name: 'read_file' });
		s.chat.handle({ type: 'tool_output', call_id: 'c1', name: 'read_file', output: 'body' });
		s.chat.handle({ type: 'model_status', state: 'ready' });
		return store.allSessions.find((x) => x.id === id)!;
	};
	const output = (s: Session) => {
		const m = s.chat.messages.find((x) => x.kind === 'tool');
		return m?.kind === 'tool' ? m.output : undefined;
	};

	it('lets go of a settled conversation not shown for a while, and opens it again when shown', async () => {
		const store = new SessionStore();
		store.projects.push(proj());
		const p = store.projects[0];
		const s = await started(store, p);
		store.releaseHidden([], 0);
		store.releaseHidden([], RELEASE_AFTER_MS - 1);
		expect(s.dormant).toBeFalsy();
		store.releaseHidden([], RELEASE_AFTER_MS);
		expect(s.dormant).toBe(true);
		expect(daemon.unwatch).toHaveBeenCalledWith(s.id);
		expect(output(s)).toBe('');
		// The daemon may close it once idle: no restart follows.
		store.handleExit(s.id);
		expect(s.chat.messages.some((m) => m.kind === 'system')).toBe(false);
		vi.mocked(hostSession).mockClear();
		store.wake(s.id);
		await flush();
		expect(vi.mocked(hostSession).mock.calls[0]?.[2]).toBe(s.chat.sessionId);
		s.chat.handle({ type: 'transcript', items: [{ role: 'user', content: 'hi' }, { role: 'tool', name: 'read_file', output: 'body' }] });
		expect(output(s)).toBe('body');
	});

	it('keeps what is shown, busy or not LynShen', async () => {
		const store = new SessionStore();
		store.projects.push(proj());
		const p = store.projects[0];
		const shown = await started(store, p);
		const busy = await started(store, p);
		busy.chat.handle({ type: 'connecting' });
		const claude = await started(store, p);
		claude.backendId = 'claude';
		store.releaseHidden([shown.id], 0);
		store.releaseHidden([shown.id], RELEASE_AFTER_MS);
		expect([shown.dormant, busy.dormant, claude.dormant]).toEqual([undefined, undefined, undefined]);
		expect(daemon.unwatch).not.toHaveBeenCalled();
	});

	/** A started session let go of while hidden. */
	const released = async (store: SessionStore) => {
		store.projects.push(proj());
		const s = await started(store, store.projects[0]);
		store.releaseHidden([], 0);
		store.releaseHidden([], RELEASE_AFTER_MS);
		expect(s.dormant).toBe(true);
		vi.mocked(hostSession).mockClear();
		return s;
	};

	it('watches a conversation let go of again once it starts something, so it asks here', async () => {
		const store = new SessionStore();
		const s = await released(store);
		// Events that change nothing leave it as it is.
		s.chat.handle({ type: 'context_usage', tokens: 10 });
		store.rouse(s);
		expect(s.dormant).toBe(true);
		expect(hostSession).not.toHaveBeenCalled();
		// Another session's message starts a turn in it.
		s.chat.handle({ type: 'user_message', content: 'from elsewhere' });
		s.chat.handle({ type: 'connecting' });
		store.rouse(s);
		expect(s.dormant).toBe(false);
		await flush();
		expect(vi.mocked(hostSession).mock.calls[0]?.[2]).toBe(s.chat.sessionId);
		// Not let go of while it runs, however long it is hidden.
		store.releaseHidden([], Date.now() + RELEASE_AFTER_MS * 2);
		expect(s.dormant).toBe(false);
		expect(daemon.unwatch).toHaveBeenCalledTimes(1);
	});

	it('counts a session as shown until it leaves the screen, and from when it is shown again', async () => {
		const store = new SessionStore();
		store.projects.push(proj());
		const s = await started(store, store.projects[0]);
		store.releaseHidden([], 0);
		// Shown for 30 s between two checks: hidden only since then.
		store.noteShown([s.id], RELEASE_AFTER_MS - 60_000);
		store.noteShown([], RELEASE_AFTER_MS - 30_000);
		store.releaseHidden([], RELEASE_AFTER_MS);
		expect(s.dormant).toBeFalsy();
		store.releaseHidden([], RELEASE_AFTER_MS * 2 - 30_000);
		expect(s.dormant).toBe(true);
		// Woken: its clock starts again.
		const woken = Date.now();
		store.wake(s.id);
		await flush();
		expect(s.shownAt).toBeGreaterThanOrEqual(woken);
	});

	it('ignores the idle close the daemon sends as a conversation opens again', async () => {
		const store = new SessionStore();
		const s = await released(store);
		let opened = () => {};
		vi.mocked(hostSession).mockImplementationOnce(() => new Promise<void>((resolve) => (opened = resolve)));
		store.wake(s.id);
		await flush();
		// The daemon closed the idle engine just before the open reached it.
		store.handleExit(s.id);
		expect(s.chat.messages.some((m) => m.kind === 'system')).toBe(false);
		expect(hostSession).toHaveBeenCalledTimes(1);
		opened();
		await flush();
		// Once open, an exit is a crash again.
		store.handleExit(s.id);
		expect(s.chat.messages.some((m) => m.kind === 'system')).toBe(true);
		await flush();
		expect(hostSession).toHaveBeenCalledTimes(2);
	});

	it('closes a conversation it let go of when its tab is closed', async () => {
		const store = new SessionStore();
		store.projects.push(proj());
		const s = await started(store, store.projects[0]);
		store.releaseHidden([], 0);
		store.releaseHidden([], RELEASE_AFTER_MS);
		expect(s.dormant).toBe(true);
		store.removeSession(s.id);
		expect(closeSession).toHaveBeenCalledWith(s.id);
	});
});

describe('moveDraft', () => {
	it('moves a new conversation to another project, and it starts there', async () => {
		const store = new SessionStore();
		const a = proj('a');
		const b = proj('b');
		store.projects.push(a, b);
		const id = store.addSession(a, undefined, 'claude');
		store.moveDraft(id, 'b');
		expect(store.projects[0]!.sessions).toHaveLength(0);
		expect(store.projects[1]!.sessions.map((s) => s.id)).toEqual([id]);
		expect(store.projects[1]!.lastBackend).toBe('claude');
		await begin(id);
		await flush();
		expect(vi.mocked(hostSession).mock.calls.at(-1)![1]).toBe('/tmp/b');
		// Started: it stays where it is.
		store.moveDraft(id, 'a');
		expect(store.projects[1]!.sessions.map((s) => s.id)).toEqual([id]);
	});
});

describe('新对话: one new conversation waits until its first message', () => {
	/** localStorage for unsent composer text (composerText.ts), as the app has it. */
	function storage() {
		const items = new Map<string, string>();
		vi.stubGlobal('localStorage', {
			getItem: (k: string) => items.get(k) ?? null,
			setItem: (k: string, v: string) => void items.set(k, v),
			removeItem: (k: string) => void items.delete(k)
		});
		return items;
	}
	afterEach(() => vi.unstubAllGlobals());
	const listed = (store: SessionStore) => store.shownProjects.flatMap((p) => listedSessions(p)).map((s) => s.id);

	it('新对话 again before anything is sent opens the same conversation, which is not listed', async () => {
		const store = new SessionStore();
		store.projects.push(proj());
		const first = await store.newChat();
		store.activeId = '';
		expect(await store.newChat()).toBe(first);
		expect(await store.newChat()).toBe(first);
		expect(store.activeId).toBe(first);
		expect(store.projects.filter((p) => p.home)).toHaveLength(1);
		expect(store.home!.sessions.map((s) => s.id)).toEqual([first]);
		// Not a conversation yet: not in the lists, not what a restart opens.
		expect(listed(store)).toEqual([]);
		expect(store.recentSessions).toEqual([]);
		// Sent: listed, and the next 新对话 is a new one.
		store.home!.sessions[0].chat.optimisticUser('hi');
		begin(first);
		expect(listed(store)).toEqual([first]);
		await flush();
		await flush();
		const second = await store.newChat();
		expect(second).not.toBe(first);
		expect(listed(store)).toEqual([first]);
		expect(hostSession).toHaveBeenCalledTimes(1);
	});

	it("a project's + opens its waiting new conversation; one with a first message is not reused", () => {
		const store = new SessionStore();
		const a = proj('a');
		const b = proj('b');
		store.projects.push(a, b);
		const inA = store.addSession(a);
		const inB = store.addSession(b);
		expect(inB).not.toBe(inA);
		expect(store.addSession(a)).toBe(inA);
		expect(store.activeId).toBe(inA);
		expect(store.addSession(b)).toBe(inB);
		expect(a.sessions).toHaveLength(1);
		expect(b.sessions).toHaveLength(1);
		// Asked for a given backend (the TUI picker) or with a first message: a new one.
		expect(store.addSession(a, undefined, 'claude')).not.toBe(inA);
		const sent = store.addSession(b, 'hello');
		expect(sent).not.toBe(inB);
		expect(store.addSession(b)).toBe(inB);
		// A draft the user named is a conversation of its own.
		store.renameSession(inB, 'plan');
		const next = store.addSession(b);
		expect(next).not.toBe(inB);
		expect(listedSessions(b).map((s) => s.id)).toEqual([sent, inB]);
	});

	it('a command typed into a new conversation leaves it unlisted and waiting; a goal makes it a conversation', async () => {
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		dispatch(id, { op: 'command', input: '/help' });
		await flush();
		expect(hostSession).toHaveBeenCalledTimes(1);
		const s = p.sessions[0];
		s.chat.messages.push({ kind: 'system', text: 'commands: …' });
		expect(listedSessions(p)).toEqual([]);
		expect(store.addSession(p)).toBe(id);
		s.chat.handle({ type: 'goal', goal: { objective: 'make the tests pass', status: 'active' } } as never);
		expect(listedSessions(p).map((x) => x.id)).toEqual([id]);
		expect(store.addSession(p)).not.toBe(id);
	});

	it('a restored conversation is listed unless the daemon reports it saved empty', async () => {
		const store = new SessionStore();
		await store.restore([{ id: 'p1', name: 'p1', path: '/tmp/p1', tabs: [{ id: 't1', sid: 's-1', title: UNTITLED }] }]);
		const p = store.projects[0];
		expect(listedSessions(p).map((s) => s.id)).toEqual(['t1']);
		p.sessions[0].empty = true;
		expect(listedSessions(p)).toEqual([]);
		// Not reused either: it holds a saved conversation.
		expect(store.addSession(p)).not.toBe('t1');
	});

	it('a restart keeps one waiting new conversation per project, and every one with unsent text', async () => {
		const items = storage();
		items.set('lynshen-composer:t-typed', 'half a question');
		const waiting = (id: string, tabs: SavedProject['tabs']) => ({
			id,
			name: '对话',
			path: '/home/u/Documents/LynShen',
			home: true,
			newFolder: true,
			tabs
		});
		const store = new SessionStore();
		await store.restore([
			// What 0.8.0 saved after 新对话 was clicked four times.
			waiting('h1', [{ id: 't-h1', title: UNTITLED }]),
			waiting('h2', [{ id: 't-h2', title: UNTITLED }]),
			waiting('h3', [{ id: 't-typed', title: UNTITLED }]),
			waiting('h4', [{ id: 't-h4', title: UNTITLED }]),
			{ id: 'h5', name: '2026-10-14 hi', path: '/home/u/Documents/LynShen/2026-10-14 hi', home: true, tabs: [{ id: 't-hi', sid: 's-hi', title: 'hi' }] },
			{
				id: 'p1',
				name: 'p1',
				path: '/tmp/p1',
				tabs: [
					{ id: 't-a', title: UNTITLED },
					{ id: 't-b', title: UNTITLED },
					{ id: 't-named', title: 'named' },
					{ id: 't-c', title: UNTITLED, archived: true },
					{ id: 't-sent', sid: 's-1', title: 'fix it' }
				]
			}
		]);
		const ids = (p: Project | undefined) => p?.sessions.map((s) => s.id);
		expect(store.projects.map((p) => p.id)).toEqual(['h1', 'h3', 'h5', 'p1']);
		expect(ids(store.projects[0])).toEqual(['t-h1']);
		expect(ids(store.projects[1])).toEqual(['t-typed']);
		expect(ids(store.projects[3])).toEqual(['t-a', 't-named', 't-sent']);
		// The lists show the conversations only; a restart opens the latest one.
		expect(listed(store).sort()).toEqual(['t-hi', 't-named', 't-sent']);
		expect(['t-hi', 't-named', 't-sent']).toContain(store.activeId);
		// 新对话 opens the one waiting; nothing was deleted on disk.
		expect(await store.newChat()).toBe('t-h1');
		expect(store.addSession(store.projects[3])).toBe('t-a');
		expect(items.get('lynshen-composer:t-typed')).toBe('half a question');
		expect(store.serialize().filter((p) => p.home && p.newFolder)).toHaveLength(2);
	});

	it('a new conversation moved to a project replaces the one waiting there', () => {
		const items = storage();
		const store = new SessionStore();
		const a = proj('a');
		const b = proj('b');
		store.projects.push(a, b);
		const waitingInB = store.addSession(b);
		const moved = store.addSession(a);
		store.moveDraft(moved, 'b');
		expect(b.sessions.map((s) => s.id)).toEqual([moved]);
		expect(store.addSession(b)).toBe(moved);
		// One with unsent text stays (it opens once this one is sent).
		const typed = store.addSession(a);
		items.set(`lynshen-composer:${moved}`, 'keep me');
		store.moveDraft(typed, 'b');
		expect(b.sessions.map((s) => s.id)).toEqual([typed, moved]);
		expect(waitingInB).not.toBe(moved);
	});

	it('history leaves out conversations saved with nothing in them', async () => {
		vi.mocked(sessionHistory).mockResolvedValueOnce([
			{ session: 's-full', title: 'old chat', updated_at: 3, entries: 4, archived: false, agent: null, open: false, engine: 'lynshen' },
			{ session: 's-empty', title: '', updated_at: 2, entries: 0, archived: false, agent: null, open: false, engine: 'lynshen' },
			{ session: 's-old', title: 's-old', updated_at: 2, entries: 0, archived: false, agent: null, open: false, engine: 'lynshen' },
			{ session: 's-named', title: 'kept', updated_at: 1, entries: 0, archived: false, agent: null, open: false, engine: 'lynshen' }
		]);
		const store = new SessionStore();
		const p = proj();
		store.projects.push(p);
		const id = store.addSession(p);
		const items = await store.historyItems(p, p.sessions.find((s) => s.id === id)!.chat);
		expect(items.map((x) => x.id)).toEqual(['s-full', 's-named']);
	});
});
