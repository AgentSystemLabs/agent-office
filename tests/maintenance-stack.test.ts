import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { MaintenanceStack } from '../src/shared/protocol.js';
import { MaintenanceStackKeeper, STACK_BRANCH, swapBuild, type ShipCheck } from '../src/server/maintenance-stack.js';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd, encoding: 'utf8' }).trim();

/** A bare origin and the office's source cloned from it, with a built dist and node_modules, like the live checkout. */
function office() {
  const root = mkdtempSync(path.join(tmpdir(), 'ao-stack-'));
  const origin = path.join(root, 'origin.git');
  const src = path.join(root, 'src');
  mkdirSync(origin);
  git(origin, 'init', '--bare', '-b', 'main');
  git(root, 'clone', origin, src);
  writeFileSync(path.join(src, 'package.json'), '{"name":"agent-office"}\n');
  writeFileSync(path.join(src, '.gitignore'), 'node_modules\ndist\ndist.prev\n');
  writeFileSync(path.join(src, 'app.txt'), 'one\n');
  git(src, 'add', '-A');
  git(src, 'commit', '-m', 'first');
  git(src, 'push', 'origin', 'main');
  mkdirSync(path.join(src, 'node_modules'));
  for (const d of ['server', 'public']) mkdirSync(path.join(src, 'dist', d), { recursive: true });
  writeFileSync(path.join(src, 'dist', 'public', 'built.txt'), 'old');
  return { root, origin, src, data: path.join(root, 'data') };
}

const build: ShipCheck = { step: 'Building', cmd: 'sh', args: ['-c', 'mkdir -p dist/server dist/public && cp app.txt dist/public/built.txt'] };

function keeper(o: ReturnType<typeof office>, extra: Partial<ConstructorParameters<typeof MaintenanceStackKeeper>[0]> = {}) {
  const seen: MaintenanceStack[] = [];
  const restarts: string[] = [];
  const k = new MaintenanceStackKeeper({
    dataDir: o.data,
    source: o.src,
    emit: (s) => seen.push(s),
    busy: () => false,
    restart: async (by) => void restarts.push(by),
    checks: [build],
    supervised: true,
    ...extra,
  });
  return { k, seen, restarts };
}

/** Waits for a shipment to end: it failed, finished, or reached its restart (which leaves it on its last step). */
const settled = async (k: MaintenanceStackKeeper, restarts: string[] = []) => {
  for (let i = 0; i < 400 && k.state.phase === 'shipping' && !restarts.length; i++) await new Promise((r) => setTimeout(r, 25));
  return k.state;
};

test('his worktree is made on his own branch, shares the live checkout\'s dependencies, and starts with an empty stack', async () => {
  const o = office();
  const { k } = keeper(o);
  assert.equal(k.dir, undefined, 'no worktree until he is needed');
  assert.equal(await k.prepare(), undefined);
  assert.equal(k.dir, path.join(o.data, 'maintenance', 'worktree'));
  assert.equal(git(k.dir!, 'rev-parse', '--abbrev-ref', 'HEAD'), STACK_BRANCH);
  assert.ok(lstatSync(path.join(k.dir!, 'node_modules')).isSymbolicLink());
  assert.deepEqual(k.state.changes, []);
  assert.equal(k.state.dirty, 0);
  assert.equal(k.state.branch, 'main');
});

test('each commit he makes is a change on the stack, oldest first, and an unfinished edit shows as dirty', async () => {
  const o = office();
  const { k } = keeper(o);
  await k.prepare();
  writeFileSync(path.join(k.dir!, 'a.txt'), 'a');
  git(k.dir!, 'add', '-A');
  git(k.dir!, 'commit', '-m', 'Add a screen');
  writeFileSync(path.join(k.dir!, 'b.txt'), 'b');
  git(k.dir!, 'add', '-A');
  git(k.dir!, 'commit', '-m', 'Add a button');
  writeFileSync(path.join(k.dir!, 'c.txt'), 'c');
  await k.refresh();
  assert.deepEqual(k.state.changes.map((c) => c.subject), ['Add a screen', 'Add a button']);
  assert.equal(k.state.dirty, 1);
});

