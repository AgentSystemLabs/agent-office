// IWSDK agent script: ride the elevator to the roof, report arrival.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.ride?.(window.__vrtest?.roof?.()));
  await frame.waitForTimeout(9000);
  const state = await frame.evaluate(() => ({
    inVR: window.__vrtest?.inVR?.() ?? null,
    pos: window.__vrtest?.pos?.() ?? null,
    facing: window.__vrtest?.facing?.() ?? null,
  }));
  console.log('ROOF:', JSON.stringify(state));
  return { ok: true, state };
}
