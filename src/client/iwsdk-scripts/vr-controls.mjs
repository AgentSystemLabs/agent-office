// IWSDK agent script: shows the controls card (the ☰ menu's ❓ row) for a look.
export default async function run({ frame }) {
  const shown = await frame.evaluate(() => {
    window.__vrtest?.showMenu?.('main');
    return window.__vrtest?.mclick?.('controls') ?? false;
  });
  await frame.waitForTimeout(800);
  const ui = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
  console.log('CONTROLS:', JSON.stringify({ shown, ui }));
  return { ok: shown === true && ui?.controls === true };
}
