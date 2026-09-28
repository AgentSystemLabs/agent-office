// IWSDK agent script: the queue view's trailing 🧹 Clear row. Absent on an empty
// queue, present once finished tasks exist; the first tap arms (nothing clears),
// the second fires (the test queue holds no real finished tasks, so the server
// has nothing to forget — the send itself mirrors the verified queue siblings).
export default async function run({ page, frame }) {
  await frame.evaluate(() => window.__vrtest?.showMenu?.('queue'));
  await frame.waitForTimeout(600);
  const before = await frame.evaluate(() => window.__vrtest?.queue?.() ?? null);
  const emptyBefore = (before?.tasks ?? []).length === 0;
  // On an empty queue there is no row:0 to tap (never tap a real task row blindly).
  const noRow = emptyBefore ? await frame.evaluate(() => window.__vrtest?.mclick?.('row:0') ?? false) : null;
  await frame.evaluate(() => window.__vrtest?.seedQueueTask?.('zzz-qclear-1', 'zzz clear probe one'));
  await frame.evaluate(() => window.__vrtest?.seedQueueTask?.('zzz-qclear-2', 'zzz clear probe two'));
  await frame.evaluate(() => window.__vrtest?.showMenu?.('queue'));
  await frame.waitForTimeout(600);
  const seeded = await frame.evaluate(() => window.__vrtest?.queue?.() ?? null);
  const tasks = seeded?.tasks ?? [];
  // The clear row trails the trimmed done list (wrong order would arm a requeue).
  const running = tasks.filter((t) => t.status === 'running').length;
  const queued = tasks.filter((t) => t.status === 'queued').length;
  const done = tasks.filter((t) => t.status === 'done').slice(-8).length;
  const clearIdx = running + queued + done;
  const armBtn = await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), clearIdx);
  await frame.waitForTimeout(400);
  const afterArm = await frame.evaluate(() => window.__vrtest?.queue?.() ?? null);
  const armView = await frame.evaluate(() => window.__vrtest?.menuView?.() ?? null);
  await page.screenshot({ path: '/tmp/vr-qclear.png' });
  const fireBtn = await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), clearIdx);
  await frame.waitForTimeout(800);
  const afterFire = await frame.evaluate(() => window.__vrtest?.queue?.() ?? null);
  const fireView = await frame.evaluate(() => window.__vrtest?.menuView?.() ?? null);
  console.log('QCLEAR:', JSON.stringify({ emptyBefore, noRow, clearIdx, armBtn, stillThere: afterArm?.tasks?.length, armView, fireBtn, afterFire: afterFire?.tasks?.length, fireView }));
  // The seeds are client-local (reload clears them); the fire is a safe server no-op here.
  const ok = (emptyBefore ? noRow === false : true) && armBtn === true && afterArm?.tasks?.length === tasks.length && armView === 'queue' && fireBtn === true && afterFire?.tasks?.length === tasks.length && fireView === 'queue';
  return { ok };
}
