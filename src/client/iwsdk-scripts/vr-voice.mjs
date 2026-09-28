// IWSDK agent script: the menu's mute row out of voice. Tapping it joins voice (the
// V key's function), not a mute no-op: in the emulator that means joined (fake
// media) or the join error on the toast (no mic) — either proves the join path ran.
export default async function run({ frame }) {
  const before = await frame.evaluate(() => window.__vrtest?.inVoice?.() ?? null);
  await frame.evaluate(() => {
    window.__vrtest?.showMenu?.('main');
    window.__vrtest?.mclick?.('mute');
  });
  let toast = null;
  let joined = false;
  for (let i = 0; i < 10; i++) {
    await frame.waitForTimeout(1500);
    const s = await frame.evaluate(() => ({ inVoice: window.__vrtest?.inVoice?.() ?? null, toast: window.__vrtest?.toastText?.() ?? null }));
    if (s.toast) toast = s.toast;
    if (s.inVoice) {
      joined = true;
      break;
    }
  }
  console.log('VOICE:', JSON.stringify({ before, joined, toast }));
  const ok = before === false && (joined === true || !!toast);
  return { ok };
}
