<script lang="ts">
	// The phone remote page's computer view (HostView, as the page shows it)
	// on a scripted computer: a session list, a session waiting for an
	// approval, the notification rules. For the browser regressions of the
	// phone page at 390×844.
	//   ?remoteHost              the list
	//   &open=<session>          as when a notification about it was tapped
	// window.__remoteOps: every op the page sent; __remoteSend(frame) sends
	// one more frame from the computer.
	import { onMount, type Component } from 'svelte';
	import HostView, { type ShowRequest } from '../../src/lib/remote/HostView.svelte';
	import PushSettings from '../../src/lib/remote/PushSettings.svelte';
	import Toaster from '../../src/lib/ui/Toaster.svelte';
	import ConfirmHost from '../../src/lib/ui/ConfirmHost.svelte';
	import RemoteSession from '../../src/lib/RemoteSession.svelte';
	import { HostConnection } from '../../src/lib/remote/connection.svelte';
	import { openTarget } from '../../src/lib/remote/push';
	import { setLocale } from '../../src/lib/i18n';
	import type { SocketLike } from '../../src/lib/daemon';

	const params = new URL(location.href).searchParams;
	setLocale(params.get('lang') === 'en' ? 'en' : 'zh');
	type Frame = Record<string, unknown>;
	const ops: Frame[] = [];
	let rules: Frame = { daily_budget: 20, quiet_start: '23:00', quiet_end: '08:00', turn_done: true, sent_today: 3 };
	const SESSION = 's-cache';
	const sessions = [
		{ session: SESSION, cwd: '/Users/me/code/lynshen-desktop', title: '会话缓存分片', open: true, watchers: 0, updated_at: Date.now(), created_at: Date.now(), entries: 4, engine: 'lynshen', agent: null, archived: false, chat: false },
		{ session: 's-docs', cwd: '/Users/me/code/lynshen-desktop', title: '翻译文档', open: false, watchers: 0, updated_at: Date.now() - 3_600_000, created_at: Date.now() - 3_600_000, entries: 9, engine: 'lynshen', agent: null, archived: false, chat: false }
	];
	const workspaces = { type: 'workspaces', rev: 1, workspaces: [{ id: 'w1', name: '工作', projects: [{ id: 'p1', name: 'lynshen-desktop', path: '/Users/me/code/lynshen-desktop', dirs: [] }] }] };
	const approval = {
		type: 'approval_request', session: SESSION, call_id: 'call-push', name: 'bash', summary: 'git push origin feat/session-cache',
		subagent_id: null, hunks: null, kind: 'escalation', must_ask: false, justification: '改动和测试都完成了，推送分支要联网',
		cwd: '/Users/me/code/lynshen-desktop', command: 'git push origin feat/session-cache', paths: [], dir_suggestion: null,
		prefix: 'git push', scopes: ['once', 'session'], elevation: null
	};

	class Computer implements SocketLike {
		readyState = 1;
		onopen: (() => void) | null = null;
		onmessage: ((event: { data: unknown }) => void) | null = null;
		onclose: (() => void) | null = null;
		onerror: (() => void) | null = null;
		constructor() {
			setTimeout(() => {
				this.emit({ type: 'hello', protocol: 2, version: '0.7.5' });
				this.emit({ type: 'sessions', sessions });
				this.emit(workspaces);
				this.emit({ type: 'agents', agents: [] });
				this.emit({ type: 'questions', questions: [] });
				this.emit({ type: 'actions', actions: [] });
			});
			Object.assign(window, { __remoteSend: (f: Frame) => this.emit(f) });
		}
		emit(frame: Frame) {
			this.onmessage?.({ data: JSON.stringify(frame) });
		}
		send(text: string) {
			const op = JSON.parse(text) as Frame;
			ops.push(op);
			const answer = (frame: Frame) => setTimeout(() => this.emit({ ...frame, id: op.id }), 20);
			switch (op.op) {
				case 'session_list':
					return answer({ type: 'sessions', sessions });
				case 'report_list':
					return answer({ type: 'reports', reports: [] });
				case 'agent_list':
					return answer({ type: 'agents', agents: [] });
				case 'schedule_list':
					return answer({ type: 'schedules', schedules: [] });
				case 'workspaces':
					return answer(workspaces);
				case 'session_open':
					return answer({ type: 'session_opened', session: op.session });
				case 'watch':
					setTimeout(() => {
						this.emit({ type: 'startup', session: op.session, session_id: op.session, cwd: sessions[0].cwd, model: 'gpt-5.5', version: '0.7.5' });
						this.emit({ type: 'approval_mode', session: op.session, mode: 'manual' });
						this.emit({
							type: 'transcript', session: op.session,
							items: [
								{ role: 'user', content: '把会话缓存改成按会话分片，跑完单元测试再提交。' },
								{ role: 'assistant', content: '改好了，单元测试全部通过。接下来推送分支。' }
							]
						});
						this.emit({ type: 'attended', session: op.session, attended: true });
						if (op.session === SESSION && !approved) this.emit(approval);
					}, 30);
					return;
				case 'approve':
					approved = true;
					setTimeout(() => this.emit({ type: 'tool_output', session: SESSION, call_id: 'call-push', name: 'bash', output: '已推送', is_error: false }), 30);
					return;
				case 'push_rules':
					return answer({ type: 'push_rules', rules });
				case 'push_rules_set':
					rules = { ...rules, ...(op.rules as Frame) };
					return answer({ type: 'push_rules', rules });
				case 'push_viewing':
					return answer({ type: 'push_viewing' });
				case 'ping':
					return answer({ type: 'pong' });
				default:
					if (typeof op.id === 'number') answer({ type: 'error', message: `${op.op} requires session` });
			}
		}
		close() {}
	}
	let approved = false;
	Object.assign(window, { __remoteOps: ops });

	const conn = new HostConnection('host-1', 'lan', async () => ({ url: 'ws://computer', token: 't' }), () => new Computer());
	conn.start();
	/* eslint-disable @typescript-eslint/no-explicit-any -- the screens as the page loads them */
	const screens: { RemoteSession: Component<any> | null; FilesScreen: Component<any> | null; ChangesScreen: Component<any> | null } = {
		RemoteSession,
		FilesScreen: null,
		ChangesScreen: null
	};
	/* eslint-enable @typescript-eslint/no-explicit-any */
	let show = $state<ShowRequest | null>(null);
	let settings = $state(params.has('settings'));
	onMount(() => {
		const opened = params.get('open');
		if (!opened) return;
		const target = openTarget(`/remote?host=host-1&session=${opened}`);
		// As the page does once the computer's list has arrived.
		const wait = setInterval(() => {
			if (conn.agents.status !== 'on' || !target) return;
			clearInterval(wait);
			show = { ...target, n: 1 };
		}, 50);
	});
</script>

{#snippet switcher()}<button class="conn" onclick={() => (settings = true)}>通知</button>{/snippet}
{#snippet resizer()}{/snippet}

<Toaster />
<ConfirmHost />
<div class="remote">
	<HostView {conn} name="MacBook Pro" hidden={false} wide={false} {screens} {switcher} {resizer} onAdd={() => {}} onForget={() => {}} onRepair={() => {}} {show} />
</div>
{#if settings}
	<PushSettings {conn} conns={[conn]} name="MacBook Pro" onTest={() => {}} onClose={() => (settings = false)} />
{/if}

<style>
	.remote {
		min-height: 100dvh;
		background: var(--bg);
		color: var(--text);
		font-family: var(--font-sans);
	}
</style>
