// IWSDK agent script: ride the elevator down to droidproxy, report arrival.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.ride?.('droidproxy'));
  await frame.waitForTimeout(9000);
  const state = await frame.evaluate(() => ({
    inVR: window.__vrtest?.inVR?.() ?? null,
    pos: window.__vrtest?.pos?.() ?? null,
    facing: window.__vrtest?.facing?.() ?? null,
  }));
  console.log('DOWN:', JSON.stringify(state));
  return { ok: true, state };
}
