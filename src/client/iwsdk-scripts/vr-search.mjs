// IWSDK agent script: the chat view's 🔎 button. Searches the office through the
// headset prompt: too-short queries toast the two-character floor, a real query
// lists chat and terminal hits, tapping a terminal hit opens its terminal at the
// line (highlighted), and chat hits are inert. Cleans up its shell afterwards.
const MARK = 'zzzfindme';
async function typeKey(frame, text) {
  for (const ch of text) {
    const c = ch.toLowerCase();
    await frame.evaluate((k) => window.__vrtest?.key?.(0, `k:${k}`, true), c);
    await frame.evaluate((k) => window.__vrtest?.key?.(0, `k:${k}`, false), c);
  }
}
export default async function run({ frame }) {
  // A fresh shell holds the terminal marker (no agent to disturb).
  const beforeIds = new Set((await frame.evaluate(() => window.__vrtest?.workers?.() ?? [])).map((w) => w.id));
  await frame.evaluate(() => window.__vrtest?.shell?.());
  let shell = null;
  for (let i = 0; i < 20 && !shell; i++) {
    await frame.waitForTimeout(1000);
    const workers = await frame.evaluate(() => window.__vrtest?.workers?.() ?? []);
    shell = workers.find((w) => !beforeIds.has(w.id))?.id ?? null;
  }
  if (!shell) return { ok: false, why: 'no shell spawned' };
  await frame.evaluate((id) => window.__vrtest?.openTerminal?.(id), shell);
  await frame.waitForTimeout(2500);
  await frame.evaluate((m) => window.__vrtest?.type?.(`echo ${m}-in-a-shell\n`), MARK);
  await frame.waitForTimeout(2500);
  await frame.evaluate(() => window.__vrtest?.tclick?.('close') ?? false);
  await frame.waitForTimeout(500);
  // The floor's chat holds the chat marker (the ✍️ path, past the split header).
  await frame.evaluate(() => window.__vrtest?.showMenu?.('chat'));
  await frame.waitForTimeout(500);
  const sayBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('say') ?? false);
  await frame.waitForTimeout(600);
  await typeKey(frame, `${MARK}-in-the-chat`);
  await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
  await frame.waitForTimeout(1000);
  // Too short: the two-character floor toasts, and the view stays chat.
  await frame.evaluate(() => window.__vrtest?.showMenu?.('chat'));
  await frame.waitForTimeout(500);
  await frame.evaluate(() => window.__vrtest?.mclick?.('find') ?? false);
  await frame.waitForTimeout(600);
  await typeKey(frame, 'x');
  await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
  await frame.waitForTimeout(500);
  const shortToast = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
  const shortView = await frame.evaluate(() => window.__vrtest?.menuView?.() ?? null);
  // The real search: prompt → submit → the search view fills in.
  await frame.evaluate(() => window.__vrtest?.showMenu?.('chat'));
  await frame.waitForTimeout(500);
  const findBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('find') ?? false);
  await frame.waitForTimeout(600);
  const asked = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
  await typeKey(frame, MARK);
  await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
  let found = null;
  for (let i = 0; i < 15; i++) {
    await frame.waitForTimeout(1000);
    found = await frame.evaluate(() => window.__vrtest?.search?.() ?? null);
    if (found?.status === 'done' || found?.status === 'error') break;
  }
  const view = await frame.evaluate(() => window.__vrtest?.menuView?.() ?? null);
  // A chat hit taps through to nothing (the line is already in the chat view).
  const chatTap = found && found.chat > 0 ? await frame.evaluate(() => window.__vrtest?.mclick?.('row:0') ?? false) : null;
  await frame.waitForTimeout(500);
  const afterChatTap = await frame.evaluate(() => ({ view: window.__vrtest?.menuView?.() ?? null, ui: window.__vrtest?.ui?.() ?? null }));
  // A terminal hit opens its terminal right at the line.
  let jumped = null;
  if (found && found.terminals > 0) {
    await frame.evaluate((r) => window.__vrtest?.mclick?.(`row:${r}`), found.chat);
    for (let i = 0; i < 10; i++) {
      await frame.waitForTimeout(1000);
      jumped = await frame.evaluate(() => window.__vrtest?.termFind?.() ?? null);
      if (jumped) break;
    }
  }
  const jumpedUi = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
  // A query with no matches says so.
  await frame.evaluate(() => window.__vrtest?.showMenu?.('chat'));
  await frame.waitForTimeout(500);
  await frame.evaluate(() => window.__vrtest?.mclick?.('find') ?? false);
  await frame.waitForTimeout(600);
  await typeKey(frame, 'zzz-nothing-matches-this');
  await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
  let empty = null;
  for (let i = 0; i < 15; i++) {
    await frame.waitForTimeout(1000);
    empty = await frame.evaluate(() => window.__vrtest?.search?.() ?? null);
    if (empty?.status === 'done' || empty?.status === 'error') break;
  }
  // Cleanup: the shell goes home (the chat marker scrolls away with the floor's chat).
  await frame.evaluate((id) => window.__vrtest?.kill?.(id), shell);
  await frame.waitForTimeout(1500);
  const workers = await frame.evaluate(() => window.__vrtest?.workers?.() ?? []);
  console.log('SEARCH:', JSON.stringify({ sayBtn, shortToast, shortView, findBtn, asked: asked?.prompt ?? null, found, view, chatTap, afterChatTap, jumped, jumpedUi, empty, workersLeft: workers.length }));
  const ok =
    sayBtn === true &&
    shortToast === 'Type at least two characters' &&
    shortView === 'chat' &&
    findBtn === true &&
    asked?.prompt === true &&
    found?.status === 'done' &&
    view === 'search' &&
    found.chat >= 1 &&
    found.terminals >= 1 &&
    afterChatTap.view === 'search' &&
    afterChatTap.ui.terminal === false &&
    jumped?.workerId === shell &&
    jumped.row >= 0 &&
    jumpedUi.terminal === true &&
    empty?.status === 'done' &&
    empty.chat === 0 &&
    empty.terminals === 0 &&
    !workers.some((w) => w.id === shell);
  return { ok };
}
