// IWSDK agent script: the hire prompt's 🐚 Shell button (the desktop B key). Opens the
// hire list, taps the first free desk, chooses Shell: a shell worker sits down there and
// the prompt + keyboard go home.
export default async function run({ frame }) {
  const before = await frame.evaluate(() => (window.__vrtest?.workers?.() ?? []).length);
  const asked = await frame.evaluate(() => {
    window.__vrtest?.showMenu?.('hire');
    const tapped = window.__vrtest?.mclick?.('row:0') ?? false;
    return { tapped, ui: window.__vrtest?.ui?.() ?? null };
  });
  await frame.waitForTimeout(500);
  const chose = await frame.evaluate(() => window.__vrtest?.promptButton?.('alt') ?? false);
  await frame.waitForTimeout(4000);
  const after = await frame.evaluate(() => ({
    workers: window.__vrtest?.workers?.() ?? [],
    ui: window.__vrtest?.ui?.() ?? null,
  }));
  console.log('HSHELL:', JSON.stringify({ before, asked, chose, after }));
  const ok = asked.tapped === true && asked.ui.prompt === true && chose === true
    && after.workers.length === before + 1 && after.ui.prompt === false && after.ui.keyboard === false;
  return { ok };
}
