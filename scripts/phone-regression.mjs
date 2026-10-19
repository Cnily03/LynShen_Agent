// The phone remote page at 390×844 in Chromium and WebKit: a tapped
// notification opens its session with the approval card above the composer,
// the page tells the computer which session it shows, and 通知 shows and
// changes the computer's rules. Run by CI after browser-regression.mjs;
// `node scripts/phone-regression.mjs [port]` on its own.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { chromium, webkit, expect } from '@playwright/test';

const port = Number(process.argv[2] ?? 1446);
const server = await createServer({
	configFile: false,
	plugins: [svelte({ compilerOptions: { runes: true } })],
	resolve: { alias: { $lib: resolve('src/lib') } },
	server: { host: '127.0.0.1', port, strictPort: true }
});
await server.listen();
const base = `http://127.0.0.1:${port}/tests/browser/index.html`;
const engines = [
	['chromium', () => chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH })],
	['webkit', () => webkit.launch()]
];
let failed = false;
try {
	for (const [name, launch] of engines) {
		const browser = await launch();
		const errors = [];
		try {
			const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
			const page = await ctx.newPage();
			page.on('pageerror', (e) => errors.push(e.message));
			const ops = () => page.evaluate(() => window.__remoteOps.map((o) => ({ ...o, id: undefined })));

			// A tapped notification: the session opens, the approval card sits
			// right above the composer, with its reason and command.
			// (This phone may run outside the sandbox: the request is an escalation.)
			await page.goto(`${base}?remoteHost&open=s-cache&scopes=full_access`);
			const card = page.locator('.session .bottom > .approval');
			await expect(card).toBeVisible({ timeout: 30000 });
			await expect(page.locator('.session .title')).toHaveText('会话缓存分片');
			await expect(card).toContainText('git push origin feat/session-cache');
			// Measured once its entrance has played.
			await card.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
			const cardBox = await card.boundingBox();
			const composerBox = await page.locator('.composer').boundingBox();
			assert.ok(cardBox && composerBox, 'card and composer have boxes');
			assert.ok(cardBox.y + cardBox.height <= composerBox.y + 1, `card above composer (${cardBox.y + cardBox.height} vs ${composerBox.y})`);
			assert.ok(composerBox.y + composerBox.height <= 844, 'composer on screen');
			assert.ok(cardBox.y > 300, `card in thumb reach (${cardBox.y})`);
			// The computer is told which session this phone shows.
			await expect.poll(async () => (await ops()).filter((o) => o.op === 'push_viewing').at(-1)?.session).toBe('s-cache');
			// Allowed once from the phone: the card goes.
			await card.getByRole('button', { name: /允许一次/ }).click();
			await expect(card).toHaveCount(0);
			assert.ok((await ops()).some((o) => o.op === 'approve' && o.session === 's-cache'), 'approve sent');
			// Back to the list: the phone shows no session any more.
			await page.locator('.session > header').getByRole('button', { name: '返回' }).click();
			await expect.poll(async () => (await ops()).filter((o) => o.op === 'push_viewing').at(-1)?.session).toBe(null);
			// Hidden (locked, another app): no session either.
			await page.evaluate(() => window.__remoteOps.splice(0));

			// 通知: the defaults, today's count, and a change sent to the computer.
			await page.goto(`${base}?remoteHost&settings`);
			const screen = page.locator('.screen');
			await expect(screen.getByText('MacBook Pro 的规则')).toBeVisible({ timeout: 30000 });
			await expect(screen.getByText('今天已推送 3 条')).toBeVisible();
			await expect(screen.getByRole('combobox', { name: '每天最多' })).toHaveValue('20');
			await expect(screen.locator('input[type=time]').first()).toHaveValue('23:00');
			await expect(screen.locator('input[type=time]').nth(1)).toHaveValue('08:00');
			await expect(screen.getByText('等你批准', { exact: true })).toBeVisible();
			await expect(screen.getByText('会话出错', { exact: true })).toBeVisible();
			await expect(screen.getByText('通知里只写会话名和要做什么。命令全文在手机上解密后才显示。')).toBeVisible();
			await screen.getByRole('combobox', { name: '每天最多' }).selectOption('10');
			await expect.poll(async () => (await ops()).find((o) => o.op === 'push_rules_set')?.rules).toEqual({ daily_budget: 10 });
			await screen.getByRole('switch', { name: '安静时段' }).click();
			await expect(screen.locator('input[type=time]')).toHaveCount(0);
			await expect(screen.getByRole('switch', { name: '安静时段' })).toHaveAttribute('aria-checked', 'false');
			await expect.poll(async () => (await ops()).filter((o) => o.op === 'push_rules_set').at(-1)?.rules).toEqual({ quiet_start: '00:00', quiet_end: '00:00' });
			await page.waitForTimeout(400);
			await page.screenshot({ path: `/tmp/phone-push-settings-${name}.png` });

			// Paired, not yet confirmed on the computer: the check code, in two
			// groups of three, and nothing else of the computer.
			await page.goto(`${base}?remoteHost&pending`);
			await expect(page.getByRole('heading', { name: '在电脑上核对这串数字' })).toBeVisible({ timeout: 30000 });
			await expect(page.locator('.check')).toHaveText('482913'.slice(0, 3) + '913');
			await expect(page.getByText('等电脑确认…')).toBeVisible();
			await expect(page.locator('.session')).toHaveCount(0);
			await page.waitForTimeout(600);
			await page.screenshot({ path: `/tmp/phone-pair-check-${name}.png` });

			// 反馈问题 from the phone (ticket #45): sent through the computer,
			// which signs it and attaches its logs; the screenshot and the
			// phone's platform go along.
			await page.goto(`${base}?remoteHost&feedback`);
			const dialog = page.getByRole('dialog', { name: '反馈问题' });
			await expect(dialog).toBeVisible({ timeout: 30000 });
			await expect(dialog.getByText('会以工单提交到「MacBook Pro」上登录的 LynShen 账户')).toBeVisible();
			await expect(dialog.getByText('附带「MacBook Pro」的日志')).toBeVisible();
			await dialog.getByRole('button', { name: '建议', exact: true }).click();
			await dialog.locator('input').first().fill('网页端提交工单');
			await dialog.locator('textarea').fill('在 app.lynshen.org 上也能提交工单');
			await page.waitForTimeout(300);
			await page.screenshot({ path: `/tmp/phone-feedback-${name}.png` });
			await dialog.getByRole('button', { name: '提交' }).click();
			await expect(page.getByText('已提交工单 #54')).toBeVisible();
			const sent = (await ops()).find((o) => o.op === 'feedback_send');
			assert.equal(sent.title, '网页端提交工单');
			assert.equal(sent.category, 'feature');
			assert.equal(sent.with_logs, true);
			assert.equal(sent.app_version, 'web');
			assert.match(sent.body, /来自网页端（app\.lynshen\.org）· 电脑：MacBook Pro/);
			// A computer whose engine predates it says to update.
			await page.goto(`${base}?remoteHost&feedback&oldEngine`);
			await expect(dialog).toBeVisible({ timeout: 30000 });
			await dialog.locator('input').first().fill('t');
			await dialog.locator('textarea').fill('b');
			await dialog.getByRole('button', { name: '提交' }).click();
			await expect(dialog.getByText('电脑上的 Aogiri 版本较旧')).toBeVisible();

			// 全自动 is a locked row until the computer allows this phone; an
			// escalation can only be denied here.
			await page.goto(`${base}?remoteHost&open=s-cache`);
			await expect(card).toBeVisible({ timeout: 30000 });
			await expect(card.getByText('这台手机不能批准这一项，请在电脑上处理，或在电脑上授权这台手机')).toBeVisible();
			await expect(card.getByRole('button', { name: /允许一次/ })).toHaveCount(0);
			await expect(card.getByRole('button', { name: /拒绝并告诉它怎么做/ })).toBeVisible();
			await page.locator('.flatbtn.mode').click();
			const full = page.getByRole('menuitemradio', { name: /全自动/ });
			await expect(full).toBeDisabled();
			await expect(full).toContainText('要先在电脑上授权这台手机');
			await page.keyboard.press('Escape');
			// Allowed on the computer: 全自动 can be picked, the escalation allowed.
			await page.goto(`${base}?remoteHost&open=s-cache&scopes=full_auto,full_access`);
			await expect(card).toBeVisible({ timeout: 30000 });
			await expect(card.getByRole('button', { name: /允许一次/ })).toBeVisible();
			await page.locator('.flatbtn.mode').click();
			await expect(page.getByRole('menuitemradio', { name: /全自动/ })).toBeEnabled();
			await page.keyboard.press('Escape');

			// The plan sheet does not dim the conversation: no scrim, not modal;
			// the conversation behind still scrolls and takes taps; a tap
			// outside closes it, so does a drag down past 40 px (not less).
			await page.goto(`${base}?remote&cards`);
			const chips = page.getByRole('region', { name: '计划和子智能体' });
			await expect(chips.locator('.chip')).toHaveCount(2, { timeout: 30000 });
			await chips.locator('.chip').first().click();
			const sheet = page.locator('.sheet[role="dialog"]');
			await expect(sheet).toHaveAttribute('aria-modal', 'false');
			// The step marks are the desktop's (PR #64): done struck through,
			// the current one with its dot and running light, the rest hollow.
			if (await sheet.locator('.step .tick').count()) {
				await expect(sheet.locator('.step.done .tick')).toHaveCount(3);
				await expect(sheet.locator('.step.active .dot')).toHaveCount(1);
				await expect(sheet.locator('.step.active .veil')).toHaveCount(1);
				await expect(sheet.locator('.step.pending .ring')).toHaveCount(3);
			}
			await expect(page.locator('.scrim')).toHaveCount(0);
			const style = await sheet.evaluate((el) => {
				const cs = getComputedStyle(el);
				return { animationDuration: cs.animationDuration, animationTimingFunction: cs.animationTimingFunction };
			});
			assert.equal(style.animationDuration, '0.55s');
			assert.equal(style.animationTimingFunction, 'cubic-bezier(0.32, 0.86, 0.28, 1)');
			await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
			// The conversation is not covered: what is above the sheet takes a
			// wheel and a tap (a tap closes the sheet, and lands).
			const scroll = page.locator('.session .scroll');
			// It made room: the conversation's end is above the sheet.
			await expect.poll(() => scroll.evaluate((el) => parseFloat(getComputedStyle(el).paddingBottom))).toBeGreaterThan(100);
			const box = await sheet.boundingBox();
			await page.mouse.move(195, box.y - 120);
			await page.mouse.wheel(0, -200);
			await expect.poll(() => scroll.evaluate((el) => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeGreaterThan(50);
			await expect(sheet).toBeVisible();
			await page.waitForTimeout(300);
			await page.mouse.click(195, box.y - 60);
			await expect(sheet, 'a tap outside closes the sheet').toHaveCount(0);
			// A short drag snaps back; a long one closes.
			await chips.locator('.chip').first().click();
			await sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
			const grab = sheet.locator('.grab');
			const g = await grab.boundingBox();
			await page.mouse.move(g.x + g.width / 2, g.y + 5);
			await page.mouse.down();
			await page.mouse.move(g.x + g.width / 2, g.y + 35, { steps: 4 });
			await page.mouse.up();
			await expect(sheet).toBeVisible();
			// (Snapped back: 0.3 s.)
			await page.waitForTimeout(400);
			const g2 = await grab.boundingBox();
			assert.ok(Math.abs(g2.y - g.y) < 2, `the sheet snapped back (${g2.y} vs ${g.y})`);
			await page.mouse.move(g.x + g.width / 2, g.y + 5);
			await page.mouse.down();
			await page.mouse.move(g.x + g.width / 2, g.y + 90, { steps: 6 });
			await page.mouse.up();
			await expect(sheet, 'a drag past 40 px closes the sheet').toHaveCount(0);
			// The chip toggles it.
			await chips.locator('.chip').first().click();
			await expect(sheet).toBeVisible();
			await chips.locator('.chip').first().click();
			await expect(sheet, 'the chip closes its sheet').toHaveCount(0);

			// The bar: three tabs (会话 · 工作台 · 需求) and the round 派一件事.
			await page.goto(`${base}?remoteHost&bench`);
			const nav = page.locator('nav');
			await expect(nav.locator('.tabs button')).toHaveText([/会话/, /工作台/, /需求/], { timeout: 30000 });
			const go = nav.getByRole('button', { name: '派一件事' });
			const goBox = await go.boundingBox();
			assert.ok(Math.abs(goBox.width - 56) < 1 && Math.abs(goBox.height - 56) < 1, `round button 56×56 (${goBox.width}×${goBox.height})`);
			assert.ok(goBox.x + goBox.width <= 390 && goBox.y + goBox.height <= 844, 'the round button on screen');
			// 工作台: the number cards, the deck one card at a time.
			await nav.getByRole('button', { name: /工作台/ }).click();
			const stats = page.locator('.stats');
			await expect(stats.locator('.cell')).toHaveText([/4\s*等你处理/, /1\s*进行中/, /42\s*%\s*今天用量/]);
			const deck = page.locator('.deck');
			await expect(page.locator('.deck-h')).toContainText('第 1/4 件');
			const firstTitle = await deck.locator('.title').textContent();
			// A sideways swipe of 44 px or more turns the card.
			const d = await deck.boundingBox();
			const swipe = async (from, to) => {
				await page.mouse.move(from, d.y + 30);
				await page.mouse.down();
				await page.mouse.move(to, d.y + 34, { steps: 6 });
				await page.mouse.up();
			};
			await swipe(300, 230);
			await expect(page.locator('.deck-h')).toContainText('第 2/4 件');
			assert.notEqual(await deck.locator('.title').textContent(), firstTitle);
			// Too short: nothing. From the screen edge: the system's, nothing.
			await swipe(300, 270);
			await expect(page.locator('.deck-h')).toContainText('第 2/4 件');
			await swipe(385, 250);
			await expect(page.locator('.deck-h')).toContainText('第 2/4 件');
			// Back past the first: it says so.
			await swipe(150, 260);
			await expect(page.locator('.deck-h')).toContainText('第 1/4 件');
			await page.getByRole('button', { name: '上一件' }).click();
			await expect(page.getByRole('status')).toHaveText('已经是第一件');
			// An action is allowed from its card.
			await deck.getByRole('button', { name: '允许' }).click();
			await expect.poll(async () => (await ops()).some((o) => o.op === 'decide_action' && o.decision === 'allow')).toBe(true);
			// The cards stay under the title bar while the page scrolls.
			await page.evaluate(() => window.scrollTo(0, 400));
			await expect(stats).toHaveClass(/stuck/);
			await page.waitForTimeout(200);
			const top = await page.locator('.top').boundingBox();
			const st = await stats.boundingBox();
			assert.ok(Math.abs(st.y - (top.y + top.height)) < 14, `the cards under the title bar (${st.y} vs ${top.y + top.height})`);
			await page.screenshot({ path: `/tmp/phone-bench-${name}.png` });
			// The round button opens the dispatch composer, over any tab.
			await go.click();
			await expect(page.getByRole('heading', { name: /派发|新派发/ }).first()).toBeVisible();

			// A turn that ended with a next step: the recap card above the
			// composer, as on the desktop; 暂不 leaves a receipt under the reply.
			await page.goto(`${base}?remoteHost&open=s-docs`);
			await expect(page.locator('.session .title')).toHaveText('翻译文档', { timeout: 30000 });
			await expect(page.locator('.row.user')).toHaveCount(1);
			await page.evaluate(() => {
				const f = (frame) => window.__remoteSend({ session: 's-docs', ...frame });
				f({ type: 'user_message', content: '跑一遍单元测试' });
				f({ type: 'connecting' });
				f({ type: 'status', message: 'streaming' });
				f({ type: 'assistant_delta', delta: '12 个单元测试全部通过。' });
				f({ type: 'status', message: 'ready' });
				f({ type: 'prompt_suggestion', text: '提交并推送' });
			});
			const recap = page.locator('.session .recap-wrap .recap');
			await expect(recap).toBeVisible();
			await expect(recap.locator('.title')).toHaveText('本轮完成');
			await expect(recap.getByRole('button', { name: '提交并推送' })).toBeVisible();
			const rBox = await recap.boundingBox();
			const cBox = await page.locator('.composer').boundingBox();
			assert.ok(rBox.y + rBox.height <= cBox.y + 1, 'the recap card is above the composer');
			await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {}))));
			await page.screenshot({ path: `/tmp/phone-recap-${name}.png` });
			await recap.getByRole('button', { name: '暂不' }).click();
			await expect(recap).toHaveCount(0);
			await expect(page.locator('.thread')).toContainText('提交并推送');

			// Reduced motion: the sheet and the deck's cards only fade.
			const calm = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
			calm.on('pageerror', (e) => errors.push(e.message));
			await calm.goto(`${base}?remote&cards`);
			await calm.getByRole('region', { name: '计划和子智能体' }).locator('.chip').first().click();
			const calmSheet = calm.locator('.sheet[role="dialog"]');
			assert.match(await calmSheet.evaluate((el) => getComputedStyle(el).animationName), /sheet-fade$/);
			// (The app's reduced-motion rule may shorten it further; it never slides.)
			assert.ok(parseFloat(await calmSheet.evaluate((el) => getComputedStyle(el).animationDuration)) <= 0.15);
			const calmBox = await calmSheet.boundingBox();
			await calm.waitForTimeout(60);
			assert.deepEqual(await calmSheet.boundingBox(), calmBox, 'the sheet does not move');
			await calm.goto(`${base}?remoteHost&bench`);
			await calm.getByRole('button', { name: /工作台/ }).click();
			const calmCard = calm.locator('.deck .card');
			await expect(calmCard).toBeVisible({ timeout: 30000 });
			assert.match(await calmCard.evaluate((el) => getComputedStyle(el).animationName), /fade-only/);
			await calm.close();

			// The computer's side: a phone that paired asks to be confirmed with
			// its check code; a paired phone's scopes are switched there.
			const desk = await browser.newPage({ viewport: { width: 1280, height: 860 } });
			desk.on('pageerror', (e) => errors.push(e.message));
			await desk.goto(`${base}?shell&settings=chat&pending`);
			await desk.getByRole('button', { name: '远程访问', exact: true }).click();
			const ask = desk.getByRole('alertdialog', { name: 'Pixel 想连接这台电脑' });
			await expect(ask).toBeVisible({ timeout: 30000 });
			await expect(ask.locator('.check')).toHaveText('482 913');
			await ask.getByRole('button', { name: '一样，确认' }).click();
			await expect(ask).toHaveCount(0, { timeout: 10000 });
			const deskOps = () => desk.evaluate(() => window.__ops.map((o) => ({ ...o, id: undefined })));
			assert.ok((await deskOps()).some((o) => o.op === 'device_confirm' && o.device === 'dev-new'), 'device_confirm sent');
			await desk.getByRole('button', { name: 'iPhone' }).click();
			await expect(desk.getByText('这台手机还可以')).toBeVisible();
			await desk.getByRole('switch', { name: '切换到全自动' }).click();
			await expect.poll(async () => (await deskOps()).filter((o) => o.op === 'device_scopes').at(-1)?.scopes).toEqual(['full_auto']);
			await expect(desk.getByRole('switch', { name: '切换到全自动' })).toHaveAttribute('aria-checked', 'true');
			await expect(desk.getByRole('switch', { name: '打开终端' })).toHaveAttribute('aria-checked', 'false');
			await desk.waitForTimeout(400);
			await desk.screenshot({ path: `/tmp/desk-device-scopes-${name}.png` });
			// Adding a device and closing its code takes the code back.
			await desk.getByRole('button', { name: '添加设备' }).click();
			await desk.locator('.code').getByRole('button', { name: '关闭' }).click();
			await expect.poll(async () => (await deskOps()).some((o) => o.op === 'pair_cancel')).toBe(true);
			await desk.close();
			assert.deepEqual(errors, [], 'no page errors');
			console.log(`${name}: PHONE CHECKS PASSED`);
		} catch (e) {
			failed = true;
			console.error(`${name}: FAILED`, e, errors);
		} finally {
			await browser.close();
		}
	}
} finally {
	await server.close();
}
process.exit(failed ? 1 : 0);
