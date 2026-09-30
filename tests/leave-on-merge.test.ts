import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LeaveOnMerge, landedWorkers } from '../src/server/leave-on-merge.js';
import { Worktrees } from '../src/server/worktrees.js';
import type { GhPull, QueueTask, WorkerInfo, WorkerStatus } from '../src/shared/protocol.js';

function worker(id: string, status: WorkerStatus = 'done', more: Partial<WorkerInfo> = {}): WorkerInfo {
  return {
    id, kind: 'agent', deskId: 'desk-1', name: id, color: '#fff', status, acked: false, createdBy: 'test', createdAt: 0, cols: 80, rows: 24, viewers: [],
    worktree: { path: `.agent-office/worktrees/${id}`, branch: `office/${id}`, base: 'abc' },
    ...more,
  };
}

const pull = (number: number, state: string, headRefName: string, headRefOid?: string): GhPull => ({
  number, title: `PR ${number}`, state, isDraft: false, url: '', author: '', labels: [], reviewDecision: '',
  headRefName, headRefOid, baseRefName: 'main', createdAt: '', updatedAt: '', additions: 0, deletions: 0,
  checks: 'none', body: '', closes: [],
});

const ids = (workers: WorkerInfo[], pulls: GhPull[], tasks: QueueTask[] = []) => landedWorkers(workers, pulls, tasks).map((l) => l.worker.id);

test('a worker at rest whose pull request merged goes, with the head of what merged', () => {
  const head = 'a'.repeat(40);
  assert.deepEqual(landedWorkers([worker('mochi')], [pull(7, 'MERGED', 'office/mochi', head)], []), [{ worker: worker('mochi'), pr: 7, head }]);
  for (const status of ['idle', 'exited', 'offline'] as const) assert.deepEqual(ids([worker('mochi', status)], [pull(7, 'MERGED', 'office/mochi')]), ['mochi'], status);
});

test('a worker stays while its PR is open, a follow-up is open, or it has none', () => {
  assert.deepEqual(ids([worker('a')], [pull(1, 'OPEN', 'office/a')]), []);
  assert.deepEqual(ids([worker('a')], [pull(1, 'MERGED', 'office/a'), pull(2, 'OPEN', 'office/a')]), []);
  assert.deepEqual(ids([worker('a')], [pull(1, 'CLOSED', 'office/a')]), []);
  assert.deepEqual(ids([worker('a')], [pull(1, 'MERGED', 'office/someone-else')]), []);
  // Opened from its desk but not on the list yet: open.
  assert.deepEqual(ids([worker('a', 'done', { pr: { number: 9, url: '' } })], [pull(1, 'MERGED', 'office/a')]), []);
});

test('a worker stays while it works, waits on someone, opens a PR or has its terminal watched', () => {
  const merged = [pull(1, 'MERGED', 'office/a')];
  for (const status of ['starting', 'working', 'needs_input'] as const) assert.deepEqual(ids([worker('a', status)], merged), [], status);
  assert.deepEqual(ids([worker('a', 'done', { prOpening: true })], merged), []);
  assert.deepEqual(ids([worker('a', 'done', { viewers: ['Cody'] })], merged), []);
});

test('shells, board agents and the meeting table never go by pull request', () => {
  const merged = [pull(1, 'MERGED', 'office/a')];
  assert.deepEqual(ids([worker('a', 'done', { kind: 'shell' })], merged), []);
  assert.deepEqual(ids([worker('a', 'done', { deskId: 'station-pulls' })], merged), []);
  assert.deepEqual(ids([worker('a', 'done', { meeting: 'm1' })], merged), []);
});

test("a queue task's merged PR counts after it drops off GitHub's list", () => {
  const task: QueueTask = { id: 't', title: 't', prompt: 't', addedBy: 'x', addedAt: 0, status: 'done', workerId: 'a', pr: { number: 4, url: '', state: 'MERGED', title: 't' } };
  assert.deepEqual(landedWorkers([worker('a', 'done', { worktree: undefined })], [], [task]), [{ worker: worker('a', 'done', { worktree: undefined }), pr: 4, head: undefined }]);
});

test('the setting is off until someone turns it on, and keeps across restarts', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-leave-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const told: boolean[] = [];
  const a = new LeaveOnMerge(dir, (s) => told.push(s.on));
  assert.deepEqual(a.state(), { on: false });
  a.set(true, 'Cody');
  assert.deepEqual(told, [true]);
  const b = new LeaveOnMerge(dir, () => {});
  assert.equal(b.on, true);
  assert.equal(b.state().by, 'Cody');
});

test("commits in the merged PR aren't work a worktree would lose, even with the branch gone from GitHub", async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-landed-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(path.join(dir, 'a.txt'), 'a');
  git('add', '.');
  git('commit', '-qm', 'init');
  const base = git('rev-parse', 'HEAD');
  // Two commits on the worker's branch, no remote at all (as if GitHub deleted it and a fetch pruned it).
  git('checkout', '-qb', 'office/mochi');
  for (const n of [1, 2]) {
    writeFileSync(path.join(dir, `f${n}.txt`), String(n));
    git('add', '.');
    git('commit', '-qm', `c${n}`);
  }
  const merged = git('rev-parse', 'HEAD');
  git('checkout', '-q', 'main');
  const trees = new Worktrees(dir);
  const wt = { branch: 'office/mochi', base };
  assert.equal((await trees.inspect(wt)).unpushed, 2);
  assert.equal((await trees.inspect(wt, merged)).unpushed, 0);
  // A commit GitHub has and this checkout doesn't: it can't vouch for anything.
  assert.equal((await trees.inspect(wt, 'b'.repeat(40))).unpushed, 2);
  assert.equal((await trees.inspect(wt, '--all')).unpushed, 2);
  // Work after what merged still counts.
  git('checkout', '-q', 'office/mochi');
  writeFileSync(path.join(dir, 'f3.txt'), '3');
  git('add', '.');
  git('commit', '-qm', 'c3');
  git('checkout', '-q', 'main');
  assert.equal((await trees.inspect(wt, merged)).unpushed, 1);
});
