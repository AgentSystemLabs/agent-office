// IWSDK agent script: show VR menu view: chat.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.showMenu?.('chat'));
  await frame.waitForTimeout(1800);
  return { ok: true };
}
