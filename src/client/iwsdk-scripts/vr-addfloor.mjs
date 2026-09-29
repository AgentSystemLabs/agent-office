// IWSDK agent script: the floors view's ➕ button. Names a folder that doesn't exist:
// the server refuses and its error lands on the headset toast (the same waiter +
// message the happy path rides on).
export default async function run({ frame }) {
  const dir = '/zzz/zzz';
  await frame.evaluate(() => {
    window.__vrtest?.showMenu?.('floors');
    window.__vrtest?.mclick?.('add');
  });
  await frame.waitForTimeout(600);
  const asked = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
  for (const ch of dir) {
    await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, true), ch);
    await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, false), ch);
  }
  const typed = await frame.evaluate(() => window.__vrtest?.promptText?.() ?? null);
  const sent = await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
  let error = null;
  for (let i = 0; i < 15 && !error; i++) {
    await frame.waitForTimeout(2000);
    error = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
  }
  console.log('ADDFLOOR:', JSON.stringify({ asked, typed, sent, error }));
  const ok = asked?.prompt === true && typed === dir && sent === true && !!error;
  return { ok };
}
