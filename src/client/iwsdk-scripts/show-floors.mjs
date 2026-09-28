// IWSDK agent script: show VR menu view: floors.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.showMenu?.('floors'));
  await frame.waitForTimeout(1800);
  return { ok: true };
}
