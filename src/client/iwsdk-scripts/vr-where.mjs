export default async function run({ frame }) {
  const s = await frame.evaluate(() => ({
    inVR: window.__vrtest?.inVR?.() ?? null,
    floor: window.__vrtest?.floor?.() ?? null,
    pos: window.__vrtest?.pos?.() ?? null,
  }));
  console.log('WHERE:', JSON.stringify(s));
  return { ok: true, s };
}
