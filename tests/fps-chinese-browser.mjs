// Chinese desktop UI and real movement/fire, including a browser without pointer lock.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const url = process.env.FPS_URL ?? 'http://127.0.0.1:4601';
const out = path.resolve(process.argv[2] ?? '../fps-chinese-evidence'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const errors = [];
let currentPage;
try {
  for (const fallback of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    assert.ok((await context.request.post(`${url}/api/login`, { data: { password: process.env.FPS_PASSWORD ?? 'dev' } })).ok());
    await context.addInitScript(fallback => {
      localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Open', color: '#4f86f7', look: { skin: 0, hair: 0, style: 0 } }));
      if (fallback) Object.defineProperty(HTMLElement.prototype, 'requestPointerLock', { value: undefined, configurable: true });
    }, fallback);
    const page = await context.newPage(); page.setDefaultTimeout(20000); page.on('pageerror', e => errors.push(e.message));
    currentPage = page;
    await page.goto(url); await page.waitForFunction(() => window.__office?.net.up && window.__agentOfficeZh && !document.querySelector('#loading')?.offsetParent);
    assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
    assert.ok(await page.evaluate(() => window.__agentOfficeZh.count >= 2400));
    if (await page.locator('.backdrop .close').count()) await page.locator('.backdrop .close').last().click();
    // The overlay must not translate the contents of a terminal or a user's task.
    const protectedText = await page.evaluate(async () => {
      const el = document.createElement('pre'); el.textContent = 'Open'; document.body.append(el);
      await new Promise(resolve => setTimeout(resolve, 200)); const result = el.textContent; el.remove(); return result;
    }); assert.equal(protectedText, 'Open');
    await page.screenshot({ path: path.join(out, `office-${fallback ? 'drag' : 'desktop'}.png`) });
    await page.keyboard.press('F8'); await page.getByText('单挑竞技场', { exact: true }).waitFor();
    await page.getByRole('combobox', { name: '人机强度' }).selectOption('easy');
    await page.screenshot({ path: path.join(out, `lobby-${fallback ? 'drag' : 'desktop'}.png`) });
    await page.locator('.fps-practice').click(); await page.waitForFunction(() => window.__fps.state()?.phase === 'live');
    await page.bringToFront(); await page.locator('#scene').click({ position: { x: 720, y: 500 } });
    if (!fallback) await page.waitForFunction(() => window.__office.player.hasMouse);
    const self = () => page.evaluate(() => window.__fps.state().players.find(p => p.id === window.__office.store.you));
    await page.evaluate(() => { window.__office.player.camYaw = 0; window.__office.player.lookPitch = 0; });
    const before = await self(); await page.keyboard.down('KeyA'); await page.waitForTimeout(350); await page.keyboard.up('KeyA');
    await page.waitForFunction(x => window.__fps.state().players.find(p => p.id === window.__office.store.you).x < x - .5, before.x);
    const ammo = (await self()).ammo; await page.mouse.down();
    await page.waitForFunction(ammo => window.__fps.state().players.find(p => p.id === window.__office.store.you).ammo < ammo, ammo);
    await page.mouse.up(); assert.ok((await self()).hp > 0);
    await page.getByText('生命值', { exact: true }).waitFor();
    assert.equal(await page.locator('.fps-team.blue > .peer-name').textContent(), 'Open');
    await page.screenshot({ path: path.join(out, `game-${fallback ? 'drag' : 'desktop'}.png`) });
    await page.keyboard.press('Escape'); await page.getByText('退出对战，返回办公室', { exact: true }).click();
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('PASS: Chinese office/lobby/HUD, protected user content, authoritative movement and shooting with pointer lock and drag fallback; no page errors.');
} catch (error) {
  console.log('Failure state:', await currentPage?.evaluate(() => ({ fps: window.__fps?.state(), active: window.__fps?.active(), errors: document.body.innerText.slice(-1000) })), errors);
  throw error;
} finally { await browser.close(); }
