export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.ladderE?.());
  await frame.waitForTimeout(400);
  return { ok: true };
}