test('with nothing stacked he starts again from what the live checkout is on now', async () => {
  const o = office();
  const { k } = keeper(o);
  await k.prepare();
  writeFileSync(path.join(o.src, 'later.txt'), 'x');
  git(o.src, 'add', '-A');
  git(o.src, 'commit', '-m', 'someone else');
  await k.prepare();
  assert.ok(existsSync(path.join(k.dir!, 'later.txt')));
  assert.deepEqual(k.state.changes, []);
});

test('the big button commits what is left, checks, updates and pushes the live checkout, swaps the build in and restarts', async () => {
  const o = office();
  const { k, restarts } = keeper(o);
  await k.prepare();
  writeFileSync(path.join(k.dir!, 'app.txt'), 'two\n');
  git(k.dir!, 'commit', '-am', 'Change app');
  writeFileSync(path.join(k.dir!, 'wip.txt'), 'half done');
  await k.refresh();
  assert.equal(await k.ship('Alex'), undefined);
  assert.equal(k.state.phase, 'shipping');
  const done = await settled(k, restarts);
  assert.equal(done.phase, 'shipping', 'it stays on the last step while the office restarts');
  assert.deepEqual(restarts, ['Alex']);
  assert.equal(readFileSync(path.join(o.src, 'app.txt'), 'utf8'), 'two\n');
  assert.ok(existsSync(path.join(o.src, 'wip.txt')), 'the unfinished edit was committed too');
  assert.equal(git(o.src, 'rev-parse', 'HEAD'), git(o.origin, 'rev-parse', 'main'), 'pushed');
  assert.equal(readFileSync(path.join(o.src, 'dist', 'public', 'built.txt'), 'utf8'), 'two\n', 'the new build is in');
  assert.equal(readFileSync(path.join(o.src, 'dist.prev', 'public', 'built.txt'), 'utf8'), 'old', 'the old one is kept');
  assert.deepEqual(k.state.changes, [], 'and the stack is empty');
});

test('a failing check stops the shipment with the live checkout, its build and origin as they were', async () => {
  const o = office();
  const { k, restarts } = keeper(o, { checks: [{ step: 'Running the tests', cmd: 'sh', args: ['-c', 'echo "1 failing: the thing" >&2; exit 1'] }, build] });
  await k.prepare();
  writeFileSync(path.join(k.dir!, 'app.txt'), 'two\n');
  git(k.dir!, 'commit', '-am', 'Change app');
  const before = git(o.src, 'rev-parse', 'HEAD');
  assert.equal(await k.ship('Alex'), undefined);
  const s = await settled(k);
  assert.equal(s.phase, 'failed');
  assert.match(s.error!, /Running the tests failed, so nothing was shipped/);
  assert.match(s.error!, /1 failing: the thing/);
  assert.equal(git(o.src, 'rev-parse', 'HEAD'), before);
  assert.equal(git(o.origin, 'rev-parse', 'main'), before);
  assert.equal(readFileSync(path.join(o.src, 'dist', 'public', 'built.txt'), 'utf8'), 'old');
  assert.deepEqual(restarts, []);
  assert.equal(s.changes.length, 1, 'the change is still stacked');
});

test('a refused push puts the live checkout back and keeps the stack', async () => {
  const o = office();
  writeFileSync(path.join(o.origin, 'hooks', 'pre-receive'), '#!/bin/sh\necho "no pushing today" >&2\nexit 1\n');
  chmodSync(path.join(o.origin, 'hooks', 'pre-receive'), 0o755);
  const { k, restarts } = keeper(o);
  await k.prepare();
  writeFileSync(path.join(k.dir!, 'app.txt'), 'two\n');
  git(k.dir!, 'commit', '-am', 'Change app');
  const before = git(o.src, 'rev-parse', 'HEAD');
  await k.ship('Alex');
  const s = await settled(k);
  assert.equal(s.phase, 'failed');
  assert.match(s.error!, /push to origin\/main was refused/);
  assert.equal(git(o.src, 'rev-parse', 'HEAD'), before, 'rolled back');
  assert.equal(readFileSync(path.join(o.src, 'app.txt'), 'utf8'), 'one\n');
  assert.equal(s.changes.length, 1);
  assert.deepEqual(restarts, []);
});

