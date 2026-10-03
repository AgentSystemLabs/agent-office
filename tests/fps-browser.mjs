// Integration check against a running office: FPS_URL and FPS_PASSWORD select a disposable instance.
// node tests/fps-browser.mjs [screenshot-directory]
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const url = process.env.FPS_URL ?? 'http://127.0.0.1:4601';
const out = path.resolve(process.argv[2] ?? '../fps-evidence'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const errors = [], contexts = [];
async function join(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } }); contexts.push(context); context.setDefaultTimeout(20000);
  const login = await context.request.post(`${url}/api/login`, { data: { password: process.env.FPS_PASSWORD ?? 'dev' } });
  assert.equal(login.ok(), true);
  await context.addInitScript(name => localStorage.setItem('agent-office.profile', JSON.stringify({ name, color: '#4f86f7', look: { skin: 0, hair: 0, style: 0 } })), name);
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForFunction(() => window.__office?.net.up && !document.querySelector('#loading')?.offsetParent);
  if (await page.locator('.backdrop .close').count()) await page.locator('.backdrop .close').last().click();
  await page.evaluate(() => {
    window.__shotChecks = [];
    window.__office.net.onMessage(msg => {
      if (msg.t !== 'fps.shot') return;
      const p = window.__office.player;
      window.__shotChecks.push({ shot: msg.shot, yaw: p.camYaw, pitch: p.lookPitch, sounds: window.__fps.sounds() });
    });
  });
  await page.keyboard.press('F8');
  await page.locator('.fps-lobby-art').evaluate(img => img.decode());
  await page.screenshot({ path: path.join(out, `${name}-lobby.png`) });
  await page.locator('.fps-join').click(); return page;
}
async function state(page) { return page.evaluate(() => window.__fps.state()); }
async function self(page) { return page.evaluate(() => window.__fps.state().players.find(p => p.id === window.__office.store.you)); }
async function pointAt(page, target, pitch = 0) {
  await page.bringToFront(); await page.locator('#scene').click({ position: { x: 720, y: 450 } });
  await page.evaluate(({ target, pitch }) => {
    const me = window.__fps.state().players.find(p => p.id === window.__office.store.you);
    window.__office.player.camYaw = Math.atan2(-(target.x - me.x), -(target.z - me.z)); window.__office.player.lookPitch = pitch;
  }, { target, pitch });
}

