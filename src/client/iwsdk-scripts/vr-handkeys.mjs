// IWSDK agent script: open the hire prompt, report key world positions for hand aiming.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.askDemo?.());
  await frame.waitForTimeout(1500);
  const s = await frame.evaluate(() => window.__vrtest?.keyPos?.(['k:a', 'k:b']));
  console.log('KEYPOS:', JSON.stringify(s));
  return { ok: !!s, s };
}
