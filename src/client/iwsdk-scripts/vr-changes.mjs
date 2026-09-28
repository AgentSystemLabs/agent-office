// IWSDK agent script: the 📝 Changes row + view. A shell on a scratch branch
// holds the probe: the view lists it, commit commits it, the PR prompt opens
// with the subject and cancels without opening anything, then the commit is
// undone; back on main the probe returns and tap-twice discard deletes it.
// Aborts (leaving nothing behind) if the checkout isn't clean to start with.
const PROBE = 'zzz-changes-probe.txt';
const BRANCH = 'zzz-changes-branch';
async function typeKey(frame, text) {
  for (const ch of text) {
    const c = ch.toLowerCase();
    await frame.evaluate((k) => window.__vrtest?.key?.(0, `k:${k}`, true), c);
    await frame.evaluate((k) => window.__vrtest?.key?.(0, `k:${k}`, false), c);
  }
}
async function waitChanges(frame, pred, tries = 25) {
  let c = null;
  for (let i = 0; i < tries; i++) {
    await frame.waitForTimeout(1000);
    c = await frame.evaluate(() => window.__vrtest?.changes?.() ?? null);
    // Error states carry no files (a poll raced our own git command): never match those.
    if (c && !c.error && pred(c)) break;
  }
  return c && !c.error ? c : null;
}
export default async function run({ frame }) {
  let shell = null;
  const out = {};
  try {
    const beforeIds = new Set((await frame.evaluate(() => window.__vrtest?.workers?.() ?? [])).map((w) => w.id));
    await frame.evaluate(() => window.__vrtest?.shell?.());
    for (let i = 0; i < 20 && !shell; i++) {
      await frame.waitForTimeout(1000);
      const workers = await frame.evaluate(() => window.__vrtest?.workers?.() ?? []);
      shell = workers.find((w) => !beforeIds.has(w.id))?.id ?? null;
    }
    if (!shell) return { ok: false, why: 'no shell spawned' };
    await frame.evaluate((id) => window.__vrtest?.openTerminal?.(id), shell);
    await frame.waitForTimeout(2500);
    // The probe, on a scratch branch (the PR button needs a branch of its own).
    await frame.evaluate(([b, p]) => window.__vrtest?.type?.(`git checkout -b ${b} && echo probe > ${p}\n`), [BRANCH, PROBE]);
    await frame.waitForTimeout(3000);
    await frame.evaluate(() => window.__vrtest?.showMenu?.('main'));
    await frame.waitForTimeout(500);
    out.rowBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('changes') ?? false);
    out.view = await frame.evaluate(() => window.__vrtest?.menuView?.() ?? null);
    const listed = await waitChanges(frame, (c) => Array.isArray(c.files) && c.files.length > 0);
    out.listed = listed?.files ?? null;
    // Only our probe: anything else is someone's work — abort before touching it.
    if (listed?.files.length !== 1 || !listed.files[0].path.endsWith(PROBE)) {
      out.abort = 'checkout not clean';
      return { ok: false, why: 'checkout not clean', out };
    }
    // Commit it through the headset prompt.
    out.commitBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('ch:commit') ?? false);
    await frame.waitForTimeout(600);
    out.commitAsked = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
    await typeKey(frame, 'zzz probe commit');
    await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
    const done = await waitChanges(frame, (c) => Array.isArray(c.files) && c.files.every((f) => !f.uncommitted));
    out.committed = done ? { files: done.files.length, ahead: done.ahead, prBase: done.prBase } : null;
    // The PR prompt opens with the subject, then cancels: no PR opens.
    out.prBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('ch:pr') ?? false);
    await frame.waitForTimeout(600);
    out.prTitle = await frame.evaluate(() => window.__vrtest?.promptText?.() ?? null);
    await frame.evaluate(() => window.__vrtest?.promptButton?.('send'));
    await frame.waitForTimeout(600);
    out.prBodyAsked = await frame.evaluate(() => window.__vrtest?.ui?.() ?? null);
    await frame.evaluate(() => window.__vrtest?.promptButton?.('cancel'));
    await frame.waitForTimeout(1000);
    const afterPr = await frame.evaluate(() => window.__vrtest?.changes?.() ?? null);
    out.noPr = afterPr?.pr ?? null;
    // Undo the commit, unstage the probe, drop the branch, back on main.
    await frame.evaluate(([b, p]) => window.__vrtest?.type?.(`git reset --soft HEAD~1 && git reset HEAD -q -- ${p} && rm ${p} && git checkout -q main && git branch -q -D ${b}\n`), [BRANCH, PROBE]);
    const undone = await waitChanges(frame, (c) => Array.isArray(c.files) && c.files.length === 0);
    out.undone = !!undone;
    // The probe returns on main (untracked again); tap-twice discard deletes it.
    await frame.evaluate((p) => window.__vrtest?.type?.(`echo probe > ${p}\n`), PROBE);
    const relisted = await waitChanges(frame, (c) => Array.isArray(c.files) && c.files.length === 1);
    out.relisted = relisted?.files ?? null;
    out.discardBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('ch:discard') ?? false);
    await frame.waitForTimeout(500);
    out.armToast = await frame.evaluate(() => window.__vrtest?.toastText?.() ?? null);
    out.armView = await frame.evaluate(() => window.__vrtest?.menuView?.() ?? null);
    out.fireBtn = await frame.evaluate(() => window.__vrtest?.mclick?.('ch:discard') ?? false);
    const discarded = await waitChanges(frame, (c) => Array.isArray(c.files) && c.files.length === 0);
    out.discarded = !!discarded;
  } finally {
    // Whatever happened: the probe, the branch and the commit go; the shell goes home.
    // The reset only fires when our commit is still on top (never the checkout's own).
    if (shell) {
      await frame.evaluate(() => window.__vrtest?.type?.('git log -1 --format=%s | grep -q "zzz probe commit" && git reset --soft HEAD~1 2>/dev/null; true\n'));
      await frame.evaluate(([b, p]) => window.__vrtest?.type?.(`git reset -q HEAD -- ${p} 2>/dev/null; rm -f ${p}; git checkout -q main 2>/dev/null; git branch -q -D ${b} 2>/dev/null; true\n`), [BRANCH, PROBE]);
      await frame.waitForTimeout(2000);
      await frame.evaluate((id) => window.__vrtest?.kill?.(id), shell);
      await frame.waitForTimeout(1500);
    }
  }
  const workers = await frame.evaluate(() => window.__vrtest?.workers?.() ?? []);
  console.log('CHANGES:', JSON.stringify({ ...out, shellGone: !workers.some((w) => w.id === shell) }));
  const ok =
    out.rowBtn === true &&
    out.view === 'changes' &&
    out.commitBtn === true &&
    out.commitAsked?.prompt === true &&
    out.committed?.ahead === 1 &&
    out.prBtn === true &&
    out.prTitle === 'zzz probe commit' &&
    out.prBodyAsked?.prompt === true &&
    out.noPr === null &&
    out.undone === true &&
    out.relisted?.length === 1 &&
    out.relisted[0].uncommitted === true &&
    out.discardBtn === true &&
    typeof out.armToast === 'string' &&
    out.armToast.includes('back to the last commit') &&
    out.armView === 'changes' &&
    out.fireBtn === true &&
    out.discarded === true &&
    !workers.some((w) => w.id === shell);
  return { ok };
}
