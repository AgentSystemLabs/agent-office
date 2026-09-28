export default async function run({ frame }) {
  const s = await frame.evaluate(() => ({
    rays: window.__vrtest?.rays?.() ?? null,
    rayPos: window.__vrtest?.rayPos?.() ?? null,
    inVR: window.__vrtest?.inVR?.() ?? null,
    ui: window.__vrtest?.ui?.() ?? null,
    text: window.__vrtest?.promptText?.() ?? null,
  }));
  console.log('HDBG:', JSON.stringify(s));
  return { ok: true, s };
}
