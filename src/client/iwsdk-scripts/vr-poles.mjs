export default async function run({ frame }) {
  const s = await frame.evaluate(() => ({
    poles: window.__vrtest?.poles?.() ?? null,
    pos: window.__vrtest?.pos?.() ?? null,
  }));
  console.log('POLES:', JSON.stringify(s));
  return { ok: true, s };
}
