// IWSDK agent script: open terminal, type echo, wait for output.
export default async function run({ frame }) {
  const workers = await frame.evaluate(() => window.__vrtest?.workers?.() ?? []);
  if (!workers.length) return { ok: false, why: 'no workers' };
  await frame.evaluate((id) => window.__vrtest?.openTerminal?.(id), workers[0].id);
  await frame.waitForTimeout(1200);
  await frame.evaluate(() => window.__vrtest?.type?.('echo hello-vr\r'));
  await frame.waitForTimeout(2500);
  return { ok: true };
}
