// IWSDK agent script: the PR detail view's 🔍 button. The first tap only arms it
// (no toast, nothing sent); the second reaches the busy-room guard — the room is
// seeded busy, so nothing starts and the guard's words land on the headset toast.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.seedPull?.(999999, 'zzz seeded PR'));
  await frame.evaluate(() => window.__vrtest?.detail?.('pull', 999999));
  await frame.waitForTimeout(500);
  const arm = await frame.evaluate(() => window.__vrtest?.mclick?.('act:review') ?? false);
  await frame.waitForTimeout(2000);
  const silent = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
  await frame.evaluate(() => window.__vrtest?.seedMeetingBusy?.('zzz busy meeting'));
  await frame.waitForTimeout(500);
  const fire = await frame.evaluate(() => window.__vrtest?.mclick?.('act:review') ?? false);
  await frame.waitForTimeout(1000);
  const toast = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
  console.log('REVIEW:', JSON.stringify({ arm, silent, fire, toast }));
  const ok = arm === true && silent === null && fire === true && !!toast && toast.includes('busy');
  return { ok };
}
