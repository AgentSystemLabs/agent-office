// Uses the real authenticated HTTP routes/store; a broken fixture build verifies failed-build UX.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';
import { requestHandler } from '../dist/server/server/http/router.js';
import { devApkRoute } from '../dist/server/server/http/routes/dev-apk.js';
import { atomic, jobDir, projectFor, rootFor, saveJob } from '../dist/server/server/dev-apk/storage.js';
import { publish } from '../dist/server/server/dev-apk/runner.js';
import { view } from '../dist/server/server/dev-apk/manager.js';
const dir = mkdtempSync(path.join(tmpdir(), 'apk-browser-')), source = path.join(dir, 'source');
mkdirSync(path.join(source, 'Tools'), { recursive: true });
writeFileSync(path.join(source, 'Tools/Build-Quest.ps1'), "throw 'Fixture build failed'");
writeFileSync(path.join(source, 'Tools/BuildLock.ps1'), "throw 'Fixture build failed before Unity starts'");
const config = { repo: 'owner/game', sourceDir: source, buildDir: path.join(dir, 'build'), ref: 'origin/main', apkName: 'Game-dev.apk' };
atomic(path.join(dir, 'dev-apk.json'), { projects: [config] });
const root = rootFor(dir), project = projectFor(config.repo);
const job = { id: randomUUID(), project, config, pid: process.pid, status: 'publishing', requestedBy: 'Kajo', startedAt: Date.now(), ref: 'origin/main' };
saveJob(root, job); const folder = jobDir(root, project, job.id);
writeFileSync(path.join(folder, 'app.apk.part'), Buffer.from('PK\x03\x04fixture APK')); writeFileSync(path.join(folder, 'revision.txt'), 'b'.repeat(40)); await publish(root, job);
const session = { account: { id: 'admin', name: 'Kajo', role: 'admin' } };
const ctx = { cfg: { dataDir: dir, port: 0, trustProxy: false }, services: { lookup: () => undefined }, auth: { fromRequest: () => session }, floors: new Map([['game', { def: { repo: config.repo } }]]) };
const handler = requestHandler(ctx, [devApkRoute]);
const vite = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'apk-acceptance', configureServer(server) {
  server.middlewares.use((req, res, next) => {
    if (req.url.startsWith('/api/dev-apk')) return void handler(req, res);
    if (req.url !== '/__apk-test') return next();
    res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;background:#8195aa;font-family:Arial}#modal-root{position:fixed;inset:0}</style><div id="modal-root"></div><script type="module">import '/src/client/styles/base.css';import {store} from '/src/client/state/index.ts';import {openDevApk} from '/src/client/ui/dev-apk/index.ts';store.floor='game';window.show=()=>openDevApk();window.show();</script></html>`);
  });
} }] });
let browser;
try {
  await vite.listen(); const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.APK_TEST_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message)); await page.goto(origin + '/__apk-test');
  await page.getByRole('link', { name: 'APK herunterladen', exact: true }).waitFor();
  const post = page.waitForResponse(r => r.request().method() === 'POST' && r.url().includes('/api/dev-apk'));
  await page.getByRole('button', { name: 'Dev-APK bauen', exact: true }).click(); assert.equal((await post).status(), 202);
  await page.getByText(/Build fehlgeschlagen/).waitFor({ timeout: 30000 });
  assert.equal(view(dir, config.repo, session).latest.id, job.id);
  const download = await page.request.get(new URL(await page.getByRole('link', { name: 'APK herunterladen', exact: true }).getAttribute('href'), origin).href);
  assert.equal(download.status(), 200); assert.equal((await download.body()).subarray(0, 4).toString('hex'), '504b0304');
  const output = process.env.APK_SCREENSHOT_DIR || 'E:/source/agent-office-deployment/dev-apk-screenshots'; mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
  await page.evaluate(() => window.show()); await page.getByRole('button', { name: 'Close', exact: true }).click(); assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(errors, []); console.log('PASS: actual build trigger/failure, previous download, desktop/mobile, Escape and close.');
} finally { await browser?.close(); await vite.close(); rmSync(dir, { recursive: true, force: true }); }
