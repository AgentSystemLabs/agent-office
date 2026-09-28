// IWSDK agent script: stands near desk-6 (Pixel's shell) with the dash hidden, so a
// controller aimed at the desk lights the aim bar. Reports what the bar says.
export default async function run({ frame }) {
  await frame.evaluate(() => {
    window.__vrtest?.hideDash?.();
    window.__vrtest?.teleport?.(1.6, 0, -4.5);
  });
  await frame.waitForTimeout(1500);
  const s = await frame.evaluate(() => ({
    pos: window.__vrtest?.pos?.() ?? null,
    aim: window.__vrtest?.aim?.() ?? null,
    ui: window.__vrtest?.ui?.() ?? null,
  }));
  console.log('AIM:', JSON.stringify(s));
  // Setup check only (aiming the ray needs the device tools): the bar's words land in AIM.
  const ok = !!s.pos && Math.abs(s.pos[0] - 1.6) < 0.01;
  return { ok };
}
