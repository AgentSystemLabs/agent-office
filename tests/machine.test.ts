import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Machine, parseWorkerLimit } from '../src/server/machine.js';
import type { MachineState } from '../src/shared/protocol.js';

function fixture(ceiling?: number) {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-machine-'));
  let workers = 0;
  const told: MachineState[] = [];
  const open = () => new Machine(dir, ceiling, () => workers, (s) => told.push(s));
  return { open, told, hire: (n = 1) => (workers += n), close: () => rmSync(dir, { recursive: true, force: true }) };
}

test('worker limits are whole numbers from 1 up', () => {
  assert.equal(parseWorkerLimit('6'), 6);
  assert.equal(parseWorkerLimit(' 12 '), 12);
  for (const bad of ['0', '-1', '2.5', 'six', '', 0, 1.5, null, undefined, 10_000]) assert.equal(parseWorkerLimit(bad), undefined, String(bad));
});

test('no limit until one is set; then hiring past it is refused, across restarts', (t) => {
  const f = fixture(); t.after(() => f.close());
  const m = f.open();
  f.hire(5);
  assert.equal(m.limit, undefined);
  assert.equal(m.full(), undefined);
  assert.equal(m.room(), Infinity);
  assert.equal(m.setLimit(5, 'Ada'), undefined);
  assert.match(m.full() ?? '', /limit of 5 workers/);
  assert.equal(m.room(), 0);
  assert.deepEqual(f.told.at(-1)?.set?.limit, 5);
  // Kept on disk.
  const again = f.open();
  assert.equal(again.limit, 5);
  assert.equal(again.state().set?.by, 'Ada');
  assert.equal(again.setLimit(undefined, 'Ada'), undefined);
  assert.equal(again.full(), undefined);
});

test('--max-workers is a ceiling the office can go under but not over', (t) => {
  const f = fixture(4); t.after(() => f.close());
  const m = f.open();
  assert.equal(m.limit, 4);
  f.hire(3);
  assert.equal(m.room(), 1);
  assert.match(m.setLimit(6, 'Ada') ?? '', /--max-workers 4/);
  assert.equal(m.limit, 4);
  assert.equal(m.setLimit(2, 'Ada'), undefined);
  assert.equal(m.limit, 2);
  assert.equal(m.room(), -1);
  assert.ok(m.full());
  // Taking the office's own limit off goes back to the ceiling.
  m.setLimit(undefined, 'Ada');
  assert.equal(m.limit, 4);
  assert.equal(m.state().ceiling, 4);
});

test('everyone hears when the worker count moves, and only then', (t) => {
  const f = fixture(); t.after(() => f.close());
  const m = f.open();
  m.workersChanged();
  const n = f.told.length;
  m.workersChanged();
  assert.equal(f.told.length, n);
  f.hire();
  m.workersChanged();
  assert.equal(f.told.length, n + 1);
  assert.equal(f.told.at(-1)?.workers, 1);
});
