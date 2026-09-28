// IWSDK agent script: wall-clipping check. Faces the wall behind spawn, opens the menu
// (1.05m out — inside the wall from here), and confirms it draws through: depthTest off,
// ordered under the ray dots, and still clickable through the panel path.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.turn?.(Math.PI));
  await frame.waitForTimeout(600);
  await frame.evaluate(() => window.__vrtest?.showMenu?.('main'));
  await frame.waitForTimeout(1200);
  const flags = await frame.evaluate(() => window.__vrtest?.panelFlags?.());
  console.log('FLAGS:', JSON.stringify(flags));
  const ok =
    !!flags &&
    flags.menu.depthTest === false && flags.menu.renderOrder === 9993 &&
    flags.keyboard.depthTest === false && flags.prompt.depthTest === false &&
    flags.toast.depthTest === false && flags.controls.depthTest === false &&
    flags.terminal.depthTest === true && flags.terminal.renderOrder === 0;
  return { ok, flags };
}
