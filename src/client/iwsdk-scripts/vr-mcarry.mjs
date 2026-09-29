// IWSDK agent script: E at the meeting table with a card in hand. Desktop's dropCard
// would open the DOM meeting form (invisible in the headset); VR puts the card back
// and opens the room's menu instead — no modal.
export default async function run({ frame }) {
  const s = await frame.evaluate(() => {
    window.__vrtest?.carry?.(7, 'The bean bag ate the deploy');
    window.__vrtest?.tapUse?.('meeting');
    return { view: window.__vrtest?.menuView?.() ?? null, modal: window.__vrtest?.modal?.() ?? null };
  });
  console.log('MCARRY:', JSON.stringify(s));
  return { ok: s.view === 'meeting' && s.modal === false };
}
