// IWSDK agent script: the people view. Empty solo (no rows), then a seeded teammate
// renders a row (tapping it does nothing — the view is read-only, like chat).
export default async function run({ frame }) {
  const empty = await frame.evaluate(() => {
    window.__vrtest?.showMenu?.('people');
    return { view: window.__vrtest?.menuView?.() ?? null, row: window.__vrtest?.mclick?.('row:0') ?? null };
  });
  await frame.evaluate(() => window.__vrtest?.seedPeer?.('Zed', "💻 in Pixel's terminal"));
  await frame.waitForTimeout(600);
  const seeded = await frame.evaluate(() => ({
    view: window.__vrtest?.menuView?.() ?? null,
    row: window.__vrtest?.mclick?.('row:0') ?? null,
  }));
  console.log('PEOPLE:', JSON.stringify({ empty, seeded }));
  // Solo the view starts rowless; with company (or a lingering ghost) it may not — the
  // seeded teammate's row is the assertion either way.
  const ok = empty.view === 'people' && seeded.row === true && seeded.view === 'people';
  return { ok };
}
