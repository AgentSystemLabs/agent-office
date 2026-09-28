// IWSDK agent script: meeting view check. Opens the room, clicks 🤝 call, answers the
// first prompt, then cancels the second: the whole call flow runs, nothing is sent.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.showMenu?.('meeting'));
  await frame.waitForTimeout(1000);
  const call = await frame.evaluate(() => window.__vrtest?.mclick?.('mtg:call'));
  await frame.waitForTimeout(800);
  const asked = await frame.evaluate(() => window.__vrtest?.ui?.());
  // Answer "what's it about" through the real keys, submitting with ⏎.
  for (const k of ['k:t', 'k:e', 'k:s', 'k:t']) {
    await frame.evaluate((id) => window.__vrtest?.key?.(0, id, true), k);
    await frame.waitForTimeout(60);
    await frame.evaluate((id) => window.__vrtest?.key?.(0, id, false), k);
    await frame.waitForTimeout(60);
  }
  const typed = await frame.evaluate(() => window.__vrtest?.promptText?.());
  await frame.evaluate(() => window.__vrtest?.key?.(0, 'fn:enter', true));
  await frame.waitForTimeout(80);
  await frame.evaluate(() => window.__vrtest?.key?.(0, 'fn:enter', false));
  await frame.waitForTimeout(800);
  const titled = await frame.evaluate(() => window.__vrtest?.ui?.());
  // Cancel the title prompt: nothing is sent, everything closes.
  const cancelled = await frame.evaluate(() => window.__vrtest?.promptButton?.('cancel'));
  await frame.waitForTimeout(800);
  const end = await frame.evaluate(() => window.__vrtest?.ui?.());
  console.log('MEET:', JSON.stringify({ call, asked, typed, titled, cancelled, end }));
  const ok = call === true && asked.prompt === true && typed === 'test' &&
    titled.prompt === true && titled.keyboard === true &&
    cancelled === true && end.prompt === false;
  return { ok };
}
