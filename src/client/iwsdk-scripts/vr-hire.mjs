// IWSDK agent script: open the real VR hire prompt, report desk + prompt position.
export default async function run({ frame }) {
  const desk = await frame.evaluate(() => window.__vrtest?.hireAt?.() ?? null);
  await frame.waitForTimeout(1500);
  const rest = await frame.evaluate(() => ({
    ui: window.__vrtest?.ui?.() ?? null,
    panel: window.__vrtest?.panelPos?.('prompt') ?? null,
  }));
  const s = { desk, ...rest };
  console.log('HIRE:', JSON.stringify(s));
  return { ok: true, s };
}
