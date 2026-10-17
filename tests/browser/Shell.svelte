<script lang="ts">
	// The window as the app lays it out (+page.svelte's frame): title bar,
	// navigator and one conversation on the canvas, or the settings page. For
	// the browser regressions and the screenshots of the theme, the window
	// frost and the conversation column.
	//   ?shell                  the conversation
	//   &theme=light            the light theme (main.ts)
	//   &frost=vibrancy&backdrop=white|black
	//                           what is behind a frosted window (with the
	//                           window frost on in storage it shows through)
	//   &empty                  a conversation with no message yet
	//   &attach                 messages sent with files (chips above the bubble)
	//   &preview                the same with files to preview: a chip opens its
	//                           file in a tab beside the conversation
	//                           (previewFiles.ts stands in for the files)
	//   &trial[=used|404]       signed in; the first-use trial claim as the app
	//                           runs it, with its grant card (main.ts answers it)
	//   &collapsed              the navigator collapsed to its icon rail
	//   &home                   the home page over the canvas
	//   &settings[=<section>]   the settings page over the navigator and canvas
	//   &chats[=empty|error|old|all] with &settings=chat: the chat connectors' sample
	//   &approval               the conversation waits for an approval (a
	//                           sandbox request: the card above the composer)
	//   &states                 the other conversations in the navigator wait
	//                           for an answer, run, or failed
	//   &busy[=<n>]             n more conversations (8 by default), in a third
	//                           project, all at work
	//   &cards                  a turn at work with a plan and three subagents of
	//                           LynShen's agent team (the plan and subagents cards)
	//   &tool                   a tool leaf (the plan panel) open beside the chat
	//   &textOnly               the engine reports a model that takes no images
	//                           and does not think (`window.__chat` attaches files)
	//   &styles                 the engine reports the reply style: the "+"
	//                           menu lists the styles (`window.__sent` the ops)
	//   &models[=old]           a gateway session on the sample models
	//                           (catalogSample.ts), described by the gateway's
	//                           catalog, or (=old) by their ids only
	// `window.__prefs` is the preferences store (the regressions change the
	// conversation width through it); `window.__shellChat` the conversation's
	// chat (to send it more events), `window.__opened` what the chat asked the
	// page to open (a subagent's page, the team panel, the agent trace) and,
	// with &cards, `window.__sent` the ops it sent its engine.
	import { onMount, untrack } from 'svelte';
	import Mosaic from '../../src/lib/workbench/Mosaic.svelte';
	import FilePreview from '../../src/lib/preview/FilePreview.svelte';
	import { filePreviews } from '../../src/lib/preview/store.svelte';
	import { previewOf, previewPanel } from '../../src/lib/preview/kinds';
	import { activateTab, leafOfTab, leavesOf, singleLeafLayout, type TileLayout } from '../../src/lib/workbench/tiles';
	import { chatPanel, chatTab, openElsewhere } from '../../src/lib/workbench/canvas';
	import ChatPane from '../../src/lib/ChatPane.svelte';
	import Sidebar from '../../src/lib/Sidebar.svelte';
	import TabChromePopover from '../../src/lib/workbench/TabChromePopover.svelte';
	import TitleBar from '../../src/lib/shell/TitleBar.svelte';
	import ConfirmHost from '../../src/lib/ui/ConfirmHost.svelte';
	import Toaster from '../../src/lib/ui/Toaster.svelte';
	import TrialGrantCard from '../../src/lib/TrialGrantCard.svelte';
	import { trial } from '../../src/lib/trial.svelte';
	import { SessionStore } from '../../src/lib/session.svelte';
	import { Requirements, provideRequirements } from '../../src/lib/requirements.svelte';
	import { daemon, type Op } from '../../src/lib/protocol';
	import { adapterFor, clearDraft } from '../../src/lib/backends/router';
	import { prefs } from '../../src/lib/prefs.svelte';
	import PlanPanel from '../../src/lib/PlanPanel.svelte';
	import { subagentPages } from '../../src/lib/agents/subagentPages.svelte';
	import { setLocale } from '../../src/lib/i18n';
	import { fileName, withFiles, withVideo } from '../../src/lib/attachments';
	import HomePage from '../../src/lib/HomePage.svelte';
	import SettingsPage from '../../src/lib/settings/SettingsPage.svelte';
	import { SIDEBAR_RAIL_WIDTH } from '../../src/lib/shell/sidebarState';
	import { SAMPLE_PLAIN_IDS } from '../../src/lib/models/catalogSample';

	const mode = new URL(location.href).searchParams;
	const NAV_W = Number(mode.get('nav')) || 272;
	let collapsed = $state(mode.has('collapsed'));
	const home = mode.has('home');
	const settings = mode.has('settings');
	let section = $state(mode.get('settings') || 'general');
	setLocale(mode.get('lang') === 'en' ? 'en' : 'zh');
	provideRequirements(new Requirements(daemon));

	const store = new SessionStore();
	const named = (path: string, titles: string[]) => {
		const p = store.createProject(path);
		titles.forEach((title, i) => {
			const id = i === 0 ? p.sessions[0].id : store.addSession(p);
			store.renameSession(id, title);
			store.allSessions.find((x) => x.id === id)!.draft = false;
		});
		return p;
	};
	const first = named('/Users/me/code/lynshen-desktop', ['对话宽度跟随窗口', '浅色主题调色', '窗口磨砂默认关闭']);
	named('/Users/me/code/LynShen-CLI', ['daemon 技能开关', 'clippy 清理']);
	if (mode.has('busy')) {
		const titles = ['会话缓存按会话分片', '对话列表虚拟滚动', '设置页搜索', '终端字体回退', '导入 DSH 会话', '模型目录缓存', '计划卡折叠', '子智能体页加载', '侧栏拖动排序', '更新检查超时', '浅色主题对比度', '窗口标题计数'];
		const n = Math.max(1, Math.min(titles.length, Number(mode.get('busy')) || 8));
		const busy = named('/Users/me/code/aogiri-web', titles.slice(0, n));
		for (const s of busy.sessions) s.chat.handle({ type: 'status', message: 'streaming' } as never);
	}
	// The sessions, to change their state from a test (the navigator's groups).
	Object.assign(window, { __shellStore: store });
	// A row's right-click menu, as the page opens it (the navigator holds its
	// order while it shows).
	let rowMenu = $state<{ sid: string; x: number; y: number } | null>(null);
	const menuSession = $derived(rowMenu ? (store.allSessions.find((s) => s.id === rowMenu!.sid) ?? null) : null);
	const session = store.allSessions.find((s) => s.id === first.sessions[0].id)!;
	store.activeId = session.id;

	const DIFF = [
		'--- a/src/lib/ChatPane.svelte',
		'+++ b/src/lib/ChatPane.svelte',
		'@@ -228,6 +228,6 @@',
		' 	let wrapW = $state(0);',
		'-	const CHAT_W = 768;',
		'-	const chatW = CHAT_W;',
		'+	const sidePad = $derived(marks.length > 1 ? CHAT_PAD_RAIL : CHAT_PAD);',
		'+	const chatW = $derived(chatColumnWidth(wrapW, prefs.chatWidth, sidePad));',
		' 	const chatPad = $derived(chatColumnPad(wrapW, chatW, sidePad));'
	].join('\n');
	const REPLY = [
		'窗口变宽后，对话列跟着变宽，两侧不再留大片空白。规则见下表，实现在 `src/lib/chatWidth.ts`，详见 [design.md](https://example.com/design)。',
		'',
		'| 设置 | 列宽 | 1720 宽的窗口（侧栏 292） | 1280 宽的窗口 | 说明 |',
		'| --- | --- | --- | --- | --- |',
		'| 自适应 | 对话区的 75%，844–1120px | 1071px | 844px | 默认；一行不超过约 70 个汉字 |',
		'| 标准 | 844px | 844px | 844px | 固定宽度，窗口再宽也不变 |',
		'| 铺满 | 对话区减去两侧留白 | 1364px | 924px | 适合宽表格和长代码行 |',
		'',
		'```ts',
		'export function chatColumnWidth(pane: number, mode: ChatWidthMode, pad: number = CHAT_PAD): number {',
		'	const room = Math.max(0, pane - 2 * pad); // what the pane can give the column between its pads',
		"	const asked = mode === 'full' ? room : mode === 'standard' ? CHAT_W_STANDARD : Math.min(CHAT_W_MAX, Math.max(CHAT_W_STANDARD, pane * CHAT_W_SHARE));",
		'	const least = Math.max(0, Math.min(CHAT_W_MIN, pane - 2 * Math.min(pad, CHAT_PAD)));',
		'	return Math.round(Math.max(Math.min(asked, room), least));',
		'}',
		'```',
		'',
		'1. 输入框和消息列同宽，始终对齐。',
		'2. 窄窗口里列宽随对话区收窄，最窄 640px。',
		'',
		'> 引用：列宽有上限，一行太长不好读。'
	].join('\n');

	const feed = (ev: Record<string, unknown>) => session.chat.handle(ev as never);
	// A gateway session: the engine's model and its list (as it reports them).
	const gatewayModels = mode.has('models');
	const providersList = gatewayModels
		? [{ id: 'monoize', name: 'LynShen', base_url: 'https://api.lynshen.org/v1', format: 'responses', models: SAMPLE_PLAIN_IDS.map((name) => ({ name, display_name: name })) }]
		: [];
	if (gatewayModels) {
		feed({ type: 'model_status', provider: 'monoize', model: 'deepseek-v4.1-flash', model_label: 'deepseek-v4.1-flash', reasoning_effort: 'medium', reasoning_efforts: ['low', 'medium', 'high'], state: 'ready', context_window: 384000 });
		session.chat.silentModelView = 1;
		feed({ type: 'model_view', active_effort: 'medium', models: SAMPLE_PLAIN_IDS.map((model) => ({ model, active: model === 'deepseek-v4.1-flash', context_window: 0, max_output_tokens: 0, reasoning_efforts: ['low', 'medium', 'high'] })) });
	}
	if (mode.has('preview')) {
		const reply = (text: string) => {
			feed({ type: 'status', message: 'streaming' });
			feed({ type: 'assistant_delta', delta: text });
			feed({ type: 'status', message: 'ready' });
		};
		feed({ type: 'user_message', content: withFiles('帮我看看谁发的消息更多', ['/Users/me/Documents/私聊_墨竹.jsonl']) });
		reply('墨竹发了 642 条，你发了 642 条：一样多。');
		feed({ type: 'user_message', content: withFiles('列宽的算法在这里，顺便看下评审截图和发布包', ['/Users/me/code/lynshen-desktop/src/lib/chatWidth.ts', '/Users/me/Desktop/评审截图 2026-10-13.png', '/Users/me/Downloads/lynshen-desktop-0.5.1.zip']) });
		reply('列宽按对话区的 75% 算，最窄 640px、最宽 1120px。');
		feed({ type: 'user_message', content: withFiles('对比口径', ['/Users/me/code/lynshen-desktop/docs/metrics.md', '/Users/me/Documents/季度报告/2026 Q3 经营分析.pdf', '/Users/me/Downloads/error-log-1013.txt']) });
		reply('报告按月活，metrics.md 已改成月活。');
	} else if (mode.has('attach')) {
		// As the engine echoes them: the files listed after the text (attachments.ts).
		const reply = (text: string) => {
			feed({ type: 'status', message: 'streaming' });
			feed({ type: 'assistant_delta', delta: text });
			feed({ type: 'status', message: 'ready' });
		};
		feed({ type: 'user_message', content: withFiles('帮我看看谁发的消息更多', ['/Users/me/Documents/私聊_墨竹.jsonl']) });
		reply('墨竹发了 1,284 条，你发了 1,102 条：墨竹多 182 条。');
		feed({ type: 'user_message', content: withFiles('对比这三份文件，列出口径不一致的地方', ['/Users/me/Documents/季度报告/2026 Q3 经营分析.pdf', 'C:\\Users\\me\\Desktop\\销售明细.xlsx', '/Users/me/code/lynshen-desktop/docs/metrics.md']) });
		reply('三份文件的「活跃用户」口径不同：报告按月活，表格按周活，metrics.md 按日活。');
		feed({ type: 'user_message', content: withVideo(withFiles('', ['/Users/me/Downloads/error-log-1013.txt']), '录屏 2026-10-13.mov', 12.4, 8) });
	} else if (!mode.has('empty')) {
		feed({ type: 'user_message', content: '窗口拉宽、高度不变时，对话两边会出现大片空白，能让对话列跟着窗口变宽吗？' });
		feed({ type: 'status', message: 'streaming' });
		feed({ type: 'reasoning_delta', delta: '先看对话列的宽度在哪里算：ChatPane 的 chatW 是固定值。' });
		feed({ type: 'tool_start', call_id: 'c1', name: 'edit' });
		feed({ type: 'tool_output', call_id: 'c1', name: 'edit', output: JSON.stringify({ path: '/Users/me/code/lynshen-desktop/src/lib/ChatPane.svelte', diff: DIFF }) });
		feed({ type: 'tool_start', call_id: 'c2', name: 'bash' });
		feed({ type: 'tool_output', call_id: 'c2', name: 'bash', output: 'error: test failed: expected 844, received 768', is_error: true });
		feed({ type: 'assistant_delta', delta: REPLY });
		feed({ type: 'usage', input_tokens: 35000, output_tokens: 780 });
		feed({ type: 'status', message: 'ready' });
		feed({ type: 'user_message', content: '好，就按这个做。' });
		feed({ type: 'status', message: 'streaming' });
		feed({ type: 'assistant_delta', delta: '已改好：默认是「自适应」，可以在 设置 → 通用 → 对话宽度 里换成「标准」或「铺满」。' });
		feed({ type: 'status', message: 'ready' });
	}

	// A sandbox request, as the engine sends it.
	const escalation = (callId: string) => ({
		type: 'approval_request',
		call_id: callId,
		name: 'bash',
		summary: 'npm install -g pnpm@11.5.1',
		kind: 'escalation',
		justification: '项目用 pnpm 管理依赖，全局没有装 pnpm。装到 /usr/local/lib 要写项目外的目录，还要从 npm 下载。',
		command: 'npm install -g pnpm@11.5.1',
		cwd: '/Users/me/code/lynshen-desktop',
		paths: ['/usr/local/lib/node_modules/pnpm'],
		prefix: 'npm install',
		scopes: ['once', 'session', 'project']
	});
	if (mode.has('approval')) feed(escalation('c-approve'));
	if (mode.has('states')) {
		const byTitle = (title: string) => store.allSessions.find((x) => x.chat.title === title)!.chat;
		byTitle('窗口磨砂默认关闭').handle(escalation('c-other') as never);
		byTitle('clippy 清理').handle({ type: 'approval_request', call_id: 'q1', name: 'AskUserQuestion', summary: '', questions: [{ question: '429 时重试还是报错？', options: [{ label: '重试' }, { label: '报错' }], multiSelect: false }] } as never);
		byTitle('浅色主题调色').handle({ type: 'status', message: 'streaming' } as never);
		byTitle('daemon 技能开关').handle({ type: 'error', message: 'cargo test 没有通过' } as never);
	}

	// ?shell&cards: a third turn at work. The plan is 3/7 with the fourth
	// step running; four subagents of the agent team (roles, an attempt, one
	// done, one queued), the team's tokens against its budget and its board.
	if (mode.has('cards') && !mode.has('empty')) {
		feed({ type: 'user_message', content: '把会话缓存改成按会话分片，跑完单元测试再提交。' });
		feed({ type: 'status', message: 'streaming' });
		feed({ type: 'assistant_delta', delta: '先列计划，再把实现、测试和审查分给工作组。' });
		feed({
			type: 'plan',
			plan: [
				{ step: '读缓存层的代码', status: 'completed', agent: '/root/explorer' },
				{ step: '设计按会话分片的键', status: 'completed' },
				{ step: '改 SessionCache 和它的调用方', status: 'completed', agent: '/root/worker-1', files: ['src/lib/cache.ts', 'src/lib/session.svelte.ts'] },
				{ step: '跑单元测试', status: 'in_progress', agent: '/root/worker-2' },
				{ step: '审查改动', status: 'pending', agent: '/root/reviewer' },
				{ step: '更新 design.md 的缓存一节', status: 'pending' },
				{ step: '提交并推送', status: 'pending' }
			]
		});
		const agents: Record<string, unknown>[] = [
			{ path: '/root/explorer', label: 'explorer', role: 'explorer', status: 'completed', message: '找到 3 处读缓存的调用', ago: 412 },
			{ path: '/root/worker-1', label: 'worker-1', role: 'worker', status: 'completed', message: '改好 2 个文件', ago: 288 },
			{ path: '/root/worker-2', label: 'worker-2', role: 'worker', status: 'running', message: '运行 pnpm vitest run src/lib/cache', ago: 134, attempt_group: 'tests', attempt: 2 },
			{ path: '/root/reviewer', label: 'reviewer', role: 'reviewer', status: 'queued', message: '', ago: 12 }
		];
		for (const { ago, ...a } of agents) {
			feed({ type: 'subagent_lifecycle', ...a });
			// When it started (and, done, how long it ran), for the times the card shows.
			const life = session.chat.subagents[a.path as string];
			life.startedAt = Date.now() - (ago as number) * 1000;
			if (life.endedAt) life.endedAt = life.startedAt + 96_000;
		}
		feed({ type: 'team_budget', used: 182_400, limit: 400_000 });
		feed({
			type: 'task_board',
			tasks: [
				{ id: 't1', title: '读缓存层', status: 'completed' },
				{ id: 't2', title: '改 SessionCache', status: 'completed' },
				{ id: 't3', title: '跑单元测试', status: 'claimed', owner: '/root/worker-2' },
				{ id: 't4', title: '审查改动', status: 'pending', depends_on: ['t3'] }
			]
		});
	}
	const opened: string[] = [];
	// What the conversation sends its engine: no engine runs here, so the
	// session is no draft waiting for one and its adapter keeps the ops.
	const sent: Op[] = [];
	// ?shell&styles: the engine says which reply style the conversation
	// uses, so the "+" menu lists the styles (fakeDaemon.ts answers styles_list).
	if (mode.has('styles')) feed({ type: 'reply_style', style: 'default', name: '默认', source: 'builtin', chosen: false, missing: false });
	if (mode.has('cards') || mode.has('styles')) {
		clearDraft(session.id);
		const adapter = adapterFor(session.id);
		if (adapter) adapter.encodeOp = (op: Op) => (sent.push(op), []);
	}
	Object.assign(window, { __shellChat: session.chat, __shellSession: session.id, __opened: opened, __sent: sent });
	$effect(() => {
		const request = subagentPages.request;
		if (request) untrack(() => opened.push(`agent:${request.agentId}:${request.place}`));
	});

	if (mode.has('textOnly'))
		feed({ type: 'model_status', provider: 'my-llm', model: 'my-small-model', reasoning_effort: 'medium', reasoning_efforts: [], input_modalities: ['text'], context_window: 64000, context_limit: 48000, max_output_tokens: 8192, state: 'ready' });

	// The canvas of ?shell&preview: the conversation, and a tab beside it
	// for each file a chip opens (as +page.svelte places it). ?shell&tool:
	// the plan panel open beside it.
	let tiles = $state<TileLayout>(
		mode.has('tool')
			? openElsewhere(singleLeafLayout([chatTab(session.id)]), { id: 'tool-plan', panel: 'plan' }, { place: 'side', chatLeaf: null })
			: singleLeafLayout([chatTab(session.id)])
	);
	$effect(() => {
		const request = filePreviews.request;
		if (!request) return;
		untrack(() => {
			const panel = previewPanel(request.path);
			const open = leavesOf(tiles.root).flatMap((l) => l.tabs).find((tab) => tab.panel === panel);
			tiles = open
				? activateTab(tiles, open.id)
				: openElsewhere(tiles, { id: `p-${panel}`, panel }, { place: 'side', chatLeaf: leafOfTab(tiles.root, chatPanel(session.id))?.id ?? null });
			filePreviews.request = null;
		});
	});

	onMount(() => {
		// What a frosted window shows behind the page: the lightest and the
		// darkest thing the system can put there. (An inline style: it stands
		// in for the native layer, which no stylesheet paints.)
		const backdrop = mode.get('backdrop');
		if (backdrop) document.documentElement.style.background = backdrop === 'black' ? '#000' : '#fff';
		prefs.init();
		Object.assign(window, { __prefs: prefs, __chat: session.chat });
		// As +page.svelte does once the sign-in is known.
		if (mode.has('trial')) Object.assign(window, { __trial: trial, __trialDone: trial.signedIn() });
	});
