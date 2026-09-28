// IWSDK agent script: the VR hire view's 🌿 toggle. Flips the next hire's
// worktree choice off and back on: the pref round-trips, nothing stays flipped.
export default async function run({ frame }) {
  const before = await frame.evaluate(() => window.__vrtest?.worktree?.() ?? null);
  await frame.evaluate(() => window.__vrtest?.showMenu?.('hire'));
  await frame.waitForTimeout(500);
  const btn = await frame.evaluate(() => window.__vrtest?.mclick?.('hire:wt') ?? false);
  await frame.waitForTimeout(300);
  const flipped = await frame.evaluate(() => window.__vrtest?.worktree?.() ?? null);
  await frame.evaluate(() => window.__vrtest?.mclick?.('hire:wt'));
  await frame.waitForTimeout(300);
  const after = await frame.evaluate(() => window.__vrtest?.worktree?.() ?? null);
  console.log('HIREWT:', JSON.stringify({ before, btn, flipped, after }));
  const ok = btn === true && typeof before === 'boolean' && flipped === !before && after === before;
  return { ok };
}
