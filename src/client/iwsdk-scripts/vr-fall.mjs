// IWSDK agent script: fall-carry check. Opens the prompt, teleports 5m up, and confirms the
// prompt + keyboard track the fall (full-3D carry, not XZ-only).
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.askDemo?.());
  await frame.waitForTimeout(1000);
  const y0 = await frame.evaluate(() => window.__vrtest?.panelPos?.('prompt')?.[1]);
  await frame.evaluate(() => {
    const t = window.__vrtest;
    const p = t.pos();
    t.teleport(p[0], p[1] + 5, p[2]);
  });
  await frame.waitForTimeout(400);
  const mid = await frame.evaluate(() => ({
    pos: window.__vrtest?.pos?.(),
    prompt: window.__vrtest?.panelPos?.('prompt'),
    keyboard: window.__vrtest?.panelPos?.('keyboard'),
  }));
  await frame.waitForTimeout(2000);
  const end = await frame.evaluate(() => ({
    pos: window.__vrtest?.pos?.(),
    prompt: window.__vrtest?.panelPos?.('prompt'),
    keyboard: window.__vrtest?.panelPos?.('keyboard'),
  }));
  console.log('FALL:', JSON.stringify({ y0, mid, end }));
  const ok = mid.prompt[1] > y0 + 2 && Math.abs(end.prompt[1] - y0) < 0.3 &&
    Math.abs(end.keyboard[1] - (y0 - 0.44)) < 0.3 && end.pos[1] === 0;
  return { ok };
}
