// IWSDK agent script: E at the seat you're on. A bar stool opens the VR bar menu
// (the roof's E does the same); the boss's chair toasts instead of opening
// Minesweeper invisibly. Teleports stand back up between sits.
export default async function run({ frame }) {
  const spawn = await frame.evaluate(() => window.__vrtest?.pos?.() ?? [8.5, 0, -11.6]);
  const bar = await frame.evaluate(() => {
    window.__vrtest?.tapUse?.('seat', undefined, undefined, 'roof-stool-1');
    window.__vrtest?.tapUse?.('seat', undefined, undefined, 'roof-stool-1');
    return window.__vrtest?.menuView?.() ?? null;
  });
  await frame.evaluate((s) => window.__vrtest?.teleport?.(s[0], s[1], s[2]), spawn);
  await frame.waitForTimeout(400);
  const game = await frame.evaluate(() => {
    window.__vrtest?.tapUse?.('seat', undefined, undefined, 'boss-chair');
    window.__vrtest?.tapUse?.('seat', undefined, undefined, 'boss-chair');
    return { view: window.__vrtest?.menuView?.() ?? null, modal: window.__vrtest?.modal?.() ?? null };
  });
  await frame.evaluate((s) => window.__vrtest?.teleport?.(s[0], s[1], s[2]), spawn);
  await frame.waitForTimeout(400);
  console.log('SEAT:', JSON.stringify({ bar, game }));
  return { ok: bar === 'bar' && game.view === 'bar' && game.modal === false };
}
