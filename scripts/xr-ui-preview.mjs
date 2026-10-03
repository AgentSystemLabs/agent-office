/**
 * Headless preview of the VR keyboard and left-hand palette card canvases (no headset needed).
 * Writes scripts/xr-ui-preview.png for the PR.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const root = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(root, 'xr-ui-preview.png');

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>VR UI preview</title>
<style>
  body { margin: 0; background: #0f111a; font: 14px ui-sans-serif, system-ui; color: #f2f2f7; }
  h1 { margin: 16px 24px 8px; font-size: 18px; }
  .row { display: flex; gap: 24px; padding: 16px 24px; align-items: flex-start; }
  canvas { background: #1b1d2b; border-radius: 16px; box-shadow: 0 8px 0 #0006; }
  figcaption { margin-top: 8px; font-weight: 700; color: #a6adc8; }
</style></head>
<body>
  <h1>VR UI — keyboard & left-hand card (canvas preview)</h1>
  <div class="row">
    <figure><canvas id="kb" width="1400" height="520"></canvas><figcaption>Virtual keyboard</figcaption></figure>
    <figure><canvas id="card" width="512" height="720"></canvas><figcaption>Left-hand palette card</figcaption></figure>
  </div>
  <script>
    function roundRect(g, x, y, w, h, r) {
      g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
    }
    function paintKb(c) {
      const g = c.getContext('2d');
      g.fillStyle = '#1b1d2b'; roundRect(g, 0, 0, c.width, c.height, 28);
      const rows = ['\` 1 2 3 4 5 6 7 8 9 0 ⌫', '⇥ q w e r t y u i o p Esc', '⇪ a s d f g h j k l ⏎', '⇧ z x c v b n m , . / ⇧', '?123 🎤 ␣ ← ↑ ↓ → ⬇'];
      let y = 40;
      for (const row of rows) {
        const keys = row.split(' ');
        const unit = (c.width - 24 - 8 * (keys.length - 1)) / keys.reduce((n, k) => n + (k === '␣' ? 6 : k.length > 1 ? 1.4 : 1), 0);
        let x = 12;
        for (const k of keys) {
          const w = unit * (k === '␣' ? 6 : k.length > 1 ? 1.4 : 1);
          g.fillStyle = '#2d3047'; roundRect(g, x, y, w, 72, 14);
          g.fillStyle = '#f2f2f7'; g.font = '700 28px ui-sans-serif, system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
          g.fillText(k, x + w / 2, y + 36); g.textAlign = 'left';
          x += w + 8;
        }
        y += 80;
      }
    }
    function paintCard(c) {
      const g = c.getContext('2d');
      g.fillStyle = '#1b1d2b'; roundRect(g, 0, 0, c.width, c.height, 24);
      g.fillStyle = '#f2f2f7'; g.font = '800 28px ui-sans-serif'; g.textBaseline = 'middle'; g.fillText('Office', 16, 28);
      const labels = ['🔎 Find', '☰ Menu', '⏭ Next waiting', '📋 Queue', '📌 Issues', '🔀 PRs', '✨ Hire', '⌨ Keyboard', '🎤 Dictate', '🚪 Exit VR'];
      let y = 52;
      for (const label of labels) {
        g.fillStyle = '#2d3047'; roundRect(g, 16, y, c.width - 32, 56, 12);
        g.fillStyle = '#f2f2f7'; g.font = '700 22px ui-sans-serif'; g.textAlign = 'center';
        g.fillText(label, c.width / 2, y + 28); g.textAlign = 'left';
        y += 66;
      }
    }
    paintKb(document.getElementById('kb'));
    paintCard(document.getElementById('card'));
    document.title = 'ready';
  </script>
</body></html>`;

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(html);
});

await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(`http://127.0.0.1:${port}/`);
await page.waitForFunction(() => document.title === 'ready');
mkdirSync(root, { recursive: true });
await page.screenshot({ path: out, fullPage: true });
await browser.close();
server.close();
console.log('wrote', out);
