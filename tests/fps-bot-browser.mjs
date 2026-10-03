// Run against a disposable built office; checks training isolation and real pointer sensitivity.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
const url = process.env.FPS_URL ?? 'http://127.0.0.1:4601';
const out = path.resolve(process.argv[2] ?? '../fps-bot-evidence'); mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : 'chrome', headless: true });
const contexts = [], errors = [];
async function lobby(name) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } }); contexts.push(context); context.setDefaultTimeout(20000);
  assert.ok((await context.request.post(`${url}/api/login`, { data: { password: process.env.FPS_PASSWORD ?? 'dev' } })).ok());
  await context.addInitScript(name => localStorage.setItem('agent-office.profile', JSON.stringify({ name, color: '#4f86f7', look: { skin: 0, hair: 0, style: 0 } })), name);
  const page = await context.newPage(); page.on('pageerror', e => errors.push(e.message));
  await page.goto(url); await page.waitForFunction(() => window.__office?.net.up && !document.querySelector('#loading')?.offsetParent);
  if (await page.locator('.backdrop .close').count()) await page.locator('.backdrop .close').last().click();
  await page.keyboard.press('F8'); return page;
}
const state = page => page.evaluate(() => window.__fps.state());
async function sensitivity(page, value) {
  await page.getByRole('slider', { name: '瞄准灵敏度' }).evaluate((input, value) => { input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
}
async function aimDelta(page) {
  await page.bringToFront(); await page.locator('#scene').click({ position: { x: 720, y: 500 } }); await page.waitForTimeout(200);
  return page.evaluate(() => {
    const p = window.__office.player, yaw = p.camYaw, pitch = p.lookPitch;
    window.dispatchEvent(new PointerEvent('pointermove', { movementX: 50, movementY: 20 }));
    return { yaw: yaw - p.camYaw, pitch: pitch - p.lookPitch };
  });
}
try {
  const a = await lobby('Trainee A');
  await sensitivity(a, .5);
  await a.getByRole('combobox', { name: 'AI 对手' }).selectOption('flanker');
  await a.getByRole('combobox', { name: '人机强度' }).selectOption('hard');
  await a.locator('.fps-practice-section').scrollIntoViewIfNeeded(); await a.screenshot({ path: path.join(out, 'ai-lobby.png') });
  await a.locator('.fps-practice').click(); await a.waitForFunction(() => window.__fps.active());
  const initial = await state(a); assert.equal(initial.phase, 'countdown'); assert.equal(initial.players.length, 2);
  assert.equal(initial.players.find(p => p.bot).difficulty, 'hard');
  const delta = await aimDelta(a); assert.ok(Math.abs(delta.yaw - .055) < 1e-8); assert.ok(Math.abs(delta.pitch - .022) < 1e-8);
  const b = await lobby('Trainee B');
  await b.getByRole('combobox', { name: 'AI 对手' }).selectOption('assault');
  await b.getByRole('combobox', { name: '人机强度' }).selectOption('easy');
  await b.locator('.fps-practice').click(); await b.waitForFunction(() => window.__fps.active());
  assert.notEqual((await state(a)).players[0].id, (await state(b)).players[0].id);
  assert.notEqual((await state(a)).players[1].id, (await state(b)).players[1].id);
  const c = await lobby('Human C'); await c.locator('.fps-join').click(); await c.waitForFunction(() => window.__fps.active());
  assert.equal((await state(c)).phase, 'waiting', 'private training leaves public arena empty');
  await a.bringToFront(); await a.keyboard.press('Escape'); await a.getByText('对战菜单', { exact: true }).waitFor();
  await sensitivity(a, 1.5);
  await a.getByRole('combobox', { name: 'AI 对手' }).selectOption('marksman');
  await a.getByRole('combobox', { name: '人机强度' }).selectOption('expert'); await a.locator('.fps-apply-bot').click();
  await a.waitForFunction(() => window.__fps.state().players.some(p => p.bot === 'marksman' && p.difficulty === 'expert'));
  assert.equal((await state(b)).players[1].difficulty, 'easy', 'changing own AI cannot change another training match');
  await a.waitForTimeout(200); await a.screenshot({ path: path.join(out, 'ai-settings.png') });
  await a.keyboard.press('Escape'); await a.waitForFunction(() => window.__office.player.hasMouse);
  const faster = await aimDelta(a); assert.ok(Math.abs(faster.yaw - .165) < 1e-8); assert.ok(Math.abs(faster.pitch - .066) < 1e-8);
  await a.waitForFunction(() => { const s = window.__fps.state(); return s.phase === 'intermission' && s.players[0].hp === 0 && s.players.some(p => p.bot && p.score > 0); }, null, { timeout: 25000 });
  assert.ok((await state(a)).players[0].hp === 0); await a.screenshot({ path: path.join(out, 'ai-round-win.png') });
  // A malicious config sent from a different client is restricted to that client's own training match.
  await c.evaluate(() => window.__office.net.send({ t: 'fps.bot', bot: { profile: 'assault', difficulty: 'easy' } }));
  await c.waitForTimeout(150); assert.equal((await state(a)).players[1].difficulty, 'expert');
  // Switch B from private practice to a human duel; the original two-seat match still starts normally.
  await b.bringToFront(); await b.keyboard.press('F8'); await b.locator('.fps-join').click();
  await b.waitForFunction(() => window.__fps.state().players.length === 2 && window.__fps.state().players.every(p => !p.bot));
  await c.waitForFunction(() => window.__fps.state().phase === 'live');
  assert.equal((await state(c)).players.length, 2); assert.ok((await state(b)).players.every(p => !p.bot));
  await a.bringToFront(); await a.keyboard.press('Escape'); await a.getByText('退出对战，返回办公室', { exact: true }).click();
  await a.waitForFunction(() => !window.__fps.active()); assert.equal(await a.evaluate(() => window.__office.player.lookSensitivity), 1);
  await a.reload(); await a.waitForFunction(() => window.__office?.net.up && !document.querySelector('#loading')?.offsetParent);
  if (await a.locator('.backdrop .close').count()) await a.locator('.backdrop .close').last().click();
  await a.keyboard.press('F8'); assert.equal(await a.getByRole('slider', { name: '瞄准灵敏度' }).inputValue(), '1.5');
  assert.equal(await a.getByRole('combobox', { name: 'AI 对手' }).inputValue(), 'marksman');
  assert.equal(await a.getByRole('combobox', { name: '人机强度' }).inputValue(), 'expert');
  await a.locator('.fps-dialog .close').click(); await a.waitForFunction(() => window.__office.player.hasMouse);
  assert.deepEqual(errors, []);
  console.log('PASS: selectable AI, private training isolation, difficulty changes/ownership, AI movement/fire/scoring, mouse sensitivity ratios and persistence, office restoration, PvP availability/mode switching, Esc/close mouse-look; no page errors.');
  console.log(`Screenshots: ${out}`);
} finally { await browser.close(); }
