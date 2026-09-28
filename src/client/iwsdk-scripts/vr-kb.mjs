// IWSDK agent script: report keyboard visibility + world position.
export default async function run({ frame }) {
  const kb = await frame.evaluate(() => ({
    pos: window.__vrtest?.panelPos?.('keyboard') ?? null,
    prompt: window.__vrtest?.panelPos?.('prompt') ?? null,
  }));
  console.log('KB:', JSON.stringify(kb));
  return { ok: true, kb };
}
