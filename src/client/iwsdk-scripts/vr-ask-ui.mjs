// IWSDK agent script: open ask demo, then report full UI visibility.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.askDemo?.());
  await frame.waitForTimeout(2000);
  const ui = await frame.evaluate(() => window.__vrtest?.ui?.());
  console.log('UI:', JSON.stringify(ui));
  return { ok: true, ui };
}
