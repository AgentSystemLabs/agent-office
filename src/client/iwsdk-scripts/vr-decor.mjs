// IWSDK agent script: the decor E-again flow. Aims E at nothing real (no id, a bogus
// id) to prove the guards, then reports the pictures on the walls — with one, E arms
// (it stays up) and E again takes it down.
export default async function run({ frame }) {
  const guards = await frame.evaluate(() => {
    const before = window.__vrtest?.menuView?.() ?? null;
    window.__vrtest?.tapUse?.('decor');
    window.__vrtest?.tapUse?.('decor', undefined, 'nope');
    const after = window.__vrtest?.menuView?.() ?? null;
    return { before, after };
  });
  const pics = await frame.evaluate(() => window.__vrtest?.decor?.() ?? []);
  console.log('DECOR:', JSON.stringify({ guards, pics }));
  const calm = guards.before === guards.after;
  if (!pics.length) return { ok: calm, why: 'no pictures on the walls' };
  const id = pics[0].id;
  await frame.evaluate((did) => window.__vrtest?.tapUse?.('decor', undefined, did), id);
  await frame.waitForTimeout(400);
  const stillUp = await frame.evaluate((did) => (window.__vrtest?.decor?.() ?? []).some((d) => d.id === did), id);
  await frame.evaluate((did) => window.__vrtest?.tapUse?.('decor', undefined, did), id);
  await frame.waitForTimeout(2500);
  const down = await frame.evaluate((did) => !(window.__vrtest?.decor?.() ?? []).some((d) => d.id === did), id);
  console.log('DECOR2:', JSON.stringify({ id, stillUp, down }));
  return { ok: calm && stillUp === true && down === true };
}
