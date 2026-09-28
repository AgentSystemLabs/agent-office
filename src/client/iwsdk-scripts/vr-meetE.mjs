// IWSDK agent script: E-routing check for the meeting room. E at the room (and at an
// empty meeting-table chair) opens the room's view; the still-missing kinds toast instead.
export default async function run({ frame }) {
  await frame.evaluate(() => window.__vrtest?.tapUse?.('meeting'));
  await frame.waitForTimeout(800);
  const room = await frame.evaluate(() => window.__vrtest?.menuView?.());
  await frame.evaluate(() => window.__vrtest?.tapUse?.('desk', 'meeting-2'));
  await frame.waitForTimeout(800);
  const chair = await frame.evaluate(() => window.__vrtest?.menuView?.());
  await frame.evaluate(() => window.__vrtest?.showMenu?.('main'));
  await frame.waitForTimeout(500);
  await frame.evaluate(() => window.__vrtest?.tapUse?.('whiteboard'));
  await frame.waitForTimeout(500);
  const gaps = await frame.evaluate(() => window.__vrtest?.menuView?.());
  console.log('MEETE:', JSON.stringify({ room, chair, gaps }));
  const ok = room === 'meeting' && chair === 'meeting' && gaps === 'main';
  return { ok };
}
