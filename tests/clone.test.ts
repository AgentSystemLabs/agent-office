import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building, type FloorDef } from '../src/server/building.js';
import { parseProgress, whyCloneFailed } from '../src/server/clone.js';

// A stand-in for gh: `repo view`, `repo clone` and `api` from bare repositories in $FAKE_GH_REPOS.
// `repo clone` checks the branch out the way gh passes `--branch` to git. It says how far along it is
// the way git does, can wait first ($FAKE_GH_DELAY), hang ($FAKE_GH_HANG) or fail the way ssh does
// ($FAKE_GH_FAIL). `api` prints $FAKE_GH_BRANCHES, the branch names of the repository.
const FAKE_GH = `#!/bin/sh
case "$1 $2" in
  "repo view")
    [ -d "$FAKE_GH_REPOS/$3.git" ] || { echo "GraphQL: Could not resolve to a Repository with the name '$3'." >&2; exit 1; }
    echo "{\\"nameWithOwner\\":\\"$3\\",\\"isEmpty\\":false,\\"defaultBranchRef\\":{\\"name\\":\\"main\\"}}"
    ;;
  "api "*)
    printf '%s\\n' "$FAKE_GH_BRANCHES"
    ;;
  "repo clone")
    name="$3"; dest="$4"
    branch=""
    for a in "$@"; do case "$a" in --branch=*) branch="\${a#--branch=}";; esac; done
    printf "Cloning into '%s'...\\n" "$dest" >&2
    [ -n "$FAKE_GH_FAIL" ] && { echo "$FAKE_GH_FAIL" >&2; echo "fatal: Could not read from remote repository." >&2; exit 128; }
    [ -n "$FAKE_GH_HANG" ] && exec sleep 600
    printf "Receiving objects:  42%% (42/100), 1.00 MiB | 512.00 KiB/s\\r" >&2
    [ -n "$FAKE_GH_DELAY" ] && sleep "$FAKE_GH_DELAY"
    if [ -n "$branch" ]; then git clone -q --branch "$branch" "$FAKE_GH_REPOS/$name.git" "$dest" || exit 1
    else git clone -q "$FAKE_GH_REPOS/$name.git" "$dest" || exit 1; fi
    git -C "$dest" remote set-url origin "https://github.com/$name.git"
    ;;
esac
`;

const fast = { clone: { tickMs: 50, stallMs: 1500 } };

function office(t: { after(fn: () => void): void }) {
  const root = mkdtempSync(path.join(tmpdir(), 'agent-office-clone-'));
  const pids: number[] = [];
  t.after(() => {
    for (const pid of pids) {
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        // gone
      }
    }
    rmSync(root, { recursive: true, force: true });
  });
  const dataDir = path.join(root, '.agent-office');
  mkdirSync(dataDir);
  const bin = path.join(root, 'bin');
  mkdirSync(bin);
  writeFileSync(path.join(bin, 'gh'), FAKE_GH);
  chmodSync(path.join(bin, 'gh'), 0o755);
  const repos = path.join(root, 'github');
  // acme/game on "GitHub", with a commit.
  const work = path.join(root, 'work');
  execFileSync('git', ['init', '-q', '-b', 'main', work]);
  writeFileSync(path.join(work, 'index.html'), '<h1>game</h1>');
  execFileSync('git', ['-C', work, 'add', '.']);
  execFileSync('git', ['-C', work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'first']);
  execFileSync('git', ['clone', '-q', '--bare', work, path.join(repos, 'acme', 'game.git')]);
  // A second branch, for a floor added on one that isn't the default.
  execFileSync('git', ['-C', path.join(repos, 'acme', 'game.git'), 'branch', 'feature']);
  process.env.PATH = `${bin}${path.delimiter}${process.env.PATH}`;
  process.env.FAKE_GH_REPOS = repos;
  for (const k of ['FAKE_GH_DELAY', 'FAKE_GH_HANG', 'FAKE_GH_FAIL', 'FAKE_GH_BRANCHES']) delete process.env[k];
  const projects = path.join(root, 'projects');
  /** The clones under way, as the office keeps them for the next one. */
  const saved = () => (existsSync(path.join(dataDir, 'cloning.json')) ? (JSON.parse(readFileSync(path.join(dataDir, 'cloning.json'), 'utf8')) as (FloorDef & { pid: number })[]) : []);
  const running = async () => {
    for (let i = 0; i < 200 && !saved().length; i++) await new Promise((r) => setTimeout(r, 25));
    const pid = saved()[0]?.pid;
    assert.ok(pid, 'the clone is in cloning.json');
    pids.push(pid);
    return pid;
  };
  return { root, dataDir, projects, saved, running };
}

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (fn: () => boolean) => {
  for (let i = 0; i < 200 && !fn(); i++) await new Promise((r) => setTimeout(r, 25));
};

