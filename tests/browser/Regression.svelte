<script lang="ts">
  import SettingsPage from '../../src/lib/settings/SettingsPage.svelte';
  import { SessionStore } from '../../src/lib/session.svelte';
  import { setLocale } from '../../src/lib/i18n';
  import Mosaic from '../../src/lib/workbench/Mosaic.svelte';
  import HomePage from '../../src/lib/HomePage.svelte';
  import TitleBar from '../../src/lib/shell/TitleBar.svelte';
  import Probe from './Probe.svelte';
  import MessageList from '../../src/lib/MessageList.svelte';
  import { ChatState } from '../../src/lib/chat.svelte';
  import { closeTab, leavesOf, moveTab, singleLeafLayout, splitLeaf, type TileLayout } from '../../src/lib/workbench/tiles';
  setLocale('zh');
  const mode = new URL(location.href).searchParams;
  // Tab contents stay mounted through splits, moves and a neighbour closing.
  (window as unknown as { __mounts: Record<string, number> }).__mounts = {};
  let tiles = $state<TileLayout>(singleLeafLayout([{ id: 't0', panel: 'a' }]));
  const lastLeaf = () => leavesOf(tiles.root).at(-1)!.id;
  // The home page's start box, and what it started.
  let started = $state('');
  const sessions = new SessionStore();
  const sessionMap = $derived(new Map(sessions.allSessions.map(s => [s.id,s])));
  let welcome = $state(false);
  let section = $state('account');
  let sequence = 0;
  const projectMode = new URL(location.href).searchParams.has('projects');
  // A reply thinking and answering at length, fed by the test (window.__chat).
  const chat = new ChatState();
  (window as unknown as { __chat: ChatState }).__chat = chat;
  let scroller = $state<HTMLElement | null>(null);
  const thinking = $derived.by(() => {
    const last = chat.messages.at(-1);
    return chat.busy && last?.kind === 'reasoning' && last.live ? last : null;
  });
  const answering = $derived.by(() => {
    const last = chat.messages.at(-1);
    return chat.busy && last?.kind === 'assistant' && !last.interrupted ? last : null;
  });
</script>
{#if mode.has('mosaic')}
  <button onclick={() => (tiles = splitLeaf(tiles, leavesOf(tiles.root)[0].id, 'right', { id: 't1', panel: 'b' }).layout)}>拆分</button>
  <button onclick={() => (tiles = moveTab(tiles, 't0', lastLeaf(), 'bottom'))}>移动</button>
  <button onclick={() => (tiles = closeTab(tiles, 't1'))}>关闭</button>
  <div style="height:600px;position:relative">
    <Mosaic layout={tiles} onchange={(l) => (tiles = l)} label={(tab) => tab.id}>
      {#snippet panel(tab)}<Probe id={tab.id} />{/snippet}
    </Mosaic>
  </div>
{:else if mode.has('reasoning')}
  <main bind:this={scroller} style="height:600px;width:720px;overflow:auto">
    <MessageList messages={chat.messages} streamingMsg={answering} streamingReasoning={thinking} phase={chat.phase} {scroller} onEdit={() => {}} onRewind={() => {}} />
  </main>
{:else if mode.has('home')}
  <p data-testid="started">{started}</p>
  <div style="height:600px;position:relative">
    <HomePage projects={[]} modelPicker onStart={(text, model) => (started = `${text} @ ${model ?? '-'}`)} onOpenSession={() => {}} onOpenProject={() => {}} onAddProject={() => {}} onOpenAgent={() => {}} />
  </div>
{:else if mode.has('titlebar')}
  <div style="height:600px;display:flex;flex-direction:column">
    <TitleBar leftWidth={200} sidebarOpen onToggleSidebar={() => {}} title="对话" addOptions={['计划', '智能体', '文件'].map((l) => ({ key: l, label: l }))} onAdd={() => {}} />
    <div data-testid="pane" style="flex:1;position:relative;isolation:isolate">{#each Array(12) as _, i (i)}<p>对话正文 {i}</p>{/each}</div>
  </div>
{:else if projectMode}
  <button onclick={() => sessions.createProject(`C:/test/project-${sequence++}`)}>新项目</button>
  <button onclick={() => sessions.activeProject && sessions.addSession(sessions.activeProject)}>新会话</button>
  <p data-testid="session">{sessionMap.get(sessions.activeId)?.draft ? '草稿已就绪' : '该对话已关闭'}</p>
  <p data-testid="count">{sessionMap.size}</p>
{:else if welcome}
  <h1>欢迎页</h1>
{:else}
  <SettingsPage sessionId="draft-test" navWidth={250} bind:section onClose={() => {}} onAccountLogout={() => {welcome = true;}} />
{/if}
