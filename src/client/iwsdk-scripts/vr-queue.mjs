// IWSDK agent script: the queue view's ➕ and ⏸. Pauses the line first (so the probe
// task never runs), adds it, checks it queues, removes it, and runs the line again
// at its old width.
export default async function run({ frame }) {
  const title = 'zzz probe task';
  const max0 = await frame.evaluate(() => window.__vrtest?.queue?.().max ?? null);
  await frame.evaluate(() => {
    window.__vrtest?.showMenu?.('queue');
    window.__vrtest?.mclick?.('q:pause');
  });
  await frame.waitForTimeout(2000);
  const paused = await frame.evaluate(() => window.__vrtest?.queue?.().max ?? null);
  await frame.evaluate(() => {
    window.__vrtest?.showMenu?.('queue');
    window.__vrtest?.mclick?.('q:add');
  });
  await frame.waitForTimeout(600);
  const asked = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
  for (const ch of title) {
    await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, true), ch);
    await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, false), ch);
  }
  await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
  await frame.waitForTimeout(3000);
  const added = await frame.evaluate((t) => (window.__vrtest?.queue?.().tasks ?? []).find((x) => x.title === t) ?? null, title);
  if (added) await frame.evaluate((id) => window.__vrtest?.queueRemove?.(id), added.id);
  await frame.waitForTimeout(2000);
  const gone = await frame.evaluate((t) => !(window.__vrtest?.queue?.().tasks ?? []).some((x) => x.title === t), title);
  await frame.evaluate(() => {
    window.__vrtest?.showMenu?.('queue');
    window.__vrtest?.mclick?.('q:pause');
  });
  await frame.waitForTimeout(2000);
  const max1 = await frame.evaluate(() => window.__vrtest?.queue?.().max ?? null);
  console.log('QUEUE:', JSON.stringify({ max0, paused, asked: asked?.prompt, added, gone, max1 }));
  const ok = paused === 0 && asked?.prompt === true && added?.status === 'queued' && gone === true && max1 === max0;
  return { ok };
}