test("git's progress reads as a step, how far and how fast", () => {
  const out = "Cloning into '/x/acme/game'...\nremote: Enumerating objects: 2742, done.\nremote: Counting objects: 100% (5/5), done.\nReceiving objects:  12% (330/2742), 40.12 MiB | 1.52 MiB/s\rReceiving objects:  64% (1755/2742), 231.40 MiB | 1.50 MiB/s\r";
  assert.deepEqual(parseProgress(out), { step: 'Downloading', percent: 64, detail: '231.40 MiB · 1.50 MiB/s' });
  assert.deepEqual(parseProgress(`${out}Receiving objects: 100% (2742/2742), 362.00 MiB | 1.50 MiB/s, done.\nResolving deltas:  30% (3/10)\r`), { step: 'Unpacking', percent: 30 });
  assert.deepEqual(parseProgress('remote: Compressing objects:  50% (1/2)\r'), { step: 'GitHub is packing it up', percent: 50 });
  assert.deepEqual(parseProgress('Updating files:  99% (990/1000)\r'), { step: 'Checking out files', percent: 99 });
  assert.deepEqual(parseProgress("Cloning into '/x'...\n"), { step: 'Connecting to GitHub' });
  assert.equal(parseProgress(''), undefined);
});

test('a failed clone says what to do about it', () => {
  assert.match(whyCloneFailed("Cloning into 'x'...\nHost key verification failed.\nfatal: Could not read from remote repository.\n"), /ssh -T git@github\.com/);
  assert.match(whyCloneFailed('git@github.com: Permission denied (publickey).\n'), /gh ssh-key add/);
  assert.match(whyCloneFailed("fatal: could not read Username for 'https://github.com': terminal prompts disabled\n"), /gh auth setup-git/);
  assert.equal(whyCloneFailed('Receiving objects:  1% (1/100)\rerror: RPC failed\nfatal: early EOF\n'), 'error: RPC failed fatal: early EOF');
});

test('a clone shows how far along it is, then becomes a floor', async (t) => {
  const { dataDir, projects, saved } = office(t);
  process.env.FAKE_GH_DELAY = '0.6';
  const building = new Building(dataDir, projects, fast);
  const seen: unknown[] = [];
  let id = '';
  building.watchClones(() => seen.push(building.cloneProgress(id)));
  const r = await building.add('acme/game', 'Sam', (def) => (id = def.id));
  assert.equal(typeof r, 'object', String(r));
  assert.deepEqual(seen.at(-1), { step: 'Downloading', percent: 42, detail: '1.00 MiB · 512.00 KiB/s' });
  assert.ok(existsSync(path.join(projects, 'acme', 'game', 'index.html')));
  assert.deepEqual(building.list().map((d) => d.repo), ['acme/game']);
  assert.deepEqual(building.pending(), []);
  assert.deepEqual(saved(), [], "cloning.json is gone once it's done");
  assert.deepEqual(readdirSync(path.join(dataDir, 'clones')), [], 'and so is its log');
});

