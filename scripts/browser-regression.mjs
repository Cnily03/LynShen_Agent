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
  // Once it ends it renders as Markdown, as before.
  await page.evaluate(() => window.__chat.handle({ type: 'status', message: 'ready' }));
  await expect(page.locator('.reason-body .md')).toBeVisible();
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
  await page.evaluate(() => window.__chat.handle({ type: 'status', message: 'ready' }));
  await expect(reply.locator('.md')).toHaveCount(1);
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
  assert.deepEqual(errors, []);
  console.log('Browser regressions passed: reactive drafts, account authorization, logout, API key label, provider OAuth, mounted tabs, home model, title bar menu, long reasoning and reply, steered reply.');
} finally { await browser.close(); await server.close(); }
