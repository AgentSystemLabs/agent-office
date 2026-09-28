// IWSDK agent script: the VR terminal across a reconnect. Types into a shell (frames
// stream), drops the socket, waits for it to come back, and types again: with the
// re-attach, frames stream again (before the fix the screen froze at the drop).
export default async function run({ frame }) {
  const id = await frame.evaluate(() => (window.__vrtest?.workers?.() ?? []).find((w) => w.desk === 'desk-6')?.id ?? (window.__vrtest?.workers?.() ?? [])[0]?.id ?? null);
  if (!id) return { ok: false, why: 'no worker for a terminal' };
  await frame.evaluate((wid) => window.__vrtest?.openTerminal?.(wid), id);
  await frame.waitForTimeout(1500);
  await frame.evaluate(() => window.__vrtest?.type?.('echo zzz-one\r'));
  await frame.waitForTimeout(2000);
  const v0 = await frame.evaluate((wid) => window.__vrtest?.screen?.(wid)?.version ?? null, id);
  await frame.evaluate(() => window.__vrtest?.dropNet?.());
  // Down, then back up on its own.
  let back = false;
  for (let i = 0; i < 20; i++) {
    await frame.waitForTimeout(1000);
    if (await frame.evaluate(() => window.__vrtest?.netUp?.() ?? false)) {
      back = true;
      break;
    }
  }
  await frame.waitForTimeout(1500);
  const v1 = await frame.evaluate((wid) => window.__vrtest?.screen?.(wid)?.version ?? null, id);
  await frame.evaluate(() => window.__vrtest?.type?.('echo zzz-two\r'));
  await frame.waitForTimeout(2500);
  const v2 = await frame.evaluate((wid) => window.__vrtest?.screen?.(wid)?.version ?? null, id);
  console.log('RECON:', JSON.stringify({ v0, back, v1, v2 }));
  const ok = back === true && v0 !== null && v1 !== null && v2 !== null && v2 > v1;
  return { ok };
}
