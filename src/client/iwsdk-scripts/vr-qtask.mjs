// IWSDK agent script: the queue view's rows. A queued probe task: first tap arms
// (still there), second tap removes it (gone). Then a done task, if the office has
// one: arm, then requeue, then forget it again (the office keeps its history short).
export default async function run({ frame }) {
  const title = 'zzz row task';
  // Leftovers from an interrupted run would share the title: clear them first.
  const stale = await frame.evaluate((t) => (window.__vrtest?.queue?.().tasks ?? []).filter((x) => x.title === t).map((x) => x.id), title);
  for (const id of stale) await frame.evaluate((taskId) => window.__vrtest?.queueRemove?.(taskId), id);
  if (stale.length) await frame.waitForTimeout(1500);
  const rowIndex = (tasks, id) => {
    const running = tasks.filter((t) => t.status === 'running');
    const queued = tasks.filter((t) => t.status === 'queued');
    const done = tasks
      .filter((t) => t.status === 'done')
      .slice(-8)
      .reverse();
    return [...running, ...queued, ...done].findIndex((t) => t.id === id);
  };
  const max0 = await frame.evaluate(() => window.__vrtest?.queue?.().max ?? null);
  if (max0 !== 0) {
    await frame.evaluate(() => {
      window.__vrtest?.showMenu?.('queue');
      window.__vrtest?.mclick?.('q:pause');
    });
    await frame.waitForTimeout(2000);
  }
  const paused = await frame.evaluate(() => window.__vrtest?.queue?.().max ?? null);
  await frame.evaluate(() => {
    window.__vrtest?.showMenu?.('queue');
    window.__vrtest?.mclick?.('q:add');
  });
  await frame.waitForTimeout(600);
  for (const ch of title) {
    await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, true), ch);
    await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, false), ch);
  }
  await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
  await frame.waitForTimeout(3000);
  const added = await frame.evaluate((t) => (window.__vrtest?.queue?.().tasks ?? []).find((x) => x.title === t) ?? null, title);
  let armed = null;
  let gone = null;
  if (added) {
    await frame.evaluate(() => window.__vrtest?.showMenu?.('queue'));
    await frame.waitForTimeout(500);
    const tasks = await frame.evaluate(() => window.__vrtest?.queue?.().tasks ?? []);
    const i = rowIndex(tasks, added.id);
    await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), i);
    await frame.waitForTimeout(2000);
    armed = await frame.evaluate((t) => (window.__vrtest?.queue?.().tasks ?? []).some((x) => x.title === t), title);
    await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), i);
    await frame.waitForTimeout(2000);
    gone = await frame.evaluate((t) => !(window.__vrtest?.queue?.().tasks ?? []).some((x) => x.title === t), title);
  }
  // A finished task, seeded: arm (silent), then fire — the server has never heard
  // of it, so its 'No such task' lands on the headset toast (nothing requeued).
  await frame.evaluate(() => window.__vrtest?.seedQueueTask?.('zzz-done', 'zzz finished task'));
  await frame.evaluate(() => window.__vrtest?.showMenu?.('queue'));
  await frame.waitForTimeout(500);
  const seedTasks = await frame.evaluate(() => window.__vrtest?.queue?.().tasks ?? []);
  const seedIdx = rowIndex(seedTasks, 'zzz-done');
  await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), seedIdx);
  await frame.waitForTimeout(2000);
  const retrySilent = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
  await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), seedIdx);
  let retryToast = null;
  for (let i = 0; i < 8; i++) {
    await frame.waitForTimeout(1000);
    retryToast = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
    if (retryToast) break;
  }
  // A done task, if there is one: arm (still done), fire (queued again), forget.
  const done0 = await frame.evaluate(() => (window.__vrtest?.queue?.().tasks ?? []).find((t) => t.status === 'done' && t.id !== 'zzz-done') ?? null);
  let retry = 'skipped';
  if (done0) {
    await frame.evaluate(() => window.__vrtest?.showMenu?.('queue'));
    await frame.waitForTimeout(500);
    const tasks = await frame.evaluate(() => window.__vrtest?.queue?.().tasks ?? []);
    const i = rowIndex(tasks, done0.id);
    await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), i);
    await frame.waitForTimeout(2000);
    const still = await frame.evaluate((id) => (window.__vrtest?.queue?.().tasks ?? []).find((t) => t.id === id)?.status ?? null, done0.id);
    await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), i);
    await frame.waitForTimeout(2000);
    const back = await frame.evaluate((id) => (window.__vrtest?.queue?.().tasks ?? []).find((t) => t.id === id)?.status ?? null, done0.id);
    if (back === 'queued') await frame.evaluate((id) => window.__vrtest?.queueRemove?.(id), done0.id);
    await frame.waitForTimeout(1500);
    retry = `${still}>${back}`;
  }
  if (max0 !== 0) {
    await frame.evaluate(() => {
      window.__vrtest?.showMenu?.('queue');
      window.__vrtest?.mclick?.('q:pause');
    });
    await frame.waitForTimeout(2000);
  }
  const max1 = await frame.evaluate(() => window.__vrtest?.queue?.().max ?? null);
  console.log('QTASK:', JSON.stringify({ max0, paused, added: added?.status ?? null, armed, gone, retrySilent, retryToast, retry, max1 }));
  const ok = paused === 0 && added?.status === 'queued' && armed === true && gone === true && retrySilent === null && retryToast === 'No such task' && (retry === 'skipped' || retry === 'done>queued') && max1 === max0;
  return { ok };
}