try {
  const a = await join('Alpha'); await a.waitForFunction(() => window.__fps.active());
  assert.equal((await state(a)).phase, 'waiting');
  await a.waitForFunction(() => [...performance.getEntriesByType('resource')].filter(r => /\/(concrete|metal|wood)-[^/]+\.jpg$/.test(new URL(r.name).pathname)).length === 3);
  await a.screenshot({ path: path.join(out, 'waiting.png') });
  const b = await join('Bravo');
  await a.waitForFunction(() => window.__fps.state()?.phase === 'live'); await b.waitForFunction(() => window.__fps.state()?.phase === 'live');
  assert.equal((await state(a)).players.length, 2);
  const third = await join('Spectator');
  await third.getByText('竞技场已有两位玩家', { exact: false }).waitFor(); assert.equal(await third.evaluate(() => window.__fps.active()), false);
  await contexts[2].close();
  // A blocked shot produces wood feedback, no hit cue or blood; the camera never kicks.
  await pointAt(a, { x: -11, z: 3 }); await a.waitForTimeout(120);
  const blockedAim = await a.evaluate(() => ({ yaw: window.__office.player.camYaw, pitch: window.__office.player.lookPitch }));
  await a.mouse.down(); await a.waitForFunction(() => window.__shotChecks.length > 0); await a.mouse.up();
  const blocked = await a.evaluate(() => ({ last: window.__shotChecks[0], yaw: window.__office.player.camYaw, pitch: window.__office.player.lookPitch }));
  assert.equal(blocked.last.shot.hit, null); assert.ok(blocked.last.sounds['fps-wood'] > 0);
  assert.equal(blocked.last.sounds['fps-hit'] ?? 0, 0); assert.equal(blocked.pitch, blockedAim.pitch); assert.equal(blocked.yaw, blockedAim.yaw);
  // Walk both players into the open west lane using real browser keyboard events.
  for (const [page, duration] of [[a, 650], [b, 5250]]) {
    await page.bringToFront(); await page.locator('#scene').click({ position: { x: 720, y: 450 } });
    await page.evaluate(() => { window.__office.player.camYaw = 0; window.__office.player.lookPitch = 0; });
    const before = await self(page); await page.keyboard.down('KeyA'); await page.waitForTimeout(duration); await page.keyboard.up('KeyA'); await page.waitForTimeout(150);
    assert.ok((await self(page)).x < before.x - 1, 'keyboard movement reaches authority');
  }
  // Close the distance through the clear outer lane so the short blood burst is visible in the screenshot.
  await a.bringToFront(); await a.locator('#scene').click({ position: { x: 720, y: 450 } });
  await a.evaluate(() => { window.__office.player.camYaw = 0; window.__office.player.lookPitch = 0; });
  await a.keyboard.down('KeyW'); await a.waitForTimeout(2200); await a.keyboard.up('KeyW'); await a.waitForTimeout(150);
  const target = await self(b), shooter = await self(a);
  await pointAt(a, target, Math.atan2(.9 - 1.55, Math.hypot(target.x - shooter.x, target.z - shooter.z)));
  await a.waitForTimeout(150); await a.screenshot({ path: path.join(out, 'duel.png') });
  const aim = await a.evaluate(() => ({ yaw: window.__office.player.camYaw, pitch: window.__office.player.lookPitch }));
  const targetAim = await b.evaluate(() => ({ yaw: window.__office.player.camYaw, pitch: window.__office.player.lookPitch }));
  // Real sustained input continues while the first body impact renders.
  const start = await self(a);
  await a.keyboard.down('KeyS'); await a.mouse.down();
  await a.waitForFunction(() => window.__shotChecks.some(c => c.shot.hit && !c.shot.headshot));
  await a.mouse.up();
  await a.screenshot({ path: path.join(out, 'body-impact.png') });
  await a.keyboard.up('KeyS'); await a.waitForTimeout(150);
  assert.ok((await self(a)).ammo < 30); assert.ok((await self(b)).hp < 100 && (await self(b)).hp > 0);
  assert.ok(Math.hypot((await self(a)).x - start.x, (await self(a)).z - start.z) > .05, 'movement continues during hit feedback');
  const afterAim = await a.evaluate(() => ({ yaw: window.__office.player.camYaw, pitch: window.__office.player.lookPitch }));
  assert.deepEqual(afterAim, aim, 'firing leaves aim unchanged');
  const afterTargetAim = await b.evaluate(() => ({ yaw: window.__office.player.camYaw, pitch: window.__office.player.lookPitch }));
  assert.deepEqual(afterTargetAim, targetAim, 'being hit leaves aim unchanged');
  assert.ok((await b.evaluate(() => window.__fps.sounds()))['fps-hurt'] > 0);
  const spent = 30 - (await self(a)).ammo;
  await a.keyboard.press('KeyR'); await a.waitForFunction(() => window.__fps.state().players.find(p => p.id === window.__office.store.you).reloadUntil > 0);
  await a.screenshot({ path: path.join(out, 'reload.png') });
  await a.waitForFunction(() => { const p = window.__fps.state().players.find(p => p.id === window.__office.store.you); return p.reloadUntil === 0 && p.ammo === 30; });
  assert.equal((await self(a)).reserve, 90 - spent);
  await pointAt(a, await self(b)); await a.waitForTimeout(120); await a.mouse.down(); await a.waitForTimeout(100); await a.mouse.up();
  await a.waitForFunction(() => window.__fps.state()?.phase === 'intermission');
  assert.equal((await self(a)).score, 1); assert.equal((await self(b)).hp, 0);
  assert.ok((await a.evaluate(() => window.__fps.sounds()))['fps-headshot'] > 0);
  assert.equal(await a.locator('.fps-hit').getAttribute('aria-label'), '爆头命中');
  await a.screenshot({ path: path.join(out, 'round-win.png') });
  console.log('Combat passed; checking modal controls');
  await a.keyboard.press('Escape'); await a.getByText('对战菜单', { exact: true }).waitFor();
  await a.keyboard.press('Escape'); await a.waitForFunction(() => window.__office.player.hasMouse); console.log('Esc resumes mouse-look');
  await a.keyboard.press('Escape'); await a.getByText('退出对战，返回办公室', { exact: true }).click();
  await a.waitForFunction(() => !window.__fps.active()); await b.waitForFunction(() => window.__fps.state()?.phase === 'waiting');
  assert.equal((await self(b)).score, 0);
  await a.waitForTimeout(300); assert.equal(await a.evaluate(() => window.__fps.active()), false, 'queued snapshots do not re-enter a left match');
  await a.keyboard.press('F8'); await a.locator('.fps-dialog .close').click(); await a.waitForFunction(() => window.__office.player.hasMouse);
  assert.deepEqual(errors, []);
  console.log('PASS: join, full-arena rejection, movement, cover/body/headshot audio, steady aim while firing/taking hits, movement during feedback, reload, scoring, Esc/✕ mouse-look restore, leave/reset; no page errors.');
  console.log(`Screenshots: ${out}`);
} finally { await browser.close(); }
