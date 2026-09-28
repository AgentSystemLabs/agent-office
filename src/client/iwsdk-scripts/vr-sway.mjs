// IWSDK agent script: drunk-in-VR check. Downs two shots, waits for the kick-in, and
// reads back the rig's roll over a few frames (it should oscillate, not sit at 0).
export default async function run({ frame }) {
  const before = await frame.evaluate(() => window.__vrtest?.drink?.('shot'));
  await frame.evaluate(() => window.__vrtest?.drink?.('shot'));
  await frame.waitForTimeout(5000); // the shots kick in over ~4s
  const rolls = await frame.evaluate(async () => {
    const t = window.__vrtest;
    const out = [];
    for (let i = 0; i < 6; i++) {
      out.push(t?.rigRoll?.() ?? null);
      await new Promise((r) => setTimeout(r, 400));
    }
    return { out, drunk: t?.drink?.('mojito') };
  });
  console.log('SWAY:', JSON.stringify({ before, rolls }));
  const vals = rolls.out.filter((v) => typeof v === 'number');
  const spread = vals.length ? Math.max(...vals) - Math.min(...vals) : 0;
  const ok = vals.length === 6 && spread > 0.005;
  return { ok, before, rolls, spread };
}
