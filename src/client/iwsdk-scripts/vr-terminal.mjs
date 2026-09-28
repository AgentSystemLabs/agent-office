// IWSDK agent script: list workers, open the first one's terminal.
export default async function run({ frame }) {
  const workers = await frame.evaluate(() => window.__vrtest?.workers?.() ?? []);
  console.log('WORKERS:', JSON.stringify(workers));
  if (workers.length) {
    await frame.evaluate((id) => window.__vrtest?.openTerminal?.(id), workers[0].id);
    await frame.waitForTimeout(2500);
  }
  return { ok: true, workers };
}
