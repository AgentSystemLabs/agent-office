export default async function run({ frame }) {
  const p = await frame.evaluate(() => { try { return localStorage.getItem('agent-office.provider'); } catch { return 'unreadable'; } });
  console.log('PROVIDER:', p);
  return { ok: true, p };
}
