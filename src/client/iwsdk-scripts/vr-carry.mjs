// IWSDK agent script: modal-carry check. Opens the prompt, teleports, and confirms the
// prompt + keyboard rode along by the same delta (the terminal would stay behind).
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.askDemo?.());
  await frame.waitForTimeout(1200);
  const before = await frame.evaluate(() => ({
    pos: window.__vrtest?.pos?.(),
    prompt: window.__vrtest?.panelPos?.('prompt'),
    keyboard: window.__vrtest?.panelPos?.('keyboard'),
  }));
  const dx = 2.5;
  const dz = 1.5;
  await frame.evaluate(([x, z]) => window.__vrtest?.teleport?.(window.__vrtest.pos()[0] + x, 0, window.__vrtest.pos()[2] + z), [dx, dz]);
  await frame.waitForTimeout(1200);
  const after = await frame.evaluate(() => ({
    pos: window.__vrtest?.pos?.(),
    prompt: window.__vrtest?.panelPos?.('prompt'),
    keyboard: window.__vrtest?.panelPos?.('keyboard'),
    ui: window.__vrtest?.ui?.(),
  }));
  console.log('CARRY:', JSON.stringify({ before, after }));
  const d = (a, b) => [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const close = (u, v) => Math.hypot(u[0] - v[0], u[1] - v[1], u[2] - v[2]) < 0.05;
  const avatar = d(before.pos, after.pos);
  const ok = after.ui.prompt && after.ui.keyboard && close(d(before.prompt, after.prompt), avatar) && close(d(before.keyboard, after.keyboard), avatar);
  return { ok, avatar };
}
