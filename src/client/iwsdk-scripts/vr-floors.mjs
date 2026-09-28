export default async function run({ frame }) {
  const floors = await frame.evaluate(() => window.__vrtest?.floors?.());
  console.log('FLOORS:', JSON.stringify(floors));
  return { ok: true, floors };
}
