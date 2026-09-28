// IWSDK agent script: open the first worker's terminal, spawning a shell only if none.
export default async function run({ frame }) {
  let workers = await frame.evaluate(() => window.__vrtest?.workers?.() ?? []);
  if (!workers.length) {
    await frame.evaluate(() => window.__vrtest?.shell?.());
    for (let i = 0; i < 20 && !workers.length; i++) {
      await frame.waitForTimeout(1000);
      workers = await frame.evaluate(() => window.__vrtest?.workers?.() ?? []);
    }
  }
  console.log('WORKERS:', JSON.stringify(workers));
  if (workers.length) {
    await frame.evaluate((id) => window.__vrtest?.openTerminal?.(id), workers[0].id);
    await frame.waitForTimeout(2500);
  }
  return { ok: true, workers };
}
