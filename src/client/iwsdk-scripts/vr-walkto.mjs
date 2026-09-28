// IWSDK agent script: the VR people view's rows. Tapping a teammate on this floor
// blinks you next to them; tapping one on another floor says to ride over.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.seedPeer?.('Peanut', 'testing the walk-over'));
  await frame.evaluate(() => window.__vrtest?.showMenu?.('people'));
  await frame.waitForTimeout(500);
  const idx = await frame.evaluate(() => (window.__vrtest?.people?.() ?? []).findIndex((p) => p.id === 'peer-zzz'));
  const tapped = await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), idx);
  await frame.waitForTimeout(1500);
  const pos = await frame.evaluate(() => window.__vrtest?.pos?.() ?? null);
  const near = pos ? Math.hypot(pos[0], pos[2]) : null;
  await frame.evaluate(() => window.__vrtest?.seedPeer?.('Zed', 'elsewhere', 'zzz-floor'));
  await frame.evaluate(() => window.__vrtest?.showMenu?.('people'));
  await frame.waitForTimeout(500);
  const idx2 = await frame.evaluate(() => (window.__vrtest?.people?.() ?? []).findIndex((p) => p.id === 'peer-zzz'));
  await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), idx2);
  await frame.waitForTimeout(800);
  const pos2 = await frame.evaluate(() => window.__vrtest?.pos?.() ?? null);
  const toast = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
  console.log('WALKTO:', JSON.stringify({ idx, tapped, pos, near, idx2, pos2, toast }));
  const moved = near !== null && near < 2.5;
  const stayed = pos && pos2 && Math.hypot(pos2[0] - pos[0], pos2[2] - pos[2]) < 0.01;
  const ok = tapped === true && moved && stayed && !!toast && toast.includes('elevator');
  return { ok };
}
