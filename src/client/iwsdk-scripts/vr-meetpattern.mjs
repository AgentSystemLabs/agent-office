// IWSDK agent script: the call-a-meeting prompt's pattern row. Cycles debate → lead →
// red-blue → debate, then cancels: the whole picker runs, nothing is sent.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.showMenu?.('meeting'));
  await frame.waitForTimeout(1000);
  const call = await frame.evaluate(() => window.__vrtest?.mclick?.('mtg:call'));
  await frame.waitForTimeout(800);
  const first = await frame.evaluate(() => window.__vrtest?.promptEngine?.() ?? null);
  await frame.evaluate(() => window.__vrtest?.promptButton?.('engine'));
  await frame.waitForTimeout(300);
  const second = await frame.evaluate(() => window.__vrtest?.promptEngine?.() ?? null);
  await frame.evaluate(() => window.__vrtest?.promptButton?.('engine'));
  await frame.waitForTimeout(300);
  const third = await frame.evaluate(() => window.__vrtest?.promptEngine?.() ?? null);
  await frame.evaluate(() => window.__vrtest?.promptButton?.('engine'));
  await frame.waitForTimeout(300);
  const wrapped = await frame.evaluate(() => window.__vrtest?.promptEngine?.() ?? null);
  const cancelled = await frame.evaluate(() => window.__vrtest?.promptButton?.('cancel'));
  await frame.waitForTimeout(800);
  const end = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
  console.log('MEETPAT:', JSON.stringify({ call, first, second, third, wrapped, cancelled, end }));
  const ok =
    call === true &&
    first === '🗣️ Debate · 3 workers · tap to change' &&
    second === '🧭 Lead & team · 3 workers · tap to change' &&
    third === '🛡️ Red / blue · 2 workers · tap to change' &&
    wrapped === first &&
    cancelled === true &&
    end?.prompt === false;
  return { ok };
}
