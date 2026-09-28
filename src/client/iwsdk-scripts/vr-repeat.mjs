// IWSDK agent script: two-ray keyboard check + backspace repeat, through the live routeRay path.
// 1. Hold 'a' on ray 0, tap 'b' on ray 1, release both -> the field reads 'ab'.
// 2. Clear it, hold backspace 1.2s -> the field empties by repeat (not one letter).
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.askDemo?.());
  await frame.waitForTimeout(1500);

  // Ray 0 holds 'a' (down, no release), ray 1 taps 'b' while it is held. The whole
  // hold stays under the 450ms repeat delay, so each key types exactly once.
  await frame.evaluate(() => window.__vrtest?.key?.(0, 'k:a', true));
  await frame.waitForTimeout(120);
  await frame.evaluate(() => window.__vrtest?.key?.(1, 'k:b', true));
  await frame.waitForTimeout(80);
  await frame.evaluate(() => window.__vrtest?.key?.(1, 'k:b', false));
  const mid = await frame.evaluate(() => window.__vrtest?.promptText?.());
  await frame.waitForTimeout(80);
  await frame.evaluate(() => window.__vrtest?.key?.(0, 'k:a', false));
  const two = await frame.evaluate(() => window.__vrtest?.promptText?.());
  console.log('TWO-RAY:', JSON.stringify({ mid, two }));

  // Repeat: what is there ('ab') dies under a held backspace.
  await frame.evaluate(() => window.__vrtest?.key?.(0, 'fn:back', true));
  await frame.waitForTimeout(1200);
  await frame.evaluate(() => window.__vrtest?.key?.(0, 'fn:back', false));
  const after = await frame.evaluate(() => window.__vrtest?.promptText?.());
  console.log('REPEAT:', JSON.stringify({ after }));

  const ok = [...two].sort().join('') === 'ab' && after === '';
  await frame.evaluate(() => window.__vrtest?.hideDash?.());
  return { ok, mid, two, after };
}
