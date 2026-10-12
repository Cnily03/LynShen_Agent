<script lang="ts">
  // One real ChatPane fed engine events the way the page's `deliver` feeds
  // them: each frame through ChatState.handle, then the pane follows the end.
  import ChatPane, { type ChatPaneApi } from '../../src/lib/ChatPane.svelte';
  import { SessionStore } from '../../src/lib/session.svelte';
  import { setLocale } from '../../src/lib/i18n';
  import { Requirements, provideRequirements } from '../../src/lib/requirements.svelte';
  import type { DaemonClient } from '../../src/lib/daemon';
  setLocale('zh');
  provideRequirements(new Requirements({} as DaemonClient));
  const store = new SessionStore();
  store.createProject('/tmp/perf-project');
  const session = $derived(store.allSessions.find((s) => s.id === store.activeId));
  let api: ChatPaneApi | null = null;
  Object.assign(window, {
    __perf: {
      ready: () => !!session && !!api,
      deliver(ev: Record<string, unknown>) {
        const chat = session!.chat;
        chat.captureFrame(JSON.stringify(ev), ev);
        chat.handle(ev as never);
        api?.scrollToEnd();
      },
      chat: () => session!.chat
    }
  });
</script>
<div style="height:760px;width:1100px;display:flex;flex-direction:column;position:relative">
  {#if session}
    <ChatPane {session} {store} isActive onRegister={(_, a) => (api = a)} />
  {/if}
</div>
