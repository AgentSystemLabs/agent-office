// IWSDK agent script: show VR menu bar view.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.showMenu?.('bar'));
  await frame.waitForTimeout(1800);
  return { ok: true };
}
