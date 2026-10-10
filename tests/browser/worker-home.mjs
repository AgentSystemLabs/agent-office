// Run with: node tests/browser/worker-home.mjs [screenshot path]
import assert from 'node:assert/strict';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const root = path.resolve(import.meta.dirname, '../..');
const server = await createServer({
  configFile: false, root: path.join(root, 'src/client'),
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { host: '127.0.0.1', port: 0, hmr: false, watch: null },
  plugins: [{ name: 'warning-fixture', configureServer(s) {
    s.middlewares.use('/__warning', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<link rel="stylesheet" href="/style.css"><body><canvas id="scene" tabindex="-1"></canvas><div id="hint"></div><div id="modal-root"></div><div id="toasts"></div></body>');
    });
  } }],
});
await server.listen();
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__warning`);
  await page.evaluate(async () => {
    const { requestWorkerHome } = await import('/ui/worker-home.ts');
    const { store } = await import('/state/index.ts');
    const { installFocus } = await import('/input/focus.ts');
    window.sent = [];
    window.locks = 0;
    const player = { enabled: true, canLock: true, hasMouse: false, clearKeys() {}, yieldMouse() {}, unlock() {}, lock() { window.locks++; } };
    installFocus({ player, me: { read() {} }, hands: { read() {} }, canvas: document.getElementById('scene'), net: { send() {} }, hint: { invalidate() {} }, windowOpened: { run() {} } }, {}, { telescope: { exit() {} }, walking: { stopWalkingTo() {} } });
    window.state = store;
    store.floor = 'test-floor';
    store.workers.set('pixel', { id: 'pixel', name: 'Pixel', kind: 'agent', status: 'done' });
    store.queue = { maxWorkers: 2, tasks: [{ id: 'task-285', workerId: 'pixel', issue: 285, title: 'Thrown corpses: knockdown and get-up', status: 'running' }] };
    store.issues = { items: [{ number: 285, title: 'Thrown corpses', state: 'OPEN' }], loading: false };
    store.pulls = { items: [], loading: false };
    window.show = () => requestWorkerHome({ send: (m) => window.sent.push(m) }, { t: 'worker.kill', workerId: 'pixel', cleanup: 'keep' });
    window.show();
  });
  const dialog = page.getByRole('alertdialog');
  assert.match(await dialog.innerText(), /Issue #285/);
  assert.match(await dialog.innerText(), /not completed, closed, merged or automatically handed/);
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Keep worker here');
  if (process.argv[2]) await page.screenshot({ path: process.argv[2], fullPage: true });
  for (const close of ['Keep worker here', 'Close', 'Escape']) {
    const before = await page.evaluate(() => window.locks);
    if (close === 'Escape') await page.keyboard.press('Escape');
    else await page.getByRole('button', { name: close, exact: true }).click();
    await page.waitForFunction((n) => window.locks > n, before);
    assert.equal(await dialog.count(), 0);
    assert.equal(await page.evaluate(() => window.sent.length), 0);
    await page.evaluate(() => window.show());
  }
  // New work assigned while the warning was open must be acknowledged too.
  await page.evaluate(() => window.state.queue.tasks.push({ id: 'new', workerId: 'pixel', title: 'New assignment', status: 'running' }));
  await page.getByRole('button', { name: 'Send home anyway' }).click();
  assert.match(await dialog.innerText(), /New assignment/);
  assert.equal(await page.evaluate(() => window.sent.length), 0);
  await page.getByRole('button', { name: 'Send home anyway' }).click();
  assert.deepEqual(await page.evaluate(() => window.sent), [{ t: 'worker.kill', workerId: 'pixel', cleanup: 'keep' }]);
  // Changing floors while the modal is open must never dismiss an unrelated worker.
  await page.evaluate(() => { window.show(); window.state.floor = 'another-floor'; });
  await page.getByRole('button', { name: 'Send home anyway' }).click();
  assert.equal(await page.evaluate(() => window.sent.length), 1);
  // Completed work does not add another confirmation.
  await page.evaluate(() => {
    window.state.floor = 'test-floor';
    window.state.queue.tasks = [];
    window.state.issues.items = [];
    window.show();
  });
  assert.equal(await page.evaluate(() => window.sent.length), 2);
  assert.equal(await dialog.count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: warning, safe default, Cancel/Close/Esc mouse-look, new-work recheck, explicit confirmation, floor-change guard, completed-work bypass.');
} finally {
  await browser.close();
  server.httpServer.closeAllConnections();
  await server.close();
}
