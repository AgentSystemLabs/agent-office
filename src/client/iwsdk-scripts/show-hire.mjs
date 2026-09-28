// IWSDK agent script: show VR menu view: hire.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.showMenu?.('hire'));
  await frame.waitForTimeout(1800);
  return { ok: true };
}
