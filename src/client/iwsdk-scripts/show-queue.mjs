// IWSDK agent script: show VR menu view: queue.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.showMenu?.('queue'));
  await frame.waitForTimeout(1800);
  return { ok: true };
}
