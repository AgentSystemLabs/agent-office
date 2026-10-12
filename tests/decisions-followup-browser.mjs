import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from 'playwright-core';

const now = Date.now();
const item = {
  id: 'decision-fixture', revision: 4, status: 'answered', createdAt: now - 5000, updatedAt: now,
  createdBy: 'Issues Agent', owner: 'owner', workers: [], canAnswer: true,
  title: 'Rift-Münzgeschenk: Empfänger und Betrag', question: 'Wie soll das Geschenk funktionieren?',
  context: 'Der Mensch hat den Empfänger und die Obergrenze festgelegt.',
  options: [], recommendation: '', category: 'Design & UX', tags: ['RIFT', 'Coins'], issues: [376],
  blocking: false, blockingReason: '', answer: 'Empfänger wählen; maximal 1000 Münzen je Welle.',
  answeredBy: 'Kajo', answeredAt: now - 1000, history: [],
  followup: { answerAt: now - 1000, status: 'issue_linked', updatedAt: now,
    issueNumbers: [4242], evidence: '', note: 'Offenes Folge-Issue erfasst; Umsetzung steht noch aus.' },
};
const vite = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 },
  plugins: [{ name: 'decision-followup-acceptance', configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url?.startsWith('/api/decisions')) { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ repo: 'owner/game', items: [item] })); return; }
      if (req.url !== '/__decision-test') return next();
      res.setHeader('content-type', 'text/html'); res.end(`<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="modal-root"></div><script type="module">import '/src/client/styles/base.css';import {store} from '/src/client/state/index.ts';import {openDecisions} from '/src/client/features/decisions/ui.ts';store.floor='game';openDecisions();</script></html>`);
    });
  } }] });
let browser;
try {
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  browser = await chromium.launch({ executablePath: process.env.OFFICE_TEST_BROWSER || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(origin + '/__decision-test');
  await page.getByRole('combobox', { name: 'Status' }).selectOption('followup');
  await page.getByText('Rift-Münzgeschenk: Empfänger und Betrag').click();
  await page.getByText('Umsetzung: Issue erfasst').waitFor();
  assert.match(await page.getByRole('dialog').innerText(), /Umsetzung noch offen/);
  assert.match(await page.getByRole('dialog').innerText(), /maximal 1000 Münzen je Welle/);
  const output = process.env.DECISION_SCREENSHOT_DIR || path.join(process.cwd(), '.agent-office', 'decision-screenshots');
  mkdirSync(output, { recursive: true });
  await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.keyboard.press('Escape'); assert.equal(await page.getByRole('dialog').count(), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: decision follow-up, owner actions, mobile layout, Esc. Screenshots:', output);
} finally { await browser?.close(); await vite.close(); }
