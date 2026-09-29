// Screenshots a lab page in a headless browser, for checking a model by eye without opening one:
//
//   node src/client/lab/shot.mjs <url> <out.png> [width] [height]
//
// e.g. node src/client/lab/shot.mjs "http://localhost:5173/lab/props.html?show=jukebox&t=2" jukebox.png
// It waits for the page's window.__ready (see stage.ts), prints it, and prints any console errors.
// The page needs the Vite dev server running (npm run dev, or npx vite). It uses the installed Edge on
// Windows and Chrome elsewhere; LAB_BROWSER=chrome|msedge|chromium picks one.
import { chromium } from 'playwright-core';

const [url, out, w = '1280', h = '800'] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node src/client/lab/shot.mjs <url> <out.png> [width] [height]');
  process.exit(2);
}
const channel = process.env.LAB_BROWSER ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
const browser = await chromium.launch({ channel: channel === 'chromium' ? undefined : channel, headless: true });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', (m) => ['error', 'warning'].includes(m.type()) && logs.push(`${m.type()}: ${m.text()}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message}`));
await page.goto(url);
try {
  const ready = await page.waitForFunction(() => window.__ready, null, { timeout: 30000 });
  console.log(JSON.stringify(await ready.jsonValue(), null, 1));
} catch (e) {
  console.log('not ready:', e.message);
}
await page.screenshot({ path: out });
if (logs.length) console.log(logs.join('\n'));
await browser.close();
