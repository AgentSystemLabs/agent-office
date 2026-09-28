// IWSDK agent script: report UI panel state + world positions for aiming.
export default async function run({ frame }) {
  const state = await frame.evaluate(() => ({
    inVR: window.__vrtest?.inVR?.() ?? null,
    ui: window.__vrtest?.ui?.() ?? null,
    controls: window.__vrtest?.panelPos?.('controls') ?? null,
    menu: window.__vrtest?.panelPos?.('menu') ?? null,
  }));
  console.log('UI:', JSON.stringify(state));
  return { ok: true, state };
}
