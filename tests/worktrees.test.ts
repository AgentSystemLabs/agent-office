import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Changes } from '../src/server/changes.js';
import { Worktrees, gitError } from '../src/server/worktrees.js';

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

test('a checkout exceeding the old 20-second limit still creates its worker worktree', (t) => {
  const f = fixture(t);
  writeFileSync(path.join(f.dir, '.gitattributes'), 'slow.txt filter=slow\n');
  writeFileSync(path.join(f.dir, 'slow.txt'), 'worker payload\n');
  f.git('add', '.gitattributes', 'slow.txt');
  f.git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'slow checkout fixture');
  const head = f.git('rev-parse', 'HEAD');
  const filter = path.join(f.root, 'slow.cjs');
  writeFileSync(filter, "const fs=require('node:fs');const bytes=fs.readFileSync(0);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,21000);process.stdout.write(bytes);");
  f.git('config', 'filter.slow.smudge', `"${process.execPath.replaceAll('\\', '/')}" "${filter.replaceAll('\\', '/')}"`);
  f.git('config', 'filter.slow.required', 'true');
  const start = Date.now();
  const made = new Worktrees(f.dir).create('slow-checkout');
  assert.ok(typeof made !== 'string', String(made));
  assert.ok(Date.now() - start >= 20_000, 'actually exceeds the previous timeout');
  assert.ok(existsSync(path.join(f.dir, made.path, 'slow.txt')));
  assert.equal(f.git('rev-parse', 'HEAD'), head, 'main checkout is unchanged');
});

test('git failures report their cause instead of checkout progress', () => {
  assert.equal(gitError({ code: 'ETIMEDOUT', stderr: 'Updating files: 96%' }), 'Git timed out before finishing');
  assert.equal(gitError({ code: 'ENOBUFS', stderr: 'Updating files: 96%' }), 'Git output exceeded the capture limit');
  assert.equal(gitError({ stderr: 'Updating files: 96%\rfatal: LFS download failed\nAdvice follows' }), 'fatal: LFS download failed');
});

for (const contents of ['clean', 'untracked', 'ignored', 'committed'] as const) {
  test(`failed creation cleans only its own unused checkout: ${contents}`, (t) => {
    const f = fixture(t);
    const trees = new Worktrees(f.dir);
    const internal = trees as unknown as { gitSync(args: string[], cwd?: string, timeout?: number): string };
    const run = internal.gitSync.bind(trees);
    const abs = path.join(f.dir, '.agent-office', 'worktrees', 'failed-create');
    if (contents === 'ignored') {
      const excludes = path.join(f.root, 'excludes');
      writeFileSync(excludes, 'personal.txt\n');
      f.git('config', 'core.excludesFile', excludes);
    }
    internal.gitSync = (args, cwd, timeout) => {
      const result = run(args, cwd, timeout);
      if (args[0] === 'worktree' && args[1] === 'add') {
        if (contents !== 'clean') writeFileSync(path.join(abs, 'personal.txt'), 'keep this');
        if (contents === 'committed') {
          run(['add', 'personal.txt'], abs);
          run(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'personal work'], abs);
        }
        throw Object.assign(new Error('checkout timed out'), { code: 'ETIMEDOUT' });
      }
      return result;
    };
    const result = trees.create('failed-create');
    assert.equal(typeof result, 'string');
    if (contents === 'clean') {
      assert.equal(existsSync(abs), false);
      assert.equal(f.git('for-each-ref', '--format=%(refname)', 'refs/heads/office/failed-create'), '');
      assert.match(String(result), /cleaned up/);
    } else {
      assert.ok(existsSync(path.join(abs, 'personal.txt')), 'personal work survives');
      assert.ok(f.git('for-each-ref', '--format=%(refname)', 'refs/heads/office/failed-create'));
      assert.match(String(result), /preserved/);
    }
  });
}

test('a name collision never removes the existing worker checkout', (t) => {
  const f = fixture(t);
  const trees = new Worktrees(f.dir);
  const made = trees.create('existing-worker');
  assert.ok(typeof made !== 'string');
  const personal = path.join(f.dir, made.path, 'personal.txt');
  writeFileSync(personal, 'keep this');
  assert.equal(typeof trees.create('existing-worker'), 'string');
  assert.ok(existsSync(personal));
});

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
