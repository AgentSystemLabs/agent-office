// Headless interaction/visual acceptance against the actual session HTTP routes and disk store.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { requestHandler } from '../src/server/http/router.ts';
import { xrSessionRoute, xrBridgeRoute } from '../src/server/http/routes/xr-sessions.ts';
import { XrSessions } from '../src/server/xr-playtests/store.ts';
const dir = mkdtempSync(path.join(tmpdir(), 'xr-browser-'));
mkdirSync(path.join(dir, '.agent-office'));
writeFileSync(path.join(dir, '.agent-office/playtests.json'), JSON.stringify({ items: [
  { id: 'rift-grip', revision: 1, title: 'RIFT: Pistole bleibt sicher in der Hand', category: 'Waffen', steps: 'Pistole greifen und drehen. Griff gedrückt halten.', expected: 'Die Pistole bleibt in der Hand.', modes: ['RIFT'], playStyles: ['solo'], notes: '', done: false, source: '', createdAt: new Date().toISOString(), createdBy: 'Tester' },
  { id: 'rb-lobby', revision: 1, title: 'RB: Lobby und Armory öffnen', category: 'Menü', steps: 'Armory in der RB-Lobby öffnen.', expected: 'Alle Karten sichtbar.', modes: ['RB'], playStyles: [], notes: '', done: false, source: '', createdAt: new Date().toISOString(), createdBy: 'Tester' }
] }));
const sessions = new XrSessions(dir);
const ctx = { cfg: { port: 0, trustProxy: false }, services: { lookup: () => undefined }, auth: { fromRequest: () => ({ account: { id: 'tester', name: 'Tester' } }) }, floors: new Map([['lab', { dir }]]) };
const handler = requestHandler(ctx, [xrSessionRoute, xrBridgeRoute]);
const vite = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'xr-acceptance', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url.startsWith('/api/playtests/xr-')) return void handler(req, res);
    if (req.url.startsWith('/api/playtests?')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ items: sessions.tests() })); }
    if (req.url !== '/__xr-test') return next();
    res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#29374a;font-family:Arial}#modal-root{position:fixed;inset:0}</style><div id="modal-root"></div><div id="toasts"></div><script type="module">import '/src/client/styles/base.css';import {store} from '/src/client/state/index.ts';import {openPlaytests} from '/src/client/ui/playtests/index.ts';store.floor='lab';openPlaytests();</script></html>`);
  });
} }] });
let browser;
try {
  await vite.listen(); const port = vite.httpServer.address().port;
  browser = await chromium.launch({ executablePath: process.env.XR_TEST_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }); const errors = []; page.on('pageerror', e => { errors.push(e.message); console.error(e.message); });
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()); });
  page.on('response', response => { if (response.status() >= 400) console.error(response.status(), response.url()); });
  await page.goto(`http://127.0.0.1:${port}/__xr-test`);
  await page.getByRole('button', { name: '🥽 Headset-Testbegleitung', exact: true }).click();
  assert.equal(await page.getByRole('dialog').count(), 1, 'global session replaces checklist; closing returns to game');
  const started = page.waitForResponse(r => r.url().includes('xr-session') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Headset-Testbegleitung starten', exact: true }).click();
  const pair = await (await started).json();
  const inventory = [{ serial: 'quest-test', name: 'Quest 3 · Testgerät', status: 'device' }];
  const feed = (snapshots = {}) => sessions.ingest(pair.id, pair.token, { bridgeId: 'browser-test-12345', devices: inventory, snapshots });
  feed(); await page.getByLabel('Quest 3 · Testgerät', { exact: true }).check();
  await page.getByRole('button', { name: 'Mit ausgewählten Headsets begleiten' }).click();
  let sequence = 0;
  const heartbeat = setInterval(() => feed({ 'quest-test': { protocol: 1, appSession: 'test-app', sequence: ++sequence, role: 'solo',
    context: { mode: 'RIFT', style: 'solo', phase: 'playing', build: 'Testbuild 2026.10.11', focused: true, connected: true, sampledAt: Date.now() }, signals: { 'right.held': 'Pistol', 'right.tracking': true, foveation: 'Off' }, events: [] } }), 500);
  try {
    await page.getByText('Begleitung aktiv · 2 passende Tests', { exact: true }).waitFor();
    await page.getByText('Aktiv · RIFT: Pistole bleibt sicher in der Hand', { exact: true }).click();
    await page.getByLabel('Technisches Kriterium').first().selectOption('right.tracking');
    await page.getByLabel('Erwarteter Wert').first().fill('true');
    await page.getByRole('button', { name: 'Voraussetzungen speichern' }).first().click();
    await page.locator('.xr-status').click();
    await page.getByText(/Technisches Kriterium erfüllt/).first().waitFor();
    const output = process.env.XR_SCREENSHOT_DIR || 'E:/source/agent-office-deployment/xr-screenshots'; mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'session-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(output, 'session-mobile.png'), fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
    await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
    assert.deepEqual(errors, []);
    console.log('Browser acceptance passed: global start, pairing, selection, live criterion, desktop/mobile, Esc.');
  } finally { clearInterval(heartbeat); }
} finally { await browser?.close(); await vite.close(); rmSync(dir, { recursive: true, force: true }); }

