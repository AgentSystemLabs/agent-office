import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PendingHires, prepareHire, type PreparedHire } from '../src/server/workers/hiring.js';
import { Worktrees } from '../src/server/worktrees.js';
import { runCheckout } from '../src/server/worktree-checkout.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { WorkerManager } from '../src/server/workers/manager.js';

const prepared: PreparedHire = { worktree: { path: 'saved-worktree', branch: 'office/test', base: 'base' }, notes: [] };
const worker = { id: 'one', name: 'Pixel' } as WorkerInfo;

test('manager launches Codex exactly once in its prepared checkout, with final desk validation', async () => {
  let complete!: (value: object) => void;
  let launches = 0;
  // Exercise the real manager hire/spawn path with only the terminal and disk persistence replaced.
  const manager = Object.assign(Object.create(WorkerManager.prototype), {
    workers: new Map(), hires: new PendingHires(), defaultProvider: 'codex', wing: () => 0,
    ledger: {}, events: { toast() {} }, tasks: { notePrompt() {} },
    trees: { prepareCheckout: () => new Promise((resolve) => { complete = resolve; }), create: () => assert.fail('second checkout') },
    launch(w: { info: WorkerInfo }) { launches++; assert.equal(w.info.provider, 'codex'); assert.deepEqual(w.info.worktree, prepared.worktree); },
    persist() {},
  }) as WorkerManager;
  const result = manager.hire('desk-1', 'Kajo', 'my task', true, 'agent', 'codex');
  assert.equal(manager.deskOccupied('desk-1'), true);
  assert.equal(launches, 0);
  assert.match(String(await manager.hire('desk-1', 'Kajo', 'duplicate', true, 'agent', 'codex')), /taken/);
  complete(prepared.worktree);
  const hired = await result;
  assert.notEqual(typeof hired, 'string');
  assert.equal(launches, 1);
  assert.equal(manager.list().length, 1);
});

test('a pending checkout reserves its desk, releases it before launch, and prevents duplicate launches', async () => {
  const pending = new PendingHires();
  let complete!: (value: PreparedHire) => void;
  let starts = 0;
  const result = pending.run('desk', () => new Promise((resolve) => { complete = resolve; }), () => {
    assert.equal(pending.has('desk'), false);
    starts++;
    return worker;
  });
  assert.equal(pending.has('desk'), true);
  assert.match(String(await pending.run('desk', async () => prepared, () => worker)), /already being prepared/);
  assert.equal(starts, 0);
  complete(prepared);
  assert.equal(await result, worker);
  assert.equal(starts, 1);
});

test('shutdown cancels preparation and never launches even if checkout completes at the same time', async () => {
  const pending = new PendingHires();
  let complete!: (value: PreparedHire) => void;
  let signal!: AbortSignal;
  const result = pending.run('desk', (s) => { signal = s; return new Promise((resolve) => { complete = resolve; }); }, () => assert.fail('must not launch'));
  pending.close();
  assert.equal(signal.aborted, true);
  complete(prepared);
  assert.match(String(await result), /cancelled.*kept/);
  assert.equal(pending.has('desk'), false);
});

test('a failed checkout releases the desk without launching an agent', async () => {
  const pending = new PendingHires();
  assert.equal(await pending.run('desk', async () => 'disk full', () => assert.fail()), 'disk full');
  assert.equal(pending.has('desk'), false);
  assert.match(String(await pending.run('desk', async () => prepared, () => 'worker limit reached')), /saved-worktree.*kept/);
});

test('unchecked worktree passes provider, model and prompt through without preparing anything', async () => {
  const args: Parameters<Parameters<typeof prepareHire>[2]['spawn']>[0] = ['desk', 'Kajo', 'my task', false, 'agent', 'codex', 'model'];
  const result = await prepareHire(new PendingHires(), args, {
    validate: () => assert.fail('validation is performed by the immediate spawn'),
    spawn: (actual) => { assert.deepEqual(actual, args); return worker; },
    trees: { prepareCheckout: () => assert.fail('unchecked must not create a worktree') } as unknown as Worktrees,
    worktrees: {} as Parameters<typeof prepareHire>[2]['worktrees'],
    events: { toast: () => assert.fail('no preparation notice') },
  });
  assert.equal(result, worker);
});

test('checked worktree waits for preparation and passes the prepared reference to the same requested hire', async () => {
  let complete!: (value: object) => void;
  let started = false;
  const args: Parameters<Parameters<typeof prepareHire>[2]['spawn']>[0] = ['desk', 'Kajo', 'my task', true, 'agent', 'codex', 'model'];
  const result = prepareHire(new PendingHires(), args, {
    validate: () => undefined,
    spawn: (actual) => { started = true; assert.deepEqual(actual.slice(0, 7), args); assert.deepEqual(actual[12]?.worktree, prepared.worktree); return worker; },
    trees: { prepareCheckout: () => new Promise((resolve) => { complete = resolve; }) } as unknown as Worktrees,
    worktrees: {} as Parameters<typeof prepareHire>[2]['worktrees'],
    events: { toast: () => undefined },
  });
  assert.equal(started, false);
  complete(prepared.worktree);
  assert.equal(await result, worker);
});

test('async checkout keeps the event loop responsive beyond the former 20 second deadline', { timeout: 30000 }, async () => {
  let ticks = 0;
  const timer = setInterval(() => { ticks++; }, 100);
  try {
    await runCheckout(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 21000)'], process.cwd());
    assert.ok(ticks > 100, `office timers continued (${ticks})`);
  } finally { clearInterval(timer); }
});

test('checkout timeout and Git failures give useful errors instead of progress dumps', async () => {
  await assert.rejects(runCheckout(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], process.cwd(), undefined, 200), /timed out/);
  await assert.rejects(runCheckout(process.execPath, ['-e', 'process.stderr.write("Updating files: 75%\\rfatal: disk full\\n"); process.exit(1)'], process.cwd()), /^Error: fatal: disk full$/);
});

test('real async worktree checkout preserves dirty shared main and reports failed retries compactly', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-hire-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', ...args], { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '-b', 'main');
  writeFileSync(path.join(root, 'file.txt'), 'committed');
  git('add', 'file.txt'); git('commit', '-m', 'initial');
  writeFileSync(path.join(root, 'file.txt'), 'local edits');
  const trees = new Worktrees(root);
  const made = await trees.prepareCheckout('hire-one');
  assert.notEqual(typeof made, 'string');
  if (typeof made === 'string') return;
  assert.equal(readFileSync(path.join(root, made.path, 'file.txt'), 'utf8'), 'committed');
  assert.equal(readFileSync(path.join(root, 'file.txt'), 'utf8'), 'local edits');
  assert.equal(git('branch', '--show-current'), 'main');
  assert.match(String(await trees.prepareCheckout('hire-one')), /already exists.*Any partial checkout/s);
});
