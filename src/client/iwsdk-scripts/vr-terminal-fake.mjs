// IWSDK agent script: open a terminal for a fake worker (placement/chrome check only).
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.openTerminal?.('no-such-worker'));
  await frame.waitForTimeout(2000);
  const ui = await frame.evaluate(() => window.__vrtest?.ui?.());
  console.log('UI:', JSON.stringify(ui));
  return { ok: true, ui };
}
