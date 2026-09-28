// IWSDK agent script: report per-ray input state.
export default async function run({ frame }) {
  const rays = await frame.evaluate(() => window.__vrtest?.rays?.() ?? null);
  console.log('RAYS:', JSON.stringify(rays));
  return { ok: true, rays };
}
