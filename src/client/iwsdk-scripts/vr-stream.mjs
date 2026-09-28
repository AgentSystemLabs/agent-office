// IWSDK agent script: the VR jukebox's 📻 row. Plays a stream URL through the
// headset prompt, then puts the jukebox back how it was (tune, stream, or off).
export default async function run({ frame }) {
  const before = await frame.evaluate(() => window.__vrtest?.jukebox?.() ?? null);
  const type = async (text) => {
    for (const ch of text) {
      if (ch === ':') {
        await frame.evaluate(() => window.__vrtest?.key?.(0, 'fn:shift', true));
        await frame.evaluate(() => window.__vrtest?.key?.(0, 'fn:shift', false));
        await frame.evaluate(() => window.__vrtest?.key?.(0, 'k:;', true));
        await frame.evaluate(() => window.__vrtest?.key?.(0, 'k:;', false));
      } else {
        await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, true), ch);
        await frame.evaluate((c) => window.__vrtest?.key?.(0, `k:${c}`, false), ch);
      }
    }
  };
  const playUrl = async (url) => {
    await frame.evaluate(() => window.__vrtest?.showMenu?.('jukebox'));
    await frame.waitForTimeout(500);
    const btn = await frame.evaluate(() => window.__vrtest?.mclick?.('row:4') ?? false);
    await frame.waitForTimeout(600);
    const asked = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
    await type(url);
    await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
    return { btn, asked: asked?.prompt ?? null };
  };
  const { btn, asked } = await playUrl('https://example.com/zzz.mp3');
  let played = null;
  for (let i = 0; i < 10; i++) {
    await frame.waitForTimeout(1000);
    played = await frame.evaluate(() => window.__vrtest?.jukebox?.() ?? null);
    if (played?.on && played?.track === 'stream') break;
  }
  // Back how it was.
  await frame.evaluate(() => window.__vrtest?.showMenu?.('jukebox'));
  await frame.waitForTimeout(500);
  const stopBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('jb:stop') ?? false);
  await frame.waitForTimeout(1000);
  if (before?.on && before?.track !== 'stream') {
    const idx = ['rainy-window', 'coffee-break', 'late-commit', 'green-build'].indexOf(before.track);
    if (idx >= 0) await frame.evaluate((i) => window.__vrtest?.mclick?.(`row:${i}`), idx);
  } else if (before?.on && before?.track === 'stream' && before?.url) {
    await playUrl(before.url);
  }
  await frame.waitForTimeout(1500);
  const after = await frame.evaluate(() => window.__vrtest?.jukebox?.() ?? null);
  console.log('STREAM:', JSON.stringify({ btn, asked, played, stopBtn, before, after }));
  const ok = btn === true && asked === true && played?.on === true && played?.track === 'stream';
  return { ok };
}
