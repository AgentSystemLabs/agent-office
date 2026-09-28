// IWSDK agent script: the VR settings view's 🐶 row. Renames the floor dog through
// the headset prompt, then renames it back (the test office keeps its dog).
export default async function run({ frame }) {
  const before = await frame.evaluate(() => window.__vrtest?.dog?.() ?? null);
  if (!before) return { ok: false, why: 'no dog on this floor' };
  const rename = async (name) => {
    await frame.evaluate(() => window.__vrtest?.showMenu?.('settings'));
    await frame.waitForTimeout(500);
    const btn = await frame.evaluate(() => window.__vrtest?.mclick?.('row:4') ?? false);
    await frame.waitForTimeout(600);
    const asked = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
    for (const ch of name) {
      if (ch >= 'A' && ch <= 'Z') {
        await frame.evaluate(() => window.__vrtest?.key?.(0, 'fn:shift', true));
        await frame.evaluate(() => window.__vrtest?.key?.(0, 'fn:shift', false));
      }
      const c = ch.toLowerCase();
      await frame.evaluate((k) => window.__vrtest?.key?.(0, `k:${k}`, true), c);
      await frame.evaluate((k) => window.__vrtest?.key?.(0, `k:${k}`, false), c);
    }
    await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
    let after = null;
    for (let i = 0; i < 10; i++) {
      await frame.waitForTimeout(1000);
      after = await frame.evaluate(() => window.__vrtest?.dog?.() ?? null);
      if (after === name) break;
    }
    return { btn, asked: asked?.prompt ?? null, after };
  };
  const first = await rename('zzzwags');
  const second = await rename(before);
  console.log('DOG:', JSON.stringify({ before, first, second }));
  const ok = first.btn === true && first.asked === true && first.after === 'zzzwags' && second.after === before;
  return { ok };
}
