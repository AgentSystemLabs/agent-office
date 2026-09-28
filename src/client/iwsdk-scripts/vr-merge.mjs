// IWSDK agent script: the PR detail's ✓ merge box. The floor's open PR shows its
// real status (conflicted: no button); flipped mergeable, the ✓ button arms
// silently and fires — GitHub refuses the conflicted PR, which verifies the
// send, the waiter and the toast with no merge. A merged PR shows its state
// with no button; a bogus PR errors.
// (Numbers are the droidproxy floor's, where the session spawns: #274 open and
// conflicted, #333 merged. If they go stale the checks fail loudly, not silently.)
export default async function run({ page, frame }) {
  const waitMerge = async (number) => {
    let m = null;
    for (let i = 0; i < 15; i++) {
      await frame.waitForTimeout(1000);
      m = await frame.evaluate(() => window.__vrtest?.merge?.() ?? null);
      if (m?.number === number && m.state !== 'loading') break;
    }
    return m;
  };
  // The real status first: conflicted, so no button.
  await frame.evaluate(() => window.__vrtest?.detail?.('pull', 274));
  const real = await waitMerge(274);
  const realBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('act:merge') ?? false);
  // Flipped mergeable: the ✓ arms silently, then fires into GitHub's refusal.
  await frame.evaluate(() => window.__vrtest?.seedMerge?.());
  await frame.waitForTimeout(500);
  const seeded = await frame.evaluate(() => window.__vrtest?.merge?.() ?? null);
  const armBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('act:merge') ?? false);
  await frame.waitForTimeout(400);
  const armToast = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
  const armView = await frame.evaluate(() => window.__vrtest?.menuView?.() ?? null);
  await page.screenshot({ path: '/tmp/vr-merge.png' });
  const fireBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('act:merge') ?? false);
  let refused = null;
  for (let i = 0; i < 15; i++) {
    await frame.waitForTimeout(1000);
    refused = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
    if (refused && refused !== 'Merging…') break;
  }
  // A merged PR: state shown, no button.
  await frame.evaluate(() => window.__vrtest?.detail?.('pull', 333));
  const merged = await waitMerge(333);
  const mergedBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('act:merge') ?? false);
  // A bogus PR: the fetch errors, nothing paints and nothing crashes.
  await frame.evaluate(() => window.__vrtest?.detail?.('pull', 999999));
  const bogus = await waitMerge(999999);
  console.log('MERGE:', JSON.stringify({ real, realBtn, seeded, armBtn, armToast, armView, fireBtn, refused, merged, mergedBtn, bogus }));
  const ok =
    real?.state === 'ready' &&
    real.can === false &&
    real.short === 'Conflicts' &&
    realBtn === false &&
    seeded?.can === true &&
    armBtn === true &&
    armToast === null &&
    armView === 'detail' &&
    fireBtn === true &&
    typeof refused === 'string' &&
    refused.length > 0 &&
    refused !== 'Merging…' &&
    merged?.state === 'ready' &&
    merged.can === false &&
    merged.short === 'Merged' &&
    mergedBtn === false &&
    bogus?.state === 'error';
  return { ok };
}
