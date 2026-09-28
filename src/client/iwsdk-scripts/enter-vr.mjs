// IWSDK agent script: reload with ?vrtest=1, hide editor chrome, click Enter VR for real.
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
  const state = await frame.evaluate(() => ({
    inVR: window.__vrtest?.inVR?.() ?? 'no-hook',
    pos: window.__vrtest?.pos?.() ?? null,
  }));
  console.log('STATE:', JSON.stringify(state));
  return { ok: true, state };
}
