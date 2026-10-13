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
	// `window.__prefs` is the preferences store (the regressions change the
	// conversation width through it).
	import { onMount } from 'svelte';
	import ChatPane from '../../src/lib/ChatPane.svelte';
	import Sidebar from '../../src/lib/Sidebar.svelte';
	import TitleBar from '../../src/lib/shell/TitleBar.svelte';
	import ConfirmHost from '../../src/lib/ui/ConfirmHost.svelte';
	import Toaster from '../../src/lib/ui/Toaster.svelte';
	import { SessionStore } from '../../src/lib/session.svelte';
	import { Requirements, provideRequirements } from '../../src/lib/requirements.svelte';
	import { daemon } from '../../src/lib/protocol';
	import { prefs } from '../../src/lib/prefs.svelte';
	import { setLocale } from '../../src/lib/i18n';
	import { withFiles, withVideo } from '../../src/lib/attachments';

	const mode = new URL(location.href).searchParams;
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
	if (mode.has('attach')) {
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

	onMount(() => {
		// What a frosted window shows behind the page: the lightest and the
		// darkest thing the system can put there. (An inline style: it stands
		// in for the native layer, which no stylesheet paints.)
		const backdrop = mode.get('backdrop');
		if (backdrop) document.documentElement.style.background = backdrop === 'black' ? '#000' : '#fff';
		prefs.init();
		Object.assign(window, { __prefs: prefs });
	});
</script>

<ConfirmHost />
<Toaster />
<div class="app">
	<TitleBar leftWidth={292} sidebarOpen onToggleSidebar={() => {}} title={session.chat.title || '对话宽度跟随窗口'} subtitle="lynshen-desktop" addOptions={[{ key: 'term', label: '终端' }]} onAdd={() => {}} />
	<div class="body">
		<div class="panel">
			<Sidebar
				projects={store.userProjects}
				activeId={session.id}
				width={292}
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
				onSessionMenu={() => {}}
				onProjectMenu={() => {}}
				onHistory={() => {}}
				footer={{ loggedIn: true, onManageAccount: () => {}, onSettings: () => {}, onUpdate: () => {}, onLoggedOut: () => {} }}
			/>
			<div class="canvas" data-testid="canvas">
				<ChatPane {session} {store} isActive />
			</div>
		</div>
	</div>
</div>

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
	}
	.panel {
		flex: 1;
		display: flex;
		min-width: 0;
		overflow: hidden;
		position: relative;
	}
	.canvas {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-width: 0;
		background: var(--bg);
		position: relative;
	}
</style>
