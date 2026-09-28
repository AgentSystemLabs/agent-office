// IWSDK agent script: the VR settings view's sound rows. Toggles the jukebox and
// the office sounds off and back on: the mute switches round-trip, nothing stays muted.
export default async function run({ frame }) {
  const before = await frame.evaluate(() => window.__vrtest?.soundMuted?.() ?? null);
  const hasDog = await frame.evaluate(() => window.__vrtest?.dog?.() ?? null);
  const base = hasDog ? 5 : 4;
  await frame.evaluate(() => window.__vrtest?.showMenu?.('settings'));
  await frame.waitForTimeout(500);
  await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), base);
  await frame.waitForTimeout(500);
  const musicOff = await frame.evaluate(() => window.__vrtest?.soundMuted?.() ?? null);
  await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), base + 1);
  await frame.waitForTimeout(500);
  const bothOff = await frame.evaluate(() => window.__vrtest?.soundMuted?.() ?? null);
  await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), base);
  await frame.waitForTimeout(300);
  await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), base + 1);
  await frame.waitForTimeout(500);
  const after = await frame.evaluate(() => window.__vrtest?.soundMuted?.() ?? null);
  console.log('SOUND:', JSON.stringify({ before, base, musicOff, bothOff, after }));
  const ok =
    before !== null && musicOff?.music === !before.music && musicOff?.sounds === before.sounds && bothOff?.music === !before.music && bothOff?.sounds === !before.sounds && after?.music === before.music && after?.sounds === before.sounds;
  return { ok };
}
