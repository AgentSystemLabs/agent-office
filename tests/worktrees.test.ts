import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Changes } from '../src/server/changes.js';
import { Worktrees } from '../src/server/worktrees.js';

/**
 * A project cloned from a bare origin, plus a second clone standing in for GitHub: whatever it
 * pushes is a pull request merged there, which the project hasn't pulled (issue #119).
 */
function fixture(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'office-worktrees-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const run = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const origin = path.join(root, 'origin.git');
  run(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const dir = path.join(root, 'project');
  run(root, 'clone', '-q', origin, dir);
  run(dir, 'checkout', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  run(dir, 'add', '.');
  run(dir, 'commit', '-qm', 'a');
  run(dir, 'push', '-q', '-u', 'origin', 'main');
  const github = path.join(root, 'github');
  run(root, 'clone', '-q', origin, github);
  const commit = (cwd: string, file: string) => {
    writeFileSync(path.join(cwd, file), file);
    run(cwd, 'add', '.');
    run(cwd, 'commit', '-qm', file);
    return run(cwd, 'rev-parse', 'HEAD');
  };
  const merge = (file: string) => {
    run(github, 'pull', '-q', '--ff-only');
    const sha = commit(github, file);
    run(github, 'push', '-q', 'origin', 'main');
    return sha;
  };
  return { root, dir, git: (...args: string[]) => run(dir, ...args), commit: (file: string) => commit(dir, file), merge };
}

test("a worktree starts from the PR merged on origin, not from the project's stale checkout", async (t) => {
  const f = fixture(t);
  const stale = f.git('rev-parse', 'HEAD');
  const merged = f.merge('fix.txt');
  const trees = new Worktrees(f.dir);
  // Nothing fetched it yet: the project's main and its origin/main both still say `stale`.
  assert.equal(f.git('rev-parse', 'origin/main'), stale);
  const fetching = trees.fetch();
  assert.ok(fetching, 'fetches the first time');
  await fetching;
  assert.equal(f.git('rev-parse', 'origin/main'), merged);
  // A burst of hires shares that fetch.
  assert.equal(trees.fetch(), undefined);
  const made = trees.create('rex-1');
  assert.ok(typeof made !== 'string', String(made));
  assert.equal(made.base, merged);
  assert.equal(made.from, 'main');
  assert.equal(made.note, undefined);
  assert.ok(existsSync(path.join(f.dir, made.path, 'fix.txt')), 'the worktree has the merged fix');
  // The project's own checkout is left where it was.
  assert.equal(f.git('rev-parse', 'HEAD'), stale);
});

test('a project ahead of origin (commits not pushed yet) still branches from its HEAD', async (t) => {
  const f = fixture(t);
  const local = f.commit('wip.txt');
  const trees = new Worktrees(f.dir);
  await trees.fetch();
  const made = trees.create('rex-2');
  assert.ok(typeof made !== 'string', String(made));
  assert.equal(made.base, local);
  assert.equal(made.note, undefined);
});

test("when both moved on, it starts from origin's and says what it left out", async (t) => {
  const f = fixture(t);
  const merged = f.merge('fix.txt');
  f.commit('wip1.txt');
  f.commit('wip2.txt');
  const trees = new Worktrees(f.dir);
  await trees.fetch();
  const made = trees.create('rex-3');
  assert.ok(typeof made !== 'string', String(made));
  assert.equal(made.base, merged);
  assert.match(made.note ?? '', /origin\/main.*2 commits on main/);
});

test('without an origin, or offline, it branches from HEAD as before', async (t) => {
  const f = fixture(t);
  f.merge('fix.txt');
  f.git('remote', 'set-url', 'origin', path.join(f.root, 'nowhere.git'));
  const trees = new Worktrees(f.dir);
  await trees.fetch();
  const made = trees.create('rex-4');
  assert.ok(typeof made !== 'string', String(made));
  assert.equal(made.base, f.git('rev-parse', 'HEAD'));
  f.git('remote', 'remove', 'origin');
  const again = new Worktrees(f.dir);
  assert.equal(again.fetch(), undefined, 'nothing to fetch from');
  const other = again.create('rex-5');
  assert.ok(typeof other !== 'string', String(other));
  assert.equal(other.base, f.git('rev-parse', 'HEAD'));
});

test('on a detached HEAD there is no branch to fetch', (t) => {
  const f = fixture(t);
  f.git('checkout', '-q', '--detach');
  const trees = new Worktrees(f.dir);
  assert.equal(trees.fetch(), undefined);
  const made = trees.create('rex-6');
  assert.ok(typeof made !== 'string', String(made));
  assert.equal(made.base, f.git('rev-parse', 'HEAD'));
  assert.equal(made.from, undefined);
});

test("the Changes window doesn't count PRs merged on origin as the worker's changes", async (t) => {
  const f = fixture(t);
  f.merge('fix.txt');
  const trees = new Worktrees(f.dir);
  await trees.fetch();
  const made = trees.create('rex-7');
  assert.ok(typeof made !== 'string', String(made));
  const cwd = path.join(f.dir, made.path);
  writeFileSync(path.join(cwd, 'mine.txt'), 'mine');
  execFileSync('git', ['add', 'mine.txt'], { cwd });
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'mine'], { cwd });
  const target = { name: 'Rex', cwd, rel: made.path, worktreeBase: made.base };
  const changes = new Changes(f.dir, 'main', () => target, () => undefined, { state() {}, toast() {}, refreshGitHub() {} });
  t.after(() => changes.stop());
  const state = await (changes as unknown as { compute(id: string, t: typeof target): Promise<{ files: { path: string }[]; ahead: number; error?: string }> }).compute('w1', target);
  assert.equal(state.error, undefined);
  assert.deepEqual(state.files.map((x) => x.path), ['mine.txt']);
  assert.equal(state.ahead, 1);
});

test('a worktree deleted with its branch comes back from origin when it was pushed', async (t) => {
  const f = fixture(t);
  const trees = new Worktrees(f.dir);
  const made = trees.create('rex-9');
  assert.ok(typeof made !== 'string', String(made));
  const abs = path.join(f.dir, made.path);
  const run = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: abs, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  writeFileSync(path.join(abs, 'pushed.txt'), 'pushed');
  run('add', '.');
  run('commit', '-qm', 'pushed');
  run('push', '-q', 'origin', made.branch);
  const pushed = run('rev-parse', 'HEAD');
  assert.equal(trees.branchState(made.branch), 'here');
  rmSync(abs, { recursive: true, force: true });
  f.git('worktree', 'prune');
  f.git('branch', '-D', made.branch);
  assert.equal(trees.branchState(made.branch), 'origin');
  assert.deepEqual(await trees.restore(made), { from: 'origin' });
  assert.equal(run('rev-parse', 'HEAD'), pushed);
  assert.equal(run('rev-parse', '--abbrev-ref', 'HEAD'), made.branch);
  // Checked out somewhere else already, it can't come back here: git says why.
  rmSync(abs, { recursive: true, force: true });
  f.git('worktree', 'prune');
  f.git('checkout', '-q', made.branch);
  const refused = await trees.restore(made);
  assert.ok('error' in refused && /already (checked out|used by worktree)/.test(refused.error), JSON.stringify(refused));
});