test("a clone that goes quiet is stopped as stalled, and one that can't sign in says why", async (t) => {
  const { dataDir, projects, running } = office(t);
  process.env.FAKE_GH_HANG = '1';
  const building = new Building(dataDir, projects, fast);
  const r = building.add('acme/game', 'Sam', () => {});
  const pid = await running();
  assert.match(String(await r), /stalled/);
  await until(() => !alive(pid));
  assert.ok(!alive(pid), 'the clone was stopped');
  assert.deepEqual(building.pending(), []);

  delete process.env.FAKE_GH_HANG;
  process.env.FAKE_GH_FAIL = 'Host key verification failed.';
  assert.match(String(await building.add('acme/game', 'Sam', () => {})), /^Couldn't clone acme\/game: ssh .*host key/);
  assert.deepEqual(building.list(), []);
});

test('a clone can be stopped by an admin or whoever added it', async (t) => {
  const { dataDir, projects, running } = office(t);
  process.env.FAKE_GH_HANG = '1';
  const building = new Building(dataDir, projects, { clone: { tickMs: 50 } });
  let id = '';
  const r = building.add('acme/game', 'Sam', (def) => (id = def.id), { account: 'sam-account' });
  const pid = await running();
  assert.match(String(building.cancel(id, 'Ann stopped the clone', (owner) => owner === 'ann-account')), /Only admins/);
  assert.equal(building.cancel(id, 'Sam stopped the clone', (owner) => owner === 'sam-account'), undefined);
  assert.equal(await r, 'Sam stopped the clone');
  await until(() => !alive(pid));
  assert.ok(!alive(pid));
  assert.deepEqual(building.list(), []);
  assert.equal(building.cancel(id, 'again', () => true), 'No such floor');
});

test('a restart mid-clone picks the clone back up, and it becomes its floor', async (t) => {
  const { dataDir, projects, saved, running } = office(t);
  process.env.FAKE_GH_DELAY = '1';
  const first = new Building(dataDir, projects, fast);
  void first.add('acme/game', 'Sam', () => {});
  await running();
  // The office restarts (tsx watch, systemd): the clone carries on without it.
  first.shutdown(true);
  const second = new Building(dataDir, projects, fast);
  const done: (FloorDef | string)[] = [];
  second.resumeClones((r) => done.push(r));
  assert.deepEqual(second.pending().map((d) => d.repo), ['acme/game'], "it's on its way again");
  await until(() => done.length > 0);
  assert.equal(typeof done[0], 'object', String(done[0]));
  assert.deepEqual(second.list().map((d) => d.repo), ['acme/game']);
  assert.deepEqual(saved(), []);
  // Saved, so the next office has it too.
  assert.deepEqual(new Building(dataDir, projects).list().map((d) => d.repo), ['acme/game']);
});

test('a clone that finished while no office was watching becomes its floor at the next start', async (t) => {
  const { dataDir, projects, running } = office(t);
  process.env.FAKE_GH_DELAY = '0.3';
  const first = new Building(dataDir, projects, fast);
  void first.add('acme/game', 'Sam', () => {});
  const pid = await running();
  first.shutdown(true);
  await until(() => !alive(pid));
  const done: (FloorDef | string)[] = [];
  new Building(dataDir, projects, fast).resumeClones((r) => done.push(r));
  assert.equal(done.length, 1);
  assert.equal((done[0] as FloorDef).repo, 'acme/game');
});

test("a clone that was cut off isn't taken for a checkout", async (t) => {
  const { dataDir, projects } = office(t);
  const dest = path.join(projects, 'acme', 'game');
  execFileSync('git', ['init', '-q', dest]);
  execFileSync('git', ['-C', dest, 'remote', 'add', 'origin', 'https://github.com/acme/game.git']);
  const building = new Building(dataDir, projects, fast);
  assert.match(String(await building.add('acme/game', 'Sam', () => {})), /didn't finish/);
  assert.deepEqual(building.list(), []);
});

test('a floor added on a branch is cloned with its checkout there', async (t) => {
  const { dataDir, projects } = office(t);
  process.env.FAKE_GH_DELAY = '0.3';
  const building = new Building(dataDir, projects, fast);
  const r = await building.add('acme/game', 'Sam', () => {}, { branch: 'feature' });
  assert.equal(typeof r, 'object', String(r));
  // The whole repository comes down either way: only the checkout starts where they picked.
  const dir = path.join(projects, 'acme', 'game');
  const head = (d: string) => execFileSync('git', ['-C', d, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(head(dir), 'feature');
  const branches = execFileSync('git', ['-C', dir, 'branch', '-a'], { encoding: 'utf8' });
  assert.match(branches, /\borigin\/feature\b/, 'the branch picked is there');
  assert.match(branches, /\borigin\/main\b/, 'and so is the rest of the repository');
});

test("a branch that isn't a branch name is refused before anything is cloned", async (t) => {
  const { dataDir, projects } = office(t);
  const building = new Building(dataDir, projects, fast);
  // A branch name is git's own; one of these would become an option of git's, not a branch.
  for (const branch of ['--upload-pack=touch /tmp/pwned', 'main..other', 'a b', '']) {
    assert.equal(await building.add('acme/game', 'Sam', () => {}, { branch }), "That isn't a branch name", branch);
  }
  assert.deepEqual(building.list(), []);
  assert.deepEqual(building.pending(), []);
});

test("a checkout already on disk is put on the branch picked, and says so when git won't", async (t) => {
  const { root, dataDir, projects } = office(t);
  const dest = path.join(projects, 'acme', 'game');
  execFileSync('git', ['clone', '-q', path.join(root, 'github', 'acme', 'game.git'), dest]);
  execFileSync('git', ['-C', dest, 'remote', 'set-url', 'origin', 'https://github.com/acme/game.git']);
  const head = () => execFileSync('git', ['-C', dest, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
  assert.equal(head(), 'main');
  const building = new Building(dataDir, projects, fast);
  // A branch the repository doesn't have: git refuses, and the checkout is left where it was.
  assert.match(String(await building.add('acme/game', 'Sam', () => {}, { branch: 'nope' })), /couldn't be put on nope/);
  assert.equal(head(), 'main');
  assert.deepEqual(building.list(), []);
  // The one it does have: the checkout moves onto it, with nothing cloned again.
  assert.equal(typeof (await building.add('acme/game', 'Sam', () => {}, { branch: 'feature' })), 'object');
  assert.equal(head(), 'feature');
});

test("a repository's branches come back with its default one, ready for the picker", async (t) => {
  const { dataDir, projects } = office(t);
  const building = new Building(dataDir, projects, fast);
  process.env.FAKE_GH_BRANCHES = 'feature\nmain\n--evil\nnot a branch\nfeature';
  // gh's list, without what isn't a branch name and without the repeats; the default is named apart.
  assert.deepEqual(await building.branches('acme/game'), { branches: ['feature', 'main'], default: 'main' });
  // A list cut short of the default branch still offers it.
  process.env.FAKE_GH_BRANCHES = 'feature';
  assert.deepEqual(await building.branches('acme/game'), { branches: ['main', 'feature'], default: 'main' });
  // Nothing from gh at all: the default is all the picker has.
  process.env.FAKE_GH_BRANCHES = '';
  assert.deepEqual(await building.branches('acme/game'), { branches: ['main'], default: 'main' });
});
