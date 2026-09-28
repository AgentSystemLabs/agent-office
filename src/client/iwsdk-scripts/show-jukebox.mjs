// IWSDK agent script: show VR menu view: jukebox.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.showMenu?.('jukebox'));
  await frame.waitForTimeout(1800);
  return { ok: true };
}
