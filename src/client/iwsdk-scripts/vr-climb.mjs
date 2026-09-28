export default async function run({ frame }) {
  const s = await frame.evaluate(() => ({
    rigged: window.__vrtest?.rigged?.() ?? null,
    pos: window.__vrtest?.pos?.() ?? null,
    ladder: window.__vrtest?.ladderY?.() ?? null,
  }));
  console.log('CLIMB:', JSON.stringify(s));
  return { ok: true, s };
}