test('the stack is rebased onto a live checkout that moved on, and a conflict is reported, not forced', async () => {
  const o = office();
  const { k, restarts } = keeper(o);
  await k.prepare();
  writeFileSync(path.join(k.dir!, 'mine.txt'), 'mine');
  git(k.dir!, 'add', '-A');
  git(k.dir!, 'commit', '-m', 'Mine');
  writeFileSync(path.join(o.src, 'theirs.txt'), 'theirs');
  git(o.src, 'add', '-A');
  git(o.src, 'commit', '-m', 'Theirs');
  await k.ship('Alex');
  await settled(k, restarts);
  assert.deepEqual(restarts, ['Alex']);
  assert.ok(existsSync(path.join(o.src, 'mine.txt')) && existsSync(path.join(o.src, 'theirs.txt')), 'both sides survive');

  const p = office();
  const second = keeper(p);
  await second.k.prepare();
  writeFileSync(path.join(second.k.dir!, 'app.txt'), 'mine\n');
  git(second.k.dir!, 'commit', '-am', 'Mine');
  writeFileSync(path.join(p.src, 'app.txt'), 'theirs\n');
  git(p.src, 'commit', '-am', 'Theirs');
  await second.k.ship('Alex');
  const s = await settled(second.k, second.restarts);
  assert.equal(s.phase, 'failed');
  assert.match(s.error!, /hit conflicts/);
  assert.equal(readFileSync(path.join(p.src, 'app.txt'), 'utf8'), 'theirs\n');
  assert.equal(s.changes.length, 1);
  assert.equal(git(second.k.dir!, 'status', '--porcelain'), '', 'the rebase was aborted');
});

test('it will not ship while he is working, with nothing stacked, or over uncommitted changes in the live checkout', async () => {
  const o = office();
  let busy = true;
  const { k } = keeper(o, { busy: () => busy });
  await k.prepare();
  assert.match((await k.ship('Alex'))!, /still working/);
  busy = false;
  assert.equal(await k.ship('Alex'), 'Nothing is stacked yet');
  writeFileSync(path.join(k.dir!, 'a.txt'), 'a');
  git(k.dir!, 'add', '-A');
  git(k.dir!, 'commit', '-m', 'A');
  await k.refresh();
  writeFileSync(path.join(o.src, 'app.txt'), 'edited by hand\n');
  assert.equal(await k.ship('Alex'), undefined);
  const s = await settled(k);
  assert.equal(s.phase, 'failed');
  assert.match(s.error!, /changes that aren't committed/);
  assert.equal(readFileSync(path.join(o.src, 'app.txt'), 'utf8'), 'edited by hand\n', 'and they were left alone');
});

test('an office nothing restarts is built and pushed but left running, with a note', async () => {
  const o = office();
  const { k, restarts } = keeper(o, { supervised: false });
  await k.prepare();
  writeFileSync(path.join(k.dir!, 'a.txt'), 'a');
  git(k.dir!, 'add', '-A');
  git(k.dir!, 'commit', '-m', 'A');
  await k.ship('Alex');
  const s = await settled(k);
  assert.equal(s.phase, 'idle');
  assert.match(s.note!, /restart it to run the new version/);
  assert.deepEqual(restarts, []);
  assert.equal(git(o.src, 'rev-parse', 'HEAD'), git(o.origin, 'rev-parse', 'main'));
});

test('a build that made no dist is not swapped in', () => {
  const o = office();
  const from = path.join(o.root, 'empty');
  mkdirSync(from);
  assert.throws(() => swapBuild(from, o.src), /didn't produce dist/);
  assert.equal(readFileSync(path.join(o.src, 'dist', 'public', 'built.txt'), 'utf8'), 'old');
});
