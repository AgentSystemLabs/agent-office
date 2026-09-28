// IWSDK agent script: enter VR, open the main menu, screenshot the flat mirror.
export default async function run({ page, frame }) {
  await page.evaluate(() => {
    const s = document.createElement('style');
    s.textContent = '.workspace-view-switcher { display: none !important; }';
    document.head.appendChild(s);
  });
  await frame.goto('https://127.0.0.1:5173/?vrtest=1');
  await frame.waitForSelector('canvas', { timeout: 20000 });
  await frame.waitForTimeout(3000);
  const btn = frame.locator('button[aria-label="Enter VR"]');
  await btn.waitFor({ timeout: 15000 });
  await frame.waitForTimeout(800);
  await btn.click({ timeout: 15000 });
  await frame.waitForTimeout(6000);
  await frame.evaluate(() => window.__vrtest?.hideDash?.());
  await frame.waitForTimeout(500);
  await frame.evaluate(() => window.__vrtest?.showMenu?.('main'));
  await frame.waitForTimeout(1500);
  await page.screenshot({ path: '/tmp/vr-main.png' });
  return { ok: true };
}
