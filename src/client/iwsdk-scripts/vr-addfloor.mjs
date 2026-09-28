// IWSDK agent script: the floors view's ➕ button. Names a repository that doesn't
// exist: the cloning toast goes up, the server refuses, and its error lands on the
// headset toast (the same waiter + message the happy path rides on).
export default async function run({ frame }) {
  const repo = 'zzz/zzz';
  await frame.evaluate(() => {
    window.__vrtest?.showMenu?.('floors');
    window.__vrtest?.mclick?.('add');
  });
  await frame.waitForTimeout(600);
  const asked = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
  for (const ch of repo) {
    await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, true), ch);
    await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, false), ch);
  }
  const typed = await frame.evaluate(() => window.__vrtest?.promptText?.() ?? null);
  const sent = await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
  // The cloning toast (the submit path) and then the server's refusal (the waiter): the
  // refusal can land before the first poll, so any non-cloning toast counts as the error.
  const seen = [];
  for (let i = 0; i < 15; i++) {
    await frame.waitForTimeout(2000);
    const t = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
    if (t && !seen.includes(t)) seen.push(t);
    if (seen.some((x) => !x.includes('Cloning'))) break;
  }
  const cloning = seen.find((x) => x.includes('Cloning')) ?? null;
  const error = seen.find((x) => !x.includes('Cloning')) ?? null;
  console.log('ADDFLOOR:', JSON.stringify({ asked, typed, sent, cloning, error }));
  const ok = asked?.prompt === true && typed === repo && sent === true && (!!cloning || !!error);
  return { ok };
}
