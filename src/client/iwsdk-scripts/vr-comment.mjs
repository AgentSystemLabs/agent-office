// IWSDK agent script: the detail view's 💬 button. Comments on an issue that doesn't
// exist: the prompt opens from the button, the send goes out, and the server's
// refusal lands on the headset toast (nothing posted anywhere real).
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.seedIssue?.(999999, 'zzz seeded issue'));
  await frame.evaluate(() => window.__vrtest?.detail?.('issue', 999999));
  await frame.waitForTimeout(500);
  const btn = await frame.evaluate(() => window.__vrtest?.mclick?.('act:comment') ?? false);
  await frame.waitForTimeout(600);
  const asked = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
  for (const ch of 'zzz') {
    await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, true), ch);
    await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, false), ch);
  }
  await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
  const seen = [];
  for (let i = 0; i < 15; i++) {
    await frame.waitForTimeout(2000);
    const t = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
    if (t && !seen.includes(t)) seen.push(t);
    if (seen.some((x) => !x.includes('Posting'))) break;
  }
  const posting = seen.find((x) => x.includes('Posting')) ?? null;
  const error = seen.find((x) => !x.includes('Posting')) ?? null;
  console.log('COMMENT:', JSON.stringify({ btn, asked: asked?.prompt, posting, error }));
  const ok = btn === true && asked?.prompt === true && (!!posting || !!error);
  return { ok };
}
