// IWSDK agent script: terminal ⏻ check on a free shell worker. Arms with one tap
// (nothing happens), confirms with the second: the worker goes home and its
// terminal closes itself.
export default async function run({ frame }) {
  const desk = await frame.evaluate(() => window.__vrtest?.shell?.());
  await frame.waitForTimeout(4000);
  const id = await frame.evaluate((deskId) => (window.__vrtest?.workers?.() ?? []).find((w) => w.desk === deskId)?.id ?? null, desk);
  if (!id) return { ok: false, why: 'no shell worker spawned' };
  await frame.evaluate((wid) => window.__vrtest?.openTerminal?.(wid), id);
  await frame.waitForTimeout(1500);
  const arm = await frame.evaluate(() => window.__vrtest?.tclick?.('kill'));
  await frame.waitForTimeout(600);
  const stillThere = await frame.evaluate((wid) => (window.__vrtest?.workers?.() ?? []).some((w) => w.id === wid), id);
  const confirm = await frame.evaluate(() => window.__vrtest?.tclick?.('kill'));
  await frame.waitForTimeout(2500);
  const end = await frame.evaluate((wid) => ({
    gone: !(window.__vrtest?.workers?.() ?? []).some((w) => w.id === wid),
    ui: window.__vrtest?.ui?.() ?? null,
  }), id);
  console.log('KILL:', JSON.stringify({ desk, id, arm, stillThere, confirm, end }));
  const ok = arm === true && stillThere === true && confirm === true && end.gone === true && end.ui.terminal === false;
  return { ok };
}
