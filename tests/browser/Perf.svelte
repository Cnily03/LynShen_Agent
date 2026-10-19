<script lang="ts">
  // One real ChatPane fed engine events the way the page's `deliver` feeds
  // them: each frame through ChatState.handle, then the pane follows the end.
  // For the streaming benchmarks (scripts/reasoning-perf.mjs,
  // scripts/desk-perf.mjs) and the browser regression's performance check.
  //
  // `window.__perf.seed(turns)` gives the shown conversation a long history
  // (history.ts) before or after the pane shows; `addSessions(n, turns)`
  // opens more conversations, kept in memory and not shown; `show(i)` shows
  // the i-th (0: the first), as picking it in the navigator does: the pane
  // of the one shown before goes. ?defer: no pane until `show` is called.
  import ChatPane, { type ChatPaneApi } from '../../src/lib/ChatPane.svelte';
  import { SessionStore } from '../../src/lib/session.svelte';
  import { setLocale } from '../../src/lib/i18n';
  import { Requirements, provideRequirements } from '../../src/lib/requirements.svelte';
  import type { DaemonClient } from '../../src/lib/daemon';
  import { historyEvents } from './history';
  setLocale('zh');
  provideRequirements(new Requirements({} as DaemonClient));
  const store = new SessionStore();
  const project = store.createProject('/tmp/perf-project');
  const ids = [project.sessions[0]!.id];
  const first = store.allSessions.find((s) => s.id === ids[0])!;
  first.draft = false;
  let shownId = $state<string | null>(new URL(location.href).searchParams.has('defer') ? null : ids[0]!);
  const session = $derived(store.allSessions.find((s) => s.id === shownId));
  let api: ChatPaneApi | null = null;
  const chatOf = (i: number) => store.allSessions.find((s) => s.id === ids[i])!.chat;
  Object.assign(window, {
    __perf: {
      ready: () => !!session && !!api,
      deliver(ev: Record<string, unknown>) {
        const chat = session!.chat;
        chat.captureFrame(JSON.stringify(ev), ev);
        chat.handle(ev as never);
        api?.scrollToEnd();
      },
      chat: () => (session ?? first).chat,
      /** Gives conversation `i` (default the first) `turns` turns of history. */
      seed(turns: number, i = 0, from = 0) {
        const chat = chatOf(i);
        for (const ev of historyEvents(turns, from)) chat.handle(ev as never);
      },
      /** Opens `n` more conversations of `turns` turns each; returns how many there are. */
      addSessions(n: number, turns: number) {
        for (let k = 0; k < n; k++) {
          const id = store.addSession(project, undefined, 'lynshen');
          store.allSessions.find((s) => s.id === id)!.draft = false;
          ids.push(id);
          for (const ev of historyEvents(turns, 0)) chatOf(ids.length - 1).handle(ev as never);
        }
        return ids.length;
      },
      /** Shows conversation `i` (-1: none). */
      show(i: number) {
        api = null;
        shownId = i < 0 ? null : ids[i]!;
      },
      count: () => ids.length
    }
  });
</script>
<div style="height:760px;width:1100px;display:flex;flex-direction:column;position:relative">
  {#key shownId}
    {#if session}
      <ChatPane {session} {store} isActive onRegister={(_, a) => (api = a)} />
    {/if}
  {/key}
</div>
