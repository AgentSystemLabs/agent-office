// IWSDK agent script: the detail view's ✕ button. The first tap only arms it (no
// toast, nothing sent); the second closes. The issue doesn't exist, so the server's
// refusal lands on the headset toast (nothing closed anywhere real).
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.seedIssue?.(999999, 'zzz seeded issue'));
  await frame.evaluate(() => window.__vrtest?.detail?.('issue', 999999));
  await frame.waitForTimeout(500);
  const arm = await frame.evaluate(() => window.__vrtest?.mclick?.('act:close') ?? false);
  await frame.waitForTimeout(3000);
  const silent = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
  const fire = await frame.evaluate(() => window.__vrtest?.mclick?.('act:close') ?? false);
  const seen = [];
  for (let i = 0; i < 15; i++) {
    await frame.waitForTimeout(2000);
    const t = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
    if (t && !seen.includes(t)) seen.push(t);
    if (seen.some((x) => !x.includes('Closing'))) break;
  }
  const closing = seen.find((x) => x.includes('Closing')) ?? null;
  const error = seen.find((x) => !x.includes('Closing')) ?? null;
  console.log('CLOSE:', JSON.stringify({ arm, silent, fire, closing, error }));
  const ok = arm === true && silent === null && fire === true && (!!closing || !!error);
  return { ok };
}
