// Run this worktree's Vite on 127.0.0.1:5199; set CHROMIUM_PATH to the installed browser.
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 650 } });
  await page.route('http://127.0.0.1:5199/', r => r.fulfill({ contentType: 'text/html', body: '<html><link rel="stylesheet" href="/style.css"><body><div id="limits" class="limits" style="position:relative;margin:40px;width:350px"></div></body></html>' }));
  await page.goto('http://127.0.0.1:5199/');
  await page.evaluate(async () => {
    const { store } = await import('/state.ts');
    const { renderLimits } = await import('/ui/limits.ts');
    window.fixture = { store, renderLimits };
    store.workers = new Map(['Alice', 'Bob'].map(name => [name, { id: name, name, kind: 'agent', provider: 'codex' }]));
    renderLimits();
  });
  assert.equal(await page.getByText('Codex: limits unavailable', { exact: true }).count(), 1);
  await page.evaluate(() => {
    const { store, renderLimits } = window.fixture;
    store.codexLimits = { at: Date.now(), windows: [{ label: '5h session', pct: 32, resetsAt: Date.now() + 3600000 }, { label: 'Week', pct: 61 }] };
    renderLimits();
  });
  assert.equal(await page.getByText('Codex', { exact: true }).count(), 1);
  assert.equal(await page.getByRole('progressbar').count(), 2);
  assert.equal(await page.getByText(/Alice|Bob/).count(), 0);
  await page.screenshot({ path: '/tmp/issue8-codex-limits.png' });
  await page.evaluate(() => {
    const { store, renderLimits } = window.fixture;
    store.workers.clear();
    store.codexLimits.at = Date.now() - 11 * 60000;
    renderLimits();
  });
  assert.equal(await page.getByRole('progressbar').count(), 2);
  assert.equal(await page.getByText(/^As of /).count(), 1);
  assert.equal(await page.locator('#limits.hidden').count(), 0);
  console.log('Shared Codex meter, unavailable state, worker removal and stale snapshot passed; screenshot /tmp/issue8-codex-limits.png');
} finally { await browser.close(); }
