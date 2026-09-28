// IWSDK agent script: show VR menu settings view, report values + panel position.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.showMenu?.('settings'));
  await frame.waitForTimeout(1800);
  const s = await frame.evaluate(() => ({
    settings: window.__vrtest?.vrSettings?.() ?? null,
    panel: window.__vrtest?.panelPos?.('menu') ?? null,
  }));
  console.log('SETTINGS:', JSON.stringify(s));
  return { ok: true, s };
}
