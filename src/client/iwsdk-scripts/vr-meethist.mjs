// IWSDK agent script: the VR meeting view's earlier meetings. Seeds a running
// meeting (no seats) plus one earlier: rows 0-1 exist, row 2 doesn't, and tapping
// the past row does nothing (read-only, like the chat lines).
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.seedMeetingBusy?.('zzz busy meeting'));
  await frame.evaluate(() => window.__vrtest?.seedMeetingPast?.('zzz earlier meeting'));
  await frame.evaluate(() => window.__vrtest?.showMenu?.('meeting'));
  await frame.waitForTimeout(600);
  const r0 = await frame.evaluate(() => window.__vrtest?.mclick?.('row:0') ?? false);
  const r1 = await frame.evaluate(() => window.__vrtest?.mclick?.('row:1') ?? false);
  const r2 = await frame.evaluate(() => window.__vrtest?.mclick?.('row:2') ?? false);
  await frame.waitForTimeout(500);
  const view = await frame.evaluate(() => window.__vrtest?.menuView?.() ?? null);
  const ui = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
  console.log('MEETHIST:', JSON.stringify({ r0, r1, r2, view, ui }));
  const ok = r0 === true && r1 === true && r2 === false && view === 'meeting' && ui?.prompt === false;
  return { ok };
}