</script>

{#snippet chat()}
	<ChatPane
		{session}
		{store}
		isActive
		providers={gatewayModels ? ['monoize'] : []}
		{providersList}
		onOpenTrace={mode.has('cards') ? () => opened.push('trace') : undefined}
		onOpenTeam={mode.has('cards') ? () => opened.push('team') : undefined}
	/>
{/snippet}

<ConfirmHost />
<Toaster />
<TrialGrantCard />
<div class="app">
	<TitleBar
		leftWidth={settings || !collapsed ? NAV_W : SIDEBAR_RAIL_WIDTH}
		sidebarOpen={!collapsed}
		onToggleSidebar={() => (collapsed = !collapsed)}
		heading={!settings && !home}
		title={settings ? '设置' : home ? '主页' : session.chat.title || '对话宽度跟随窗口'}
		subtitle={settings || home ? '' : 'lynshen-desktop'}
		addOptions={settings ? [] : [{ key: 'term', label: '终端' }]}
		onAdd={() => {}}
	/>
	<div class="body">
		<div class="panel" class:covered={settings}>
			<Sidebar
				projects={store.userProjects}
				activeId={home ? '' : session.id}
				width={NAV_W}
				{collapsed}
				onToggleCollapsed={() => (collapsed = !collapsed)}
				onHome={() => {}}
				homeOpen={home}
				onSelect={() => {}}
				onNewProject={() => {}}
				onNewSession={() => {}}
				onNewChat={() => {}}
				onNewTask={() => {}}
				onCloseSession={() => {}}
				onCloseProject={() => {}}
				onArchiveSession={() => {}}
				onUnarchiveSession={() => {}}
				onPinSession={() => {}}
				onMoveSession={() => {}}
				onMoveProject={() => {}}
				onRenameSession={() => {}}
				onSessionMenu={(sid, ev) => {
					ev.preventDefault();
					rowMenu = { sid, x: ev.clientX, y: ev.clientY };
				}}
				holdOpen={!!rowMenu}
				onProjectMenu={() => {}}
				onHistory={() => {}}
				footer={{ loggedIn: true, onManageAccount: () => {}, onSettings: () => {}, onUpdate: () => {}, onLoggedOut: () => {} }}
			/>
			<div class="canvas" data-testid="canvas">
				{#if home}
					<HomePage projects={store.userProjects} onStart={() => {}} onOpenSession={() => {}} onOpenProject={() => {}} onAddProject={() => {}} onOpenAgent={() => {}} />
				{:else if mode.has('preview') || mode.has('tool')}
					<Mosaic
						hideSoloBar
						layout={tiles}
						onchange={(next) => (tiles = next)}
						label={(tab) => (previewOf(tab.panel) ? fileName(previewOf(tab.panel)!) : tab.panel === 'plan' ? '任务计划' : session.chat.title || '对话')}
					>
						{#snippet panel(tab)}
							{#if previewOf(tab.panel)}
								<FilePreview path={previewOf(tab.panel)!} root={first.path} />
							{:else if tab.panel === 'plan'}
								<PlanPanel plan={session.chat.plan} />
							{:else}
								{@render chat()}
							{/if}
						{/snippet}
					</Mosaic>
				{:else}
					{@render chat()}
				{/if}
			</div>
			{#if settings}
				<SettingsPage sessionId={session.id} chat={session.chat} bind:section navWidth={NAV_W} onClose={() => {}} />
			{/if}
		</div>
	</div>
</div>
<!-- Each, so the menu keeps its session while it fades out. -->
{#each rowMenu && menuSession ? [{ ...rowMenu, s: menuSession }] : [] as m (m.sid)}
	<TabChromePopover
		x={m.x}
		y={m.y}
		name={m.s.chat.title}
		color={m.s.color ?? null}
		icon={m.s.icon ?? null}
		onRename={(n) => store.renameSession(m.s.id, n)}
		onColor={(c) => store.setSessionChrome(m.s.id, { color: c })}
		onIcon={(i) => store.setSessionChrome(m.s.id, { icon: i })}
		pinned={!!m.s.pinned}
		onPin={(v) => store.setPinned(m.s.id, v)}
		onClose={() => (rowMenu = null)}
	/>
{/each}

<style>
	/* The frame, as in src/routes/+page.svelte. */
	:global(html),
	:global(body) {
		overflow: clip;
	}
	.app {
		display: flex;
		flex-direction: column;
		height: 100vh;
		overflow: hidden;
		background: var(--rail);
	}
	:global(:root[data-vibrancy='on']) .app {
		background: var(--vibrancy-chrome);
	}
	.body {
		flex: 1;
		display: flex;
		min-height: 0;
		border-top: 1px solid var(--divider);
	}
	.panel {
		flex: 1;
		display: flex;
		min-width: 0;
		overflow: hidden;
		position: relative;
	}
	.panel.covered > :global(:not(.settings)) {
		visibility: hidden;
	}
	.canvas {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		border-left: 1px solid var(--divider);
		background: var(--bg);
		position: relative;
	}
</style>
