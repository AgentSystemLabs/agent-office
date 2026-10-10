import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { run } from './process.js';

export interface CheckoutState { branch?: string; remote?: string; behind: number; ahead: number; dirty: boolean; error?: string }
const git = (dir: string, args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 5000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const checks = new Map<string, { at: number; error?: string; pending?: Promise<string | undefined> }>();

export function checkoutState(dir: string): CheckoutState {
  const state: CheckoutState = { behind: 0, ahead: 0, dirty: false };
  try {
    try { if (git(dir, ['rev-parse', '--is-inside-work-tree']) !== 'true') return state; } catch { return state; }
    state.branch = git(dir, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    state.dirty = !!git(dir, ['status', '--porcelain']);
    const gitDir = git(dir, ['rev-parse', '--absolute-git-dir']);
    if (['MERGE_HEAD', 'rebase-merge', 'rebase-apply', 'CHERRY_PICK_HEAD'].some(f => existsSync(`${gitDir}/${f}`))) throw new Error('A merge/rebase is unfinished.');
    try { state.remote = git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']); }
    catch { try { git(dir, ['remote', 'get-url', 'origin']); state.remote = `origin/${state.branch}`; } catch { return state; } }
    const [ahead, behind] = git(dir, ['rev-list', '--left-right', '--count', `HEAD...refs/remotes/${state.remote}`]).split(/\s+/).map(Number);
    Object.assign(state, { ahead, behind });
  } catch (err) { state.error = `Cannot verify the Office checkout: ${(err as Error).message.split('\n')[0]}`; }
  return state;
}

export function checkoutProblem(state: CheckoutState): string | undefined {
  if (state.error) return state.error;
  if (!state.behind) return;
  return `Office checkout is ${state.behind} commits behind ${state.remote}${state.ahead ? ` and has ${state.ahead} local commits` : ''}${state.dirty ? ', with uncommitted changes' : ''}. No new task was started. Finish the current work and safely update this copy, or use an up-to-date worktree. Local work was preserved.`;
}

/** Wait for active turns, then let Git preserve unrelated edits during a fast-forward. Never stash or reset. */
export function prepareCheckout(dir: string, busy: () => boolean): Promise<string | undefined> {
  const old = checks.get(dir);
  if (old?.pending) return old.pending;
  const entry = { at: 0 } as { at: number; error?: string; pending?: Promise<string | undefined> };
  checks.set(dir, entry);
  entry.pending = (async () => {
    const initial = checkoutState(dir);
    if (initial.error) return initial.error;
    if (!initial.remote) return;
    const slash = initial.remote.indexOf('/');
    const remote = initial.remote.slice(0, slash), branch = initial.remote.slice(slash + 1);
    try { await run('git', ['fetch', '--quiet', '--no-tags', remote, `refs/heads/${branch}:refs/remotes/${initial.remote}`], dir, 15000, { ...process.env, GIT_TERMINAL_PROMPT: '0' } as Record<string, string>); }
    catch { return 'Could not fetch the latest Office checkout. No new shared-checkout task was started; retry when GitHub is reachable.'; }
    let current = checkoutState(dir);
    if (current.branch !== initial.branch) return 'The Office branch changed during the check. Retry; local work was preserved.';
    while (current.behind && !current.ahead && !current.error && busy()) {
      await new Promise(resolve => setTimeout(resolve, 250));
      current = checkoutState(dir);
      if (current.branch !== initial.branch) return 'The Office branch changed while waiting. Local work was preserved.';
    }
    if (current.behind && !current.ahead && !current.error) {
      try { await run('git', ['merge', '--ff-only', `refs/remotes/${current.remote}`], dir, 15000); }
      catch { return `${checkoutProblem(checkoutState(dir))} Git could not update without overwriting local files. Resolve the overlapping edits; unrelated local changes do not block updates.`; }
      current = checkoutState(dir);
    }
    return checkoutProblem(current);
  })().then(error => { entry.at = Date.now(); entry.error = error; entry.pending = undefined; return error; });
  return entry.pending;
}

/** Existing idle terminals must pass the same check before accepting another assignment. */
export function readyCheckout(dir: string, busy: () => boolean): string | undefined {
  const entry = checks.get(dir);
  if (!entry || entry.pending || Date.now() - entry.at > 15000) {
    void prepareCheckout(dir, busy);
    return 'Checking the shared Office checkout against GitHub. Retry this task in a moment; it has not been dispatched.';
  }
  return entry.error ?? checkoutProblem(checkoutState(dir));
}
