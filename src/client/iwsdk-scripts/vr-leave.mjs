// IWSDK agent script: the VR menu's 📞 Leave row, on the dev panel preview (its
// voice stub is in voice, which the headset emulator can't join without a mic).
// Clicks Leave and Mute through the panel's own registry and reads the log back.
export default async function run({ frame }) {
  await frame.goto('https://127.0.0.1:5173/vr-preview.html');
  await frame.waitForSelector('canvas', { timeout: 20000 });
  await frame.waitForTimeout(2000);
  const leave = await frame.evaluate(() => window.vrUi?.menu.panel.clickButton('leave') ?? false);
  const mute = await frame.evaluate(() => window.vrUi?.menu.panel.clickButton('mute') ?? false);
  await frame.waitForTimeout(500);
  const log = await frame.evaluate(() => document.getElementById('log')?.textContent ?? '');
  console.log('LEAVE:', JSON.stringify({ leave, mute, log: log.slice(0, 300) }));
  const ok = leave === true && mute === true && log.includes('leave voice') && log.includes('mute →');
  return { ok };
}
