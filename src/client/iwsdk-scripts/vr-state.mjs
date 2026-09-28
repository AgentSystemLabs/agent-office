// IWSDK agent script: report live VR state in the app frame.
export default async function run({ frame }) {
  const state = await frame.evaluate(() => ({
    inVR: window.__vrtest?.inVR?.() ?? null,
    pos: window.__vrtest?.pos?.() ?? null,
    facing: window.__vrtest?.facing?.() ?? null,
  }));
  console.log('STATE:', JSON.stringify(state));
  return { ok: true, state };
}
