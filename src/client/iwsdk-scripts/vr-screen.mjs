// IWSDK agent script: report screen state for the first worker.
export default async function run({ frame }) {
  const workers = await frame.evaluate(() => window.__vrtest?.workers?.() ?? []);
  const screen = workers.length ? await frame.evaluate((id) => window.__vrtest?.screen?.(id), workers[0].id) : null;
  console.log('SCREEN:', JSON.stringify(screen));
  return { ok: true, screen };
}
