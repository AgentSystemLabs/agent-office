export default async function run({ frame }) {
  const s = await frame.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('agent-office.settings') ?? 'null')?.vr ?? null; }
    catch { return 'unreadable'; }
  });
  console.log('SAVED:', JSON.stringify(s));
  await frame.evaluate(() => window.__vrtest?.showMenu?.('main'));
  await frame.waitForTimeout(1500);
  return { ok: true, s };
}
