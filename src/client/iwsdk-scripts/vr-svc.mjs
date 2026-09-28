// IWSDK agent script: the services view. E at the services board opens it, the main
// list grows the 🌐 row, and with nothing running it says so (rather than the old
// "isn't in VR yet" toast).
export default async function run({ frame }) {
  const eRoute = await frame.evaluate(() => {
    window.__vrtest?.tapUse?.('services');
    return window.__vrtest?.menuView?.() ?? null;
  });
  await frame.waitForTimeout(400);
  const row = await frame.evaluate(() => {
    window.__vrtest?.showMenu?.('main');
    const ok = window.__vrtest?.mclick?.('services') ?? false;
    return { ok, view: window.__vrtest?.menuView?.() ?? null };
  });
  console.log('SVC:', JSON.stringify({ eRoute, row }));
  const ok = eRoute === 'services' && row.ok === true && row.view === 'services';
  return { ok };
}
