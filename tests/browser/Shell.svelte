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
	//   &recap[=changes|suggestion|long]
	//                           a third turn that changed three files and ended,
	//                           then the engine's suggested next prompt: the
	//                           recap card above the composer (=changes: no
	//                           suggestion; =suggestion: no changes; =long: a
	//                           long suggestion). `window.__sent` the ops,
	//                           `window.__opened` "changes" for the Changes panel
	//   &states                 the other conversations in the navigator wait
	//                           for an answer, run, or failed
	//   &busy[=<n>]             n more conversations (8 by default), in a third
	//                           project, all at work
	//   &cards                  a turn at work with a plan and three subagents of
	//                           LynShen's agent team (the plan and subagents cards)
	//   &subagents[=<n>]        the conversation runs a turn with n subagents (3
	//                           by default; 0: none yet), listed under it in the
	//                           navigator; `window.__subagent(i, status)` sends
	//                           the lifecycle event of the i-th (1-based:
	//                           /root/agent-<i>), `window.__shellChat` the rest
	//                           (`{type: 'status', message: 'ready'}` ends the turn)
	//   &stay=<ms>              how long they stay once the turn is over (30 s)
	//   &tool                   a tool leaf (the plan panel) open beside the chat
	//   &team                   the agent team's panel (工作组) open beside the chat
	//   &work=<step>            a third turn at work, on one step: think, write,
	//                           bash (lynshen: `started: <command>`), read or
	//                           edit (a card naming the file, as claude's), mcp,
	//                           a run of calls (group), compact
	//   &textOnly               the engine reports a model that takes no images
	//                           and does not think (`window.__chat` attaches files)
	//   &styles                 the engine reports the reply style: the "+"
	//                           menu lists the styles (`window.__sent` the ops)
	//   &models[=old]           a gateway session on the sample models
	//                           (catalogSample.ts), described by the gateway's
	//                           catalog, or (=old) by their ids only
	//   &planStop=quota|inactive|none|notInPlan|devices
	//                           the last turn stopped by the plan, as the
	//                           gateway answers (notes/plan-balance-contract.md
	//                           3): the 5-hour window used up (recovers in 2
	//                           hours), the plan ended, no plan at all, a model
	//                           outside the plan, a fourth device (429
	//                           plan_device_limit) (with &trial and &funding=plan)
	// `window.__prefs` is the preferences store (the regressions change the
	// conversation width through it); `window.__shellChat` the conversation's
	// chat (to send it more events), `window.__shellStore` its sessions,
	// `window.__opened` what the chat asked the
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
	import { showWaiting } from '../../src/lib/shell/attention.svelte';
	import PlanPanel from '../../src/lib/PlanPanel.svelte';
	import TeamPanel from '../../src/lib/agents/TeamPanel.svelte';
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
	const withSubagents = mode.has('subagents');
	const subagentStay = Number(mode.get('stay')) || undefined;
	// A row's right-click menu, as the page opens it (the navigator holds its
	// order while it shows).
	let rowMenu = $state<{ sid: string; x: number; y: number } | null>(null);
	const menuSession = $derived(rowMenu ? (store.allSessions.find((s) => s.id === rowMenu!.sid) ?? null) : null);
	const session = store.allSessions.find((s) => s.id === first.sessions[0].id)!;
	store.activeId = session.id;
	// As the page does: the count of conversations that wait for the user in
	// the window's title, the Dock badge or the Windows overlay
	// (`window.__calls`).
	showWaiting(() => store.allSessions);

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

	// A turn the plan stopped (?shell&planStop=…): the gateway's answer as
	// Codex passes it on.
	const planStop = mode.get('planStop');
	if (planStop) {
		const at = (ms: number) => new Date(ms).toISOString();
		const win = (kind: string, quota: string, used: string, resets: string) => ({ kind, quota_cny: quota, used_cny: used, in_flight_cny: '0.00', remaining_cny: (Number(quota) - Number(used)).toFixed(2), resets_at: resets });
		const retry = at(Date.now() + 2 * 3_600_000);
		const bodies: Record<string, [number, string, Record<string, unknown>]> = {
			quota: [402, 'Payment Required', { code: 'plan_quota_exhausted', type: 'invalid_request_error', param: null, message: '套餐 5 小时额度已用完', plan_name: '7 天体验套餐', window: '5h', retry_at: retry, windows: [win('5h', '4.00', '4.00', retry), win('7d', '10.00', '6.20', at(Date.now() + 5 * 86_400_000))] }],
			inactive: [402, 'Payment Required', { code: 'plan_inactive', type: 'invalid_request_error', param: null, message: '套餐已结束', plan_name: 'Grove', ended_at: at(Date.now() - 3 * 3_600_000), reason: 'expired' }],
			none: [402, 'Payment Required', { code: 'plan_inactive', type: 'invalid_request_error', param: null, message: '没有生效的套餐', plan_name: null, ended_at: null, reason: 'none' }],
			notInPlan: [403, 'Forbidden', { code: 'model_not_in_plan', type: 'invalid_request_error', param: 'model', message: '模型不在套餐内', model: 'claude-opus-5-5', plan_name: '7 天体验套餐' }],
			devices: [429, 'Too Many Requests', { code: 'plan_device_limit', type: 'rate_limit_error', param: null, message: '套餐同时使用的设备已满', limit: 3, in_use: 3, plan_name: '7 天体验套餐' }]
		};
		const [status, text, error] = bodies[planStop] ?? bodies.quota;
		feed({ type: 'user_message', content: '把会话缓存改成按会话分片，跑完单元测试再提交。' });
		feed({ type: 'status', message: 'streaming' });
		feed({ type: 'error', message: `unexpected status ${status} ${text}: ${JSON.stringify({ error })}, url: https://api.lynshen.org/v1/responses, request id: 7f3c2a10-5b1e-4c55-9d1a-3e2f9b8c6d01` });
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

	// ?shell&subagents: a turn of the conversation that runs subagents.
	const SUBAGENT_TASKS = ['读缓存层的代码', '改 SessionCache 和调用方', '跑单元测试', '审查改动', '更新 design.md 的缓存一节', '检查类型', '对比基准', '整理提交说明', '清理旧缓存', '补充文档', '核对迁移', '回归测试'];
	const subagentEvent = (i: number, status = 'running') => ({ type: 'subagent_lifecycle', path: `/root/agent-${i}`, label: SUBAGENT_TASKS[(i - 1) % SUBAGENT_TASKS.length], role: 'worker', status, message: '' });
	if (withSubagents && !mode.has('empty')) {
		feed({ type: 'user_message', content: '把会话缓存改成按会话分片，跑完单元测试再提交。' });
		feed({ type: 'connecting' });
		feed({ type: 'status', message: 'streaming' });
		feed({ type: 'assistant_delta', delta: '分给工作组：读代码、改实现、跑测试、审查。' });
		const n = mode.get('subagents') === '' ? 3 : Math.max(0, Number(mode.get('subagents')) || 0);
		for (let i = 1; i <= n; i++) feed(subagentEvent(i));
	}
	Object.assign(window, { __subagent: (i: number, status?: string) => feed(subagentEvent(i, status)) });

	if (mode.has('states')) {
		const byTitle = (title: string) => store.allSessions.find((x) => x.chat.title === title)!.chat;
		byTitle('窗口磨砂默认关闭').handle(escalation('c-other') as never);
		byTitle('clippy 清理').handle({ type: 'approval_request', call_id: 'q1', name: 'AskUserQuestion', summary: '', questions: [{ question: '429 时重试还是报错？', options: [{ label: '重试' }, { label: '报错' }], multiSelect: false }] } as never);
		byTitle('浅色主题调色').handle({ type: 'status', message: 'streaming' } as never);
		byTitle('daemon 技能开关').handle({ type: 'error', message: 'cargo test 没有通过' } as never);
	}

	// ?shell&recap: a third turn that ends with changes and a suggestion.
	const recapMode = mode.get('recap');
	if (recapMode !== null && !mode.has('empty')) {
		const edit = (id: string, path: string, added: number, removed: number) => {
			const diff = [`--- a/${path}`, `+++ b/${path}`, '@@ -1 +1 @@', ...Array.from({ length: removed }, (_, i) => `-old ${i}`), ...Array.from({ length: added }, (_, i) => `+new ${i}`)].join('\n');
			feed({ type: 'tool_start', call_id: id, name: 'edit' });
			feed({ type: 'tool_output', call_id: id, name: 'edit', output: JSON.stringify({ path: `/Users/me/code/lynshen-desktop/${path}`, diff }) });
		};
		feed({ type: 'user_message', content: '把会话缓存改成按会话分片，跑完单元测试再提交。' });
		feed({ type: 'connecting' });
		feed({ type: 'status', message: 'streaming' });
		if (recapMode !== 'suggestion') {
			edit('r1', 'src/lib/cache.ts', 30, 5);
			edit('r2', 'src/lib/session.svelte.ts', 10, 2);
			edit('r3', 'src/lib/cache.test.ts', 2, 0);
		}
		feed({ type: 'assistant_delta', delta: '先看了读缓存的三处调用。\n\n缓存已按会话分片：每个会话一份键空间，旧缓存在启动时迁移。**12 个单元测试**全部通过。' });
		feed({ type: 'status', message: 'ready' });
		if (recapMode !== 'changes')
			feed({ type: 'prompt_suggestion', text: recapMode === 'long' ? '提交并推送，然后在 PR 描述里写清楚缓存键的新格式、旧缓存的迁移方式和回滚办法，再请两位同事评审' : '提交并推送' });
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
	// ?shell&work=<step>: the conversation's third turn, still at work.
	const work = mode.get('work');
	if (work && !mode.has('empty')) {
		feed({ type: 'user_message', content: '把会话缓存改成按会话分片，跑完单元测试再提交。' });
		feed({ type: 'status', message: 'streaming' });
		const tool = (id: string, name: string, update?: string) => {
			feed({ type: 'tool_start', call_id: id, name });
			if (update) feed({ type: 'tool_update', call_id: id, name, output: update });
		};
		if (work === 'think') feed({ type: 'reasoning_delta', delta: '先找出读缓存的地方。' });
		else if (work === 'write') feed({ type: 'assistant_delta', delta: '缓存键改成了会话 ID 加文件路径，' });
		else if (work === 'bash') tool('w1', 'bash', 'started: pnpm vitest run src/lib/cache.test.ts --reporter=dot');
		else if (work === 'read') tool('w1', 'read', JSON.stringify({ path: '/Users/me/code/lynshen-desktop/src/lib/cache.ts' }));
		else if (work === 'edit') tool('w1', 'str_replace', JSON.stringify({ path: '/Users/me/code/lynshen-desktop/src/lib/session.svelte.ts', paths: [], diff: '' }));
		else if (work === 'mcp') tool('w1', 'mcp__linear__create_issue');
		else if (work === 'group') {
			tool('w1', 'read', JSON.stringify({ path: '/Users/me/code/lynshen-desktop/src/lib/cache.ts' }));
			feed({ type: 'tool_output', call_id: 'w1', name: 'read', output: JSON.stringify({ path: '/Users/me/code/lynshen-desktop/src/lib/cache.ts', content: 'export const cache = new Map();' }) });
			tool('w2', 'bash', 'started: pnpm vitest run src/lib/cache.test.ts');
			feed({ type: 'tool_update', call_id: 'w2', name: 'bash', output: 'running 2.0s\nstdout:\n ✓ cache.test.ts (12 tests)' });
		} else if (work === 'compact') session.chat.handle({ type: 'compaction_start' } as never);
	}
	const opened: string[] = [];
	// What the conversation sends its engine: no engine runs here, so the
	// session is no draft waiting for one and its adapter keeps the ops.
	const sent: Op[] = [];
	// ?shell&styles: the engine says which reply style the conversation
	// uses, so the "+" menu lists the styles (fakeDaemon.ts answers styles_list).
	if (mode.has('styles')) feed({ type: 'reply_style', style: 'default', name: '默认', source: 'builtin', chosen: false, missing: false });
	if (mode.has('cards') || mode.has('styles') || mode.has('recap')) {
		clearDraft(session.id);
		const adapter = adapterFor(session.id);
		if (adapter) adapter.encodeOp = (op: Op) => (sent.push(op), []);
	}
	Object.assign(window, { __shellChat: session.chat, __shellSession: session.id, __shellStore: store, __opened: opened, __sent: sent });
	$effect(() => {
		const request = subagentPages.request;
		if (request) untrack(() => opened.push(`agent:${request.agentId}:${request.place}`));
	});

	if (mode.has('textOnly'))
		feed({ type: 'model_status', provider: 'my-llm', model: 'my-small-model', reasoning_effort: 'medium', reasoning_efforts: [], input_modalities: ['text'], context_window: 64000, context_limit: 48000, max_output_tokens: 8192, state: 'ready' });

	// The canvas of ?shell&preview: the conversation, and a tab beside it
	// for each file a chip opens (as +page.svelte places it). ?shell&tool:
	// the plan panel open beside it; ?shell&team, the agent team's panel.
	const toolPanel = mode.has('tool') ? 'plan' : mode.has('team') ? 'team' : '';
	let tiles = $state<TileLayout>(
		toolPanel
			? openElsewhere(singleLeafLayout([chatTab(session.id)]), { id: `tool-${toolPanel}`, panel: toolPanel }, { place: 'side', chatLeaf: null })
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
		onOpenChanges={mode.has('recap') ? () => opened.push('changes') : undefined}
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
				onSelect={(id) => withSubagents && opened.push(`select:${id}`)}
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
				onOpenSubagent={(id, agent) => subagentPages.open(id, agent.id, prefs.openElsewhere)}
				{subagentStay}
				onProjectMenu={() => {}}
				onHistory={() => {}}
				footer={{ loggedIn: true, onManageAccount: () => {}, onPurchase: () => ((window as unknown as { __purchaseOpened?: number }).__purchaseOpened = ((window as unknown as { __purchaseOpened?: number }).__purchaseOpened ?? 0) + 1), onSettings: () => {}, onUpdate: () => {}, onLoggedOut: () => {} }}
			/>
			<div class="canvas" data-testid="canvas">
				{#if home}
					<HomePage projects={store.userProjects} onStart={() => {}} onOpenSession={() => {}} onOpenProject={() => {}} onAddProject={() => {}} onOpenAgent={() => {}} />
				{:else if mode.has('preview') || toolPanel}
					<Mosaic
						hideSoloBar
						layout={tiles}
						onchange={(next) => (tiles = next)}
						label={(tab) =>
							previewOf(tab.panel) ? fileName(previewOf(tab.panel)!) : tab.panel === 'plan' ? '任务计划' : tab.panel === 'team' ? '工作组' : session.chat.title || '对话'}
					>
						{#snippet panel(tab)}
							{#if previewOf(tab.panel)}
								<FilePreview path={previewOf(tab.panel)!} root={first.path} />
							{:else if tab.panel === 'plan'}
								<PlanPanel plan={session.chat.plan} />
							{:else if tab.panel === 'team'}
								<TeamPanel chat={session.chat} onOp={(op) => sent.push(op)} onOpenAgent={(id) => opened.push(`agent:${id}`)} />
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
				<!-- 导入's result: folders added and conversations opened go to `window.__opened`. -->
				<SettingsPage
					sessionId={session.id}
					chat={session.chat}
					bind:section
					navWidth={NAV_W}
					onClose={() => {}}
					onAddFolders={(paths) => (opened.push(...paths.map((p) => `folder:${p}`)), paths.length)}
					onOpenSession={(s) => opened.push(`import:${s.engine}:${s.id}:${s.cwd}`)}
				/>
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
