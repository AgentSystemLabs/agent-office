// IWSDK agent script: open the hire prompt demo (prompt panel + keyboard).
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.askDemo?.());
  await frame.waitForTimeout(2000);
  return { ok: true };
}
