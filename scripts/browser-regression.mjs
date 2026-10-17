import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  // The launch screen (src/app.html, src/lib/launch.ts; design.md, "Launch
  // screen"), served at / as the desktop window loads it, over the frame of
  // one conversation (?shell): there from the first frame in the theme's
  // canvas colours; every cold start plays the whole entrance and holds it
  // before it leaves, an app ready later leaves at readiness, a slow start
  // leaves at the cap, a click or a key skips it, reduced motion shows the
  // still logo until the app is ready, and a page outside the desktop app has
  // none.
  {
    const appHtml = readFileSync('src/app.html', 'utf8')
      .replaceAll('%sveltekit.assets%', '')
      .replace('%sveltekit.head%', '<script type="module" src="/tests/browser/launch.ts"></script><script type="module" src="/tests/browser/main.ts"></script>')
      .replace('%sveltekit.body%', '<div id="app"></div>');
    const origin = new URL(base).origin;
    const launchPage = async (query, {theme = 'dark', reduced = false, tauri = true} = {}) => {
      const ctx = await browser.newContext({viewport: {width: 1320, height: 880}, reducedMotion: reduced ? 'reduce' : 'no-preference'});
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errors.push(e.message));
      await p.route((u) => u.pathname === '/', (r) => r.fulfill({contentType: 'text/html', body: appHtml}));
      await p.addInitScript(({theme, tauri}) => {
        if (tauri) window.__TAURI_INTERNALS__ = {metadata: {currentWindow: {label: 'main'}, currentWebview: {label: 'main'}}};
        localStorage.setItem('lynshen-theme', theme);
      }, {theme, tauri});
      await p.goto(`${origin}/?shell&theme=${theme}&${query}`, {waitUntil: 'commit'});
      return p;
    };
    const outcome = (p) => p.evaluate(() => window.__launch && {left: window.__launch.left, at: Math.round(window.__launch.leftAt ?? -1), entrance: window.__launch.entranceAt});
    const look = (p, sel, props) => p.locator(sel).evaluate((el, props) => props.map((k) => getComputedStyle(el)[k]), props);
    const launching = (p) => p.evaluate(() => document.documentElement.classList.contains('launching'));
    // The dev server compiles the fixture once, so the timings below are the screen's.
    let lp = await launchPage('launchReady=never');
    await lp.waitForFunction(() => window.__launch && document.querySelector('aside'), null, {timeout: 60000});
    await lp.context().close();
    // A slow start: the logo on the dark canvas, the entrance on its five
    // parts and the kit's timetable, the frame drawn behind it; it leaves at
    // the cap, ready or not.
    lp = await launchPage('launchReady=never');
    const screen = lp.locator('#launch');
    await expect(screen).toBeVisible();
    assert.deepEqual(await look(lp, '#launch', ['backgroundColor', 'color', 'zIndex', 'position']), ['rgb(26, 26, 26)', 'rgb(236, 236, 236)', '2147483000', 'fixed']);
    assert.equal(await screen.getAttribute('data-tauri-drag-region'), '');
    for (const [sel, name, delay, duration] of [['.l-t1 i', 'l-rise', '0.1s', '0.7s'], ['.l-t2 i', 'l-rise', '0.26s', '0.7s'], ['.l-ray i', 'l-fall', '0.82s', '0.64s'], ['.l-glow', 'l-glow', '1.1s', '0.7s'], ['.l-word', 'l-word', '1.45s', '0.6s']])
      assert.deepEqual(await look(lp, `#launch ${sel}`, ['animationName', 'animationDelay', 'animationDuration', 'animationFillMode']), [name, delay, duration, 'backwards'], sel);
    await expect(lp.locator('aside').first()).toBeAttached({timeout: 30000});
    assert.equal((await outcome(lp)).left, null);
    await expect(screen).toHaveCount(0, {timeout: 8000});
    assert.equal((await outcome(lp)).left, 'cap');
    assert.ok((await outcome(lp)).at >= 3400);
    assert.equal(await launching(lp), false);
    await lp.context().close();
    // A fast start plays the whole entrance (2.05 s) and holds it (0.45 s),
    // timed from the entrance's first frame, before it leaves.
    lp = await launchPage('launchReady=300');
    await lp.waitForFunction(() => window.__launch, null, {timeout: 30000});
    await lp.waitForTimeout(900);
    assert.equal((await outcome(lp)).left, null);
    await expect(lp.locator('#launch')).toHaveCount(0, {timeout: 8000});
    const fast = await outcome(lp);
    assert.equal(fast.left, 'ready');
    assert.equal(typeof fast.entrance, 'number');
    assert.ok(fast.at >= 300 && fast.at - fast.entrance >= 2490 && fast.at - fast.entrance < 2900, `fast start left at ${fast.at}, entrance at ${fast.entrance}`);
    await lp.context().close();
    // An app ready after the hold leaves at readiness.
    lp = await launchPage('launchReady=2900');
    await expect(lp.locator('#launch')).toHaveCount(0, {timeout: 8000});
    const late = await outcome(lp);
    assert.equal(late.left, 'ready');
    assert.ok(late.at >= 2900 && late.at < 3350, `late start left at ${late.at}`);
    await lp.context().close();
    // A click, or a key, skips it at once.
    for (const act of [(p) => p.mouse.click(660, 300), (p) => p.keyboard.press('a')]) {
      lp = await launchPage('launchReady=never');
      await lp.waitForFunction(() => window.__launch, null, {timeout: 30000});
      await act(lp);
      await expect(lp.locator('#launch')).toHaveCount(0, {timeout: 3000});
      assert.equal((await outcome(lp)).left, 'skip');
      await lp.context().close();
    }
    // Reduced motion: the still logo (no entrance, no glow), gone at readiness.
    lp = await launchPage('launchReady=400', {reduced: true});
    await expect(lp.locator('#launch')).toBeVisible();
    assert.deepEqual(await look(lp, '#launch .l-t1 i', ['animationName', 'transform']), ['none', 'none']);
    assert.deepEqual(await look(lp, '#launch .l-word', ['animationName', 'opacity']), ['none', '1']);
    assert.deepEqual(await look(lp, '#launch .l-glow', ['opacity']), ['0']);
    await expect(lp.locator('#launch')).toHaveCount(0, {timeout: 8000});
    const still = await outcome(lp);
    assert.equal(still.left, 'ready');
    assert.ok(still.at >= 400 && still.at < 1000, `reduced motion left at ${still.at}`);
    await lp.context().close();
    // The light theme: its canvas, text and the darker light.
    lp = await launchPage('launchReady=never', {theme: 'light'});
    await expect(lp.locator('#launch')).toBeVisible();
    assert.deepEqual(await look(lp, '#launch', ['backgroundColor', 'color']), ['rgb(246, 245, 242)', 'rgb(26, 25, 23)']);
    assert.match((await look(lp, '#launch .l-ray i', ['backgroundImage']))[0], /rgb\(217, 101, 47\).*rgb\(178, 78, 26\)/);
    await lp.context().close();
    // Outside the desktop app (the phone page's browser): no launch screen.
    lp = await launchPage('launchReady=never', {tauri: false});
    await lp.waitForFunction(() => window.__launch, null, {timeout: 30000});
    assert.equal(await launching(lp), false);
    await expect(lp.locator('#launch')).toBeHidden();
    assert.equal(await lp.evaluate(() => window.__launch.shown), false);
    await lp.context().close();
    console.log('Launch screen passed: first frame in dark and light, the five entrances on the kit timetable, the frame behind, slow start at the cap, a fast start after the whole entrance and its hold, a late start at readiness, click and key skip, reduced motion at readiness, none outside the desktop app.');
  }
  await page.goto(base + '?projects');
  for (let i=1;i<=3;i++) {
    await page.getByRole('button',{name:'新项目',exact:true}).click();
    await expect(page.getByTestId('session')).toHaveText('草稿已就绪');
    // Before anything is sent, a new session there is the same draft.
    await page.getByRole('button',{name:'新会话',exact:true}).click();
    await expect(page.getByTestId('session')).toHaveText('草稿已就绪');
    await expect(page.getByTestId('count')).toHaveText(String(i));
  }
  assert.equal(await page.evaluate(() => window.__calls.some(c => c.command === 'daemon_endpoint')), false);
  // 新对话 clicked again and again opens the one new conversation: it is not
  // listed or saved as a conversation until its first message (each click
  // added a 新对话 row and a saved tab), and it keeps what was typed into it.
  // A project's + does the same in its project.
  await page.goto(base + '?newchat');
  const nav = page.locator('aside');
  const navRows = nav.locator('.list .sess:not(.ghost)');
  const newChatButton = nav.locator('nav.primary').getByRole('button',{name:'新对话',exact:true});
  const savedTabs = () => page.evaluate(() => window.__store.serialize().map((p) => [p.newFolder ? 'waiting' : p.home ? 'chat' : p.name, p.tabs.length]));
  await expect(navRows).toHaveCount(2);
  for (let i = 0; i < 5; i++) await newChatButton.click();
  await expect(page.locator('[data-testid=canvas] .welcome')).toBeVisible();
  await expect(navRows).toHaveCount(2);
  await expect(nav.locator('.list').getByText('新对话',{exact:true})).toHaveCount(0);
  assert.deepEqual(await savedTabs(), [['waiting', 1], ['regression-project', 1]]);
  const newChatBox = page.locator('[data-testid=canvas] .rich');
  await newChatBox.click();
  await page.keyboard.type('还没发出去的话');
  await nav.locator('.sess', {hasText:'修复登录'}).first().click();
  await expect(newChatBox).toHaveText('');
  await newChatButton.click();
  await expect(newChatBox).toHaveText('还没发出去的话');
  assert.deepEqual(await savedTabs(), [['waiting', 1], ['regression-project', 1]]);
  // Sent: a conversation, listed; the next 新对话 is a new one.
  await newChatBox.click();
  await page.keyboard.press('Enter');
  await expect(navRows).toHaveCount(3);
  await expect.poll(savedTabs).toEqual([['chat', 1], ['regression-project', 1]]);
  await newChatButton.click();
  await expect(newChatBox).toHaveText('');
  await expect(navRows).toHaveCount(3);
  await expect.poll(savedTabs).toEqual([['waiting', 1], ['chat', 1], ['regression-project', 1]]);
  const projectPlus = nav.getByRole('button',{name:'在此项目下新建对话'});
  for (let i = 0; i < 3; i++) {
    await nav.locator('.folder-row').hover();
    await projectPlus.click();
  }
  await expect(page.locator('[data-testid=canvas] .welcome')).toBeVisible();
  await expect(nav.locator('.project .sess:not(.ghost)')).toHaveText(['修复登录']);
  assert.deepEqual(await savedTabs(), [['waiting', 1], ['chat', 1], ['regression-project', 2]]);
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
  // A provider of one's own (提供商 → 添加 → 手动配置): the form checks the
  // base URL, token counts and input kinds; each model keeps its window,
  // output cap, thinking, effort tiers and input kinds; 编辑 reopens them.
  await page.goto(base);
  await page.getByRole('button',{name:'提供商',exact:true}).click();
  await page.locator('#set-provider-add').click();
  await page.getByRole('button',{name:'手动配置'}).click();
  const providerForm = page.getByRole('dialog');
  const field = (name) => providerForm.getByRole('textbox',{name,exact:true});
  const tick = (name) => providerForm.getByRole('checkbox',{name,exact:true});
  await field('Provider ID').fill('my-llm');
  await field('Base URL').fill('llm.example.com/v1');
  await field('模型名').fill('my-model');
  await field('上下文窗口').fill('16k');
  await field('最大输出').fill('32k');
  await providerForm.getByRole('button',{name:'创建',exact:true}).click();
  await expect(providerForm.getByText('最大输出不能大于上下文窗口。')).toBeVisible();
  await field('上下文窗口').fill('200k');
  await providerForm.getByRole('button',{name:'添加模型',exact:true}).click();
  await field('模型名').fill('my-small-model');
  await field('上下文窗口').fill('64k');
  await tick('图片').uncheck({force:true});
  await tick('文本').uncheck({force:true});
  await providerForm.getByRole('button',{name:'添加模型',exact:true}).click();
  await expect(providerForm.getByText('至少勾选一种输入。')).toBeVisible();
  await tick('文本').check({force:true});
  await tick('支持思考（推理）').uncheck({force:true});
  await providerForm.getByRole('button',{name:'添加模型',exact:true}).click();
  await providerForm.getByRole('button',{name:'创建',exact:true}).click();
  await expect(providerForm.getByText(/以 http:\/\/ 或 https:\/\/ 开头/)).toBeVisible();
  await field('Base URL').fill('https://llm.example.com/v1');
  await providerForm.getByRole('button',{name:'创建',exact:true}).click();
  await expect(providerForm).toHaveCount(0);
  const storedModels = () => page.evaluate(() => JSON.parse(localStorage.getItem('lynshen-custom-providers')).find((p) => p.id === 'my-llm').models
    .map((m) => [m.name, m.context_window, m.max_output_tokens, m.reasoning, m.reasoning_efforts.join(' '), m.input_modalities.join(' ')]));
  assert.deepEqual(await storedModels(), [
    ['my-model', 200000, 32000, true, 'none low medium high xhigh', 'text image'],
    ['my-small-model', 64000, 8192, false, 'none', 'text']
  ]);
  await page.locator('#pcard-my-llm .pcard-main').click();
  await page.locator('#pcard-my-llm').getByRole('button',{name:'编辑',exact:true}).click();
  await expect(field('Provider ID')).toBeDisabled();
  await expect(field('Base URL')).toHaveValue('https://llm.example.com/v1');
  await providerForm.getByRole('button',{name:'编辑 my-model'}).click();
  await expect(field('上下文窗口')).toHaveValue('200k');
  await field('上下文窗口').fill('1M');
  await tick('关闭').uncheck({force:true});
  await tick('Ultra').check({force:true});
  await providerForm.getByRole('button',{name:'更新模型',exact:true}).click();
  await providerForm.getByRole('button',{name:'保存',exact:true}).click();
  await expect(providerForm).toHaveCount(0);
  assert.deepEqual((await storedModels())[0], ['my-model', 1000000, 32000, true, 'low medium high xhigh ultra', 'text image']);
  // Ticket #24: under the Base URL, the address requests go to, as the
  // engine builds it for the format; an Anthropic-format host alone is
  // offered its /v1 address. The tiers include Minimal.
  await page.locator('#set-provider-add').click();
  await page.getByRole('button',{name:'手动配置'}).click();
  const requestUrl = providerForm.getByTestId('request-url');
  await expect(requestUrl).toHaveCount(0);
  await field('Base URL').fill('https://www.lynshen.org');
  await expect(requestUrl).toHaveText('请求地址 https://www.lynshen.org/responses');
  await expect(providerForm.getByRole('button',{name:/^改用 /})).toHaveCount(0);
  await providerForm.getByRole('button',{name:'Anthropic',exact:true}).click();
  await expect(requestUrl).toHaveText('请求地址 https://www.lynshen.org/anthropic/v1/messages');
  await expect(providerForm.getByText(/多数中转站（包括 LynShen）不支持这个路径/)).toBeVisible();
  await providerForm.getByRole('button',{name:'改用 https://www.lynshen.org/v1',exact:true}).click();
  await expect(field('Base URL')).toHaveValue('https://www.lynshen.org/v1');
  await expect(requestUrl).toHaveText('请求地址 https://www.lynshen.org/v1/messages');
  await expect(providerForm.getByRole('button',{name:/^改用 /})).toHaveCount(0);
  await providerForm.getByRole('button',{name:'Chat Completions',exact:true}).click();
  await expect(requestUrl).toHaveText('请求地址 https://www.lynshen.org/v1/chat/completions');
  await expect(tick('Minimal')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(providerForm).toHaveCount(0);
  // Ticket #24: a built-in provider's own settings. 编辑 on its card opens
  // the form without id and format; its models keep their names and cannot
  // be removed, and a model can be added. Only what differs from the
  // built-in values is kept (by provider id); the default provider's copy in
  // config.json (what the engine runs) gets the merged values.
  await page.goto(base + '?anthropic=keyed');
  await page.getByRole('button',{name:'提供商',exact:true}).click();
  const anthropicCard = page.locator('#pcard-anthropic');
  await expect(anthropicCard.getByText('已自定义')).toHaveCount(0);
  await anthropicCard.locator('.pcard-main').click();
  await anthropicCard.getByRole('button',{name:'编辑',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'编辑 Anthropic'})).toBeVisible();
  await expect(field('Provider ID')).toHaveCount(0);
  await expect(providerForm.getByRole('button',{name:'Responses',exact:true})).toHaveCount(0);
  await expect(field('Base URL')).toHaveValue('https://api.anthropic.com');
  await expect(requestUrl).toHaveText('请求地址 https://api.anthropic.com/v1/messages');
  await field('Base URL').fill('');
  await expect(requestUrl).toHaveText('请求地址 https://api.anthropic.com/v1/messages');
  await field('Base URL').fill('https://www.lynshen.org');
  await expect(requestUrl).toHaveText('请求地址 https://www.lynshen.org/anthropic/v1/messages');
  await providerForm.getByRole('button',{name:'改用 https://www.lynshen.org/v1',exact:true}).click();
  await expect(requestUrl).toHaveText('请求地址 https://www.lynshen.org/v1/messages');
  await expect(providerForm.getByText('默认地址 https://api.anthropic.com')).toBeVisible();
  await expect(providerForm.getByRole('button',{name:'移除 claude-fable-5'})).toHaveCount(0);
  await providerForm.getByRole('button',{name:'编辑 claude-fable-5'}).click();
  await expect(field('模型名')).toBeDisabled();
  await expect(field('上下文窗口')).toHaveValue('200k');
  await expect(providerForm.getByText(/留空时使用内置的值/)).toBeVisible();
  await field('上下文窗口').fill('1M');
  await field('最大输出').fill('128k');
  await tick('Minimal').check({force:true});
  await tick('Max').uncheck({force:true});
  await providerForm.getByRole('button',{name:'更新模型',exact:true}).click();
  await expect(providerForm.locator('.mrow').filter({hasText:'claude-fable-5'}).getByText(/^已修改 · 窗口 1M · 输出 128k/)).toBeVisible();
  await providerForm.getByRole('button',{name:'编辑 claude-haiku-4-5'}).click();
  await tick('图片').uncheck({force:true});
  await tick('支持思考（推理）').uncheck({force:true});
  await providerForm.getByRole('button',{name:'更新模型',exact:true}).click();
  await field('模型名').fill('claude-next');
  await field('上下文窗口').fill('400k');
  await providerForm.getByRole('button',{name:'添加模型',exact:true}).click();
  await expect(providerForm.locator('.mrow').filter({hasText:'claude-next'}).getByText(/^自己添加 · /)).toBeVisible();
  await expect(providerForm.getByRole('button',{name:'移除 claude-next'})).toBeVisible();
  await providerForm.getByRole('button',{name:'保存',exact:true}).click();
  await expect(providerForm).toHaveCount(0);
  const storedOverrides = () => page.evaluate(() => JSON.parse(localStorage.getItem('lynshen-provider-overrides') ?? 'null'));
  assert.deepEqual(await storedOverrides(), {anthropic: {
    base_url: 'https://www.lynshen.org/v1',
    models: {
      'claude-fable-5': {context_window: 1000000, max_output_tokens: 128000, reasoning_efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']},
      'claude-haiku-4-5': {reasoning: false, input_modalities: ['text']}
    },
    added: [{name: 'claude-next', context_window: 400000, max_output_tokens: 8192, reasoning: true, reasoning_efforts: ['none', 'low', 'medium', 'high', 'xhigh'], input_modalities: ['text', 'image']}]
  }});
  await expect(anthropicCard.getByText('已自定义')).toBeVisible();
  const lastEngineCopy = () => page.evaluate(() => {
    const patch = window.__calls.filter((c) => c.command === 'write_config' && 'models' in c.args.patch).at(-1)?.args.patch;
    return patch && [patch.base_url, patch.models.map((m) => [m.name, m.context_window, m.max_output_tokens, m.reasoning ?? null, m.reasoning_efforts.join(' '), (m.input_modalities ?? []).join(' ')])];
  });
  await expect.poll(lastEngineCopy).toEqual(['https://www.lynshen.org/v1', [
    ['claude-fable-5', 1000000, 128000, true, 'none minimal low medium high xhigh', ''],
    ['claude-haiku-4-5', 200000, 64000, false, 'none', 'text'],
    ['claude-next', 400000, 8192, true, 'none low medium high xhigh', 'text image']
  ]]);
  // 编辑 again: the saved values; a model and then the whole provider go
  // back to the built-in values, and nothing is kept.
  await anthropicCard.locator('.pcard-main').click();
  await anthropicCard.getByRole('button',{name:'编辑',exact:true}).click();
  await expect(field('Base URL')).toHaveValue('https://www.lynshen.org/v1');
  await providerForm.getByRole('button',{name:'恢复 claude-fable-5 的默认值'}).click();
  await expect(providerForm.getByRole('button',{name:'恢复 claude-fable-5 的默认值'})).toHaveCount(0);
  await expect(providerForm.locator('.mrow').filter({hasText:'claude-fable-5'}).getByText(/^窗口 200k · 输出 64k/)).toBeVisible();
  await page.getByRole('dialog').getByRole('button',{name:'恢复默认',exact:true}).click();
  await expect(field('Base URL')).toHaveValue('https://api.anthropic.com');
  await expect(providerForm.getByText('claude-next')).toHaveCount(0);
  await providerForm.getByRole('button',{name:'保存',exact:true}).click();
  await expect(providerForm).toHaveCount(0);
  assert.equal(await storedOverrides(), null);
  await expect(anthropicCard.getByText('已自定义')).toHaveCount(0);
  await expect.poll(async () => (await lastEngineCopy())?.[0]).toBe('https://api.anthropic.com');
  // Adding a built-in provider: the key step has the same settings behind
  // 自定义设置; 添加 Provider saves the key and them.
  await page.goto(base + '?anthropic');
  await page.getByRole('button',{name:'提供商',exact:true}).click();
  await page.locator('#set-provider-add').click();
  await page.getByRole('dialog').getByRole('button').filter({hasText:/^Anthropic/}).first().click();
  const keyStep = page.getByRole('dialog');
  await keyStep.getByPlaceholder('请输入 API Key').fill('sk-ant-test');
  await expect(field('Base URL')).toHaveCount(0);
  await keyStep.getByRole('button',{name:'自定义设置（Base URL、模型参数）'}).click();
  await field('Base URL').fill('https://www.lynshen.org/v1');
  await expect(requestUrl).toHaveText('请求地址 https://www.lynshen.org/v1/messages');
  await expect(keyStep.getByRole('textbox',{name:'API key',exact:true})).toHaveCount(0);
  await keyStep.getByRole('button',{name:'编辑 claude-haiku-4-5'}).click();
  await tick('图片').uncheck({force:true});
  await keyStep.getByRole('button',{name:'更新模型',exact:true}).click();
  await keyStep.getByRole('button',{name:'添加 Provider',exact:true}).click();
  await expect(keyStep).toHaveCount(0);
  assert.ok(await page.evaluate(() => window.__calls.some((c) => c.command === 'set_auth_key' && c.args.provider === 'anthropic' && c.args.key === 'sk-ant-test')));
  assert.deepEqual(await storedOverrides(), {anthropic: {base_url: 'https://www.lynshen.org/v1', models: {'claude-haiku-4-5': {input_modalities: ['text']}}}});
  await expect(anthropicCard.getByText('已自定义')).toBeVisible();
  // Ticket #24 P3: 获取可用模型 lists the endpoint's models (read by the
  // app with the typed key); the ones a model catalog knows come with their
  // window, output cap, tiers and input kinds (here the gateway's catalog,
  // signed in). 自动配置 puts the catalog values over listed models.
  await page.goto(base + '?models');
  await page.getByRole('button',{name:'提供商',exact:true}).click();
  await page.locator('#set-provider-add').click();
  await page.getByRole('button',{name:'手动配置'}).click();
  await field('Provider ID').fill('relay');
  await field('Base URL').fill('https://denied.example.com/v1');
  await field('API key').fill('sk-relay');
  await providerForm.getByRole('button',{name:'获取可用模型',exact:true}).click();
  await expect(providerForm.getByText('获取失败：HTTP 401: invalid api key')).toBeVisible();
  await field('Base URL').fill('https://relay.example.com/v1');
  await providerForm.getByRole('button',{name:'获取可用模型',exact:true}).click();
  const foundList = providerForm.getByRole('region',{name:'可用模型'});
  await expect(foundList.getByText('找到 4 个模型，其中 2 个在模型目录里有参数。')).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.command === 'provider_models').at(-1).args), {provider: 'relay', baseUrl: 'https://relay.example.com/v1', format: 'responses', key: 'sk-relay'});
  await expect(foundList.getByText('模型目录里没有它，按默认值添加')).toHaveCount(1);
  await foundList.getByRole('checkbox',{name:'relay-mystery',exact:true}).uncheck({force:true});
  await foundList.getByRole('button',{name:'添加所选（3）',exact:true}).click();
  await expect(foundList).toHaveCount(0);
  await expect(providerForm.getByText('已添加 3 个模型。')).toBeVisible();
  await providerForm.getByRole('button',{name:'编辑 claude-opus-5-5'}).click();
  await field('上下文窗口').fill('200k');
  await providerForm.getByRole('button',{name:'更新模型',exact:true}).click();
  await providerForm.getByRole('button',{name:'自动配置',exact:true}).click();
  await expect(providerForm.getByText('已按模型目录更新 1 个模型。')).toBeVisible();
  await providerForm.getByRole('button',{name:'自动配置',exact:true}).click();
  await expect(providerForm.getByText('列表中的模型已和模型目录一致。')).toBeVisible();
  await providerForm.getByRole('button',{name:'创建',exact:true}).click();
  await expect(providerForm).toHaveCount(0);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('lynshen-custom-providers')).find((p) => p.id === 'relay').models
    .map((m) => [m.name, m.display_name ?? null, m.context_window, m.max_output_tokens, m.reasoning, m.reasoning_efforts.join(' '), m.input_modalities.join(' ')])), [
    ['claude-opus-5-5', 'Claude Opus 5.5', 1000000, 64000, true, 'low medium high', 'text image'],
    ['glm-5.3-flash', 'GLM-5.3 Flash', 128000, 64000, false, 'none', 'text'],
    ['vendor/long-ctx', 'Long Context', 2000000, 100000, true, 'none low medium high xhigh', 'text']
  ]);
  // Its 编辑 lists the endpoint again with the saved key (read by the app).
  await page.locator('#pcard-relay .pcard-main').click();
  await page.locator('#pcard-relay').getByRole('button',{name:'编辑',exact:true}).click();
  await providerForm.getByRole('button',{name:'获取可用模型',exact:true}).click();
  await expect(foundList.getByText('已在列表中')).toHaveCount(3);
  await expect(foundList.getByRole('button',{name:'添加所选（1）',exact:true})).toBeVisible();
  assert.deepEqual(await page.evaluate(() => window.__calls.filter((c) => c.command === 'provider_models').at(-1).args), {provider: 'relay', baseUrl: 'https://relay.example.com/v1', format: 'responses', key: null});
  await page.keyboard.press('Escape');
  // The owner's report on 0.9.1: models of another provider showed no
  // thinking. What the endpoint's list says comes first; a model LynShen
  // CLI 0.7.0 lists with only "none" is not "does not think" (it is added
  // thinking, with the default tiers); a model typed by hand thinks by
  // default; 自动配置 never turns thinking off. The models reach config.json
  // with `reasoning` and their tiers.
  await page.goto(base + '?engine070');
  await page.getByRole('button',{name:'提供商',exact:true}).click();
  await page.locator('#set-provider-add').click();
  await page.getByRole('button',{name:'手动配置'}).click();
  await field('Provider ID').fill('thinker');
  await field('Base URL').fill('https://thinking.example.com/v1');
  await field('API key').fill('sk-think');
  await providerForm.getByRole('button',{name:'获取可用模型',exact:true}).click();
  await expect(foundList.getByText('找到 4 个模型，其中 1 个在模型目录里有参数。')).toBeVisible();
  const foundRow = (id) => foundList.locator('.frow').filter({has: page.getByText(id, {exact:true})}).locator('.mdesc');
  await expect(foundRow('claude-relay-5')).toHaveText(/^窗口 1M · 输出 128k · 思考 关闭 \/ Low \/ Medium \/ High \/ XHigh \/ Max · 文本、图片$/);
  await expect(foundRow('vendor/thinker-x')).toHaveText(/^窗口 256k · 输出 8192 · 思考 关闭 \/ Low \/ Medium \/ High \/ XHigh/);
  await expect(foundRow('kimi-k2-thinking')).toHaveText(/^窗口 262144 · 输出 262144 · 思考 关闭 \/ Low \/ Medium \/ High \/ XHigh/);
  await expect(foundRow('plain-chat')).toHaveText(/不思考/);
  await foundList.getByRole('button',{name:'添加所选（4）',exact:true}).click();
  await expect(providerForm.getByText('已添加 4 个模型。')).toBeVisible();
  await field('模型名').fill('moonshot-v1-8k');
  await providerForm.getByRole('button',{name:'添加模型',exact:true}).click();
  // The user turns thinking off on one; 自动配置 keeps it off, and keeps
  // thinking on for the model typed by hand that the engine's table says
  // does not think (the note says so).
  await providerForm.getByRole('button',{name:'编辑 kimi-k2-thinking'}).click();
  await tick('支持思考（推理）').uncheck({force:true});
  await providerForm.getByRole('button',{name:'更新模型',exact:true}).click();
  await providerForm.getByRole('button',{name:'自动配置',exact:true}).click();
  await expect(providerForm.getByText('已按模型目录更新 1 个模型。')).toBeVisible();
  await expect(providerForm.getByText('模型目录说 1 个模型不支持思考，它们的思考设置没有改；确认不支持时请在模型里取消“支持思考”。')).toBeVisible();
  // Turned back on, the default tiers are offered.
  await providerForm.getByRole('button',{name:'编辑 kimi-k2-thinking'}).click();
  await tick('支持思考（推理）').check({force:true});
  await expect(tick('High')).toBeChecked();
  await providerForm.getByRole('button',{name:'更新模型',exact:true}).click();
  await providerForm.getByRole('button',{name:'创建',exact:true}).click();
  await expect(providerForm).toHaveCount(0);
  const thinkerModels = () => page.evaluate(() => JSON.parse(localStorage.getItem('lynshen-custom-providers')).find((p) => p.id === 'thinker').models
    .map((m) => [m.name, m.context_window, m.max_output_tokens, m.reasoning, m.reasoning_efforts.join(' '), m.input_modalities.join(' ')]));
  assert.deepEqual(await thinkerModels(), [
    ['claude-relay-5', 1000000, 128000, true, 'none low medium high xhigh max', 'text image'],
    ['vendor/thinker-x', 256000, 8192, true, 'none low medium high xhigh', 'text image'],
    ['kimi-k2-thinking', 262144, 262144, true, 'none low medium high xhigh', 'text image'],
    ['plain-chat', 128000, 8192, false, 'none', 'text image'],
    ['moonshot-v1-8k', 8192, 4096, true, 'none low medium high xhigh', 'text image']
  ]);
  // As the default provider: config.json gets the models with `reasoning`
  // and their tiers, and the effort choice shows for a thinking model.
  await page.locator('#set-default-provider .trigger').click();
  await page.locator('#set-default-provider .opt').filter({hasText:'Thinker'}).click();
  const thinkerCopy = () => page.evaluate(() => {
    const patch = window.__calls.filter((c) => c.command === 'write_config' && 'models' in c.args.patch).at(-1)?.args.patch;
    return patch && [patch.provider, patch.model, patch.reasoning_effort, patch.models.map((m) => [m.name, m.reasoning, m.reasoning_efforts.join(' ')])];
  });
  await expect.poll(thinkerCopy).toEqual(['thinker', 'claude-relay-5', 'high', [
    ['claude-relay-5', true, 'none low medium high xhigh max'],
    ['vendor/thinker-x', true, 'none low medium high xhigh'],
    ['kimi-k2-thinking', true, 'none low medium high xhigh'],
    ['plain-chat', false, 'none'],
    ['moonshot-v1-8k', true, 'none low medium high xhigh']
  ]]);
  await page.getByRole('button',{name:'模型与推理',exact:true}).click();
  await expect(page.locator('#set-reasoning-effort .opt')).toHaveText(['None', 'Low', 'Medium', 'High', 'Xhigh', 'Max']);
  // A model that takes no images and does not think: the composer refuses
  // an image and shows no effort; one that takes images attaches it.
  await page.goto(base + '?shell&textOnly');
  await page.waitForFunction(() => window.__chat, null, {timeout:30000});
  await expect(page.locator('.fbtn.effort')).toHaveCount(0);
  await page.evaluate(() => { window.__chat.pendingAttach = ['/Users/me/Desktop/shot.png']; });
  await expect(page.getByText('my-small-model 不接受图片输入，没有添加 shot.png。', {exact:false})).toBeVisible();
  await expect(page.getByText('图片 #1')).toHaveCount(0);
  await page.evaluate(() => {
    window.__chat.handle({type:'model_status', provider:'my-llm', model:'my-model', reasoning_effort:'high', reasoning_efforts:['low','high'], input_modalities:['text','image'], context_window:200000, context_limit:150000, max_output_tokens:32000, state:'ready'});
    window.__chat.pendingAttach = ['/Users/me/Desktop/shot.png'];
  });
  await expect(page.getByText('图片 #1')).toBeVisible();
  await expect(page.locator('.fbtn.effort')).toHaveText('High');
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
  await page.locator('.model-anchor .trigger').click();
  await expect(page.locator('.pop.mp .mline')).toHaveCount(2);
  await page.locator('.pop.mp .mline', {hasText:'Claude Opus 5.5'}).click();
  await expect(page.locator('textarea')).toBeFocused();
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
  // Settings → 编码智能体 → Shell: the shells the daemon found, with their
  // versions; a choice is written to config.json; a missing PowerShell 7
  // offers its winget install and the download page.
  await page.goto(base + '?agents');
  await expect(page.locator('#set-shell-command')).toContainText('现在：zsh 5.9');
  await page.locator('#set-shell-command .trigger').click();
  await expect(page.locator('#set-shell-command .opt')).toHaveText(['自动（推荐：登录 shell，现在是 zsh）', 'zsh 5.9', 'bash 3.2.57', 'sh (bash 3.2.57)']);
  await page.getByRole('button',{name:'bash 3.2.57',exact:true}).click();
  const shellPatches = () => page.evaluate(() => window.__calls.filter((c) => c.command === 'write_config').map((c) => JSON.stringify(c.args.patch)));
  await expect.poll(shellPatches).toContain('{"shell":"bash"}');
  await expect(page.locator('#set-shell-command')).toContainText('现在：bash 3.2.57');
  await page.locator('#set-terminal-shell .trigger').click();
  await page.locator('#set-terminal-shell .opt', {hasText:'zsh 5.9'}).click();
  await expect.poll(shellPatches).toContain('{"terminal_shell":"zsh"}');
  await page.goto(base + '?agents=windows');
  await expect(page.locator('#set-shell-command .trigger')).toHaveText('自动（推荐：Git Bash，没有时用 PowerShell 7，再没有时用 Windows PowerShell 5.1）');
  await expect(page.locator('#set-shell-command')).toContainText('现在：Git Bash 5.2.37 · Windows 原生操作用 Windows PowerShell 5.1.22621.4391');
  await page.locator('#set-shell-command .trigger').click();
  await page.getByRole('button',{name:'PowerShell 7（未安装）'}).click();
  await expect(page.locator('#set-shell-command')).toContainText('PowerShell 7 未安装，命令在 Git Bash 5.2.37 中运行');
  await expect(page.locator('#set-shell-install-pwsh').getByRole('button',{name:'安装 PowerShell 7'})).toHaveAttribute('title', 'winget install --id Microsoft.PowerShell -e --source winget');
  await page.locator('#set-shell-install-pwsh').getByRole('button',{name:'官方下载'}).click();
  assert.ok(await page.evaluate(() => window.__calls.some((c) => c.command === 'plugin:opener|open_url' && String(c.args.url).includes('installing-powershell-on-windows'))));
  // A daemon before the `shells` op: a note, no choice.
  await page.goto(base + '?agents&oldEngine');
  await expect(page.getByText('当前的后台服务不能选择 Shell，更新后可用')).toBeVisible();
  // Settings → 回复风格 against the stand-in daemon: the default for new
  // conversations is written to config.json; a built-in opens read only and
  // 复制为自定义 starts a personal copy, which is saved and then deleted.
  await page.goto(base + '?styles');
  const styleDefault = page.locator('#set-reply-style-default .trigger');
  await expect(styleDefault).toHaveText('默认', {timeout:30000});
  await styleDefault.click();
  await expect(page.locator('#set-reply-style-default .opt')).toHaveText(['默认', '简洁', '详细讲解', '教学引导', '正式汇报', '代码评审', '发布说明']);
  await page.locator('#set-reply-style-default .opt', {hasText:'简洁'}).click();
  const stylePatches = () => page.evaluate(() => window.__calls.filter((c) => c.command === 'write_config').map((c) => JSON.stringify(c.args.patch)));
  await expect.poll(stylePatches).toContain('{"reply_style":"concise"}');
  await expect(page.locator('.srow', {hasText:'发布说明'})).toContainText('项目');
  // A file that does not load: its path and the reason in the app's
  // language, never the engine's English detail.
  await expect(page.getByText('~/.lynshen/styles/two words.md 不会加载：文件名不能作为风格 id', {exact:false})).toBeVisible();
  await expect(page.getByText('the file name cannot be a style id')).toHaveCount(0);
  const formal = page.locator('.srow', {hasText:'正式汇报'});
  await formal.hover();
  await formal.getByRole('button',{name:'查看'}).click();
  const viewDialog = page.getByRole('dialog', {name:'回复风格', exact:true});
  await expect(viewDialog.getByText('内置风格不能修改')).toBeVisible();
  await viewDialog.getByRole('button',{name:'复制为自定义'}).click();
  const newDialog = page.getByRole('dialog', {name:'新建回复风格', exact:true});
  await expect(newDialog.getByPlaceholder('例如：代码评审')).toHaveValue('正式汇报 副本');
  await newDialog.getByRole('button',{name:'保存',exact:true}).click();
  await expect(newDialog).toHaveCount(0);
  const savedStyle = await page.evaluate(() => window.__ops.find((o) => o.op === 'style_save'));
  assert.equal(savedStyle.name, '正式汇报 副本');
  assert.equal(savedStyle.style, undefined);
  assert.ok(savedStyle.instructions.includes('正式的书面语气'));
  const copied = page.locator('.srow', {hasText:'正式汇报 副本'});
  await expect(copied).toContainText('自定义');
  // A personal style is edited in place and deleted after confirming.
  await copied.hover();
  await copied.getByRole('button',{name:'编辑'}).click();
  const editDialog = page.getByRole('dialog', {name:'编辑回复风格', exact:true});
  await editDialog.getByPlaceholder('例如：代码评审').fill('');
  await editDialog.getByRole('button',{name:'保存',exact:true}).click();
  await expect(editDialog.getByText('填写名称')).toBeVisible();
  await editDialog.getByPlaceholder('例如：代码评审').fill('周报');
  await editDialog.getByRole('button',{name:'保存',exact:true}).click();
  await expect(editDialog).toHaveCount(0);
  // Saved under the id the daemon gave it (`style` for a name with no
  // ASCII letters, as the engine does).
  assert.equal(await page.evaluate(() => window.__ops.filter((o) => o.op === 'style_save').at(-1).style), 'style');
  const weekly = page.locator('.srow', {hasText:'周报'});
  await weekly.hover();
  await weekly.getByRole('button',{name:'删除'}).click();
  await page.getByRole('button',{name:'删除',exact:true}).last().click();
  await expect(page.locator('.srow', {hasText:'周报'})).toHaveCount(0);
  assert.ok(await page.evaluate(() => window.__ops.some((o) => o.op === 'style_delete')));
  // A save the engine refuses: the reason by its code, in the app's language.
  await page.getByRole('button',{name:'新建风格'}).click();
  const failing = page.getByRole('dialog', {name:'新建回复风格', exact:true});
  await failing.getByPlaceholder('例如：代码评审').fill('只读');
  await failing.locator('textarea').fill('先给结论。');
  await failing.getByRole('button',{name:'保存',exact:true}).click();
  await expect(failing.getByText('没有保存：写不了风格文件，检查 ~/.lynshen/styles 能否写入')).toBeVisible();
  await expect(failing.getByText(/Permission denied/)).toHaveCount(0);
  await failing.getByRole('button',{name:'取消',exact:true}).click();
  await expect(failing).toHaveCount(0);
  // Built-ins and project styles are not deleted here.
  await expect(page.locator('.srow', {hasText:'发布说明'}).getByRole('button',{name:'删除'})).toHaveCount(0);
  await expect(page.locator('.srow', {hasText:'简洁'}).getByRole('button',{name:'删除'})).toHaveCount(0);
  // A daemon before reply styles: a note, no choice.
  await page.goto(base + '?styles&oldEngine');
  await expect(page.getByText('后台服务不支持回复风格，更新 LynShen CLI 后可以使用')).toBeVisible({timeout:30000});
  // The composer's "+" menu lists the styles once the engine has said which
  // one the conversation uses; a pick goes to the engine as set_style.
  await page.goto(base + '?shell&styles');
  await page.waitForFunction(() => window.__chat, null, {timeout:30000});
  await page.locator('.fbtn.add').click();
  const tray = page.locator('#cmp-tray');
  await expect(tray.getByRole('group', {name:'回复风格'})).toBeVisible();
  await expect(tray.getByRole('option', {name:/默认/})).toHaveAttribute('aria-checked', 'true');
  await tray.getByRole('option', {name:/简洁/}).click();
  assert.deepEqual(await page.evaluate(() => window.__sent.filter((o) => o.op === 'set_style')), [{op: 'set_style', style: 'concise'}]);
  await page.evaluate(() => window.__chat.handle({type:'reply_style', style:'concise', name:'简洁', source:'builtin', chosen:true, missing:false}));
  await page.locator('.fbtn.add').click();
  await expect(tray.getByRole('option', {name:/简洁/})).toHaveAttribute('aria-checked', 'true');
  // A style that is gone shows under its id, checked and not pickable.
  await page.evaluate(() => window.__chat.handle({type:'reply_style', style:'terse', name:'terse', source:'missing', chosen:true, missing:true}));
  await expect(tray.getByRole('option', {name:/terse/})).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  // The sidebar: folded sections stay folded after a restart; the archive
  // restores several conversations at once.
  await page.goto(base + '?sidebar');
  await expect(page.locator('.folder-name')).toHaveCount(3, {timeout:30000});
  await page.getByRole('button',{name:'项目',exact:true}).click();
  await expect(page.locator('.folder-name')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('button',{name:'项目',exact:true})).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.folder-name')).toHaveCount(0);
  // 全部折叠 covers 对话 too: with 对话 open it folds everything, then
  // 全部展开 opens both sections and every project.
  await page.getByRole('button',{name:'全部折叠'}).click();
  await expect(page.getByRole('button',{name:'对话',exact:true})).toHaveAttribute('aria-expanded', 'false');
  await page.getByRole('button',{name:'全部展开'}).click();
  await expect(page.locator('.folder-name')).toHaveCount(3);
  await expect(page.getByRole('button',{name:'对话',exact:true})).toHaveAttribute('aria-expanded', 'true');
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
  // The card waits for the reader: it fades in (180 ms, --ease-enter, fill
  // backwards) and does not move while it does.
  const entering = await page.locator('.approval').evaluate((el) => new Promise((done) => {
    const seen = new Set();
    const t0 = performance.now();
    const tick = () => {
      seen.add(getComputedStyle(el).transform);
      if (performance.now() - t0 < 300) requestAnimationFrame(tick);
      else { const cs = getComputedStyle(el); done([cs.animationName, cs.animationDuration, cs.animationTimingFunction, cs.animationFillMode, [...seen]]); }
    };
    tick();
  }));
  assert.deepEqual(entering, ['fade', '0.18s', 'cubic-bezier(0, 0, 0.2, 1)', 'backwards', ['none']]);
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
  // A new conversation's project menu longer than the room it has scrolls
  // its own rows. It stays inside the conversation (it ran up under the title
  // bar), the wheel over it moves its rows and never the conversation behind
  // it (no jump-to-end button either), and the keys keep the row they reach
  // in view. Under glass it stays clear of the faded edges.
  for (const query of ['?chat&many', '?chat&many&glass']) {
    await page.goto(base + query);
    await settled('.welcome');
    const behind = page.locator('.mainwrap > main');
    const chatScroll = () => behind.evaluate((el) => ({top: el.scrollTop, room: el.scrollHeight - el.clientHeight, page: document.scrollingElement.scrollTop}));
    await page.getByRole('button',{name:'项目',exact:true}).click();
    const list = page.getByRole('menu');
    await expect(list).toBeVisible();
    await list.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const box = await list.boundingBox();
    const pane = await behind.boundingBox();
    const inset = query.includes('glass') ? 28 : 0;
    assert.ok(box.y >= pane.y + inset && box.y + box.height <= pane.y + pane.height - inset, `the project menu runs out of the conversation (${query}): ${JSON.stringify({box, pane})}`);
    assert.deepEqual(await chatScroll(), {top: 0, room: 0, page: 0}, `the project menu made the conversation longer (${query})`);
    assert.ok((await page.getByRole('menuitemradio').first().boundingBox()).height > 44, 'the two-line rows were squeezed');
    const listTop = () => list.evaluate((el) => el.scrollTop);
    const seen = (row) => row.evaluate((el) => {
      const m = el.closest('[role="menu"]').getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return r.top >= m.top && r.bottom <= m.bottom;
    });
    // It opens at the current project, the last one.
    const opened = await listTop();
    assert.ok(opened > 0 && await seen(page.getByRole('menuitemradio',{checked:true})), `the project menu did not open at the current project (${query})`);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -200);
    await expect.poll(listTop).toBeLessThan(opened);
    await page.mouse.wheel(0, -5000);
    await expect.poll(listTop).toBe(0);
    await page.mouse.wheel(0, -400);
    await page.mouse.wheel(0, 300);
    await expect.poll(listTop).toBeGreaterThan(0);
    await page.waitForTimeout(200);
    assert.deepEqual(await chatScroll(), {top: 0, room: 0, page: 0}, `the wheel over the project menu scrolled the conversation (${query})`);
    await expect(page.getByRole('button',{name:'滚动到底部'})).toHaveCount(0);
    await page.keyboard.press('End');
    const openFolder = page.getByRole('menuitem',{name:'打开文件夹…'});
    await expect(openFolder).toBeFocused();
    assert.ok(await seen(openFolder), 'End left the last row out of view');
    await page.keyboard.press('ArrowDown');
    const first = page.getByRole('menuitemradio').first();
    await expect(first).toBeFocused();
    assert.ok(await seen(first), 'ArrowDown round to the first row left it out of view');
    await page.keyboard.press('ArrowUp');
    await expect(openFolder).toBeFocused();
    assert.ok(await seen(openFolder), 'ArrowUp round to the last row left it out of view');
    await page.keyboard.press('Escape');
    await expect(list).toHaveCount(0);
  }
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
  assert.deepEqual([...new Set(await spaces())], ['12px'], 'the paragraphs of a streaming reply are spaced');
  await page.evaluate(() => window.__chat.handle({ type: 'status', message: 'ready' }));
  await expect(reply.locator('.stream')).toHaveCount(0);
  await expect(reply.locator('.md')).toHaveCount(32);
  await expect(reply.locator('.md').last()).toHaveText('Done.');
  assert.equal(await reply.locator('.md').first().getAttribute('data-seen'), '1', 'a paragraph rendered again as the reply ended');
  assert.deepEqual(await spaces(), [...Array(30).fill('12px'), '0px'], 'the paragraphs of a finished reply are spaced as one document');
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
  const heroAvatar = page.locator('.acct-profile .avatar img');
  await expect(heroAvatar).toHaveAttribute('src', kept);
  // The avatar itself is the button that changes it.
  await expect(page.locator('.acct-profile').getByRole('button',{name:'更换头像'})).toBeVisible();
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
  const avatarPicker = page.locator('.acct-profile input[type=file]');
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
  // reported blank margins at (1720 × 789, sidebar open at its 272px default
  // and the 1px divider: a 1447px pane; the fixture's conversation has the
  // turn rail, so 56px beside the column).
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
  await expectColumn(1085, '自适应, 1720 wide');
  await shell.evaluate(() => window.__prefs.setChatWidth('standard'));
  await expectColumn(844, '标准, 1720 wide');
  await shell.evaluate(() => window.__prefs.setChatWidth('full'));
  await expectColumn(1335, '铺满, 1720 wide');
  await shell.setViewportSize({width:1280,height:800});
  await expectColumn(895, '铺满, 1280 wide');
  await shell.evaluate(() => window.__prefs.setChatWidth('auto'));
  await expectColumn(844, '自适应, 1280 wide');
  await shell.setViewportSize({width:1040,height:680});
  await expectColumn(655, '自适应, the smallest window');
  await shell.close();
  // The plan and subagents cards (design.md, "Status, attention and
  // emphasis"): a turn at work with a 3/7 plan and four subagents of the
  // agent team (?shell&cards). At 1440 × 900 (a 1148px chat leaf) the column
  // moves left to leave 280px at its right and the cards sit there, clear of
  // the text; nothing about them sits on the composer's top edge.
  const cardsPage = await browser.newPage({viewport:{width:1440,height:900}});
  cardsPage.on('pageerror', e => errors.push(e.message));
  await cardsPage.goto(base + '?shell&cards');
  await expect(cardsPage.locator('.composer')).toBeVisible({timeout:30000});
  const cards = cardsPage.getByRole('region', {name:'计划和子智能体'});
  const planHead = cards.locator('.card.plan .head');
  const agentsHead = cards.locator('.card.agents .head');
  await expect(cardsPage.locator('.chatpane.beside')).toHaveCount(1);
  await expect(planHead).toHaveText(/计划\s*3\/7\s*·\s*跑单元测试/);
  await expect(agentsHead).toHaveText(/子智能体\s*4\s*·\s*2 个运行中/);
  const besideLayout = () => cardsPage.evaluate(() => {
    const main = document.querySelector('.chatpane main');
    const m = main.getBoundingClientRect();
    const cs = getComputedStyle(main);
    const left = m.left + parseFloat(cs.paddingLeft);
    const right = m.left + main.clientWidth - parseFloat(cs.paddingRight);
    const col = document.querySelector('[aria-label="计划和子智能体"]').getBoundingClientRect();
    // Where the transcript's visible text ends beside the cards (a code
    // block or a table scrolls sideways inside its own box: clipped there).
    const clip = (el) => { let right = Infinity; for (let a = el; a && a !== main; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') right = Math.min(right, a.getBoundingClientRect().right); return right; };
    let textRight = 0;
    const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const edge = clip(n.parentElement);
      for (const r of range.getClientRects()) if (r.width && r.left < edge && r.bottom > col.top && r.top < col.bottom) textRight = Math.max(textRight, Math.min(r.right, edge));
    }
    const composer = document.querySelector('.composer').getBoundingClientRect();
    const bottom = document.querySelector('.chatpane .bottom');
    return {
      column: [Math.round(left), Math.round(right - left)], composer: [Math.round(composer.left), Math.round(composer.width)],
      gap: Math.round(col.left - right), textRight: Math.round(textRight), cardsLeft: Math.round(col.left), cardsRight: Math.round(col.right),
      paneRight: Math.round(m.right), sideways: document.documentElement.scrollWidth - innerWidth,
      onComposer: bottom.textContent.includes('3/7') || !!bottom.querySelector('.tray, .bar'),
      h1: document.querySelectorAll('h1').length,
      decor: document.querySelectorAll('[aria-label="计划和子智能体"] svg circle, [aria-label="计划和子智能体"] .bead, [aria-label="计划和子智能体"] progress').length
    };
  });
  {
    const l = await besideLayout();
    assert.deepEqual(l.composer, l.column, 'the composer follows the column the cards moved');
    assert.ok(l.gap >= 16, `the cards sit ${l.gap}px from the column`);
    assert.ok(l.textRight <= l.cardsLeft, `transcript text runs under the cards (${l.textRight} > ${l.cardsLeft})`);
    assert.ok(l.paneRight - l.cardsRight >= 8, 'the cards stay inside the leaf');
    assert.equal(l.sideways, 0, 'the page scrolls sideways');
    assert.equal(l.onComposer, false, 'the plan shows on the composer\'s top edge');
    assert.equal(l.decor, 0, 'the cards draw a ring, a bar or beads');
    assert.ok(l.h1 <= 1, 'more than one h1');
  }
  // The checklist: done steps checked, the current one at 500 (the others
  // 400; 600 is for titles, design.md "Type"); each subagent
  // a 6px dot, its role, attempt, action and time; the team's tokens and board.
  const steps = cards.locator('.card.plan .step');
  await expect(steps).toHaveCount(7);
  await expect(cards.locator('.card.plan .step.done svg')).toHaveCount(3);
  const current = cards.locator('.card.plan .step.current');
  await expect(current).toHaveText(/跑单元测试/);
  const weightOf = (step) => step.locator('.text').evaluate((el) => Number(getComputedStyle(el).fontWeight));
  assert.equal(await weightOf(current), 500, 'the current step does not stand out at 500');
  assert.equal(await weightOf(steps.nth(4)), 400, 'a pending step is not at 400');
  await expect(current.locator('.owner')).toHaveText('worker-2');
  const worker = cards.locator('.agent', {has: cardsPage.getByRole('button', {name:'查看 worker-2 在做什么'})});
  await expect(worker).toContainText('编写 · #2');
  await expect(worker).toContainText('运行 pnpm vitest run src/lib/cache');
  await expect(worker.locator('.l1')).toContainText(/\d+m\d\ds/);
  assert.deepEqual(await worker.locator('.sdot').evaluate((el) => [getComputedStyle(el).width, getComputedStyle(el).height]), ['6px', '6px']);
  await expect(cards.locator('.card.agents .meta')).toContainText('182k / 400k tokens');
  await expect(cards.locator('.card.agents .meta')).toContainText('任务 2/4');
  // The team panel from the card's title line; a row opens its subagent.
  await cards.getByRole('button', {name:'打开工作组'}).click();
  await cardsPage.getByRole('button', {name:'查看 worker-2 在做什么'}).click();
  assert.deepEqual(await cardsPage.evaluate(() => window.__opened), ['team', 'agent:/root/worker-2:side']);
  await worker.getByRole('button', {name:'在新标签页打开'}).click({force:true});
  assert.equal(await cardsPage.evaluate(() => window.__opened.at(-1)), 'agent:/root/worker-2:tab');
  // Stopping an agent: its row action shows on hover, sends close_agent and
  // then waits for the agent to stop.
  const stop = worker.getByRole('button', {name:'停止 worker-2'});
  assert.equal(await worker.locator('.aacts').evaluate((el) => getComputedStyle(el).opacity), '0', 'the row actions show before hover');
  await worker.hover();
  await expect.poll(() => worker.locator('.aacts').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  await stop.click();
  await expect(worker.getByRole('img', {name:'正在停止'})).toBeVisible();
  assert.ok(await cardsPage.evaluate(() => '/root/worker-2' in window.__shellChat.stopRequested), 'close_agent was not sent');
  assert.deepEqual(await cardsPage.evaluate(() => window.__sent.filter((o) => o.op === 'close_agent')), [{op: 'close_agent', target: '/root/worker-2'}]);
  // A card collapses to its title line, by click or by keyboard (Tab to it,
  // Enter), and stays so for this session.
  await planHead.click();
  await expect(planHead).toHaveAttribute('aria-expanded', 'false');
  await expect(cards.locator('.card.plan .step')).toHaveCount(0);
  assert.deepEqual(await cardsPage.evaluate(() => JSON.parse(localStorage.getItem(`lynshen-progress-cards:${window.__shellSession}`) ?? 'null')), {plan: false});
  await agentsHead.focus();
  await cardsPage.keyboard.press('Shift+Tab');
  await expect(planHead).toBeFocused();
  assert.notEqual(await planHead.evaluate((el) => getComputedStyle(el).outlineStyle), 'none', 'no focus ring on the title line');
  await cardsPage.keyboard.press('Enter');
  await expect(planHead).toHaveAttribute('aria-expanded', 'true');
  await cardsPage.keyboard.press('Enter');
  await expect(planHead).toHaveAttribute('aria-expanded', 'false');
  // Row actions show on keyboard focus too.
  await agentsHead.focus();
  for (let i = 0; i < 12 && !(await worker.evaluate((el) => el.contains(document.activeElement))); i++) await cardsPage.keyboard.press('Tab');
  await expect.poll(() => worker.locator('.aacts').evaluate((el) => getComputedStyle(el).opacity)).toBe('1');
  // A step that fails expands the collapsed plan card, in the error color.
  await cardsPage.evaluate(() => window.__shellChat.handle({type: 'subagent_lifecycle', path: '/root/worker-2', status: 'failed', message: '3 个测试失败：cache.test.ts'}));
  await expect(planHead).toHaveAttribute('aria-expanded', 'true');
  const failed = cards.locator('.card.plan .step.failed');
  await expect(failed).toHaveText(/跑单元测试\s*worker-2 失败：3 个测试失败：cache\.test\.ts/);
  const errColor = await cardsPage.evaluate(() => { const p = document.createElement('p'); p.style.color = 'var(--err)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
  assert.equal(await failed.locator('.text').evaluate((el) => getComputedStyle(el).color), errColor, 'a failed step is not in --err');
  await expect(planHead.locator('.what.err')).toHaveText('跑单元测试');
  await cardsPage.close();

  // Narrower leaves: 1100 × 760, 1040 × 680, and 1440 × 900 with a tool leaf
  // beside the chat. Each card is its title line at the top right, on a
  // strip above the transcript; a click opens it as a solid popover over the
  // transcript, closed by Escape (focus back on its title line) or a click
  // outside; Tab goes from the title line into it.
  for (const [w, h, query] of [[1100, 760, '?shell&cards'], [1040, 680, '?shell&cards'], [1440, 900, '?shell&cards&tool']]) {
    const what = `${w} × ${h}${query.includes('tool') ? ' with a tool leaf' : ''}`;
    const p = await browser.newPage({viewport:{width:w,height:h}});
    p.on('pageerror', e => errors.push(e.message));
    await p.goto(base + query);
    await expect(p.locator('.composer')).toBeVisible({timeout:30000});
    const strip = p.getByRole('region', {name:'计划和子智能体'});
    await expect(p.locator('.chatpane.beside'), what).toHaveCount(0);
    await expect(strip.locator('.tline'), what).toHaveCount(2);
    const planLine = strip.locator('.tline').first();
    await expect(planLine).toHaveText(/计划\s*3\/7\s*·\s*跑单元测试/);
    const geo = () => p.evaluate(() => {
      const pane = document.querySelector('.chatpane').getBoundingClientRect();
      const s = document.querySelector('[aria-label="计划和子智能体"]').getBoundingClientRect();
      const lines = [...document.querySelectorAll('.tline')].map((el) => el.getBoundingClientRect());
      const main = document.querySelector('.chatpane main').getBoundingClientRect();
      const pop = document.querySelector('.cardpop')?.getBoundingClientRect();
      const fill = document.querySelector('.cardpop') ? getComputedStyle(document.querySelector('.cardpop')).backgroundColor : '';
      const stripFill = getComputedStyle(document.querySelector('.strip')).backgroundColor;
      return {
        paneRight: Math.round(pane.right), paneLeft: Math.round(pane.left), stripBottom: Math.round(s.bottom), mainTop: Math.round(main.top),
        lastRight: Math.round(Math.max(...lines.map((r) => r.right))), firstLeft: Math.round(Math.min(...lines.map((r) => r.left))),
        pop: pop && [Math.round(pop.left), Math.round(pop.top), Math.round(pop.right), Math.round(pop.bottom)], fill, stripFill,
        sideways: document.documentElement.scrollWidth - innerWidth, h1: document.querySelectorAll('h1').length
      };
    });
    let g = await geo();
    assert.ok(g.paneRight - g.lastRight <= 12, `${what}: the title lines are not at the top right`);
    assert.ok(g.firstLeft > (g.paneLeft + g.paneRight) / 2 - 200, `${what}: the title lines spread left`);
    assert.ok(g.stripBottom <= g.mainTop, `${what}: the strip covers the transcript`);
    assert.ok(!/rgba\(.*, 0(\.\d+)?\)$/.test(g.stripFill), `${what}: the strip is not opaque (${g.stripFill})`);
    assert.equal(g.sideways, 0, `${what}: the page scrolls sideways`);
    assert.ok(g.h1 <= 1, `${what}: more than one h1`);
    await planLine.click();
    const pop = p.getByRole('dialog').filter({has: p.locator('.step')});
    await expect(pop).toBeVisible();
    await expect(pop.locator('.step')).toHaveCount(7);
    g = await geo();
    assert.match(g.fill, /^rgb\(/, `${what}: the popover is not solid (${g.fill})`);
    assert.ok(g.pop[0] >= g.paneLeft && g.pop[2] <= g.paneRight && g.pop[3] <= h, `${what}: the popover leaves the chat leaf ${JSON.stringify(g)}`);
    assert.ok(g.pop[1] >= g.stripBottom, `${what}: the popover covers its title line`);
    await p.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    // A click outside closes it.
    await planLine.click();
    await expect(pop).toBeVisible();
    await p.locator('.chatpane main').click({position:{x:40, y:200}});
    await expect(pop).toHaveCount(0);
    // Keyboard: Enter opens, Tab goes into it, Escape closes it and gives
    // the focus back to the title line.
    await planLine.focus();
    await p.keyboard.press('Enter');
    await expect(pop).toBeVisible();
    await expect(planLine).toHaveAttribute('aria-expanded', 'true');
    await p.keyboard.press('Tab');
    assert.ok(await pop.evaluate((el) => el.contains(document.activeElement)), `${what}: Tab does not go into the popover`);
    await p.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    await expect(planLine).toBeFocused();
    // The subagents popover: a row opens its subagent and closes nothing else;
    // stopping an agent is its row action.
    const agentsLine = strip.locator('.tline').last();
    await agentsLine.click();
    const apop = p.getByRole('dialog').filter({has: p.locator('.agent')});
    await expect(apop.locator('.agent')).toHaveCount(4);
    await expect(apop.getByRole('button', {name:'打开工作组'})).toBeVisible();
    const row = apop.locator('.agent', {has: p.getByRole('button', {name:'查看 worker-2 在做什么'})});
    await row.hover();
    await row.getByRole('button', {name:'停止 worker-2'}).click();
    await expect(row.getByRole('img', {name:'正在停止'})).toBeVisible();
    await apop.getByRole('button', {name:'查看 worker-1 在做什么'}).click();
    assert.equal(await p.evaluate(() => window.__opened.at(-1)), 'agent:/root/worker-1:side');
    await p.keyboard.press('Escape');
    await expect(apop).toHaveCount(0);
    // A step that waits for the reader opens the plan popover by itself;
    // Escape closes the popover first and leaves the approval waiting.
    await p.evaluate(() => window.__shellChat.handle({type: 'subagent_lifecycle', path: '/root/worker-2', status: 'running', message: '等待确认'}));
    await p.evaluate(() => window.__shellChat.handle({type: 'approval_request', call_id: 'c9', name: 'shell', summary: 'pnpm vitest run', subagent_id: '/root/worker-2', scopes: ['session']}));
    await expect(pop).toBeVisible();
    await expect(pop.locator('.step.waiting')).toHaveText(/跑单元测试\s*等你确认/);
    await expect(planLine.locator('.dot.warn')).toHaveCount(1);
    await p.keyboard.press('Escape');
    await expect(pop).toHaveCount(0);
    assert.ok(await p.evaluate(() => !!window.__shellChat.pendingApproval), `${what}: Escape over the popover answered the approval`);
    await p.close();
  }

  // The phone page: the cards' title lines as chips under the header; a tap
  // opens one as a sheet from the bottom, closed by Escape or the scrim; a
  // subagent row opens its conversation.
  const cardsPhone = await browser.newPage({viewport:{width:390,height:844}});
  cardsPhone.on('pageerror', e => errors.push(e.message));
  await cardsPhone.goto(base + '?remote&cards');
  const chips = cardsPhone.getByRole('region', {name:'计划和子智能体'});
  await expect(chips.locator('.chip')).toHaveCount(2, {timeout:30000});
  await expect(chips.locator('.chip').first()).toHaveText(/计划\s*3\/7\s*·\s*跑单元测试/);
  assert.ok(await cardsPhone.evaluate(() => document.querySelector('.chips').getBoundingClientRect().top >= document.querySelector('.session > header').getBoundingClientRect().bottom), 'the chips are not under the header');
  await chips.locator('.chip').first().click();
  const sheet = cardsPhone.locator('.sheet[role="dialog"]');
  await expect(sheet.locator('.step')).toHaveCount(7);
  await cardsPhone.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await chips.locator('.chip').last().click();
  await expect(sheet.locator('.agent')).toHaveCount(3);
  await sheet.getByRole('button', {name:'查看 worker-2 在做什么'}).click();
  await expect(sheet).toHaveCount(0);
  await expect(cardsPhone.locator('.trace-sheet')).toBeVisible();
  assert.equal(await cardsPhone.evaluate(() => document.documentElement.scrollWidth - innerWidth), 0, 'the phone page scrolls sideways');
  await cardsPhone.close();
  // Outside the window, how many conversations wait for the user: "(2) "
  // before the window's title, and the Dock badge, or on Windows an overlay
  // icon on the taskbar button (a 32px image the page draws). All clear
  // once nothing waits.
  for (const os of ['macos', 'windows']) {
    const w = await browser.newPage();
    w.on('pageerror', e => errors.push(e.message));
    await w.addInitScript((os) => { const set = () => document.documentElement && (document.documentElement.dataset.os = os); set(); document.addEventListener('readystatechange', set); }, os);
    await w.goto(base + '?shell&states');
    await expect(w.locator('.composer')).toBeVisible({timeout:30000});
    const outside = () => w.evaluate(() => window.__calls.filter((c) => /set_title|set_badge_count|set_overlay_icon|image\|new/.test(c.command)).map((c) => [c.command.replace('plugin:window|', '').replace('plugin:', ''), c.args.rgba ? c.args.rgba.length : c.args.value ?? null]));
    await expect(w).toHaveTitle('(2) Aogiri');
    await expect.poll(outside).toEqual(os === 'macos' ? [['set_title', '(2) Aogiri'], ['set_badge_count', 2]] : [['set_title', '(2) Aogiri'], ['image|new', 32 * 32 * 4], ['set_overlay_icon', null]]);
    const before = (await outside()).length;
    await w.evaluate(() => { for (const s of window.__shellStore.allSessions) { const a = s.chat.pendingApproval; if (a) s.chat.handle({ type: 'tool_output', call_id: a.callId, name: a.name, output: 'ok' }); } });
    await expect(w).toHaveTitle('Aogiri');
    await expect.poll(async () => (await outside()).slice(before)).toEqual([['set_title', 'Aogiri'], [os === 'macos' ? 'set_badge_count' : 'set_overlay_icon', null]]);
    await w.close();
  }
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
  assert.deepEqual(await frostState(mac), {root: null, sidebar: 'rgb(20, 20, 20)', stored: [2, false], told: [false]});
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
  // A conversation at work: no spinner in the navigator; a light sweeps its
  // title, every title on one clock (startTime 0) and at the same point of
  // the sweep. Reduced motion stops it, dim; under the window frost the
  // title breathes instead.
  const sweep = (p) => p.evaluate(() => {
    const titles = [...document.querySelectorAll('aside .sess-title.running')];
    const veils = titles.map((t) => t.querySelector('.veil')).filter(Boolean);
    return {
      rows: titles.length,
      veils: veils.length,
      spinners: document.querySelectorAll('aside .sess .spin').length,
      clocks: [...new Set(veils.flatMap((v) => v.getAnimations().map((a) => a.startTime)))],
      phases: [...new Set(veils.map((v) => (new DOMMatrix(getComputedStyle(v).transform).e / v.offsetWidth).toFixed(2)))],
      shown: veils.filter((v) => getComputedStyle(v).display !== 'none').length,
      breathing: titles.filter((t) => getComputedStyle(t).animationName !== 'none').length
    };
  });
  const busyNav = await frosted('?shell&busy=6&states', {version: 2});
  await expect.poll(async () => (await sweep(busyNav)).rows).toBeGreaterThan(6);
  const swept = await sweep(busyNav);
  assert.deepEqual({...swept, rows: 0, phases: swept.phases.length}, {rows: 0, veils: swept.rows, spinners: 0, clocks: [0], phases: 1, shown: swept.rows, breathing: 0});
  await busyNav.emulateMedia({reducedMotion: 'reduce'});
  await expect.poll(async () => (await sweep(busyNav)).clocks).toEqual([]);
  assert.deepEqual((await sweep(busyNav)).phases, ['-0.60']);
  await busyNav.close();
  const busyFrost = await frosted('?shell&busy=6&states&frost=vibrancy', {version: 2, sidebarVibrancy: true});
  await expect.poll(async () => (await frostState(busyFrost)).root).toBe('on');
  const breathed = await sweep(busyFrost);
  assert.deepEqual([breathed.shown, breathed.clocks, breathed.breathing === breathed.rows, breathed.rows > 6], [0, [], true, true]);
  await busyFrost.close();
  // 对话 by state: 等你处理 / 进行中 / 已完成 with their counts. A state change
  // restyles the row at once and moves it to the top of its new group (a
  // transform that ends with nothing kept, the row above the others); with
  // the pointer in the list it only restyles, and moves once the pointer
  // leaves. Reduced motion: no movement. The toolbar switches to the time
  // order and keeps the choice.
  const groups = await browser.newPage({viewport: {width: 1280, height: 800}});
  groups.on('pageerror', e => errors.push(e.message));
  await groups.goto(base + '?shell&states&busy=3');
  await expect(groups.locator('aside .ghead').first()).toBeVisible({timeout:30000});
  await groups.mouse.move(900, 400);
  const chatList = () => groups.evaluate(() => {
    const sec = [...document.querySelectorAll('aside .list > section')].find((s) => s.querySelector('.item'));
    return [...sec.querySelectorAll(':scope .item')].map((it) => it.querySelector('.ghead')?.textContent.replace(/\s+/g, '') ?? it.querySelector('.sess-title').textContent.trim());
  });
  const stateOf = (title, ev) => groups.evaluate(({title, ev}) => window.__shellStore.allSessions.find((x) => x.chat.title === title).chat.handle(ev), {title, ev});
  const moving = (title) => groups.evaluate((title) => new Promise((done) => {
    const sec = [...document.querySelectorAll('aside .list > section')].find((s) => s.querySelector('.item'));
    const el = [...sec.querySelectorAll(':scope .item')].find((it) => it.querySelector('.sess-title')?.textContent.trim() === title);
    const seen = [];
    const t0 = performance.now();
    const tick = () => {
      const cs = getComputedStyle(el);
      seen.push([cs.transform !== 'none', cs.zIndex]);
      if (performance.now() - t0 < 600) requestAnimationFrame(tick);
      else done({moved: seen.some(([m]) => m), lifted: seen.some(([, z]) => z === '2'), after: [getComputedStyle(el).transform, el.getAnimations().length]});
    };
    tick();
  }), title);
  assert.deepEqual((await chatList()).filter((x) => x.startsWith('等你处理') || x.startsWith('进行中') || x.startsWith('已完成')), ['等你处理3', '进行中4', '已完成1']);
  const finishing = moving('浅色主题调色');
  await stateOf('浅色主题调色', {type: 'status', message: 'ready'});
  assert.deepEqual(await finishing, {moved: true, lifted: true, after: ['none', 0]});
  const settledList = await chatList();
  assert.deepEqual(settledList.slice(settledList.indexOf('已完成2')), ['已完成2', '浅色主题调色', '对话宽度跟随窗口']);
  await groups.mouse.move(100, 300);
  await stateOf('对话宽度跟随窗口', {type: 'status', message: 'streaming'});
  await expect(groups.locator('aside .item', {hasText: '对话宽度跟随窗口'}).first().locator('.sess-title.running')).toHaveCount(1);
  assert.deepEqual((await chatList()).slice(-2), ['浅色主题调色', '对话宽度跟随窗口']);
  await groups.mouse.move(900, 400);
  await expect.poll(async () => (await chatList()).indexOf('对话宽度跟随窗口')).toBe((await chatList()).indexOf('进行中4') + 1);
  // (Once the rows making room have landed.)
  await groups.waitForFunction(() => [...document.querySelectorAll('aside .item')].every((it) => !it.getAnimations().length));
  // A row's menu open holds the order too, with the pointer anywhere; it
  // opens where it was asked for (no moving row around it), and the order
  // catches up once it closes.
  await groups.locator('aside .sess', {hasText: '设置页搜索'}).first().click({button: 'right'});
  const rowMenu = groups.getByRole('dialog', {name: '外观'});
  await expect(rowMenu).toBeVisible();
  await groups.mouse.move(900, 400);
  const heldOrder = await chatList();
  await stateOf('对话列表虚拟滚动', {type: 'status', message: 'ready'});
  await groups.waitForTimeout(500);
  assert.deepEqual(await chatList(), heldOrder.map((x) => x.replace(/^进行中(\d+)$/, (_, n) => `进行中${n - 1}`).replace(/^已完成(\d+)$/, (_, n) => `已完成${Number(n) + 1}`)));
  await groups.keyboard.press('Escape');
  await expect(rowMenu).toHaveCount(0);
  await expect.poll(async () => { const l = await chatList(); return l.indexOf('对话列表虚拟滚动') - l.findIndex((x) => x.startsWith('已完成')); }).toBe(1);
  await groups.waitForFunction(() => [...document.querySelectorAll('aside .item')].every((it) => !it.getAnimations().length));
  await groups.emulateMedia({reducedMotion: 'reduce'});
  const still = moving('设置页搜索');
  await stateOf('设置页搜索', {type: 'status', message: 'ready'});
  assert.deepEqual(await still, {moved: false, lifted: false, after: ['none', 0]});
  await groups.getByRole('button', {name: '对话按状态分组'}).click();
  await expect(groups.locator('aside .ghead')).toHaveCount(0);
  assert.equal(await groups.evaluate(() => localStorage.getItem('lynshen-sidebar-order')), 'time');
  await groups.reload();
  await expect(groups.locator('aside .sess').first()).toBeVisible({timeout:30000});
  await expect(groups.locator('aside .ghead')).toHaveCount(0);
  await expect(groups.getByRole('button', {name: '对话按状态分组'})).toHaveAttribute('aria-pressed', 'false');
  await groups.close();
  // Sub-agents under their conversation: while its turn runs sub-agents,
  // the running and just finished ones list under its row (26px, 14px in, on
  // a tree line), four at most, then 还有 N 个. They fade in and settle 4px,
  // after 80ms and then 120ms apart, while the rows below make room; the
  // pointer in the list holds them like a move. Done, one turns --text at
  // 500 in place. They move with their conversation when it changes group,
  // and fold once its turn is over (&stay for the 30 s), the rows below
  // moving up. Nothing is kept on a row. A click (or Enter) opens a
  // sub-agent's page, 还有 N 个 the conversation. Reduced motion: no
  // movement; the rail lists none.
  const subs = await browser.newPage({viewport: {width: 1280, height: 800}});
  subs.on('pageerror', e => errors.push(e.message));
  await subs.goto(base + '?shell&busy=3&subagents=0&stay=1500');
  await expect(subs.locator('aside .ghead').first()).toBeVisible({timeout:30000});
  await subs.mouse.move(900, 400);
  const subList = () => subs.evaluate(() => {
    const sec = [...document.querySelectorAll('aside .list > section')].find((s) => s.querySelector('.item'));
    return [...sec.querySelectorAll(':scope .item')].map((it) => (it.classList.contains('under') ? '└' : '') + (it.querySelector('.ghead')?.textContent.replace(/\s+/g, '') ?? it.querySelector('.sess-title, .sub-title').textContent.trim()));
  });
  const subParent = '窗口磨砂默认关闭';
  const subsOf = (list) => { const out = []; for (let j = list.indexOf(subParent) + 1; j < list.length && list[j].startsWith('└'); j++) out.push(list[j].slice(1)); return out; };
  const subSettled = () => subs.waitForFunction(() => [...document.querySelectorAll('aside .item')].every((it) => !it.getAnimations().length));
  const subKept = () => subs.evaluate(() => [...document.querySelectorAll('aside .item')].filter((it) => getComputedStyle(it).transform !== 'none' || it.getAnimations().length).length);
  // A token's computed colour, to compare with an element's.
  const subToken = (name) => subs.evaluate((name) => { const i = document.createElement('i'); i.style.color = `var(${name})`; document.body.append(i); const c = getComputedStyle(i).color; i.remove(); return c; }, name);
  assert.deepEqual(subsOf(await subList()), []);
  // (Svelte waits out a transition's delay in an animation of its own, as long as the delay.)
  const subSpawned = await subs.evaluate(() => new Promise((done) => {
    for (let i = 1; i <= 3; i++) window.__subagent(i);
    requestAnimationFrame(() => requestAnimationFrame(() => done({
      delays: [...document.querySelectorAll('aside .item.under')].map((it) => it.getAnimations()[0]?.effect.getTiming().duration),
      making: [...document.querySelectorAll('aside .item:not(.under)')].filter((it) => it.getAnimations().length).length
    })));
  }));
  assert.deepEqual(subSpawned.delays, [80, 200, 320]);
  assert.ok(subSpawned.making >= 6, `${subSpawned.making} rows make room`);
  const subFade = await subs.evaluate(() => new Promise((done) => setTimeout(() => {
    const a = document.querySelector('aside .item.under').getAnimations()[0];
    const k = a.effect.getKeyframes();
    done([a.effect.getTiming().duration, k[0].opacity, k[0].transform, k.at(-1).opacity, k.at(-1).transform]);
  }, 140)));
  assert.deepEqual(subFade, [240, '0', 'translateY(-4px)', '1', 'translateY(0px)']);
  await subSettled();
  assert.equal(await subKept(), 0);
  assert.deepEqual(subsOf(await subList()), ['读缓存层的代码', '改 SessionCache 和调用方', '跑单元测试']);
  const subLook = await subs.evaluate(() => {
    const items = [...document.querySelectorAll('aside .item.under')];
    const parentRow = document.querySelector('aside .item .sess.on');
    const line = getComputedStyle(items[0], '::before');
    const veils = items.map((it) => it.querySelector('.sub-title.running .veil')).filter(Boolean);
    return {
      heights: items.map((it) => it.getBoundingClientRect().height),
      indent: items[0].querySelector('.sub').getBoundingClientRect().left - parentRow.getBoundingClientRect().left,
      line: [line.width, line.backgroundColor, line.left],
      clocks: [...new Set(veils.flatMap((v) => v.getAnimations().map((a) => a.startTime)))],
      veils: veils.length
    };
  });
  const subLine = await subs.evaluate(() => { const i = document.createElement('i'); i.style.background = 'var(--border-strong)'; document.body.append(i); const c = getComputedStyle(i).backgroundColor; i.remove(); return c; });
  assert.deepEqual(subLook, {heights: [26, 26, 26], indent: 14, line: ['1px', subLine, '11px'], clocks: [0], veils: 3});
  // The pointer in the list: a new one waits (it would move the rows below),
  // and comes in once the pointer leaves.
  await subs.mouse.move(100, 300);
  await subs.evaluate(() => window.__subagent(4));
  await subs.waitForTimeout(400);
  assert.deepEqual(subsOf(await subList()), ['读缓存层的代码', '改 SessionCache 和调用方', '跑单元测试']);
  await subs.mouse.move(900, 400);
  await expect.poll(async () => subsOf(await subList()).length).toBe(4);
  await subs.evaluate(() => { window.__subagent(5); window.__subagent(6); });
  await expect.poll(async () => subsOf(await subList())).toEqual(['读缓存层的代码', '改 SessionCache 和调用方', '跑单元测试', '审查改动', '还有 2 个']);
  await subSettled();
  // Done: --text at 500, at once and in place.
  const subDoneAt = await subs.evaluate(() => document.querySelector('aside .sub[data-agent="/root/agent-1"]').getBoundingClientRect().top);
  await subs.evaluate(() => window.__subagent(1, 'completed'));
  const subDone = await subs.evaluate(() => {
    const b = document.querySelector('aside .sub[data-agent="/root/agent-1"]');
    const t = b.querySelector('.sub-title');
    // (A transition of the text colour: `color` or `all`, for a time.)
    const fades = (el) => { const cs = getComputedStyle(el); const times = cs.transitionDuration.split(', '); return cs.transitionProperty.split(', ').some((p, i) => (p === 'color' || p === 'all') && parseFloat(times[i % times.length]) > 0); };
    return {weight: getComputedStyle(t).fontWeight, color: getComputedStyle(t).color, veil: !!t.querySelector('.veil'), top: b.getBoundingClientRect().top, moves: b.closest('.item').getAnimations().length, colorTransition: fades(b) || fades(t)};
  });
  assert.deepEqual(subDone, {weight: '500', color: await subToken('--text'), veil: false, top: subDoneAt, moves: 0, colorTransition: false});
  await expect(subs.getByRole('button', {name: '「窗口磨砂默认关闭」的子智能体 读缓存层的代码，已完成。打开它的会话'})).toHaveCount(1);
  // A click opens its page; Enter on a focused one too; 还有 N 个 opens the conversation.
  await subs.getByRole('button', {name: '「窗口磨砂默认关闭」的子智能体 跑单元测试，运行中。打开它的会话'}).click();
  await subs.getByRole('button', {name: /的子智能体 改 SessionCache 和调用方/}).focus();
  await subs.keyboard.press('Enter');
  await subs.getByRole('button', {name: '「窗口磨砂默认关闭」还有 2 个子智能体，打开对话查看'}).click();
  const subParentId = await subs.evaluate(() => window.__shellSession);
  assert.deepEqual((await subs.evaluate(() => window.__opened)).slice(-3), ['agent:/root/agent-3:side', 'agent:/root/agent-2:side', `select:${subParentId}`]);
  await subs.mouse.move(900, 400);
  await subSettled();
  // The turn ends: the conversation moves to 已完成 with its sub-agents (all
  // above the rows they pass), then they fold and the rows below move up.
  const subCarry = subs.evaluate(() => new Promise((done) => {
    const seen = new Map();
    const t0 = performance.now();
    const tick = () => {
      for (const it of document.querySelectorAll('aside .item')) {
        const key = it.classList.contains('under') ? 'under' : it.querySelector('.sess.on') ? 'parent' : 'rows';
        const cs = getComputedStyle(it);
        const s = seen.get(key) ?? {moved: false, lifted: false, faded: false};
        s.moved ||= cs.transform !== 'none';
        s.lifted ||= cs.zIndex === '2';
        s.faded ||= it.classList.contains('under') && Number(cs.opacity) < 1;
        seen.set(key, s);
      }
      if (performance.now() - t0 < 700) requestAnimationFrame(tick);
      else done(Object.fromEntries(seen));
    };
    tick();
  }));
  await subs.evaluate(() => { for (let i = 2; i <= 6; i++) window.__subagent(i, 'completed'); window.__shellChat.handle({type: 'status', message: 'ready'}); });
  const subCarried = await subCarry;
  assert.deepEqual([subCarried.parent, subCarried.under], [{moved: true, lifted: true, faded: false}, {moved: true, lifted: true, faded: false}]);
  const subEnded = await subList();
  assert.equal(subEnded.indexOf(subParent), subEnded.findIndex((x) => x.startsWith('已完成')) + 1);
  assert.deepEqual(subsOf(subEnded), ['读缓存层的代码', '改 SessionCache 和调用方', '跑单元测试', '审查改动', '还有 2 个']);
  await subSettled();
  const subFolding = await subs.evaluate(() => new Promise((done) => {
    const below = [...document.querySelectorAll('aside .item')].findLast((it) => it.classList.contains('under')).nextElementSibling;
    const seen = {faded: false, rowsUp: false};
    const t0 = performance.now();
    const tick = () => {
      for (const it of document.querySelectorAll('aside .item.under')) seen.faded ||= Number(getComputedStyle(it).opacity) < 1;
      seen.rowsUp ||= below.isConnected && getComputedStyle(below).transform !== 'none';
      if (performance.now() - t0 > 4000) return done({...seen, timeout: true});
      if (document.querySelector('aside .item.under') || performance.now() - t0 < 300) requestAnimationFrame(tick);
      else done(seen);
    };
    tick();
  }));
  assert.deepEqual(subFolding, {faded: true, rowsUp: true});
  await subSettled();
  assert.equal(await subKept(), 0);
  assert.deepEqual(subsOf(await subList()), []);
  // The time order lists them under their conversation too.
  await subs.evaluate(() => { window.__shellChat.handle({type: 'connecting'}); window.__shellChat.handle({type: 'status', message: 'streaming'}); window.__subagent(7); window.__subagent(8); });
  await subs.getByRole('button', {name: '对话按状态分组'}).click();
  await expect(subs.locator('aside .ghead')).toHaveCount(0);
  await expect.poll(async () => subsOf(await subList())).toEqual(['对比基准', '整理提交说明']);
  await subs.getByRole('button', {name: '对话按状态分组'}).click();
  await subSettled();
  // Reduced motion: they come and go at once, and nothing moves.
  await subs.emulateMedia({reducedMotion: 'reduce'});
  const subStill = await subs.evaluate(() => new Promise((done) => {
    window.__subagent(9);
    requestAnimationFrame(() => requestAnimationFrame(() => done([document.querySelectorAll('aside .item.under').length, [...document.querySelectorAll('aside .item')].filter((it) => it.getAnimations().length).length])));
  }));
  assert.deepEqual(subStill, [3, 0]);
  await subs.evaluate(() => { for (let i = 7; i <= 9; i++) window.__subagent(i, 'completed'); window.__shellChat.handle({type: 'status', message: 'ready'}); });
  await expect(subs.locator('aside .item.under')).toHaveCount(0, {timeout: 4000});
  assert.equal(await subKept(), 0);
  await subs.emulateMedia({reducedMotion: 'no-preference'});
  // Collapsed to the rail: none, also while the navigator peeks.
  await subs.evaluate(() => { window.__shellChat.handle({type: 'connecting'}); window.__subagent(10); });
  await expect(subs.locator('aside .item.under')).toHaveCount(1);
  await subs.locator('.titlebar').getByRole('button', {name: '收起侧栏'}).click();
  await expect(subs.locator('aside .item.under')).toHaveCount(0);
  await subs.mouse.move(24, 400);
  await subs.waitForTimeout(500);
  await expect(subs.locator('aside .item.under')).toHaveCount(0);
  await subs.mouse.move(900, 400);
  await subs.locator('.titlebar').getByRole('button', {name: '展开侧栏'}).click();
  await expect(subs.locator('aside .item.under')).toHaveCount(1);
  await subs.close();
  // The light theme's canvas is an off-white, the sidebar a step darker and
  // the composer a step lighter; the page never paints white. (Glass off:
  // with it the composer lets the canvas through.)
  const light = await browser.newPage();
  light.on('pageerror', e => errors.push(e.message));
  await light.addInitScript(() => localStorage.setItem('lynshen-prefs', JSON.stringify({version: 2, glass: 0})));
  await light.goto(base + '?shell&theme=light');
  await expect(light.locator('.composer')).toBeVisible({timeout:30000});
  const fill = (sel) => light.evaluate((sel) => getComputedStyle(document.querySelector(sel)).backgroundColor, sel);
  assert.deepEqual([await fill('body'), await fill('.sidebar'), await fill('.composer')], ['rgb(246, 245, 242)', 'rgb(240, 239, 235)', 'rgb(251, 250, 248)']);
  await light.close();
  // The work status line: one sign, the step in words (a verb and what it
  // acts on), how long it has taken, and › to the running call. A command
  // keeps its name after lynshen's updates replace "started: <command>"; a
  // run of calls opens, and a card the reader folded opens again.
  const work = await browser.newPage();
  work.on('pageerror', e => errors.push(e.message));
  const statusLine = () => work.evaluate(() => {
    const el = document.querySelector('.ind');
    return el && {text: el.textContent.replace(/\s+/g, ' ').trim(), signs: el.querySelectorAll('.sign').length, spin: getComputedStyle(el.querySelector('.sign')).animationName, more: !!el.querySelector('.more')};
  });
  await work.goto(base + '?shell&work=group');
  await expect(work.locator('.ind')).toBeVisible({timeout:30000});
  const workLine = await statusLine();
  assert.match(workLine.text, /^正在运行 pnpm vitest run src\/lib\/cache\.test\.ts · \d+s$/);
  assert.deepEqual([workLine.signs, workLine.spin, workLine.more], [1, 'spin', true]);
  await expect(work.locator('.tgroup.open')).toHaveCount(0);
  await work.locator('.ind .more').click();
  await expect(work.locator('.tgroup.open')).toHaveCount(1);
  const runningCard = work.locator('.tool').last();
  await expect(runningCard.locator('.collapse.open')).toHaveCount(1);
  await runningCard.locator('.head').click();
  await expect(runningCard.locator('.collapse')).toHaveCount(0);
  await work.locator('.ind .more').click();
  await expect(runningCard.locator('.collapse.open')).toHaveCount(1);
  for (const [step, text] of [['read', /^正在读取 cache\.ts · \d+s$/], ['think', /^正在思考 · \d+s$/], ['write', /^正在写回复 · \d+s$/], ['mcp', /^正在调用 create_issue · \d+s$/]]) {
    await work.goto(base + '?shell&work=' + step);
    await expect(work.locator('.ind')).toBeVisible({timeout:30000});
    assert.match((await statusLine()).text, text, step);
    assert.equal((await statusLine()).more, step === 'read' || step === 'mcp', step);
  }
  await work.close();
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
  // A model picked for a new conversation sets the context gauge to that
  // model's window. It kept the window of the model the backend ran last:
  // GPT-6 Sol's 92.2万 beside DeepSeek V4.1 Flash, which the user's own
  // provider limits to 400K (ticket #34).
  await page.evaluate(() => {
    const efforts = ['none', 'low', 'medium', 'high'];
    const relay = [['deepseek-v4.1-flash', 400000], ['glm-5.3', 500000]];
    localStorage.setItem('lynshen-prefs', JSON.stringify({ ...JSON.parse(localStorage.getItem('lynshen-prefs') ?? '{}'), footContext: true }));
    localStorage.setItem('lynshen-backend-profiles', JSON.stringify({ lynshen: {
      provider: 'lynshen-relay', model: 'gpt-6-sol', modelLabel: 'GPT-6 Sol', effort: 'low', efforts, contextWindow: 922000,
      catalog: [
        { model: 'gpt-6-sol', label: 'GPT-6 Sol', active: true, context_window: 922000, max_output_tokens: 128000, reasoning_efforts: efforts },
        ...relay.map(([model, window]) => ({ model, active: false, context_window: window, max_output_tokens: 8192, reasoning_efforts: efforts }))
      ]
    } }));
  });
  await page.goto(base + '?chat');
  await settled('.welcome');
  const ring = page.locator('.composer-wrap .ctxwrap .ring-btn');
  await expect(ring).toHaveAttribute('aria-label', '上下文容量 0/92.2万');
  await page.locator('.composer-wrap .fbtn.model').click();
  await page.locator('.pop.mm .mline').filter({ hasText: 'DeepSeek V4.1 Flash' }).first().click();
  await expect(page.locator('.composer-wrap .fbtn.model')).toHaveText('DeepSeek V4.1 Flash');
  await expect(ring).toHaveAttribute('aria-label', '上下文容量 0/40万');
  await page.evaluate(() => localStorage.removeItem('lynshen-backend-profiles'));
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
  // The end of a turn hands control back (?shell&recap): a card above the
  // composer with 本轮完成, the result (the turn's changes and its last
  // paragraph), a question, the engine's suggestion as the one primary
  // button, 暂不 and ×; the keys only in the tooltips. It fades in (180 ms,
  // opacity only, fill backwards) and the composer stops offering the
  // suggestion. ⌘↵ (Ctrl+↵) in the empty composer sends it; the card closes
  // its height and leaves a receipt under the reply. Esc closes it, no
  // receipt, but not while the composer has text or its menu is open.
  const recapPage = await browser.newPage();
  recapPage.on('pageerror', e => errors.push(e.message));
  const openRecap = async (q) => { await recapPage.goto(base + q); await expect(recapPage.locator('.recap')).toBeVisible({timeout:30000}); };
  const recapCard = recapPage.locator('.recap');
  const recapGo = recapCard.locator('.go button');
  const recapEditor = recapPage.locator('.composer [contenteditable]').first();
  const recapHint = recapPage.locator('.composer [data-placeholder]');
  await openRecap('?shell&recap');
  assert.deepEqual(await recapCard.evaluate((el) => { const cs = getComputedStyle(el); return [cs.animationName, cs.animationDuration, cs.animationFillMode, cs.transform, cs.filter]; }), ['fade', '0.18s', 'backwards', 'none', 'none']);
  await expect(recapCard.locator('.title')).toHaveText('本轮完成');
  await expect(recapCard.locator('.result')).toHaveText('改了 3 个文件，+42 −7。缓存已按会话分片：每个会话一份键空间，旧缓存在启动时迁移。12 个单元测试全部通过。');
  await expect(recapCard.locator('.ask')).toHaveText('要继续吗？');
  await expect(recapGo).toHaveText('提交并推送');
  await expect(recapGo).toHaveClass(/primary/);
  await expect(recapGo).toHaveAttribute('title', /^提交并推送 · (⌘↵|Ctrl\+Enter)$/);
  await expect(recapCard.getByRole('button', {name: '暂不'})).toBeVisible();
  await expect(recapCard.getByRole('button', {name: '关闭'})).toHaveAttribute('title', '关闭 · Esc');
  await expect(recapHint).not.toHaveAttribute('data-placeholder', '提交并推送');
  await recapEditor.click();
  const recapHeights = recapPage.evaluate(() => new Promise((done) => {
    const wrap = document.querySelector('.recap').parentElement;
    const hs = [];
    const t0 = performance.now();
    const tick = () => { hs.push(wrap.isConnected ? Math.round(wrap.getBoundingClientRect().height) : -1); if (performance.now() - t0 < 700) requestAnimationFrame(tick); else done(hs); };
    tick();
  }));
  await recapPage.keyboard.press('ControlOrMeta+Enter');
  const heights = await recapHeights;
  assert.ok(heights.some((h) => h > 5 && h < heights[0] - 5) && heights.at(-1) === -1, `the card closes its height: ${heights}`);
  await expect(recapPage.locator('.receipt')).toHaveText('已选择：提交并推送');
  assert.deepEqual(await recapPage.evaluate(() => window.__sent.filter((o) => o.op === 'user_message').map((o) => o.content)), ['提交并推送']);
  await openRecap('?shell&recap');
  await recapEditor.click();
  await recapPage.keyboard.type('还有一件事');
  await recapPage.keyboard.press('Escape');
  await expect(recapCard).toBeVisible();
  await recapPage.keyboard.press('ControlOrMeta+a');
  await recapPage.keyboard.press('Backspace');
  await recapPage.getByRole('button', {name: '添加', exact: true}).click();
  await expect(recapPage.getByRole('listbox', {name: '添加'})).toBeVisible();
  await recapPage.keyboard.press('Escape');
  await expect(recapPage.getByRole('listbox', {name: '添加'})).toHaveCount(0);
  await expect(recapCard).toBeVisible();
  await recapPage.keyboard.press('Escape');
  await expect(recapCard).toHaveCount(0);
  await expect(recapPage.locator('.receipt')).toHaveCount(0);
  await expect(recapHint).toHaveAttribute('data-placeholder', '提交并推送');
  // 暂不 says so under the reply; with changes only, the button opens them.
  await openRecap('?shell&recap');
  await recapCard.getByRole('button', {name: '暂不'}).click();
  await expect(recapPage.locator('.receipt')).toHaveText('未采用：提交并推送');
  await openRecap('?shell&recap=changes');
  await expect(recapCard.locator('.ask')).toHaveText('要看看改动吗？');
  await recapGo.click();
  await expect(recapPage.locator('.receipt')).toHaveText('已选择：查看改动');
  assert.deepEqual(await recapPage.evaluate(() => window.__opened), ['changes']);
  // A long suggestion keeps one line at 1040 × 680 (all of it in the
  // tooltip); an approval arriving takes the place of the card.
  await recapPage.setViewportSize({width: 1040, height: 680});
  await openRecap('?shell&recap=long');
  assert.deepEqual(await recapCard.evaluate((el) => { const label = el.querySelector('.go .label'); const skip = el.querySelectorAll('.acts button')[1]; return [label.scrollWidth > label.clientWidth, el.querySelector('.go button').offsetHeight === skip.offsetHeight, document.documentElement.scrollWidth <= innerWidth]; }), [true, true, true]);
  await recapPage.evaluate(() => window.__shellChat.handle({type: 'approval_request', call_id: 'c9', name: 'shell', summary: 'git push', scopes: ['session']}));
  await expect(recapPage.locator('.approval')).toBeVisible();
  await expect(recapCard).toHaveCount(0);
  // Reduced motion: no fade.
  await recapPage.emulateMedia({reducedMotion: 'reduce'});
  await openRecap('?shell&recap');
  assert.equal(await recapCard.evaluate((el) => el.getAnimations().length), 0);
  await recapPage.close();
  // A card under the list that closes (the recap card's button, an answered
  // approval) leaves the view following the end: the list grows, the
  // browser brings the position up into the new range, and that is not the
  // reader scrolling up. The reply to the recap's suggestion comes into
  // view; no ⌄ after either. The reader scrolling up while a reply streams
  // still stops it there (the wheel, a scroll key), and ⌄ goes back to the
  // end. (The ⌄ came up at once and the reply stayed below the composer.)
  {
    const follow = await browser.newPage({viewport: {width: 1280, height: 800}});
    follow.on('pageerror', e => errors.push(e.message));
    const jumpButton = follow.getByRole('button', {name: '滚动到底部'});
    const shortOfEnd = () => follow.evaluate(() => { const m = document.querySelector('.chatpane main'); return Math.round(m.scrollHeight - m.clientHeight - m.scrollTop); });
    // Where the view stops once a smooth scroll (the wheel, a key) has run out.
    const settledTop = async () => {
      let last = -1;
      for (;;) {
        const top = await follow.evaluate(() => document.querySelector('.chatpane main').scrollTop);
        if (top === last) return top;
        last = top;
        await follow.waitForTimeout(150);
      }
    };
    const reply = (lines, from = 0) => follow.evaluate(async ({lines, from}) => {
      const c = window.__shellChat;
      c.handle({type: 'status', message: 'streaming'});
      for (let i = from; i < from + lines; i++) {
        c.handle({type: 'assistant_delta', delta: `第 ${i} 行：回复接着写。\n\n`});
        await new Promise((r) => setTimeout(r, 30));
      }
    }, {lines, from});
    await follow.goto(base + '?shell&recap');
    await expect(follow.locator('.recap')).toBeVisible({timeout: 30000});
    await follow.locator('.recap .go button').click();
    await expect(follow.locator('.receipt')).toHaveText('已选择：提交并推送');
    await expect(follow.locator('.recap')).toHaveCount(0);
    await expect(jumpButton).toHaveCount(0);
    await reply(3);
    await expect.poll(shortOfEnd).toBeLessThanOrEqual(1);
    await expect(jumpButton).toHaveCount(0);
    // Scrolling up while it streams stops following; the reply goes on below.
    await follow.mouse.move(700, 300);
    await follow.mouse.wheel(0, -400);
    await expect(jumpButton).toBeVisible();
    await expect.poll(shortOfEnd).toBeGreaterThan(60);
    const readerAt = await settledTop();
    await reply(4, 3);
    await follow.waitForTimeout(300);
    assert.equal(await follow.evaluate(() => document.querySelector('.chatpane main').scrollTop), readerAt);
    assert.ok((await shortOfEnd()) > 60);
    await jumpButton.click();
    await expect.poll(shortOfEnd).toBeLessThanOrEqual(1);
    await expect(jumpButton).toHaveCount(0);
    // A scroll key in the list stops it too (a click there first: the list
    // takes the keys).
    await follow.mouse.click(320, 300);
    await follow.keyboard.press('PageUp');
    await expect.poll(shortOfEnd).toBeGreaterThan(60);
    await expect(jumpButton).toBeVisible();
    const keyAt = await settledTop();
    await reply(3, 7);
    await follow.waitForTimeout(300);
    assert.equal(await follow.evaluate(() => document.querySelector('.chatpane main').scrollTop), keyAt);
    await jumpButton.click();
    await expect.poll(shortOfEnd).toBeLessThanOrEqual(1);
    // A message sent from the composer: its reply is followed. (The sent
    // bubble loses its 发送中 line as the reply starts; the content shrinks
    // and grows in one go, and the scroll event of that came after the
    // growth, read as the reader's.)
    await follow.locator('.composer [contenteditable]').first().click();
    await follow.keyboard.type('再跑一次');
    await follow.keyboard.press('Enter');
    await follow.waitForTimeout(300);
    await reply(4, 10);
    await expect.poll(shortOfEnd).toBeLessThanOrEqual(1);
    await expect(jumpButton).toHaveCount(0);
    await follow.goto(base + '?shell&approval');
    await expect(follow.locator('.approval')).toBeVisible({timeout: 30000});
    await follow.locator('.approval .approval-actions button').first().click();
    await expect(follow.locator('.approval')).toHaveCount(0);
    await follow.waitForTimeout(300);
    await expect(jumpButton).toHaveCount(0);
    assert.ok((await shortOfEnd()) <= 1);
    await follow.close();
  }
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
  // The LynShen sandbox: a new session in 自动, the note when commands are
  // not isolated, a 越界记录 line, the card's answers from the engine's
  // scopes (a must-ask request gets once and deny only), deny with what to
  // do, and Settings → 权限与沙箱 writing config.json.
  await page.goto(base + '?chat');
  await expect(page.locator('.fbtn.mode')).toHaveText('自动');
  await page.evaluate(() => {
    const c = window.__paneChat();
    c.handle({ type: 'escalated', call_id: 'e1', kind: 'escalation', command: 'brew install jq', justification: '需要 jq', cwd: '/w', paths: [], by: 'mode' });
    c.handle({ type: 'sandbox', mode: 'workspace-write', network: true, enforced: false, unavailable: null, directories: [] });
    c.handle({ type: 'approval_request', call_id: 's1', name: 'bash', summary: 'npm install -g pnpm', kind: 'escalation', justification: '全局装 pnpm', cwd: '/w', command: 'npm install -g pnpm', prefix: 'npm install', scopes: ['once', 'session', 'project'] });
  });
  await expect(page.locator('.esc')).toContainText('越界记录');
  await expect(page.locator('.fbtn.isolation')).toBeVisible();
  await expect(page.locator('.approval .approval-actions button')).toHaveText([/允许一次/, /本会话允许「npm install」开头的命令/, /始终允许/, /拒绝并告诉它怎么做/]);
  await page.getByRole('button',{name:/拒绝并告诉它怎么做/}).click();
  await page.locator('.fb-input').fill('用 corepack pnpm');
  await page.locator('.fb-input').press('Enter');
  await expect(page.locator('.approval')).toHaveCount(0);
  await page.evaluate(() => window.__paneChat().handle({ type: 'approval_request', call_id: 's2', name: 'bash', summary: 'git push', kind: 'rule', must_ask: true, command: 'git push', prefix: 'git push', scopes: ['once'] }));
  await expect(page.locator('.approval .approval-actions button')).toHaveText([/允许一次/, /拒绝并告诉它怎么做/]);
  await expect(page.locator('.approval .place')).toHaveCount(0);
  // A write outside the workspace is allowed once only, or for the
  // directory the engine suggests. Asked while git push waits, it waits
  // behind it (it used to replace it, and git push was never answered):
  // the card says 第 1/2 个, then 第 2/2 个 once git push is answered.
  await page.evaluate(() => window.__paneChat().handle({ type: 'approval_request', call_id: 's3', name: 'write', summary: '/Users/me/Desktop/a.txt', kind: 'outside_write', command: null, paths: ['/Users/me/Desktop/a.txt'], dir_suggestion: '/Users/me/Desktop', prefix: null, scopes: ['once'] }));
  await expect(page.locator('.approval .place')).toHaveText('第 1/2 个');
  await expect(page.locator('.approval .approval-actions button')).toHaveText([/允许一次/, /拒绝并告诉它怎么做/]);
  await page.locator('.approval .approval-actions button').first().click();
  await expect(page.locator('.approval .place')).toHaveText('第 2/2 个');
  await expect(page.locator('.approval .approval-actions button')).toHaveText([/允许一次/, /本会话可写「Desktop」/, /加入可写目录「Desktop」/, /拒绝并告诉它怎么做/]);
  await page.goto(base);
  await page.getByRole('button',{name:'权限与沙箱'}).first().click();
  await page.getByRole('switch',{name:'允许联网'}).click();
  const configPatches = () => page.evaluate(() => window.__calls.filter((c) => c.command === 'write_config').map((c) => JSON.stringify(c.args.patch)));
  await expect.poll(configPatches).toContain('{"sandbox_network":false}');
  // 完全访问 only after a confirmation: declined, nothing is written.
  await page.getByRole('button',{name:'完全访问',exact:true}).click();
  await expect(page.getByText('关闭沙箱，改为完全访问？')).toBeVisible();
  await page.getByRole('button',{name:'取消',exact:true}).click();
  assert.ok(!(await configPatches()).some((p) => p.includes('"sandbox":')));
  await page.getByRole('button',{name:'完全访问',exact:true}).click();
  await page.getByRole('button',{name:'改为完全访问'}).click();
  await expect.poll(configPatches).toContain('{"sandbox":"full-access"}');
  // Windows 沙箱（预览）: Windows only, off by default; on, it writes
  // sandbox_windows and the notice says commands are isolated now. The
  // network row says the switch cannot stop the network there.
  await expect(page.getByRole('switch',{name:'Windows 沙箱（预览）'})).toHaveCount(0);
  const winPage = await browser.newPage();
  await winPage.goto(base);
  // The app sets data-os from the user agent (applyPlatformClass); the
  // fixture does not. The section reads it when it opens.
  await winPage.evaluate(() => { document.documentElement.dataset.os = 'windows'; });
  await winPage.getByRole('button',{name:'权限与沙箱'}).first().click();
  const winSwitch = winPage.getByRole('switch',{name:'Windows 沙箱（预览）'});
  await expect(winSwitch).toHaveAttribute('aria-checked','false');
  await expect(winPage.getByText('要限制命令，打开下面的「Windows 沙箱（预览）」')).toBeVisible();
  await expect(winPage.getByText('在 Windows 上，这个开关不能阻止命令访问网络')).toBeVisible();
  await winSwitch.click();
  const winPatches = () => winPage.evaluate(() => window.__calls.filter((c) => c.command === 'write_config').map((c) => JSON.stringify(c.args.patch)));
  await expect.poll(winPatches).toContain('{"sandbox_windows":"restricted-token"}');
  await expect(winSwitch).toHaveAttribute('aria-checked','true');
  await expect(winPage.getByText('Windows 沙箱（预览）已开启')).toBeVisible();
  await winPage.close();
  // The product is named Aogiri; its engine and the account keep the name LynShen.
  // Its name shows as the drawn wordmark, named Aogiri for screen readers.
  await page.goto(base + '?sidebar');
  await expect(page.locator('.brand .word')).toHaveAttribute('aria-label', 'Aogiri');
  await expect(page.locator('.brand .word svg')).toBeVisible();
  await page.goto(base + '?welcome');
  await expect(page.locator('.wordmark')).toHaveAttribute('aria-label', 'Aogiri');
  await expect(page.locator('.wordmark svg')).toBeVisible();
  await expect(page.getByRole('heading',{name:'登录 LynShen'})).toBeVisible();
  await page.goto(base + '?updates');
  await expect(page.locator('#set-app-version')).toContainText('Aogiri 版本');
  await expect(page.locator('#set-engine-version')).toContainText('引擎版本');
  await page.goto(base + '?updates=found');
  await expect(page.getByRole('heading',{name:'发现新版本 Aogiri 9.9.9'})).toBeVisible();
  await page.goto(base + '?skills&oldEngine');
  await expect(page.getByText('当前的 LynShen 引擎还不能在这里管理技能。到「更新」里更新 Aogiri 后再试')).toBeVisible();
  // The first-use trial plan against a stubbed gateway: claimed at most once
  // per start (and right after a fresh sign-in: see the first run below); a
  // grant shows its card until answered, then never again, and is final; the
  // card asks whether this device pays with the trial (a new device pays
  // with the balance; nothing is switched unless the user says so); the
  // account card shows the plan on one line; a refusal or an older gateway
  // (404) shows nothing and is asked again at the next start, once.
  const trialPage = await browser.newPage({viewport:{width:1440,height:860}});
  trialPage.on('pageerror', e => errors.push(e.message));
  const claimCount = () => trialPage.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_trial_claim').length);
  const openTrial = async (query, {fresh} = {fresh: false}) => {
    await trialPage.goto(base + query);
    if (fresh) {
      await trialPage.evaluate(() => { localStorage.removeItem('lynshen-trial-claims'); localStorage.removeItem('lynshen-funding-offered'); });
      await trialPage.reload();
    }
    await expect(trialPage.locator('.composer')).toBeVisible({timeout:30000});
    await trialPage.evaluate(() => window.__trialDone);
  };
  const grantCard = trialPage.getByRole('region',{name:'体验套餐'});
  await openTrial('?shell&trial', {fresh: true});
  await expect(grantCard.getByRole('heading',{name:'已赠送 7 天体验套餐'})).toBeVisible();
  await expect(grantCard).toContainText(/国内模型分组 · 共 10 积分 · 每 5 小时最多 4 积分 · 到期 \d+月\d+日/);
  assert.equal(await claimCount(), 1);
  await trialPage.evaluate(() => window.__trial.signedIn());
  assert.equal(await claimCount(), 1, 'the trial was claimed twice');
  const fundingPuts = () => trialPage.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_set_plan_funding').map((c) => c.args.funding));
  // The grant put this device on the trial (contract v1.2): said, with 改用余额.
  await expect(grantCard).toContainText('本设备的请求由体验套餐支付');
  await expect(grantCard.getByRole('button',{name:'改用余额'})).toBeVisible();
  await grantCard.getByRole('button',{name:'知道了'}).click();
  await expect(grantCard).toHaveCount(0);
  assert.deepEqual(await fundingPuts(), [], '知道了 changed the funding');
  // The trial's plan was put to the user: no second offer for it.
  await expect(trialPage.getByRole('region',{name:'套餐'})).toHaveCount(0);
  await openTrial('?shell&trial');
  await expect(grantCard).toHaveCount(0);
  await expect(trialPage.getByRole('region',{name:'套餐'})).toHaveCount(0);
  assert.equal(await claimCount(), 0, 'the trial was claimed again after a grant');
  // The account card: a short menu. The plan on one line (name, end, the
  // window with the least left), the balance, 设置, 退出登录; the rest is in
  // Settings → 账户 / 外观. It fits without a scroll.
  await trialPage.getByRole('button',{name:'账号'}).click();
  const acctCard = trialPage.locator('.acct-card');
  const planLine = acctCard.locator('.line.plan');
  await expect(planLine).toContainText('7 天体验套餐');
  await expect(planLine).toContainText(/\d+月\d+日 到期/);
  await expect(planLine).toContainText('5 小时额度剩 4.00 积分');
  await expect(acctCard).toContainText('余额');
  await expect(acctCard.getByRole('button',{name:/设置/})).toBeVisible();
  await acctCard.getByRole('button',{name:'购买套餐或充值'}).click();
  assert.equal(await trialPage.evaluate(() => window.__purchaseOpened), 1, 'the account card did not open 套餐与充值');
  await trialPage.getByRole('button',{name:'账号'}).click();
  await expect(acctCard.getByRole('button',{name:'退出登录'})).toBeVisible();
  for (const gone of ['最近 60 秒', '计费方式', '显示货币', '主题']) await expect(acctCard).not.toContainText(gone);
  assert.ok(await acctCard.evaluate((el) => el.scrollHeight <= el.clientHeight + 1 && el.getBoundingClientRect().top >= 0), 'the account card does not fit');
  await openTrial('?shell&trial=404', {fresh: true});
  await expect(grantCard).toHaveCount(0);
  assert.equal(await claimCount(), 1);
  await trialPage.evaluate(() => window.__trial.signedIn());
  assert.equal(await claimCount(), 1, 'a 404 was asked twice in one run');
  await openTrial('?shell&trial=404');
  assert.equal(await claimCount(), 1, 'a 404 was not asked again at the next start');
  await trialPage.evaluate(() => window.__trial.signedIn());
  assert.equal(await claimCount(), 1, 'a 404 was asked twice in one run');
  await trialPage.getByRole('button',{name:'账号'}).click();
  await expect(trialPage.locator('.acct-card .line.plan')).toHaveCount(0);
  await expect(trialPage.locator('.acct-card .funding')).toHaveCount(0);
  // not_eligible: the same, asked again at the next start.
  await openTrial('?shell&trial=not_eligible', {fresh: true});
  assert.equal(await claimCount(), 1);
  await openTrial('?shell&trial=not_eligible');
  assert.equal(await claimCount(), 1, 'not_eligible was not asked again at the next start');
  // 改用余额 on the card: this device pays with the balance from now on.
  await openTrial('?shell&trial', {fresh: true});
  await grantCard.getByRole('button',{name:'改用余额'}).click();
  await expect(grantCard).toHaveCount(0);
  await expect.poll(fundingPuts).toEqual(['balance']);
  await expect(trialPage.getByText('本设备已改为余额计费')).toBeVisible();
  // A gateway that leaves the device on the balance: the card asks, and
  // 用体验套餐 moves it to the trial.
  await openTrial('?shell&trial&noclaimswitch', {fresh: true});
  await expect(grantCard).toContainText('本设备使用体验套餐支付？');
  await grantCard.getByRole('button',{name:'用体验套餐'}).click();
  await expect(grantCard).toHaveCount(0);
  await expect.poll(fundingPuts).toEqual(['plan']);
  await expect(trialPage.getByText('本设备已改为套餐计费')).toBeVisible();
  await openTrial('?shell&trial&noclaimswitch', {fresh: true});
  await grantCard.getByRole('button',{name:'暂不，用余额'}).click();
  await expect(grantCard).toHaveCount(0);
  assert.deepEqual(await fundingPuts(), [], 'keeping the balance changed the funding');
  // A plan bought on the website, which this device does not pay with: offered
  // once; 继续用余额 sends nothing, and it is not offered again.
  const offerCard = trialPage.getByRole('region',{name:'套餐'});
  await openTrial('?shell&trial=web', {fresh: true});
  await expect(offerCard.getByRole('heading',{name:'检测到套餐 Grove'})).toBeVisible();
  await offerCard.getByRole('button',{name:'继续用余额'}).click();
  await expect(offerCard).toHaveCount(0);
  assert.deepEqual(await fundingPuts(), [], 'keeping the balance changed the funding');
  await openTrial('?shell&trial=web');
  await trialPage.waitForTimeout(500);
  await expect(offerCard).toHaveCount(0);
  await openTrial('?shell&trial=web', {fresh: true});
  await offerCard.getByRole('button',{name:'本设备改用套餐'}).click();
  await expect.poll(fundingPuts).toEqual(['plan']);
  await expect(offerCard).toHaveCount(0);
  // The gateway moved this device to the plan bought: said once, with 改用余额.
  await openTrial('?shell&trial=web&funding=plan', {fresh: true});
  await expect(offerCard.getByRole('heading',{name:'本设备现在由套餐 Grove 支付'})).toBeVisible();
  await offerCard.getByRole('button',{name:'改用余额'}).click();
  await expect.poll(fundingPuts).toEqual(['balance']);
  await expect(offerCard).toHaveCount(0);
  await openTrial('?shell&trial=web&funding=plan', {fresh: true});
  await offerCard.getByRole('button',{name:'知道了'}).click();
  await expect(offerCard).toHaveCount(0);
  await openTrial('?shell&trial=web&funding=plan');
  await trialPage.waitForTimeout(500);
  await expect(offerCard).toHaveCount(0);
  assert.deepEqual(await fundingPuts(), [], '知道了 changed the funding');
  await trialPage.close();

  // Who pays (Settings → 账户) against a slow gateway (each answer 300–1500
  // ms later): every click shows at once, none is dropped, the control never
  // snaps back, a read landing in between changes nothing, and the last
  // click is what the gateway ends with.
  const fundPage = await browser.newPage({viewport:{width:1280,height:900}});
  fundPage.on('pageerror', e => errors.push(e.message));
  await fundPage.goto(base + '?trial=used&funding=plan&latency=random');
  const choice = fundPage.locator('#set-account-plan .funding');
  await expect(choice.locator('.opt.on')).toHaveText('套餐 · 7 天体验套餐', {timeout:30000});
  await expect(choice).toContainText('本设备由谁支付');
  await expect(choice).toContainText('只用套餐额度；用完会暂停并提示，不会自动扣余额。');
  // The plan's state, end and windows (used / quota, when each recovers).
  const planGroup = fundPage.locator('#set-account-plan');
  await expect(planGroup).toContainText('使用中');
  await expect(planGroup).toContainText(/\d+月\d+日 \d\d:\d\d 到期/);
  await expect(planGroup.locator('.win')).toHaveCount(2);
  await expect(planGroup.locator('.win').first()).toContainText(/5 小时\s*1\.36 \/ 4\.00 积分/);
  await expect(planGroup.locator('.win').last()).toContainText(/7 天\s*3\.58 \/ 10\.00 积分/);
  await expect(planGroup.locator('.win').first()).toContainText(/恢复/);
  await expect(planGroup).toContainText('套餐正在使用：1 / 3 台设备');
  await choice.evaluate((el) => {
    window.__shown = [el.querySelector('.opt.on')?.textContent?.trim()];
    new MutationObserver(() => {
      const now = el.querySelector('.opt.on')?.textContent?.trim();
      if (now && now !== window.__shown.at(-1)) window.__shown.push(now);
    }).observe(el, { subtree: true, attributes: true, childList: true, characterData: true });
  });
  const clicks = ['余额', '套餐 · 7 天体验套餐', '余额', '套餐 · 7 天体验套餐', '余额'];
  for (const [i, label] of clicks.entries()) {
    if (i === 3) await fundPage.evaluate(() => { void window.__trial.refreshStatus(); });
    await choice.getByRole('button',{name:label}).click();
    await expect(choice.locator('.opt.on')).toHaveText(label);
    await fundPage.waitForTimeout(150);
  }
  await expect.poll(() => fundPage.evaluate(() => window.__trial.saving), {timeout:20000}).toBe(false);
  await expect(choice.locator('.opt.on')).toHaveText('余额');
  await expect(choice).toContainText('只扣余额，不用套餐。');
  const puts = await fundPage.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_set_plan_funding').map((c) => c.args.funding));
  assert.equal(puts.at(-1), 'balance', `the last change sent was ${puts.at(-1)}`);
  assert.deepEqual(await fundPage.evaluate(() => window.__shown), ['套餐 · 7 天体验套餐', ...clicks], 'the funding choice snapped back');
  await fundPage.evaluate(() => window.__trial.refreshStatus());
  await expect(choice.locator('.opt.on')).toHaveText('余额');
  // The plan ended while the device still pays with it: the choice stays,
  // and says the requests stop; 余额 is the way out.
  await fundPage.goto(base + '?trial=ended&funding=plan');
  await expect(choice).toContainText('套餐已结束，本设备的请求会停下', {timeout:30000});
  await expect(choice.locator('.opt.on')).toHaveText('套餐');
  await fundPage.close();

  // A turn the plan stopped (gateway contract notes/plan-balance-contract.md
  // section 3): the card names the window and when it recovers, and offers
  // the ways on side by side, none taken for the user; 等待恢复 waits (and
  // can be called off), 改用余额继续 moves this device to the balance and
  // says so; an ended plan offers renewing; a model outside the plan offers
  // another model, and on the plan the pickers mark such models (listed, not
  // hidden), on the balance they do not mention the plan.
  {
    const pp = await browser.newPage({viewport:{width:1280,height:820}});
    pp.on('pageerror', e => errors.push(e.message));
    const mrow = (scope, name) => scope.locator('.mline').filter({has: scope.page().getByText(name, {exact: true})});
    const puts = () => pp.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_set_plan_funding').map((c) => c.args.funding));
    // The trial's card shows on the first page of this context only.
    const answerTrialCard = async () => {
      await expect(pp.locator('.composer')).toBeVisible({timeout:30000});
      await pp.evaluate(() => window.__trialDone);
      await pp.waitForTimeout(300);
      const grant = pp.getByRole('region',{name:'体验套餐'});
      if (await grant.count()) await grant.getByRole('button',{name:/暂不|知道了/}).click();
    };
    await pp.goto(base + '?shell&empty&trial=full&funding=plan&planStop=quota');
    await answerTrialCard();
    const card = pp.locator('.err').filter({hasText:'套餐 5 小时额度用完了'});
    await expect(card).toContainText(/\d\d:\d\d 恢复。本设备由套餐支付，额度用完不会自动改扣余额。/);
    const ways = card.locator('.foot button');
    await expect(ways).toHaveText([/^等待恢复 · \d\d:\d\d$/, '额度恢复前先用余额', '购买套餐', '原始信息']);
    assert.equal(await card.locator('.b.primary').count(), 0, 'one way on was pushed as the primary');
    await ways.first().click();
    await expect(card.getByRole('status')).toContainText(/\d\d:\d\d 恢复后自动继续/);
    await expect(ways).toHaveText(['额度恢复前先用余额', '购买套餐', '原始信息']);
    await card.getByRole('button',{name:'取消等待'}).click();
    await expect(card.getByRole('status')).toHaveCount(0);
    assert.deepEqual(await puts(), [], 'waiting changed the funding');
    // The balance until the window recovers (owner, 2026-10-17): sent as
    // until_reset, said with its end; the gateway puts the device back on the
    // plan then, and the app says so.
    await card.getByRole('button',{name:'额度恢复前先用余额'}).click();
    await expect(pp.getByText(/余额支付至 \d\d:\d\d，之后恢复套餐/).first()).toBeVisible();
    const temp = await pp.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_set_plan_funding').map((c) => [c.args.funding, c.args.mode, c.args.until]));
    assert.deepEqual(temp.map((c) => c.slice(0, 2)), [['balance', 'until_reset']]);
    assert.ok(!Number.isNaN(Date.parse(temp[0][2])), 'the 402 retry_at was not sent as until');
    await pp.evaluate(() => { window.__windowRecovered(); void window.__trial.refreshStatus(); });
    await expect(pp.getByText('已恢复使用套餐')).toBeVisible();
    assert.equal(await pp.evaluate(() => window.__trial.funding), 'plan');
    // A fourth device on a plan for three: which limit, the balance, the devices.
    await pp.goto(base + '?shell&empty&trial&funding=plan&planStop=devices');
    const full = pp.locator('.err').filter({hasText:'套餐已在 3 台设备上使用，已达上限'});
    await expect(full).toBeVisible({timeout:30000});
    await expect(full.locator('.foot button')).toHaveText(['改用余额继续', '查看设备', '原始信息']);
    // The plan ended: renew, or the balance.
    await pp.goto(base + '?shell&empty&trial=ended&funding=plan&planStop=inactive');
    const ended = pp.locator('.err').filter({hasText:'Grove 已结束'});
    await expect(ended).toBeVisible({timeout:30000});
    await expect(ended.locator('.foot button')).toHaveText(['续费套餐', '改用余额继续', '原始信息']);
    await pp.goto(base + '?shell&empty&trial=ended&funding=plan&planStop=none');
    await expect(pp.locator('.err').filter({hasText:'现在没有生效的套餐'}).locator('.foot button')).toHaveText(['购买套餐', '改用余额继续', '原始信息'], {timeout:30000});
    // A model outside the plan: another model, or the balance; the picker
    // lists it marked 套餐外.
    await pp.goto(base + '?shell&empty&models&trial&funding=plan&planStop=notInPlan');
    await answerTrialCard();
    // The composer's foot says who pays.
    await expect(pp.locator('.fbtn.payer')).toHaveText(/^套餐 · (5 小时|7 天)剩 \d+(\.\d+)? 积分$/);
    const outside = pp.locator('.err').filter({hasText:'不在套餐内'});
    await expect(outside.locator('.foot button')).toHaveText(['换个模型', '改用余额继续', '原始信息']);
    await outside.getByRole('button',{name:'换个模型'}).click();
    const quick = pp.locator('.pop.mm .qs');
    await expect(mrow(quick, 'Claude Opus 5.5').locator('.aside')).toHaveText('套餐外');
    await expect(mrow(quick, 'Claude Opus 5.5')).toHaveClass(/outside/);
    await expect(mrow(quick, 'GLM-5.3').locator('.aside')).toHaveText('套餐内');
    await pp.keyboard.press('Escape');
    // The windows follow the work: a request of the session reads the plan
    // again (once for a burst), not a timer.
    const reads = () => pp.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_desktop_plan').length);
    await pp.waitForTimeout(2500);
    const before = await reads();
    await pp.evaluate(() => { for (let i = 0; i < 3; i++) window.__shellChat.handle({type: 'usage', input_tokens: 1200, output_tokens: 80}); });
    await expect.poll(reads, {timeout:6000}).toBe(before + 1);
    // On the balance the plan is not mentioned.
    await pp.goto(base + '?shell&empty&models&trial&noclaimswitch');
    await answerTrialCard();
    await pp.locator('.fbtn.model').click();
    await expect(quick.locator('.mline').first()).toBeVisible();
    await expect(quick.getByText(/套餐内|套餐外/)).toHaveCount(0);
    await expect(pp.locator('.fbtn.payer')).toHaveText('余额支付');
    await pp.close();
  }

  // Settings → 套餐与充值 against a stubbed store (gateway desktop-purchase.spec.md):
  // the plans with price, length and windows in words, the packs and a custom
  // amount; a plan by a WeChat QR code (checked until paid, then the plan and
  // the orders read again), what a plan bought under another one replaces, a
  // pack by the Alipay page in the browser, closing and continuing the same
  // payment, a refused payment retried with a new attempt on the same order,
  // a network failure retried with the same ids, and a gateway without the store.
  {
    const sp = await browser.newPage({viewport:{width:1280,height:900}});
    sp.on('pageerror', e => errors.push(e.message));
    const storeCalls = (cmd) => sp.evaluate((c) => window.__calls.filter((x) => x.command === c).map((x) => x.args), cmd);
    await sp.goto(base + '?purchase&balance&section=purchase');
    await expect(sp.getByRole('heading',{name:'套餐与充值',level:1})).toBeVisible({timeout:30000});
    await expect(sp.locator('.sec h3')).toHaveText(['当前', '套餐', '充值余额']);
    await expect(sp.locator('#set-purchase-plan')).toContainText('没有套餐');
    const plansSec = sp.locator('#set-purchase-plans');
    await expect(plansSec).toContainText('¥49 / 30 天 · 每 5 小时 8 积分 · 每 7 天 23 积分');
    await expect(plansSec).toContainText('¥99 / 30 天 · 每 5 小时 16 积分 · 每 7 天 46 积分');
    const topUp = sp.locator('#set-purchase-topup');
    await expect(topUp.locator('.row', {hasText:'¥50'})).toContainText('到账 ¥55，含赠送 ¥5');
    // The newest dialog: the one closed last may still be fading out.
    const dialog = sp.getByRole('dialog').last();
    const sproutRow = plansSec.locator('.row', {hasText:'Sprout'});
    await sproutRow.getByRole('button',{name:'购买'}).click();
    await expect(dialog).toContainText('购买 Sprout');
    await expect(dialog).toContainText(/付款后立即生效，30 天内有效，\d+月\d+日到期。/);
    await expect(dialog).toContainText('付款后本设备由套餐支付，可以随时改用余额。');
    await expect(dialog).toContainText('套餐仅在 Aogiri 桌面端 / LynShen CLI 中使用；API Key 调用始终按余额计费。');
    await dialog.getByRole('button',{name:'微信',exact:true}).click();
    await dialog.getByRole('button',{name:'去支付'}).click();
    await expect(dialog.locator('.qr svg')).toBeVisible();
    await expect(dialog).toContainText('用微信扫码支付 ¥49');
    await expect(dialog).toContainText(/已等待 \d+ 秒 · (29|30):\d\d 后失效/);
    assert.deepEqual((await storeCalls('monoize_store_order')).map((a) => [a.productId, a.channelId, a.customMinor]), [['sprout', 'store-channel-epay', null]]);
    assert.deepEqual((await storeCalls('monoize_store_pay')).map((a) => a.method), ['wxpay']);
    await sp.evaluate(() => { window.__storePaid = true; });
    await expect(dialog).toContainText('支付成功，Sprout 已生效', {timeout:10000});
    assert.ok((await storeCalls('monoize_store_query')).length >= 1, 'the payment was not checked');
    // A plan bought pays by default (the gateway moved the device at
    // fulfilment): the dialog says so, with the end counted from the
    // purchase, and 改用余额 is one tap away.
    await expect(dialog).toContainText('本设备现在由 Sprout 支付');
    await expect(dialog).toContainText(/\d+月\d+日 \d\d:\d\d 到期（30 天）/);
    assert.deepEqual(await storeCalls('monoize_set_plan_funding'), [], 'the app sent a choice the gateway had made');
    await dialog.getByRole('button',{name:'改用余额'}).click();
    await expect(dialog).toContainText('本设备仍由余额支付');
    assert.deepEqual((await storeCalls('monoize_set_plan_funding')).map((a) => a.funding), ['balance']);
    await dialog.getByRole('button',{name:'使用此套餐'}).click();
    await expect(dialog).toContainText('本设备现在由 Sprout 支付');
    assert.deepEqual((await storeCalls('monoize_set_plan_funding')).map((a) => a.funding), ['balance', 'plan']);
    await dialog.getByRole('button',{name:'完成'}).click();
    await expect(sp.getByRole('dialog')).toHaveCount(0);
    await expect(sp.locator('#set-purchase-plan')).toContainText('Sprout');
    await expect(sp.locator('#set-purchase-funding .opt.on')).toHaveText('套餐 · Sprout');
    await expect(sproutRow).toContainText('使用中');
    const orders = sp.locator('#set-purchase-orders');
    await expect(orders.locator('.row', {hasText:'Sprout · ¥49'})).toContainText('已完成');
    // Under a plan in force (the catalog read again): a higher plan is an
    // upgrade at the quoted price; the same plan renews from its end.
    await sp.evaluate(() => { window.__storePaid = false; });
    await plansSec.locator('.row', {hasText:'Branch'}).getByRole('button',{name:'升级'}).click();
    await expect(dialog).toContainText('付款后立即从「Sprout」升级到「Branch」');
    await dialog.getByRole('button',{name:'取消'}).click();
    await sproutRow.getByRole('button',{name:'续费'}).click();
    await expect(dialog).toContainText('续费：到期时间从当前到期日顺延 30 天');
    await dialog.getByRole('button',{name:'取消'}).click();
    // ¥50 by the Alipay page in the browser; closing only stops waiting.
    await topUp.locator('.row', {hasText:'¥50'}).getByRole('button',{name:'充值'}).click();
    await expect(dialog).toContainText('充值 ¥50');
    await dialog.getByRole('button',{name:'支付宝',exact:true}).click();
    await dialog.getByRole('button',{name:'去支付'}).click();
    await expect(dialog).toContainText('已在浏览器中打开支付页');
    assert.ok((await storeCalls('plugin:opener|open_url')).some((a) => JSON.stringify(a).includes('pay.example.com/pay/order-2')), 'the payment page was not opened');
    await dialog.getByRole('button',{name:'关闭',exact:true}).last().click();
    await expect(sp.getByRole('dialog')).toHaveCount(0);
    const fifty = orders.locator('.row', {hasText:'充值 ¥50'});
    await expect(fifty).toContainText('待支付');
    await expect(fifty).toContainText('到账 ¥55');
    await fifty.getByRole('button',{name:'继续支付'}).click();
    await expect(dialog).toContainText('已在浏览器中打开支付页');
    assert.equal((await storeCalls('monoize_store_order')).length, 2, 'continuing ordered again');
    const pays = await storeCalls('monoize_store_pay');
    assert.equal(pays.at(-1).requestId, pays.at(-2).requestId, 'continuing did not reuse the payment attempt');
    await sp.evaluate(() => { window.__storePaid = true; });
    await expect(dialog).toContainText('支付成功，已到账 ¥55', {timeout:10000});
    await dialog.getByRole('button',{name:'完成'}).click();
    // A custom amount, checked against the gateway's range.
    const custom = sp.locator('#set-purchase-custom');
    const amountBox = custom.getByRole('textbox',{name:'充值金额（元）'});
    await amountBox.fill('0.5');
    await expect(custom).toContainText('请输入 ¥1 到 ¥1,000,000 之间的金额');
    await expect(custom.getByRole('button',{name:'充值'})).toBeDisabled();
    await amountBox.fill('23.5');
    await custom.getByRole('button',{name:'充值'}).click();
    await expect(dialog).toContainText('充值 ¥23.50');
    await dialog.getByRole('button',{name:'取消'}).click();
    await sp.close();
  }
  {
    // A plan in force (Sprout, 12 days left): the same plan renews from its
    // end with the usage kept; a higher one is an upgrade at the price the
    // gateway quotes, ordered as such; a lower one is listed, not offered.
    const up = await browser.newPage({viewport:{width:1280,height:900}});
    up.on('pageerror', e => errors.push(e.message));
    await up.goto(base + '?purchase&current=sprout&section=purchase');
    const ud = up.getByRole('dialog').last();
    const rows = up.locator('#set-purchase-plans .row');
    await expect(rows.filter({hasText:'Sprout'}).getByRole('button')).toHaveText('续费', {timeout:30000});
    await expect(rows.filter({hasText:'Branch'})).toContainText('补 ¥50 升级');
    await expect(up.locator('#set-purchase-plan')).toContainText('套餐正在使用：1 / 3 台设备');
    await rows.filter({hasText:'Sprout'}).getByRole('button',{name:'续费'}).click();
    await expect(ud).toHaveAttribute('aria-label', '续费 Sprout');
    await expect(ud).toContainText(/续费：到期时间从当前到期日顺延 30 天，到 \d+月\d+日；已用额度保留。/);
    await ud.getByRole('button',{name:'取消'}).click();
    await rows.filter({hasText:'Branch'}).getByRole('button',{name:'升级'}).click();
    await expect(ud).toHaveAttribute('aria-label', '升级到 Branch');
    await expect(ud).toContainText('¥50');
    await expect(ud).toContainText(/付款后立即从「Sprout」升级到「Branch」：到期时间不变（\d+月\d+日），当前时段的用量保留/);
    await ud.getByRole('button',{name:'微信',exact:true}).click();
    await ud.getByRole('button',{name:'去支付'}).click();
    await expect(ud.locator('.qr svg')).toBeVisible();
    const order = await up.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_store_order').map((c) => [c.args.productId, c.args.upgradeFrom]));
    assert.deepEqual(order, [['branch', 'sprout']], 'the upgrade was not ordered as one');
    await up.evaluate(() => { window.__storePaid = true; });
    await expect(ud).toContainText('本设备现在由 Branch 支付', {timeout:10000});
    await ud.getByRole('button',{name:'完成'}).click();
    // Now on Branch: Sprout is lower, and has no button.
    await expect(rows.filter({hasText:'Sprout'})).toContainText('低于当前套餐');
    await expect(rows.filter({hasText:'Sprout'}).getByRole('button')).toHaveCount(0);
    await up.close();
  }
  {
    // A gateway before contract v1.2 (the releases ship together, but not
    // always at the same minute): no device count, no quotes or renewal
    // (the same plan starts over and replaces, as it does there), and the
    // balance until the window recovers falls back to the balance for good.
    const og = await browser.newPage({viewport:{width:1280,height:900}});
    og.on('pageerror', e => errors.push(e.message));
    await og.goto(base + '?purchase&oldgw&current=sprout&section=purchase');
    const orows = og.locator('#set-purchase-plans .row');
    await expect(orows.filter({hasText:'Sprout'}).getByRole('button')).toHaveText('购买', {timeout:30000});
    await expect(orows.filter({hasText:'Branch'}).getByRole('button')).toHaveText('购买');
    await expect(og.locator('#set-purchase-plan')).not.toContainText('台设备');
    await orows.filter({hasText:'Sprout'}).getByRole('button',{name:'购买'}).click();
    await expect(og.getByRole('dialog').last()).toContainText('付款后立即重新开始一个 30 天的「Sprout」');
    await og.getByRole('dialog').last().getByRole('button',{name:'取消'}).click();
    await og.goto(base + '?shell&empty&oldgw&trial=full&funding=plan&planStop=quota');
    const ocard = og.locator('.err').filter({hasText:'额度用完了'});
    await expect(ocard).toBeVisible({timeout:30000});
    const grant = og.getByRole('region',{name:'体验套餐'});
    if (await grant.count()) await grant.getByRole('button',{name:'知道了'}).click();
    await ocard.getByRole('button',{name:'额度恢复前先用余额'}).click();
    await expect(og.getByText('本设备已改为余额计费')).toBeVisible();
    assert.deepEqual(await og.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_set_plan_funding').map((c) => c.args.mode ?? null)), ['until_reset', null]);
    await og.close();
  }
  {
    // A gateway that leaves the device on the balance at fulfilment: the app
    // makes the plan pay, as a purchase does by default.
    const fp = await browser.newPage({viewport:{width:1280,height:900}});
    fp.on('pageerror', e => errors.push(e.message));
    await fp.goto(base + '?purchase&nofundswitch&section=purchase');
    const fd = fp.getByRole('dialog').last();
    await fp.locator('#set-purchase-plans .row', {hasText:'Sprout'}).getByRole('button',{name:'购买'}).click({timeout:30000});
    await fd.getByRole('button',{name:'微信',exact:true}).click();
    await fd.getByRole('button',{name:'去支付'}).click();
    await expect(fd.locator('.qr svg')).toBeVisible();
    await fp.evaluate(() => { window.__storePaid = true; });
    await expect(fd).toContainText('本设备现在由 Sprout 支付', {timeout:10000});
    assert.deepEqual(await fp.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_set_plan_funding').map((c) => c.args.funding)), ['plan']);
    await fp.close();
  }
  {
    // Refused for certain: a new attempt on the same order.
    const rp = await browser.newPage();
    rp.on('pageerror', e => errors.push(e.message));
    const calls = (cmd) => rp.evaluate((c) => window.__calls.filter((x) => x.command === c).map((x) => x.args), cmd);
    await rp.goto(base + '?purchase=reject&section=purchase');
    const dialog = rp.getByRole('dialog');
    await rp.locator('#set-purchase-plans .row', {hasText:'Sprout'}).getByRole('button',{name:'购买'}).click({timeout:30000});
    await dialog.getByRole('button',{name:'去支付'}).click();
    await expect(dialog.getByRole('alert')).toContainText('支付渠道拒绝了这笔订单');
    await dialog.getByRole('button',{name:'重试'}).click();
    await expect(dialog.locator('.qr svg').or(dialog.getByText('已在浏览器中打开支付页'))).toBeVisible();
    assert.equal((await calls('monoize_store_order')).length, 1, 'a refused payment ordered again');
    const pays = await calls('monoize_store_pay');
    assert.equal(pays.length, 2);
    assert.notEqual(pays[0].requestId, pays[1].requestId, 'a refused attempt was retried with its own id');
    await rp.close();
    // Not reached: the same ids again, so the retry cannot order twice.
    const np = await browser.newPage();
    np.on('pageerror', e => errors.push(e.message));
    await np.goto(base + '?purchase=offline&section=purchase');
    const nd = np.getByRole('dialog');
    await np.locator('#set-purchase-topup .row', {hasText:'¥10'}).getByRole('button',{name:'充值'}).click({timeout:30000});
    await nd.getByRole('button',{name:'去支付'}).click();
    await expect(nd.getByRole('alert')).toContainText('连不上 LynShen 服务');
    await nd.getByRole('button',{name:'重试'}).click();
    await expect(nd.locator('.qr svg').or(nd.getByText('已在浏览器中打开支付页'))).toBeVisible();
    const tries = await np.evaluate(() => window.__calls.filter((x) => x.command === 'monoize_store_order').map((x) => x.args.requestId));
    assert.equal(tries.length, 2);
    assert.equal(tries[0], tries[1], 'a retry after a network failure used a new order id');
    await np.close();
    // A gateway without the store: the website instead.
    const op = await browser.newPage();
    op.on('pageerror', e => errors.push(e.message));
    await op.goto(base + '?purchase=404&section=purchase');
    await expect(op.getByText('当前的 LynShen 服务还不支持在应用里购买，请到网站购买。')).toBeVisible({timeout:30000});
    await expect(op.getByRole('button',{name:'去网站购买'})).toBeVisible();
    await op.close();
  }

  // Settings → 账户 while the account is read (查看账户 from a 余额不足 error
  // opens it): loading, never 未登录 or the sign-in. The next start shows the
  // account kept from the last read at once.
  const acctPage = await browser.newPage();
  acctPage.on('pageerror', e => errors.push(e.message));
  await acctPage.goto(base + '?loggedIn&accountLatency=2500');
  await expect(acctPage.locator('.acct-wait')).toBeVisible({timeout:30000});
  await expect(acctPage.getByText('未登录')).toHaveCount(0);
  await expect(acctPage.locator('#account-login')).toHaveCount(0);
  await expect(acctPage.locator('.acct-profile')).toContainText('Test user', {timeout:10000});
  // The page: profile, then 套餐与余额 / 用量 / 更多 / 登录 as full-width
  // groups; 重新登录 and 退出登录 are quiet rows at the bottom.
  await expect(acctPage.locator('.sec h3')).toHaveText(['套餐与余额', '用量', '更多', '登录']);
  await expect(acctPage.locator('#set-account-noplan')).toContainText('没有套餐');
  await expect(acctPage.locator('#set-account-currency')).toContainText('显示货币');
  // 购买套餐 and 充值 open Settings → 套餐与充值 in the app, not the website.
  await acctPage.locator('#set-account-balance').getByRole('button',{name:'充值'}).click();
  await expect(acctPage.getByRole('heading',{name:'套餐与充值',level:1})).toBeVisible();
  await acctPage.getByRole('button',{name:'账户',exact:true}).click();
  await expect(acctPage.locator('#set-account-noplan').getByRole('button',{name:'购买套餐'})).toBeVisible();
  await expect(acctPage.locator('.acct-profile').getByRole('button',{name:'退出登录'})).toHaveCount(0);
  await expect(acctPage.getByRole('button',{name:'退出登录',exact:true})).toBeVisible();
  const widths = await acctPage.locator('.sec .body').evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().width)));
  assert.equal(new Set(widths).size, 1, `the groups have different widths: ${widths}`);
  await acctPage.reload();
  await expect(acctPage.locator('.acct-profile')).toContainText('Test user', {timeout:30000});
  await expect(acctPage.locator('.acct-wait')).toHaveCount(0);
  assert.equal(await acctPage.evaluate(() => window.__calls.filter((c) => c.command === 'monoize_session').length), 1);
  await acctPage.close();

  // The first run: the LynShen sign-in is the first screen (no Node, Git or
  // model step). Signed in, the app is ready: the welcome page closes, the
  // trial is claimed at once, and a new computer's engine runs on the account.
  const first = await browser.newPage({viewport:{width:1280,height:800}});
  first.on('pageerror', e => errors.push(e.message));
  await first.goto(base + '?welcome&authorize&freshConfig');
  await expect(first.getByRole('heading',{name:'登录 LynShen'})).toBeVisible({timeout:30000});
  await expect(first.getByRole('button',{name:'跳过，稍后登录'})).toBeVisible();
  await expect(first.getByText(/Node\.js|Git\b|依赖/)).toHaveCount(0);
  await first.getByRole('button',{name:'在浏览器中授权 Aogiri'}).click();
  await expect(first.getByTestId('welcome-closed')).toHaveText('signed-in', {timeout:20000});
  const firstCalls = () => first.evaluate(() => window.__calls);
  await expect.poll(async () => (await firstCalls()).some((c) => c.command === 'monoize_trial_claim'), {message: 'the trial was not claimed right after the sign-in'}).toBe(true);
  assert.ok((await firstCalls()).some((c) => c.command === 'write_config' && c.args.patch.provider === 'monoize'), 'the engine was not pointed at the account');
  assert.equal(await first.evaluate(() => localStorage.getItem('lynshen-setup-done')), '1');
  // 跳过，稍后登录: one optional page for other agents. Tools show only for
  // the agent that needs them (none for LynShen's engine; Node, then Claude
  // Code for Claude Code); 开始使用 always goes on.
  await first.goto(base + '?welcome');
  await first.getByRole('button',{name:'跳过，稍后登录'}).click();
  await expect(first.getByRole('heading',{name:'选择智能体'})).toBeVisible();
  await expect(first.locator('.install')).toHaveCount(0);
  await first.getByRole('radio',{name:/Claude Code/}).click();
  await expect(first.locator('.install')).toContainText('Node.js');
  await expect(first.locator('.install')).not.toContainText('Git');
  await first.getByRole('button',{name:'开始使用'}).click();
  await expect(first.getByTestId('welcome-closed')).toHaveText('start:claude');
  // After logging out (not a first run), 跳过 just closes the page.
  await first.goto(base + '?welcome=relogin');
  await first.getByRole('button',{name:'跳过，稍后登录'}).click();
  await expect(first.getByTestId('welcome-closed')).toHaveText('dismissed');
  // The walkthrough (command palette): every step opens at once; 稍后设置
  // and Escape close it.
  await first.goto(base + '?welcome=guide');
  await first.getByRole('button',{name:'基础操作'}).click();
  await expect(first.getByRole('heading',{name:'基础操作',level:2})).toBeVisible();
  await first.getByRole('button',{name:'稍后设置'}).click();
  await expect(first.getByTestId('welcome-closed')).toHaveText('dismissed');
  await first.goto(base + '?welcome=guide');
  await expect(first.getByRole('heading',{name:'开始使用'})).toBeVisible();
  await first.keyboard.press('Escape');
  await expect(first.getByTestId('welcome-closed')).toHaveText('dismissed');
  await first.close();

  // The composer's modes: five, in Claude Code's order, numbered 1–5. In a
  // narrow window, in Chinese and English, each description wraps inside its
  // row (also a long one), never under the check or the number, and the menu
  // stays inside the window. Shift+Tab switches to the next mode; with the
  // menu open the number keys pick.
  const MODE_LABELS = {zh: ['谨慎', '自动改文件', '计划', '自动', '全自动'], en: ['Cautious', 'Auto-edit files', 'Plan', 'Auto', 'Full auto']};
  const LONG = {zh: '保留沙箱边界，越界自动放行并留下记录；git push、提权、删除工作区以外的文件等仍会问你，每次越界都会在对话里留下一条记录', en: 'Keeps the sandbox boundary, allows leaving it and records each time; still asks for git push, admin rights, deleting files outside the workspace and the like'};
  for (const lang of ['zh', 'en']) {
    for (const viewport of [{width:1040,height:680}, {width:720,height:520}]) {
      const mp = await browser.newPage({viewport});
      mp.on('pageerror', e => errors.push(e.message));
      await mp.goto(base + `?shell&empty${lang === 'en' ? '&lang=en' : ''}`);
      await mp.locator('.fbtn.mode').click({timeout:30000});
      const menu = mp.locator('.pop.modes');
      await expect(menu.getByRole('menuitemradio')).toHaveCount(5);
      await expect(menu.locator('.pop-label')).toHaveText(MODE_LABELS[lang]);
      await expect(menu.locator('.key')).toHaveText(['1', '2', '3', '4', '5']);
      await expect(menu.getByRole('menuitemradio',{checked:true})).toContainText(MODE_LABELS[lang][3]);
      // Under glass (on by default) the menu stays solid: nothing behind it
      // shows between its rows.
      assert.ok(await mp.evaluate(() => 'glass' in document.documentElement.dataset), 'glass is off in the fixture');
      const fill = await menu.evaluate((m) => getComputedStyle(m).backgroundColor);
      assert.ok(!/\/\s*0?\.\d+\)$|rgba\(.*,\s*0?\.\d+\)$/.test(fill), `the mode menu is see-through: ${fill}`);
      const fits = async (what) => {
        // The menu fits itself to the window as its size changes (next frame).
        await menu.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        const rows = await menu.evaluate((m) => {
          const box = (el) => { const r = el.getBoundingClientRect(); return {l: r.left, r: r.right, t: r.top, b: r.bottom}; };
          return {menu: box(m), vw: innerWidth, vh: innerHeight, rows: [...m.querySelectorAll('.pop-row')].map((row) => ({row: box(row), desc: box(row.querySelector('.pop-desc')), name: box(row.querySelector('.name')), check: box(row.querySelector('.check')), key: box(row.querySelector('.key')), lines: Math.round(row.querySelector('.pop-desc').getBoundingClientRect().height / parseFloat(getComputedStyle(row.querySelector('.pop-desc')).lineHeight))}))};
        });
        const at = `${lang} ${viewport.width} ${what}`;
        assert.ok(rows.menu.l >= 0 && rows.menu.r <= rows.vw && rows.menu.t >= 0 && rows.menu.b <= rows.vh, `${at}: the menu leaves the window ${JSON.stringify(rows.menu)}`);
        for (const [i, r] of rows.rows.entries()) {
          assert.ok(r.desc.r <= r.check.l + 0.5 && r.name.r <= r.check.l + 0.5, `${at}: row ${i + 1}'s text runs under its check`);
          assert.ok(r.check.r <= r.key.l + 0.5 && r.key.r <= r.row.r + 0.5, `${at}: row ${i + 1}'s check and number overlap`);
          assert.ok(r.desc.r <= rows.menu.r && r.desc.l >= rows.menu.l, `${at}: row ${i + 1}'s description leaves the menu`);
        }
        return rows;
      };
      const plain = await fits('as shipped');
      // The shipped descriptions are one line each where the menu is wide enough.
      if (viewport.width >= 1040) assert.ok(plain.rows.every((r) => r.lines === 1), `${lang}: a description takes more than one line`);
      // A long description wraps inside its row.
      await menu.locator('.pop-desc').nth(4).evaluate((el, text) => { el.textContent = text; }, LONG[lang]);
      const long = await fits('long text');
      assert.ok(long.rows[4].lines >= 2, `${lang}: the long description did not wrap`);
      // The number keys pick while the menu is open; Shift+Tab switches in the composer.
      await mp.keyboard.press('2');
      await expect(menu).toHaveCount(0);
      await expect(mp.locator('.fbtn.mode')).toHaveText(MODE_LABELS[lang][1]);
      await mp.locator('.composer .rich').click();
      await mp.keyboard.press('Shift+Tab');
      await expect(mp.locator('.fbtn.mode')).toHaveText(MODE_LABELS[lang][2]);
      await mp.keyboard.press('Shift+Tab');
      await mp.keyboard.press('Shift+Tab');
      await mp.keyboard.press('Shift+Tab');
      await expect(mp.locator('.fbtn.mode')).toHaveText(MODE_LABELS[lang][0]);
      await mp.close();
    }
  }

  // The model pickers (src/lib/models), on the gateway's catalog
  // (catalogSample.ts, a trial account), at the smallest window in both
  // themes: the quick switcher under the composer's model button, its keys,
  // typing into the full browser, search by Chinese words and aliases,
  // folded versions, an unavailable model, and a long name that wraps.
  // A model row by its full name.
  const row = (scope, name) => scope.locator('.mline').filter({has: scope.page().getByText(name, {exact: true})});
  const cutOff = (loc) => loc.evaluate((el) => el.scrollWidth > el.clientWidth + 1 || getComputedStyle(el).textOverflow === 'ellipsis' && getComputedStyle(el).whiteSpace === 'nowrap');
  const solid = async (loc, what) => {
    const fill = await loc.evaluate((el) => getComputedStyle(el).backgroundColor);
    assert.ok(!/\/\s*0?\.\d+\)$|rgba\(.*,\s*0?\.\d+\)$/.test(fill), `${what} is see-through: ${fill}`);
  };
  for (const theme of ['dark', 'light']) {
    const mp = await browser.newPage({viewport:{width:1040,height:680}});
    mp.on('pageerror', e => errors.push(e.message));
    await mp.goto(base + `?shell&models&theme=${theme}`);
    // The button names the model as the catalog does, not by its id.
    await expect(mp.locator('.fbtn.model')).toHaveText('DeepSeek V4.1 Flash', {timeout:30000});
    await mp.locator('.fbtn.model').click();
    await mp.mouse.move(5, 5);
    const quick = mp.locator('.pop.mm .qs');
    await solid(mp.locator('.pop.mm'), `${theme}: the model menu`);
    // The model in use, then the plan's picks (a trial: what it pays for
    // first); an unavailable model and an image model are not offered.
    await expect(quick.locator('.head')).toHaveText(['最近使用', '推荐']);
    await expect(quick.locator('.mline .name')).toHaveText(['DeepSeek V4.1 Flash', 'GLM-5.3', 'Kimi K3', 'Auto', 'Claude Opus 5.5', 'Claude Sonnet 5.5 (1M context, extended thinking)', 'GPT-6 Sol']);
    await expect(row(quick, 'GLM-5.3').locator('.aside')).toHaveText('套餐内');
    await expect(row(quick, 'Claude Sonnet 5.5 (1M context, extended thinking)').locator('.aside')).toHaveText('不稳定');
    await expect(row(quick, 'Claude Sonnet 5.5 (1M context, extended thinking)').locator('.dot')).toHaveCount(1);
    // The long name wraps inside its row: nothing cut, nothing under the check.
    const long = row(quick, 'Claude Sonnet 5.5 (1M context, extended thinking)');
    assert.equal(await cutOff(long.locator('.name')), false, `${theme}: the long name is cut in the quick switcher`);
    const [nameBox, checkBox] = await Promise.all([long.locator('.name').boundingBox(), long.locator('.pop-check').boundingBox()]);
    assert.ok(nameBox.x + nameBox.width <= checkBox.x, `${theme}: the long name runs under the check`);
    // Keys: the search field has the focus; the arrows move, ⌘D pins, Enter picks.
    await expect(quick.locator('input')).toBeFocused();
    await expect(quick.locator('.mline.sel .name')).toHaveText('DeepSeek V4.1 Flash');
    await mp.keyboard.press('ArrowDown');
    await mp.keyboard.press('ArrowDown');
    await expect(quick.locator('.mline.sel .name')).toHaveText('Kimi K3');
    await mp.keyboard.press('ControlOrMeta+d');
    await expect(quick.locator('.head')).toHaveText(['收藏', '最近使用', '推荐']);
    await expect(quick.locator('.mline').first().locator('.name')).toHaveText('Kimi K3');
    await expect(quick.locator('.mline.sel .name')).toHaveText('Kimi K3');
    await mp.keyboard.press('Enter');
    await expect(mp.locator('.pop.mm')).toHaveCount(0);
    await expect(mp.locator('.fbtn.model.pending')).toHaveCount(1);
    assert.deepEqual(await mp.evaluate(() => JSON.parse(localStorage.getItem('lynshen-model-picks'))), {favorites: ['monoize::kimi-k3'], recent: ['monoize::kimi-k3']});
    // An input method: nothing moves while it composes (its Enter picks
    // nothing); the browser opens with the finished text.
    await mp.locator('.fbtn.model').click();
    const qi = mp.locator('.pop.mm .qs input');
    const compose = (loc, text, done) => loc.evaluate((el, [text, done]) => {
      el.dispatchEvent(new CompositionEvent('compositionstart', {bubbles: true}));
      el.value = text;
      el.dispatchEvent(new InputEvent('input', {isComposing: true, bubbles: true}));
      el.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', keyCode: 229, isComposing: true, bubbles: true}));
      if (done) {
        el.value = done;
        el.dispatchEvent(new InputEvent('input', {isComposing: true, bubbles: true}));
        el.dispatchEvent(new CompositionEvent('compositionend', {data: done, bubbles: true}));
      }
    }, [text, done]);
    await compose(qi, 'kan', '');
    await expect(mp.locator('.pop.mm')).toHaveCount(1);
    await expect(mp.locator('.mb')).toHaveCount(0);
    await compose(qi, 'kantu', '看图');
    const ime = mp.locator('.mb');
    await expect(ime.locator('input')).toHaveValue('看图');
    await expect(ime.locator('.mline .name')).toContainText(['Kimi K3']);
    await expect(row(ime, 'GLM-5.3')).toHaveCount(0);
    await compose(ime.locator('input'), 'guo', '');
    await expect(ime.locator('.empty')).toHaveCount(0);
    await expect(row(ime, 'Kimi K3')).toHaveCount(1);
    await compose(ime.locator('input'), 'guochan', '国产');
    await expect(row(ime, 'GLM-5.3')).toHaveCount(1);
    await mp.keyboard.press('Escape');
    await expect(ime).toHaveCount(0);
    // Typing opens the full browser with the text.
    await mp.locator('.fbtn.model').click();
    await mp.keyboard.type('opus');
    const dlg = mp.locator('.mb');
    await expect(dlg.locator('input')).toBeFocused();
    await expect(dlg.locator('input')).toHaveValue('opus');
    await mp.mouse.move(5, 5);
    await expect(dlg.locator('.mline .name')).toHaveText(['Claude Opus 5.5', 'Claude Opus 5', 'Claude Opus 4.8']);
    await solid(dlg, `${theme}: the model browser`);
    for (const [query, names] of [
      ['opus 4.8', ['Claude Opus 4.8']],
      ['能看图的国产模型', ['Kimi K3']],
      ['zhipuai', ['GLM-5.3']],
      ['DeepSeek-V4.1-Flash', ['DeepSeek V4.1 Flash']],
      ['便宜 国产', ['DeepSeek V4.1 Flash', 'DeepSeek V4 Pro', 'GLM-5.3', 'GLM-5.3 Flash']]
    ]) {
      await dlg.locator('input').fill(query);
      await expect(dlg.locator('.mline .name'), query).toHaveText(names);
    }
    await dlg.locator('input').fill('没有这种模型');
    await expect(dlg.locator('.empty')).toHaveText('没有匹配的模型');
    // No query: vendor sections (a trial: domestic first), older versions folded.
    await dlg.locator('input').fill('');
    await expect(dlg.locator('.vhead .vname')).toHaveText(['DeepSeek', '智谱', 'Kimi', 'LynShen', 'Anthropic', 'OpenAI', 'Google', '其他']);
    await expect(row(dlg, 'Claude Opus 4.8')).toHaveCount(0);
    const opus = row(dlg, 'Claude Opus 5.5');
    await opus.hover();
    await mp.keyboard.press('ArrowRight');
    await expect(dlg.locator('.mline.folded .name')).toHaveText(['Claude Opus 5', 'Claude Opus 4.8']);
    await expect(dlg.locator('.more.sel, .mline.sel')).toHaveCount(1);
    await mp.keyboard.press('ArrowLeft');
    await expect(dlg.locator('.mline.folded')).toHaveCount(0);
    await expect(dlg.locator('.more.sel .pop-label')).toHaveText('更多版本 · 2');
    // The long name in the browser: one row, full text.
    assert.equal(await cutOff(row(dlg, 'Claude Sonnet 5.5 (1M context, extended thinking)').locator('.name')), false, `${theme}: the long name is cut in the browser`);
    await expect(row(dlg, 'Claude Sonnet 5.5 (1M context, extended thinking)').locator('.facts')).toHaveText('不稳定 · 套餐外，余额模式可用 · 1M 上下文 · ¥21.3 / ¥107 每百万 · 看图 · 思考');
    // An unavailable model: after the working ones, its dot, picked after a confirmation.
    const openai = await dlg.locator('.mline').evaluateAll((rows) => rows.map((r) => r.querySelector('.name').textContent).filter((n) => /^GPT/.test(n)));
    // A chat picker lists no image model (GPT Image 2).
    assert.deepEqual(openai, ['GPT-6 Sol', 'GPT-6.1 Sol', 'GPT-5.5']);
    const down = row(dlg, 'GPT-6.1 Sol');
    await expect(down.locator('.dot.err')).toHaveCount(1);
    await expect(down.locator('.facts')).toContainText('暂不可用');
    await down.click();
    await expect(mp.getByText('这个模型暂不可用')).toBeVisible();
    await mp.getByRole('button',{name:'仍然使用'}).click();
    await expect(dlg).toHaveCount(0);
    assert.equal(await mp.evaluate(() => JSON.parse(localStorage.getItem('lynshen-model-picks')).recent[0]), 'monoize::gpt-6.1-sol');
    await mp.close();
  }
  // An older gateway (no catalog, 404): names, vendors and families read
  // from the ids; no price, health or plan.
  {
    const mp = await browser.newPage({viewport:{width:1040,height:680}});
    mp.on('pageerror', e => errors.push(e.message));
    await mp.goto(base + '?shell&models=old');
    await expect(mp.locator('.fbtn.model')).toHaveText('DeepSeek V4.1 Flash', {timeout:30000});
    await mp.locator('.fbtn.model').click();
    await expect(mp.locator('.qs .mline').first().locator('.name')).toHaveText('DeepSeek V4.1 Flash');
    await mp.getByRole('option', {name:/全部模型/}).click();
    const dlg = mp.locator('.mb');
    await expect(dlg.locator('.vhead .vname').first()).toHaveText('LynShen');
    await expect(row(dlg, 'Claude Opus 5.5')).toHaveCount(1);
    await expect(row(dlg, 'Claude Opus 4.8')).toHaveCount(0);
    await expect(dlg.getByText(/¥|套餐内|不稳定|暂不可用/)).toHaveCount(0);
    // Two spellings of one model are one row.
    await dlg.locator('input').fill('v4.1');
    await expect(dlg.locator('.mline .name')).toHaveText(['DeepSeek V4.1 Flash']);
    await mp.close();
  }
  // Settings → 模型与推理: the same pickers; the image model's lists only
  // models that draw images.
  {
    const mp = await browser.newPage({viewport:{width:1040,height:680}});
    mp.on('pageerror', e => errors.push(e.message));
    await mp.goto(base + '?models&loggedIn');
    await mp.getByRole('button', {name:'模型与推理', exact:true}).click({timeout:30000});
    const trigger = mp.locator('#set-default-model .trigger');
    await expect(trigger).toContainText('DeepSeek V4.1 Flash');
    await expect(mp.locator('#set-compact-model .trigger')).toContainText('GLM-5.3 Flash');
    await expect(mp.locator('#set-image-model .trigger')).toContainText('GPT Image 2');
    await trigger.click();
    await mp.mouse.move(5, 5);
    const quick = mp.locator('.pop.mp');
    await solid(quick, 'the settings model list');
    await expect(quick.locator('input')).toBeFocused();
    await row(quick, 'Kimi K3').click();
    await expect(trigger).toContainText('Kimi K3');
    await expect.poll(() => mp.evaluate(() => window.__calls.filter((c) => c.command === 'write_config').map((c) => c.args.patch.model).filter(Boolean))).toContain('kimi-k3');
    await mp.locator('#set-image-model .trigger').click();
    await expect(mp.locator('.pop.mp .qs [role=option]')).toHaveText([/自动选择|自动/, /GPT Image 2/, /全部模型/]);
    await mp.keyboard.press('Escape');
    await expect(mp.locator('.pop.mp')).toHaveCount(0);
    await mp.close();
  }
  // Settings → 聊天连接: a Telegram bot's state, binding with a code (link
  // and QR code, closed by the new binding), the chat's limits, adding a bot
  // (token and proxy checked first), unbinding; 远程访问 lists phones only;
  // an older daemon says so.
  {
    const cp = await browser.newPage({viewport:{width:1040,height:680}});
    cp.on('pageerror', e => errors.push(e.message));
    const ops = (name) => cp.evaluate((n) => window.__ops.filter((o) => o.op === n), name);
    await cp.goto(base + '?shell&settings=chat');
    await expect(cp.getByRole('heading', {name:'聊天连接', level:1})).toBeVisible({timeout:30000});
    const bot = cp.locator('#set-chat-tg-3f9a1c2b');
    await expect(bot.getByRole('heading', {name:'Telegram · @aogiri_home_bot'})).toBeVisible();
    await expect(bot.getByText('已连接', {exact:true})).toBeVisible();
    await expect(bot.getByText('Chad Li (@chadli)')).toBeVisible();
    await bot.getByRole('button', {name:'绑定账号', exact:true}).click();
    await expect(bot.getByText('绑定码 K7QXA2B9')).toBeVisible();
    await expect(bot.locator('.qr svg')).toHaveCount(1);
    await bot.getByRole('button', {name:'打开链接', exact:true}).click();
    await expect.poll(() => cp.evaluate(() => window.__calls.filter((c) => c.command === 'plugin:opener|open_url').map((c) => c.args.url))).toContain('https://t.me/aogiri_home_bot?start=K7QXA2B9');
    await cp.evaluate(() => window.__daemon.connectors[0].bindings.push({device:'dev-tg-2', name:'Second (@second)', paired_at:Date.now(), last_seen:Date.now()}));
    await expect(bot.getByText('绑定码 K7QXA2B9')).toHaveCount(0, {timeout:8000});
    await expect(bot.getByText('Second (@second)')).toBeVisible();
    // What a chat may do: full auto is not offered.
    await bot.getByRole('switch', {name:'允许在聊天中审批'}).click();
    await bot.getByRole('button', {name:'谨慎', exact:true}).click();
    await expect.poll(async () => (await ops('connector_set')).map((o) => o.approvals ?? o.max_mode)).toEqual([false, 'manual']);
    await expect(bot.getByRole('button', {name:/全自动|完全访问/})).toHaveCount(0);
    await bot.getByRole('button', {name:'解除绑定', exact:true}).first().click();
    await cp.getByRole('button', {name:'解除绑定', exact:true}).last().click();
    await expect.poll(async () => (await ops('device_revoke')).map((o) => o.device)).toEqual(['dev-tg-1']);
    await expect(bot.getByText('Chad Li (@chadli)')).toHaveCount(0);
    // Adding a bot: the token and the proxy are checked before anything is sent.
    await cp.getByRole('button', {name:'添加', exact:true}).click();
    const form = cp.locator('form.form');
    await form.locator('input[type=password]').fill('123:short');
    await form.locator('input').nth(1).fill('socks5://127.0.0.1:7891');
    await expect(form.getByText(/这不像 Telegram 的 bot token/)).toBeVisible();
    await expect(form.getByText(/不支持 SOCKS，请用/)).toBeVisible();
    await expect(form.getByRole('button', {name:'连接', exact:true})).toBeDisabled();
    await form.locator('input[type=password]').fill('123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw1');
    await form.locator('input').nth(1).fill('http://127.0.0.1:7890');
    await form.getByRole('button', {name:'连接', exact:true}).click();
    await expect(cp.getByRole('heading', {name:'Telegram · @aogiri_work_bot'})).toBeVisible();
    assert.deepEqual((await ops('connector_add')).map((o) => [o.platform, o.proxy]), [['telegram', 'http://127.0.0.1:7890']]);
    // 远程访问 lists the phones; the chat accounts live on 聊天连接.
    await cp.getByRole('button', {name:'远程访问', exact:true}).click();
    await expect(cp.getByText('iPhone', {exact:true})).toBeVisible();
    await expect(cp.getByText('Second (@second)')).toHaveCount(0);
    await cp.goto(base + '?shell&settings=chat&chats=old');
    await expect(cp.getByText('当前的后台服务不支持聊天连接，更新后可用。')).toBeVisible({timeout:30000});
    await expect(cp.getByRole('button', {name:'添加', exact:true})).toBeDisabled();
    // Discord and QQ: a server invite, QQ's note, no proxy and no QR code
    // for QQ, and its own fields when adding one.
    await cp.goto(base + '?shell&settings=chat&chats=all');
    await expect(cp.getByRole('heading', {name:'QQ · @梧桐助手'})).toBeVisible({timeout:30000});
    const qqBot = cp.locator('#set-chat-qq-102030405');
    await expect(qqBot.getByText(/QQ 不能编辑消息/)).toBeVisible();
    await expect(qqBot.getByText('代理', {exact:true})).toHaveCount(0);
    await qqBot.getByRole('button', {name:'绑定账号', exact:true}).click();
    await expect(qqBot.getByText('给机器人发私信：/bind K7QXA2B9')).toBeVisible();
    await expect(qqBot.locator('.qr svg')).toHaveCount(0);
    await cp.locator('#set-chat-dc-7a1b').getByRole('button', {name:'加入服务器', exact:true}).click();
    await expect.poll(() => cp.evaluate(() => window.__calls.filter((c) => c.command === 'plugin:opener|open_url').map((c) => c.args.url))).toContain('https://discord.com/oauth2/authorize?client_id=777&scope=bot&permissions=0');
    await cp.getByRole('button', {name:'添加', exact:true}).click();
    const addForm = cp.locator('form.form');
    await addForm.getByRole('button', {name:'Discord', exact:true}).click();
    await addForm.locator('input[type=password]').fill('not-a-token');
    await expect(addForm.getByText(/这不像 Discord 的 bot token/)).toBeVisible();
    await addForm.getByRole('button', {name:'QQ', exact:true}).click();
    await expect(addForm.getByText('代理', {exact:true})).toHaveCount(0);
    await addForm.locator('input').first().fill('102030405');
    await expect(addForm.getByRole('button', {name:'连接', exact:true})).toBeDisabled();
    await addForm.locator('input[type=password]').fill('qqSecretABCDEF');
    await addForm.getByRole('button', {name:'连接', exact:true}).click();
    await expect.poll(async () => (await ops('connector_add')).map((o) => [o.platform, o.app_id, o.secret, o.token ?? null, o.proxy ?? null])).toEqual([['qq', '102030405', 'qqSecretABCDEF', null, null]]);
    await cp.goto(base + '?shell&settings=chat&lang=en&theme=light');
    await expect(cp.getByRole('heading', {name:'Chat connectors', level:1})).toBeVisible({timeout:30000});
    await expect(cp.getByText('Connected', {exact:true})).toBeVisible();
    await cp.close();
  }
  // Settings → 导入 (ticket #35): Codex Desktop's threads listed with their
  // prompts (the scan as the app reads tests/fixtures/codex), and the result
  // opens each imported conversation in its project.
  {
    const ip = await browser.newPage({viewport:{width:1280,height:860}});
    ip.on('pageerror', e => errors.push(e.message));
    await ip.goto(base + '?shell&settings=import');
    await expect(ip.getByRole('button', {name:'扫描', exact:true})).toBeVisible({timeout:30000});
    const cwd = 'D:\\我要干大活\\三角帧不掉洲';
    const threads = [['019a3b10', '添加关闭预启动开关', 2], ['019a1f22', '修复安装包进程终止与启动', 3], ['019a3b55', '修复游戏目录识别崩溃', 1], ['019a2c33', '评估项目能否用于优化工具', 2], ['019963aa', '检查前台游戏调度时间片', 2]];
    await ip.evaluate(({threads, cwd}) => {
      const original = window.__TAURI_INTERNALS__.invoke;
      window.__TAURI_INTERNALS__.invoke = async (command, args) => {
        if (command === 'import_scan') return {skipped: [], skills: [], mcp: [], sessions: threads.map(([id, title, messages], i) => ({source: 'codex', id, title, cwd, messages, imported: false, updated_at_ms: Date.UTC(2026, 9, 17 - i)}))};
        if (command === 'import_apply') return args.selection.sessions.map((s) => ({kind: 'session', source: s.source, key: s.id, status: 'imported', target: `copy-${s.id}`, title: threads.find(([id]) => id === s.id)[1], cwd: s.cwd, engine: 'codex', cwd_exists: true, error: null}));
        return original(command, args);
      };
    }, {threads, cwd});
    await ip.getByRole('button', {name:'扫描', exact:true}).click();
    await ip.locator('.ghead').filter({hasText:'Codex'}).locator('.gtoggle').click();
    for (const [, title, n] of threads) await expect(ip.locator('.item').filter({hasText:title})).toContainText(`${n} 轮`);
    await ip.getByRole('button', {name:/一键导入/}).click();
    const opened = ip.locator('.opened');
    await expect(opened.locator('.otitle')).toHaveText('导入的会话');
    await expect(opened.locator('.oname')).toHaveText(threads.map(([, title]) => title));
    await opened.locator('.orow').filter({hasText:'修复安装包进程终止与启动'}).getByRole('button', {name:'打开', exact:true}).click();
    assert.deepEqual(await ip.evaluate(() => window.__opened), [`import:codex:copy-019a1f22:${cwd}`]);
    await ip.close();
  }
  assert.deepEqual(errors, []);
  console.log('Browser regressions passed: reactive drafts, one new conversation per place until its first message (新对话, a project\'s +), account authorization, logout, API key label, provider OAuth, a custom provider (the form checks, per model the window, output cap, thinking, effort tiers and input kinds, editing it; a text-only model in the composer), mounted tabs, home model, title bar menu, skills, marketplace, plugins, sidebar fold and archive, welcome and approval menu click-away, menu click-away under glass, long reasoning and reply, steered reply, plan menu click-away, conversation width setting and column, the plan and subagents cards (beside the column at 1440 × 900, title lines and popovers at 1100 × 760, 1040 × 680 and beside a tool leaf, collapse, keyboard, opening and stopping a subagent, a failed or waiting step opening the plan, chips and a sheet on the phone page), window frost default and migration, light theme surfaces, attached files as chips (sent, history, copy, quote, resend, queue, rewind, phone page), sandbox card and settings (Windows 沙箱（预览） on a Windows page), the shell setting (versions, choices written, PowerShell 7 install, an older daemon), reply styles (the default written, a built-in viewed and copied, a personal style edited and deleted, an older daemon, the composer + menu sending set_style, a deleted style), product name, sent files previewed in a tab beside the conversation, first-use trial claim (grant card once, final after a grant, a refusal asked again once per start, the card asking whether this device pays with the trial), the short account card, who pays this device (the plan or the balance, under a slow gateway, an ended plan; a plan new to the device shown once, paying by default with 改用余额), a turn the plan stopped (the window and its recovery, waiting, the balance until it recovers and 已恢复使用套餐, 改用余额继续, renewing, a model outside the plan; the pickers marking 套餐外 on the plan, nothing on the balance; who pays at the composer foot, a fourth device, the windows read again after requests), Settings → 账户 (read without a logged-out flash, its groups, the plan windows, 购买套餐 and 充值 in the app), Settings → 套餐与充值 (who pays, devices in use, a gateway before contract v1.2, a plan bought paying by default with 改用余额 and its end date, renewal from the current end, an upgrade at the quoted price, no downgrade, the scope line, plans with windows in words, packs, a custom amount, a WeChat QR code checked until paid, the replace notice, the Alipay page, continuing a payment, a refused payment and a network failure retried safely, a gateway without the store), the first run (sign-in first, trial claimed at once, the optional agent page, the skippable walkthrough), the five composer modes (order, wrapping in zh and en, narrow windows, Shift+Tab, number keys), the model pickers (quick switcher: rows, keys, pin; browser: typing, an input method, Chinese words, aliases, folding, an unavailable model, a long name; the fallback without a catalog; the settings pickers; dark and light at 1040 × 680), the chat connectors page (state, a binding code closed by its binding, the chat limits, adding a bot with its checks, unbinding, phones only on 远程访问, an older daemon; Discord and QQ: invite, QQ note, bind command, their add fields), Settings → 导入 (Codex prompts, opening what a run imported.');
} finally { await browser.close(); await server.close(); }
