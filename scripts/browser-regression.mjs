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
  assert.deepEqual(errors, []);
  console.log('Browser regressions passed: reactive drafts, account authorization, logout, API key label, provider OAuth, mounted tabs, home model, title bar menu, skills, marketplace, plugins, sidebar fold and archive.');
} finally { await browser.close(); await server.close(); }
