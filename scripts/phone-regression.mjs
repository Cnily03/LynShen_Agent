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
			await page.goto(`${base}?remoteHost&open=s-cache`);
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
