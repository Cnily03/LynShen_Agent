import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium, expect } from '@playwright/test';

const server = await createServer({ configFile: false, plugins: [svelte({compilerOptions:{runes:true}})], resolve: {alias:{$lib:resolve('src/lib')}}, server:{host:'127.0.0.1',port:1438,strictPort:true} });
await server.listen();
const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH});
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  const base = 'http://127.0.0.1:1438/tests/browser/index.html';
  await page.goto(base + '?projects');
  for (let i=1;i<=3;i++) {
    await page.getByRole('button',{name:'新项目',exact:true}).click();
    await expect(page.getByTestId('session')).toHaveText('草稿已就绪');
    await page.getByRole('button',{name:'新会话',exact:true}).click();
    await expect(page.getByTestId('session')).toHaveText('草稿已就绪');
    await expect(page.getByTestId('count')).toHaveText(String(i*2));
  }
  assert.equal(await page.evaluate(() => window.__calls.some(c => c.command === 'daemon_endpoint')), false);
  await page.goto(base);
  await page.getByRole('button',{name:'在浏览器中授权',exact:true}).click();
  await expect(page.getByText('ABCDEF-123456')).toBeVisible();
  assert.ok(await page.evaluate(() => window.__calls.some(c => c.command === 'plugin:opener|open_url')));
  await page.getByRole('button',{name:'取消授权',exact:true}).click();
  await page.goto(base + '?loggedIn');
  await page.getByRole('button',{name:'退出登录',exact:true}).click();
  await expect(page.getByRole('heading',{name:'欢迎页'})).toBeVisible();
  await page.goto(base);
  await page.getByRole('button',{name:'提供商',exact:true}).click();
  await page.locator('#set-provider-add').click();
  await page.getByRole('button').filter({hasText:'Openai'}).first().click();
  await expect(page.getByPlaceholder('请输入 API Key')).toBeVisible();
  await page.getByRole('button',{name:'在浏览器中授权 ChatGPT / Codex'}).click();
  await expect(page.getByRole('button',{name:'重新打开授权页面'})).toBeVisible();
  assert.ok(await page.evaluate(() => window.__calls.some(c => c.command === 'provider_oauth_start' && c.args.provider === 'openai-codex')));
  // Opening a panel beside a tab mounted the tab again (a TUI went blank).
  await page.goto(base + '?mosaic');
  const probe = page.locator('[data-probe="t0"]');
  await probe.evaluate((el) => { el.scrollTop = 1200; });
  await page.waitForTimeout(100);
  for (const step of ['拆分', '移动', '关闭']) {
    await page.getByRole('button',{name:step,exact:true}).click();
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__mounts.t0), 1, `t0 mounted again after ${step}`);
    assert.equal(await probe.evaluate((el) => el.scrollTop), 1200, `t0 lost its scroll after ${step}`);
  }
  // The home page offers the gateway's models before any conversation exists.
  await page.goto(base + '?home');
  await page.locator('button.model').click();
  await expect(page.getByRole('menuitemradio')).toHaveCount(2);
  await page.getByRole('menuitemradio',{name:'Claude Opus 5.5'}).click();
  await page.locator('textarea').fill('你好');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('started')).toHaveText('你好 @ claude-opus-5-5');
  // Over a background image the title bar's menu stays above the chat.
  await page.goto(base + '?titlebar');
  await page.evaluate(() => { document.documentElement.dataset.canvasBg = 'medium'; });
  await page.getByRole('button',{name:'打开面板'}).click();
  const item = page.getByRole('menuitem',{name:'智能体'});
  const box = await item.boundingBox();
  assert.ok(await item.evaluate((el, [x, y]) => el.contains(document.elementFromPoint(x, y)), [box.x + box.width / 2, box.y + box.height / 2]), 'the chat covers the title bar menu');
  // Settings → 技能 against a stand-in daemon: a switch reaches the engine,
  // load problems show, a personal skill is deleted after confirming.
  await page.goto(base + '?skills');
  // The first visit compiles the page's modules.
  await expect(page.getByText('agent-browser')).toBeVisible({timeout:30000});
  const grill = page.getByRole('switch', {name:'启用 grill-me'});
  await expect(grill).toHaveAttribute('aria-checked', 'false');
  await grill.click();
  await expect(grill).toHaveAttribute('aria-checked', 'true');
  assert.ok(await page.evaluate(() => window.__ops.some(o => o.op === 'skill_set_enabled' && o.path.endsWith('/grill-me') && o.enabled === true)));
  await page.getByRole('button',{name:/技能加载诊断：0 个错误，2 个警告/}).click();
  await expect(page.getByText('缺少 description，不会加载')).toBeVisible();
  await page.getByText('ste-writing').hover();
  await page.locator('.srow', {hasText:'ste-writing'}).getByRole('button',{name:'删除'}).click();
  await page.getByRole('button',{name:'删除',exact:true}).last().click();
  await expect(page.getByText('ste-writing')).toHaveCount(0);
  // Shared and project skills switch but are not deleted here.
  await expect(page.locator('.srow', {hasText:'deploy-preview'}).getByRole('button',{name:'删除'})).toHaveCount(0);
  // The marketplace tab: an install that fails says so on its own item.
  await page.getByRole('tab',{name:'技能市场'}).click();
  await page.locator('.item', {hasText:'MCP builder'}).getByRole('button',{name:'安装'}).click();
  await expect(page.getByText('安装失败：GitHub returned 403 for the skill tree')).toBeVisible();
  await page.locator('.item', {hasText:'Skill creator'}).getByRole('button',{name:'安装'}).click();
  await expect(page.locator('.item', {hasText:'Skill creator'}).getByText('已安装')).toBeVisible();
  // The engine answers from its cache: a source it could not read says so
  // beside the skills it had.
  await expect(page.getByText(/Composio：无法连接 GitHub，显示的是 .+ 的缓存，可稍后重试。/)).toBeVisible();
  await expect(page.locator('.item', {hasText:'changelog-generator'})).toBeVisible();
  // 刷新 reads every source again in the background: the catalog stays on
  // the page meanwhile, then the refreshed one replaces it.
  await page.locator('.market').getByRole('button',{name:'刷新'}).click();
  await expect(page.getByText('正在从网络更新社区技能…')).toBeVisible();
  await expect(page.locator('.item', {hasText:'Skill creator'}).getByText('已安装')).toBeVisible();
  await expect(page.getByText('正在从网络更新社区技能…')).toHaveCount(0);
  await expect(page.getByText(/Composio：无法连接 GitHub/)).toHaveCount(0);
  assert.ok(await page.evaluate(() => window.__ops.some(o => o.op === 'skills_catalog' && o.refresh === true)));
  assert.ok(await page.evaluate(() => window.__ops.some(o => o.op === 'skills_catalog' && o.wait === true)));
  // A daemon that does not answer: the spinner gives way to a retry.
  const stuck = await browser.newPage();
  stuck.on('pageerror', e => errors.push(e.message));
  await stuck.clock.install();
  await stuck.goto(base + '?market&stall');
  await expect(stuck.getByText('加载中…')).toBeVisible({timeout:30000});
  await stuck.clock.fastForward(16000);
  await expect(stuck.getByText('技能市场没有响应，可稍后重试。')).toBeVisible();
  await expect(stuck.getByText('加载中…')).toHaveCount(0);
  await stuck.evaluate(() => { window.__daemon.stall = false; });
  await stuck.getByRole('button',{name:'重试'}).click();
  await expect(stuck.locator('.item', {hasText:'MCP builder'})).toBeVisible();
  await expect(stuck.getByText('技能市场没有响应，可稍后重试。')).toHaveCount(0);
  await stuck.close();
  // An engine without per-source state: its warnings show as before.
  const older = await browser.newPage();
  await older.goto(base + '?market&oldEngine');
  await expect(older.getByText('Composio 暂时无法读取：GitHub API rate limit exceeded')).toBeVisible({timeout:30000});
  await expect(older.locator('.item', {hasText:'MCP builder'})).toBeVisible();
  await older.close();
  // An engine without the skill ops: a note, not a broken page.
  await page.goto(base + '?skills&oldEngine');
  await expect(page.getByText(/当前的 LynShen 引擎还不能在这里管理技能/)).toBeVisible();
  await page.goto(base + '?plugins');
  await expect(page.getByText('document-skills')).toBeVisible();
  // The sidebar: folded sections stay folded after a restart; the archive
  // restores several conversations at once.
  await page.goto(base + '?sidebar');
  await expect(page.locator('.folder-name')).toHaveCount(3, {timeout:30000});
  await page.getByRole('button',{name:'项目',exact:true}).click();
  await expect(page.locator('.folder-name')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button',{name:'项目',exact:true})).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.folder-name')).toHaveCount(0);
  await page.getByRole('button',{name:'展开所有项目'}).click();
  await expect(page.locator('.folder-name')).toHaveCount(3);
  await page.getByRole('button',{name:'已归档的对话'}).click();
  await expect(page.locator('.tools-count')).toHaveText('6');
  await page.getByRole('button',{name:'选择',exact:true}).click();
  await page.getByText('限流调整').click();
  await page.getByText('0.4.30 发布').click();
  await page.getByRole('button',{name:'恢复 2 个'}).click();
  await expect(page.locator('.tools-count')).toHaveText('4');
  await page.getByRole('button',{name:'返回会话列表'}).click();
  await expect(page.locator('.sess', {hasText:'限流调整'}).first()).toBeVisible();
  // Entrances leave nothing behind: once a new conversation's welcome and
  // an approval card have come in, their menus close on a click anywhere
  // else. (A fill that held the end kept each transformed, so a menu's
  // fixed click-away backdrop covered only it.)
  await page.goto(base + '?chat');
  const settled = (sel) => page.waitForFunction((sel) => document.querySelector(sel)?.getAnimations().every((a) => a.playState === 'finished'), sel);
  await settled('.welcome');
  await page.getByRole('button',{name:'项目',exact:true}).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.mouse.click(1200, 700);
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.evaluate(() => window.__paneChat().handle({ type: 'approval_request', call_id: 'c1', name: 'shell', summary: 'pnpm build', scopes: ['session', 'project', 'user'] }));
  await settled('.approval');
  await page.getByRole('button',{name:'始终允许…'}).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.mouse.click(1200, 700);
  await expect(page.getByRole('menu')).toHaveCount(0);
  // With glass on (the app's default) the transcript is masked and the
  // approval card keeps its glass on a layer of its own. Each stacks a
  // menu's click-away backdrop under the composer, and Chromium gives a
  // masked element's backdrop no click outside the mask: a press there
  // closes the menu all the same.
  await page.goto(base + '?chat&glass');
  await settled('.welcome');
  assert.ok(await page.evaluate(() => 'glass' in document.documentElement.dataset), 'glass is off');
  const closesOn = async (trigger, point) => {
    await trigger.click();
    await expect(page.getByRole('menu')).toBeVisible();
    const [x, y] = point ?? await page.locator('.composer').evaluate((el) => { const r = el.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
    await page.mouse.click(x, y);
    await expect(page.getByRole('menu')).toHaveCount(0);
  };
  const project = page.getByRole('button',{name:'项目',exact:true});
  await closesOn(project);
  await closesOn(project, [1200, 700]);
  await page.evaluate(() => window.__paneChat().handle({ type: 'approval_request', call_id: 'c1', name: 'shell', summary: 'pnpm build', scopes: ['session', 'project', 'user'] }));
  await settled('.approval');
  await closesOn(page.getByRole('button',{name:'始终允许…'}));
  await page.evaluate(() => {
    const c = window.__paneChat();
    c.handle({ type: 'status', message: 'ready' });
    c.handle({ type: 'proposed_plan', id: 'p1', title: '重构缓存', markdown: '- 读代码\n- 改缓存', status: 'pending' });
  });
  await page.waitForFunction(() => document.querySelector('.plan')?.closest('.mwrap')?.getAnimations().every((a) => a.playState === 'finished'));
  await closesOn(page.getByRole('button',{name:'执行时的审批模式'}));
  // A long reasoning streams into blocks written once: the block still
  // growing stays short, finished ones are never written again, and they read
  // as the one text they replace. (It was one text node, rewritten and laid
  // out again whole on every frame.)
  await page.goto(base + '?reasoning');
  await page.waitForFunction(() => window.__chat);
  const think = (n, seed) => page.evaluate(([n, seed]) => {
    const words = ['我们', '先看', 'the cache', '边界', '然后', 'check ', '。', '\n', '\n\n', '- 一项\n'];
    for (let i = 0; i < n; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      window.__chat.handle({ type: 'reasoning_delta', delta: words[seed % words.length] });
    }
  }, [n, seed]);
  const thought = () => page.evaluate(() => window.__chat.messages.at(-1).text);
  await page.evaluate(() => window.__chat.handle({ type: 'status', message: 'streaming' }));
  await think(400, 1);
  const line = page.locator('.reason-line span');
  // Folded, its newest words in one line.
  const lineEnd = (await thought()).slice(-240).replace(/\s+/g, ' ').trimStart();
  await expect.poll(() => line.textContent(), { timeout: 10000 }).toBe(lineEnd);
  await page.locator('.reason-line').click();
  const body = page.locator('.reason-body .stream');
  const shownText = () => body.evaluate((el) => (el.children.length ? [...el.children].map((b) => b.textContent).join('\n') : el.textContent));
  for (let i = 0; i < 12; i++) { await think(800, i + 2); await page.waitForTimeout(40); }
  await expect.poll(shownText, { timeout: 15000 }).toBe(await thought());
  await body.evaluate((el) => {
    window.__frozen = [...el.children].slice(0, -1).map((b) => [b, b.textContent]);
    window.__writes = [];
    new MutationObserver((rs) => window.__writes.push(...rs.map((r) => r.target))).observe(el, { subtree: true, characterData: true, childList: true });
  });
  for (let i = 0; i < 6; i++) { await think(800, i + 40); await page.waitForTimeout(40); }
  await expect.poll(shownText, { timeout: 15000 }).toBe(await thought());
  const blocks = await body.evaluate((el) => ({
    count: el.children.length,
    growing: (el.lastElementChild ?? el).textContent.length,
    rewritten: window.__frozen.filter(([b, text]) => b.textContent !== text || window.__writes.some((t) => b.contains(t))).length,
    // The same text as one node, under the same styles: as tall.
    sameHeight: (() => { const one = el.cloneNode(false); one.textContent = [...el.children].map((b) => b.textContent).join('\n'); el.after(one); const same = one.offsetHeight === el.offsetHeight; one.remove(); return same; })()
  }));
  assert.ok(blocks.count > 20, `reasoning in ${blocks.count} blocks`);
  assert.ok(blocks.growing < 2000, `the growing block holds ${blocks.growing} characters`);
  assert.equal(blocks.rewritten, 0, 'a finished reasoning block was written again');
  assert.ok(blocks.sameHeight, 'the blocks do not read as the one text');
  // Once it ends it renders as Markdown: its chunks at the top at once and
  // the rest a few each frame, taking over from the plain text written as it
  // streamed, which stays (laid out as it was) and loses its front as they
  // come. (It all rendered in one task: time and memory that grew with it.)
  await body.evaluate((el) => (el.dataset.kept = '1'));
  const ended = await page.evaluate(() => new Promise((done) => {
    window.__chat.handle({ type: 'status', message: 'ready' });
    requestAnimationFrame(() => {
      const plain = document.querySelector('.reason-body .stream');
      done({
        chunks: document.querySelectorAll('.reason-body .md').length,
        kept: plain?.dataset.kept === '1',
        plain: plain?.textContent.length ?? 0,
        text: window.__chat.messages.at(-1).text.length
      });
    });
  }));
  assert.ok(ended.chunks >= 1 && ended.plain > 0 && ended.plain < ended.text - 3000, `as it ended: ${JSON.stringify(ended)}`);
  assert.ok(ended.kept, 'the plain text was written again as the reasoning ended');
  await expect(page.locator('.reason-body .stream')).toHaveCount(0, { timeout: 15000 });
  // In the end it reads as the whole text rendered as one document.
  const rendered = await page.evaluate(async () => {
    const { renderMarkdown } = await import('/src/lib/markdown.ts');
    const mds = [...document.querySelectorAll('.reason-body .md')];
    const norm = (html) => html.replace(/>\s+</g, '><').trim();
    const one = document.createElement('div');
    one.className = mds[0].className.replace(/\bmore\b/, '');
    one.innerHTML = renderMarkdown(window.__chat.messages.at(-1).text);
    const height = mds.at(-1).getBoundingClientRect().bottom - mds[0].getBoundingClientRect().top;
    document.querySelector('.reason-body').append(one);
    const same = { html: norm(mds.map((m) => m.innerHTML).join('')) === norm(one.innerHTML), height: Math.abs(one.offsetHeight - height) < 1 };
    one.remove();
    return { chunks: mds.length, ...same };
  });
  assert.deepEqual(rendered, { chunks: rendered.chunks, html: true, height: true }, 'the chunks do not read as the whole reasoning');
  assert.ok(rendered.chunks > 5, `the reasoning in ${rendered.chunks} chunks`);
  // A long reply: each finished paragraph renders once, the paragraph being
  // written streams as text after them, a code fence stays in it until it
  // closes.
  await page.evaluate(() => window.__chat.handle({ type: 'status', message: 'streaming' }));
  const answer = (text) => page.evaluate((text) => { for (const delta of text.match(/[^]{1,6}/g)) window.__chat.handle({ type: 'assistant_delta', delta }); }, text);
  const reply = page.locator('.answer').last();
  await answer(Array.from({ length: 30 }, (_, i) => `第 ${i} 段：the cache 边界。\n\n`).join('') + 'Code:\n```js\nlet a = 1;\n\nlet b');
  await expect(reply.locator('.stream')).toHaveText('```js\nlet a = 1;\n\nlet b', { timeout: 15000 });
  await expect(reply.locator('.md')).toHaveCount(31);
  await reply.locator('.md').first().evaluate((el) => (el.dataset.seen = '1'));
  await answer(' = 2;\n```\n\nDone.');
  await expect(reply.locator('.stream')).toHaveText('Done.', { timeout: 15000 });
  await expect(reply.locator('.md')).toHaveCount(31);
  assert.equal(await reply.locator('.md').first().getAttribute('data-seen'), '1', 'a finished paragraph rendered again');
  await expect(reply.locator('.md').last()).toContainText('let b = 2;');
  // Once it ends the reply keeps what it rendered as it streamed: only its
  // last paragraph renders, and the paragraphs are spaced as one document's
  // (the last has no space after it). (The whole reply rendered again, as
  // one document: time and memory that grew with the reply.)
  const spaces = () => reply.locator('.md > p:last-child').evaluateAll((ps) => ps.map((p) => getComputedStyle(p).marginBottom));
  assert.deepEqual([...new Set(await spaces())], ['10px'], 'the paragraphs of a streaming reply are spaced');
  await page.evaluate(() => window.__chat.handle({ type: 'status', message: 'ready' }));
  await expect(reply.locator('.stream')).toHaveCount(0);
  await expect(reply.locator('.md')).toHaveCount(32);
  await expect(reply.locator('.md').last()).toHaveText('Done.');
  assert.equal(await reply.locator('.md').first().getAttribute('data-seen'), '1', 'a paragraph rendered again as the reply ended');
  assert.deepEqual(await spaces(), [...Array(30).fill('10px'), '0px'], 'the paragraphs of a finished reply are spaced as one document');
  // A steered message cuts the streaming reply off: it stays, finished and
  // marked, and the next response is a reply of its own after the message.
  await page.evaluate(() => {
    const c = window.__chat;
    c.handle({ type: 'user_message', content: '再想想' });
    c.handle({ type: 'connecting' });
    c.handle({ type: 'status', message: 'streaming' });
    c.handle({ type: 'assistant_delta', delta: '先这样回答一半' });
  });
  await expect(page.locator('.answer').last().locator('.stream')).toHaveText('先这样回答一半', { timeout: 15000 });
  await page.evaluate(() => {
    const c = window.__chat;
    c.handle({ type: 'status', message: 'steering' });
    c.handle({ type: 'response_interrupted' });
    c.handle({ type: 'user_message', content: '用测试库' });
    c.handle({ type: 'connecting' });
    c.handle({ type: 'assistant_delta', delta: '好，改用测试库' });
  });
  const cutReply = page.locator('.answer').nth(-2);
  await expect(cutReply.locator('.md')).toHaveText('先这样回答一半');
  await expect(cutReply.locator('.foot')).toHaveText('已中断');
  await expect(page.locator('.answer').last().locator('.stream')).toHaveText('好，改用测试库', { timeout: 15000 });
  // A row's entrance leaves nothing behind: once it has come in, its plan's
  // menu closes on a click anywhere else. (A fill that held the animation's
  // end kept every row transformed, so the menu's fixed click-away backdrop
  // covered only the row.)
  await page.evaluate(() => {
    const c = window.__chat;
    c.handle({ type: 'status', message: 'ready' });
    c.handle({ type: 'proposed_plan', id: 'p1', title: '重构缓存', markdown: '- 读代码\n- 改缓存', status: 'pending' });
  });
  await page.waitForFunction(() => document.querySelector('.plan')?.closest('.mwrap')?.getAnimations().every((a) => a.playState === 'finished'));
  await page.getByRole('button',{name:'执行时的审批模式'}).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await page.mouse.click(700, 20);
  await expect(page.getByRole('menu')).toHaveCount(0);
  // 反馈问题: selecting a field's text by dragging past the dialog's edge
  // keeps the dialog open. (The release over the scrim sends the click to the
  // scrim, the common ancestor, and that closed the dialog.) A click on the
  // scrim, Escape and the close button still close it.
  await page.goto(base + '?feedback');
  const feedbackClosed = page.getByTestId('feedback-closed');
  const feedback = page.getByRole('dialog',{name:'反馈问题'});
  const openFeedback = async () => {
    await page.getByRole('button',{name:'打开反馈',exact:true}).click();
    await expect(feedback).toBeVisible();
    await page.waitForFunction(() => document.querySelector('.sheet')?.getAnimations().every((a) => a.playState === 'finished'));
  };
  await openFeedback();
  const sheetBox = await page.locator('.sheet').boundingBox();
  const dragSelect = async (field, text, to) => {
    await field.fill(text);
    const b = await field.boundingBox();
    await page.mouse.move(b.x + 3, b.y + 8);
    await page.mouse.down();
    await page.mouse.move(to[0], to[1], {steps:8});
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await feedbackClosed.textContent(), '0', 'selecting the text closed the dialog');
    await expect(feedback).toBeVisible();
    assert.deepEqual(await field.evaluate((el) => [el.selectionStart, el.selectionEnd]), [0, text.length], 'the drag did not select the whole text');
  };
  const titleField = feedback.getByPlaceholder('一句话说明出了什么问题');
  const bodyField = feedback.getByPlaceholder(/做了什么、期望看到什么/);
  await dragSelect(titleField, '设置页打不开', [sheetBox.x + sheetBox.width + 60, sheetBox.y + sheetBox.height / 2]);
  await dragSelect(bodyField, '点击设置以后\n窗口没有反应', [sheetBox.x + sheetBox.width + 60, sheetBox.y + sheetBox.height + 20]);
  // A drag from the scrim into a field (selecting its text from outside) keeps it open too.
  {
    const b = await titleField.boundingBox();
    await page.mouse.move(sheetBox.x - 40, b.y + 8);
    await page.mouse.down();
    await page.mouse.move(b.x + b.width - 4, b.y + 8, {steps:8});
    await page.mouse.up();
    await page.waitForTimeout(100);
    assert.equal(await feedbackClosed.textContent(), '0', 'a drag from the scrim into the dialog closed it');
    await expect(feedback).toBeVisible();
  }
  await page.mouse.click(sheetBox.x - 60, sheetBox.y + 20);
  await expect(feedback).toHaveCount(0);
  await expect(feedbackClosed).toHaveText('1');
  await openFeedback();
  await page.keyboard.press('Escape');
  await expect(feedback).toHaveCount(0);
  await expect(feedbackClosed).toHaveText('2');
  await openFeedback();
  await feedback.getByRole('button',{name:'关闭',exact:true}).click();
  await expect(feedback).toHaveCount(0);
  await expect(feedbackClosed).toHaveText('3');
  // The account's avatar (gateway DA-12): the account page shows the
  // picture the app kept; 更换头像 takes a picture as the website does
  // (centred square, 256 × 256 WebP) and uploads it; a type the website
  // refuses is refused without a request. The sidebar's account row shows the
  // kept picture without a session (offline).
  await page.goto(base + '?loggedIn&avatar');
  const kept = await page.evaluate(() => window.__keptAvatar);
  const heroAvatar = page.locator('.hero .avatar img');
  await expect(heroAvatar).toHaveAttribute('src', kept);
  const picture = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300;
    c.height = 200;
    const x = c.getContext('2d');
    x.fillStyle = '#cc3333';
    x.fillRect(0, 0, 300, 200);
    x.fillStyle = '#3333cc';
    x.fillRect(50, 0, 200, 200);
    return c.toDataURL('image/png').split(',')[1];
  });
  const avatarPicker = page.locator('.hero input[type=file]');
  assert.equal(await avatarPicker.getAttribute('accept'), 'image/png,image/jpeg,image/webp');
  await avatarPicker.setInputFiles({name:'me.png', mimeType:'image/png', buffer:Buffer.from(picture, 'base64')});
  const uploads = () => page.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_avatar_upload').map((c) => c.args.image));
  await expect.poll(async () => (await uploads()).length).toBe(1);
  const [sentImage] = await uploads();
  const sent = await page.evaluate(async (image) => {
    const bytes = Uint8Array.from(atob(image), (ch) => ch.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes]));
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const x = c.getContext('2d');
    x.drawImage(bitmap, 0, 0);
    return { kind: new TextDecoder().decode(bytes.slice(8, 12)), size: [bitmap.width, bitmap.height], corner: [...x.getImageData(2, 2, 1, 1).data.slice(0, 3)] };
  }, sentImage);
  assert.deepEqual([sent.kind, sent.size], ['WEBP', [256, 256]]);
  assert.ok(sent.corner[2] > 150 && sent.corner[0] < 100, `the upload is not the centred square: ${sent.corner}`);
  await expect(heroAvatar).toHaveAttribute('src', `data:image/webp;base64,${sentImage}`);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await avatarPicker.setInputFiles({name:'a.gif', mimeType:'image/gif', buffer:Buffer.from('GIF89a')});
  await expect(page.getByText('请选择 PNG、JPEG 或 WebP 图片。')).toBeVisible();
  assert.equal((await uploads()).length, 1);
  await page.goto(base + '?sidebar&avatar');
  await expect(page.locator('.sb-foot .avatar img')).toHaveAttribute('src', kept, {timeout:30000});
  // Changed on the website: the app reads the account again when its window
  // comes back to the front a minute or more after the last read, and shows
  // the new avatar.
  {
    const back = await browser.newPage();
    back.on('pageerror', e => errors.push(e.message));
    await back.clock.install();
    await back.addInitScript(() => { window.__avatarUrl = '/api/desktop/oauth/avatars/a1'; });
    await back.goto(base + '?sidebar&avatar&loggedIn');
    const rowAvatar = back.locator('.sb-foot .avatar img');
    await expect(rowAvatar).toHaveAttribute('src', kept, {timeout:30000});
    const syncs = () => back.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_avatar_sync').length);
    assert.equal(await syncs(), 0, 'the kept avatar was downloaded again');
    await back.evaluate(() => { window.__avatarUrl = '/api/desktop/oauth/avatars/a3'; });
    await back.clock.fastForward(30_000);
    await back.evaluate(() => window.dispatchEvent(new Event('focus')));
    await back.waitForTimeout(200);
    await expect(rowAvatar).toHaveAttribute('src', kept);
    await back.clock.fastForward(31_000);
    await back.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(rowAvatar).toHaveAttribute('src', /avatars%2Fa3/);
    assert.equal(await syncs(), 1);
    await back.close();
  }
  // Settings → 通用 offers the conversation width, 自适应 by default; a
  // choice is stored; the search finds the row.
  await page.goto(base);
  await page.getByRole('button',{name:'通用',exact:true}).click();
  const widthRow = page.locator('#set-chat-width');
  await expect(widthRow.getByRole('button')).toHaveText(['自适应', '标准', '铺满']);
  await expect(widthRow.locator('.opt.on')).toHaveText('自适应');
  await widthRow.getByRole('button',{name:'铺满'}).click();
  await expect(widthRow.locator('.opt.on')).toHaveText('铺满');
  assert.deepEqual(await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('lynshen-prefs')); return [p.version, p.chatWidth]; }), [2, 'full']);
  await page.getByPlaceholder('搜索设置').fill('对话宽度');
  await expect(page.getByRole('button',{name:/^对话宽度/})).toBeVisible();
  await page.evaluate(() => localStorage.removeItem('lynshen-prefs'));
  // The conversation column follows its pane and that setting, the composer
  // with it; a wide table and a code block take the column, the page never
  // scrolls sideways, and the composer stays in view at the size a user
  // reported blank margins at (1720 × 789, sidebar open: a 1428px pane; the
  // fixture's conversation has the turn rail, so 56px beside the column).
  const shell = await browser.newPage({viewport:{width:1720,height:789}});
  shell.on('pageerror', e => errors.push(e.message));
  await shell.goto(base + '?shell');
  await expect(shell.locator('.composer')).toBeVisible({timeout:30000});
  const layout = () => shell.evaluate(() => {
    const box = (sel) => { const b = document.querySelector(sel).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.width)]; };
    const main = document.querySelector('.chatpane main');
    const pad = parseFloat(getComputedStyle(main).paddingLeft);
    const wrap = document.querySelector('.composer-wrap').getBoundingClientRect();
    return {
      column: [Math.round(main.getBoundingClientRect().left + pad), Math.round(main.clientWidth - 2 * pad)],
      composer: box('.composer'), table: box('.table-wrap'), code: box('.codeblock'),
      sideways: document.documentElement.scrollWidth - innerWidth,
      composerInView: wrap.top >= 0 && wrap.bottom <= innerHeight
    };
  });
  const expectColumn = async (width, what) => {
    await expect.poll(async () => (await layout()).column[1], {message: what}).toBe(width);
    const l = await layout();
    for (const part of ['composer', 'table', 'code']) assert.deepEqual(l[part], l.column, `${what}: the ${part} is not on the column`);
    assert.equal(l.sideways, 0, `${what}: the page scrolls sideways`);
    assert.ok(l.composerInView, `${what}: the composer is cut off`);
  };
  await expectColumn(1071, '自适应, 1720 wide');
  await shell.evaluate(() => window.__prefs.setChatWidth('standard'));
  await expectColumn(844, '标准, 1720 wide');
  await shell.evaluate(() => window.__prefs.setChatWidth('full'));
  await expectColumn(1316, '铺满, 1720 wide');
  await shell.setViewportSize({width:1280,height:800});
  await expectColumn(876, '铺满, 1280 wide');
  await shell.evaluate(() => window.__prefs.setChatWidth('auto'));
  await expectColumn(844, '自适应, 1280 wide');
  await shell.setViewportSize({width:1040,height:680});
  await expectColumn(640, '自适应, the smallest window');
  await shell.close();
  // The window frost is off unless chosen. Preferences stored with the old
  // default (on, without a version) are switched off once: in storage, in
  // what the app is told, and nothing is translucent. (?frost: the system
  // can frost, as the app answers; see tests/browser/main.ts.)
  const frosted = async (query, stored) => {
    const p = await browser.newPage();
    p.on('pageerror', e => errors.push(e.message));
    // Once: a reload keeps what the page stored.
    await p.addInitScript((prefs) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('lynshen-prefs', prefs); sessionStorage.setItem('seeded', '1'); } }, JSON.stringify(stored));
    await p.goto(base + query);
    await expect(p.locator('.composer')).toBeVisible({timeout:30000});
    return p;
  };
  const frostState = (p) => p.evaluate(() => ({
    root: document.documentElement.dataset.vibrancy ?? null,
    sidebar: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
    stored: (({ version, sidebarVibrancy }) => [version, sidebarVibrancy])(JSON.parse(localStorage.getItem('lynshen-prefs'))),
    told: window.__calls.filter((c) => c.command === 'set_window_frost').map((c) => c.args.on)
  }));
  const mac = await frosted('?shell&frost=vibrancy', {sidebarVibrancy: true, glass: 40});
  await expect.poll(async () => (await frostState(mac)).told).toEqual([false]);
  assert.deepEqual(await frostState(mac), {root: null, sidebar: 'rgb(32, 32, 32)', stored: [2, false], told: [false]});
  // Turned on afterwards it is a choice: macOS frosts at once, and it is
  // still on after a restart.
  await mac.evaluate(() => window.__prefs.setSidebarVibrancy(true));
  await expect.poll(async () => (await frostState(mac)).root).toBe('on');
  assert.match((await frostState(mac)).sidebar, /^oklab\(.* \/ 0\.96\)$|^rgba\(.*, 0\.96\)$/);
  await mac.reload();
  await expect(mac.locator('.composer')).toBeVisible({timeout:30000});
  await expect.poll(async () => (await frostState(mac)).root).toBe('on');
  assert.deepEqual((await frostState(mac)).stored, [2, true]);
  await mac.close();
  // A Windows window is see-through or not for its lifetime: the choice is
  // handed to the app and shows after the next start.
  const win = await frosted('?shell&frost=mica', {version: 2, sidebarVibrancy: false});
  await win.evaluate(() => window.__prefs.setSidebarVibrancy(true));
  await expect.poll(async () => (await frostState(win)).told).toEqual([false, true]);
  assert.equal((await frostState(win)).root, null);
  await win.reload();
  await expect(win.locator('.composer')).toBeVisible({timeout:30000});
  await expect.poll(async () => (await frostState(win)).root).toBe('on');
  await win.close();
  // The light theme's canvas is an off-white, the sidebar a step darker and
  // the composer a step lighter; the page never paints white. (Glass off:
  // with it the composer lets the canvas through.)
  const light = await browser.newPage();
  light.on('pageerror', e => errors.push(e.message));
  await light.addInitScript(() => localStorage.setItem('lynshen-prefs', JSON.stringify({version: 2, glass: 0})));
  await light.goto(base + '?shell&theme=light');
  await expect(light.locator('.composer')).toBeVisible({timeout:30000});
  const fill = (sel) => light.evaluate((sel) => getComputedStyle(document.querySelector(sel)).backgroundColor, sel);
  assert.deepEqual([await fill('body'), await fill('.sidebar'), await fill('.composer')], ['rgb(246, 245, 242)', 'rgb(238, 236, 232)', 'rgb(251, 250, 248)']);
  await light.close();
  // A message sent with a file shows what was typed and the file as a chip,
  // never the list the engine reads after the text; history from the
  // engine shows the same. (The bubble showed "Attached files (read
  // these):" and the paths.)
  await page.goto(base + '?chat');
  await settled('.welcome');
  const doc = '/Users/me/Documents/私聊_墨竹.jsonl';
  await page.evaluate((doc) => { window.__paneChat().pendingAttach = [doc]; }, doc);
  await expect(page.locator('.composer-wrap .chip-name')).toHaveText('私聊_墨竹.jsonl');
  await page.locator('.rich').click();
  await page.keyboard.type('帮我看看谁发的消息更多');
  await page.keyboard.press('Enter');
  const sentRow = page.locator('.row.user').last();
  await expect(sentRow.locator('.bubble')).toHaveText('帮我看看谁发的消息更多');
  await expect(sentRow.locator('.ufile')).toHaveCount(1);
  await expect(sentRow.locator('.ufile .uname')).toHaveText('私聊_墨竹.jsonl');
  await expect(sentRow.locator('.ufile .udir')).toHaveText('Documents');
  await expect(sentRow.locator('.ufile')).toHaveAttribute('title', doc);
  await expect(page.locator('.list')).not.toContainText('Attached files');
  await expect(page.locator('.composer-wrap .chip-name')).toHaveCount(0);
  // The engine is sent what it always was.
  assert.equal(await page.evaluate(() => window.__paneChat().messages.findLast((m) => m.kind === 'user').text), `帮我看看谁发的消息更多\n\nAttached files (read these):\n${doc}`);
  // Its chip asks for a preview (opened by the page shell: ?shell&preview
  // below), never for the file's folder.
  await sentRow.locator('.ufile').click();
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__calls.some((c) => c.command === 'plugin:opener|reveal_item_in_dir')), false);
  // Copied, it is what was typed and the file's path, without the header.
  await sentRow.hover();
  await sentRow.getByRole('button',{name:'复制',exact:true}).click();
  await expect.poll(() => page.evaluate(() => window.__calls.findLast((c) => c.command === 'plugin:clipboard-manager|write_text')?.args.text)).toBe(`帮我看看谁发的消息更多\n\n${doc}`);
  // Quoted into the composer: the typed text, and the file attached again
  // (once, however often); sent again, the engine reads the same message.
  const typedBox = page.locator('.composer-wrap .rich');
  const boxFiles = page.locator('.composer-wrap .chip-name');
  const sentText = `帮我看看谁发的消息更多\n\nAttached files (read these):\n${doc}`;
  const userTexts = () => page.evaluate(() => window.__paneChat().messages.filter((m) => m.kind === 'user').map((m) => m.text));
  const quote = sentRow.getByRole('button',{name:'引用到输入框'});
  await quote.click();
  await quote.click();
  await expect(typedBox).toHaveText('帮我看看谁发的消息更多');
  await expect(boxFiles).toHaveText(['私聊_墨竹.jsonl']);
  await page.evaluate(() => window.__paneChat().handle({ type: 'status', message: 'ready' }));
  await typedBox.click();
  await page.keyboard.press('Enter');
  await expect.poll(userTexts).toEqual([sentText, sentText]);
  await expect(page.locator('.row.user').last().locator('.bubble')).toHaveText('帮我看看谁发的消息更多');
  await expect(page.locator('.row.user').last().locator('.ufile .uname')).toHaveText('私聊_墨竹.jsonl');
  await expect(boxFiles).toHaveCount(0);
  // Queued, it shows what was typed; taken back, its file comes back too.
  await page.evaluate((text) => window.__paneChat().handle({ type: 'pending_messages', messages: [text] }), sentText);
  await expect(page.locator('.composer-wrap .qchip .qtext')).toHaveText('帮我看看谁发的消息更多');
  await page.evaluate((text) => { const c = window.__paneChat(); c.handle({ type: 'pending_messages', messages: [] }); c.handle({ type: 'unqueued', text }); }, sentText);
  await expect(typedBox).toHaveText('帮我看看谁发的消息更多');
  await expect(boxFiles).toHaveText(['私聊_墨竹.jsonl']);
  await page.locator('.composer-wrap .chip').getByRole('button',{name:'remove'}).click();
  await expect(boxFiles).toHaveCount(0);
  // Rewound: the question names what was typed, and the composer gets it
  // back with its file.
  const firstSent = page.locator('.row.user').first();
  await firstSent.hover();
  await firstSent.locator('.uedit.rewind').click();
  await page.evaluate(() => window.__paneChat().handle({ type: 'checkpoint_view', items: [{ id: 't1', label: '帮我看看谁发的消息更多', detail: '' }, { id: 't2', label: '帮我看看谁发的消息更多', detail: '' }] }));
  await expect(page.locator('.trust-path')).toHaveText('帮我看看谁发的消息更多');
  await page.getByRole('button',{name:'回退并重写',exact:true}).click();
  await expect(typedBox).toHaveText('帮我看看谁发的消息更多');
  await expect(boxFiles).toHaveText(['私聊_墨竹.jsonl']);
  await expect(page.locator('.composer-wrap')).not.toContainText('Attached files');
  // Loaded from history (a conversation opened again): the text, three
  // chips; attachments only: no bubble. (A fresh pane: one with a message
  // the engine has not echoed keeps it through a snapshot.)
  await page.goto(base + '?chat');
  await settled('.welcome');
  await page.evaluate(() => {
    const c = window.__paneChat();
    c.handle({ type: 'transcript', items: [
      { role: 'user', content: '对比这三个文件\n\nAttached files (read these):\n/Users/me/My Docs/报告 2026.pdf\nC:\\Users\\me\\data.csv\n/tmp/notes.md' },
      { role: 'assistant', content: '好的' },
      { role: 'user', content: 'Attached files (read these):\n/tmp/only.txt' }
    ] });
  });
  const rows = page.locator('.row.user');
  await expect(rows).toHaveCount(2);
  await expect(rows.first().locator('.bubble')).toHaveText('对比这三个文件');
  await expect(rows.first().locator('.ufile .uname')).toHaveText(['报告 2026.pdf', 'data.csv', 'notes.md']);
  await expect(rows.last().locator('.bubble')).toHaveCount(0);
  await expect(rows.last().locator('.ufile .uname')).toHaveText('only.txt');
  await expect(page.locator('.list')).not.toContainText('Attached files');
  // A chip opens its file in a tab beside the conversation, inside the
  // project or not, and never shows it in Finder / Explorer: code in a code
  // view, JSON Lines as records, an archive as a card with the two ways to
  // open it outside the app, a file that is gone as a state of its own.
  // (Before, a chip showed the file in its folder.)
  const tabbed = await browser.newPage({viewport:{width:1440,height:900}});
  tabbed.on('pageerror', e => errors.push(e.message));
  await tabbed.goto(base + '?shell&preview');
  await expect(tabbed.locator('button.ufile').first()).toBeVisible({timeout:30000});
  const preview = tabbed.locator('.preview:visible');
  const reveals = () => tabbed.evaluate(() => window.__calls.filter((c) => c.command === 'plugin:opener|reveal_item_in_dir').length);
  const previewed = (path) => tabbed.evaluate((path) => window.__calls.some((c) => c.command === 'preview_file' && c.args.path === path), path);
  const code = '/Users/me/code/lynshen-desktop/src/lib/chatWidth.ts';
  await tabbed.locator('button.ufile', {hasText:'chatWidth.ts'}).click();
  await expect(preview.locator('.name')).toHaveText('chatWidth.ts');
  await expect(preview.locator('.cm-content')).toContainText('export function chatColumnWidth');
  assert.ok(await previewed(code));
  // Beside the conversation, which stays in view.
  const chatBox = await tabbed.locator('.chatpane').boundingBox();
  const previewBox = await preview.boundingBox();
  assert.ok(chatBox && previewBox && chatBox.x + chatBox.width <= previewBox.x + 1, 'the preview covers the conversation');
  // A chat file inside the project can move to the editor.
  await expect(preview.getByRole('button',{name:'在编辑器中打开'})).toBeVisible();
  // JSON Lines: one record per line, a click lays one out; its source a click away.
  const jsonl = '/Users/me/Documents/私聊_墨竹.jsonl';
  await tabbed.locator('button.ufile', {hasText:'私聊_墨竹.jsonl'}).click();
  await expect(preview.locator('.name')).toHaveText('私聊_墨竹.jsonl');
  await expect(preview.getByText('1,284 条记录')).toBeVisible();
  await expect(preview.locator('.rrow')).toHaveCount(200);
  await preview.locator('.rrow').first().click();
  await expect(preview.locator('.pretty')).toContainText('"from": "墨竹"');
  await preview.getByRole('button',{name:'再显示 200 条'}).click();
  await expect(preview.locator('.rrow')).toHaveCount(400);
  await preview.getByRole('button',{name:'源文件',exact:true}).click();
  await expect(preview.locator('.cm-content')).toContainText('"id":90210');
  // Two files, two tabs; the first one's chip shows its tab again.
  await expect(tabbed.locator('.ltab', {hasText:'chatWidth.ts'})).toHaveCount(1);
  await tabbed.locator('button.ufile', {hasText:'chatWidth.ts'}).click();
  await expect(preview.locator('.name')).toHaveText('chatWidth.ts');
  await expect(tabbed.locator('.ltab', {hasText:'chatWidth.ts'})).toHaveCount(1);
  // ... and reads the file again (it may have changed).
  await expect.poll(() => tabbed.evaluate((code) => window.__calls.filter((c) => c.command === 'preview_file' && c.args.path === code).length, code)).toBe(2);
  // An archive: a card, whose buttons open it outside the app.
  const zip = '/Users/me/Downloads/lynshen-desktop-0.5.1.zip';
  await tabbed.locator('button.ufile', {hasText:'lynshen-desktop-0.5.1.zip'}).click();
  await expect(preview.getByText('这种文件无法在应用内预览。')).toBeVisible();
  await expect(preview.locator('.facts')).toContainText('46.0 MB');
  assert.equal(await reveals(), 0, 'a chip showed its file in the folder');
  await preview.locator('.card').getByRole('button',{name:'在文件夹中显示'}).click();
  await expect.poll(() => tabbed.evaluate(() => window.__calls.findLast((c) => c.command === 'plugin:opener|reveal_item_in_dir')?.args.paths[0])).toBe(zip);
  await preview.locator('.card').getByRole('button',{name:'用默认应用打开'}).click();
  await expect.poll(() => tabbed.evaluate(() => window.__calls.findLast((c) => c.command === 'open_file_default')?.args.path)).toBe(zip);
  // A PDF: a card too (the web view cannot show one everywhere).
  await tabbed.locator('button.ufile', {hasText:'2026 Q3 经营分析.pdf'}).click();
  await expect(preview.getByText('应用内无法可靠地显示 PDF，请用系统应用查看。')).toBeVisible();
  // An image: fitted, with zoom.
  await tabbed.locator('button.ufile', {hasText:'评审截图 2026-10-13.png'}).click();
  await expect(preview.locator('img')).toBeVisible();
  const fitted = await preview.locator('.pct').textContent();
  await preview.getByRole('button',{name:'放大'}).click();
  await expect(preview.locator('.pct')).not.toHaveText(fitted ?? '');
  // Gone: said in the tab, the folder and app actions off.
  await tabbed.locator('button.ufile', {hasText:'error-log-1013.txt'}).click();
  await expect(preview.getByText('找不到这个文件')).toBeVisible();
  await expect(preview.locator('.head').getByRole('button',{name:'在文件夹中显示'})).toBeDisabled();
  assert.equal(await tabbed.evaluate(() => window.__calls.filter((c) => c.command === 'preview_file').every((c) => c.args.path.startsWith('/Users/me/'))), true);
  await tabbed.close();
  // The phone page reads the history the same way; its chips only show the
  // files, and a quoted message brings its files back to its message box.
  const phone = await browser.newPage({viewport:{width:390,height:844}});
  phone.on('pageerror', e => errors.push(e.message));
  await phone.goto(base + '?remote');
  const phoneRows = phone.locator('.row.user');
  await expect(phoneRows).toHaveCount(3, {timeout:30000});
  await expect(phoneRows.nth(0).locator('.bubble')).toHaveText('帮我看看谁发的消息更多');
  await expect(phoneRows.nth(0).locator('.ufile .uname')).toHaveText('私聊_墨竹.jsonl');
  await expect(phoneRows.nth(1).locator('.ufile .uname')).toHaveText(['2026 Q3 经营分析.pdf', '销售明细.xlsx', 'metrics.md']);
  await expect(phoneRows.nth(2).locator('.bubble')).toHaveCount(0);
  await expect(phoneRows.nth(2).locator('.ufile .uname')).toHaveText(['error-log-1013.txt', '录屏 2026-10-13.mov']);
  await expect(phone.locator('button.ufile')).toHaveCount(0);
  await expect(phone.locator('.thread')).not.toContainText('Attached files');
  await expect(phone.locator('.thread')).not.toContainText('[视频附件]');
  await phoneRows.nth(1).hover();
  await phoneRows.nth(1).getByRole('button',{name:'引用到输入框'}).click();
  await expect(phone.locator('.composer textarea')).toHaveValue('对比这三份文件，列出口径不一致的地方');
  await expect(phone.locator('.composer .att-name')).toHaveText(['2026 Q3 经营分析.pdf', '销售明细.xlsx', 'metrics.md']);
  await phone.close();
  // The product is named Aogiri; its engine and the account keep the name LynShen.
  await page.goto(base + '?sidebar');
  await expect(page.locator('.brand .word')).toHaveText('Aogiri');
  await page.goto(base + '?welcome');
  await expect(page.locator('.wordmark')).toHaveText('Aogiri');
  await expect(page.getByRole('heading',{name:'登录 LynShen'})).toBeVisible();
  await page.goto(base + '?updates');
  await expect(page.locator('#set-app-version')).toContainText('Aogiri 版本');
  await expect(page.locator('#set-engine-version')).toContainText('引擎版本');
  await page.goto(base + '?updates=found');
  await expect(page.getByRole('heading',{name:'发现新版本 Aogiri 9.9.9'})).toBeVisible();
  await page.goto(base + '?skills&oldEngine');
  await expect(page.getByText('当前的 LynShen 引擎还不能在这里管理技能。到「更新」里更新 Aogiri 后再试')).toBeVisible();
  assert.deepEqual(errors, []);
  console.log('Browser regressions passed: reactive drafts, account authorization, logout, API key label, provider OAuth, mounted tabs, home model, title bar menu, skills, marketplace, plugins, sidebar fold and archive, welcome and approval menu click-away, menu click-away under glass, long reasoning and reply, steered reply, plan menu click-away, conversation width setting and column, window frost default and migration, light theme surfaces, attached files as chips (sent, history, copy, quote, resend, queue, rewind, phone page), product name, sent files previewed in a tab beside the conversation.');
} finally { await browser.close(); await server.close(); }
