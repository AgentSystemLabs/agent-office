export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.hideDash?.());
  const ui = await frame.evaluate(() => window.__vrtest?.ui?.());
  console.log('UI:', JSON.stringify(ui));
  return { ok: true, ui };
}
