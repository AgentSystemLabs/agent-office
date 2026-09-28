// IWSDK agent script: load the flat office (no VR), optionally force the insecure chip.
export default async function run({ frame }) {
  await frame.goto('https://127.0.0.1:5173/?vrtest=1');
  await frame.waitForSelector('canvas', { timeout: 20000 });
  await frame.waitForTimeout(4000);
  await frame.evaluate(() => window.__vrtest?.forceInsecureXR?.(true));
  await frame.waitForTimeout(800);
  const chip = await frame.evaluate(() => {
    const btns = [...document.querySelectorAll('#dock button')].map((b) => ({ label: b.getAttribute('aria-label'), title: b.getAttribute('title'), cls: b.className }));
    return btns;
  });
  console.log('DOCK:', JSON.stringify(chip));
  return { ok: true, chip };
}
