// IWSDK agent script: grab the ladder, climb with the left stick, report height.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.ladder?.());
  await frame.waitForTimeout(1000);
  const grabbed = await frame.evaluate(() => window.__vrtest?.rigged?.());
  const y0 = (await frame.evaluate(() => window.__vrtest?.pos?.()))?.[1] ?? null;
  console.log('GRABBED:', grabbed, 'y0:', y0);
  return { ok: true, grabbed, y0 };
}
