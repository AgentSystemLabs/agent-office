// IWSDK agent script: send all workers home (test cleanup).
export default async function run({ frame }) {
  const workers = await frame.evaluate(() => window.__vrtest?.workers?.() ?? []);
  for (const w of workers) {
    await frame.evaluate((id) => window.__vrtest?.kill?.(id), w.id);
  }
  await frame.waitForTimeout(2000);
  const left = await frame.evaluate(() => window.__vrtest?.workers?.() ?? []);
  console.log('LEFT:', JSON.stringify(left));
  return { ok: true, left };
}
