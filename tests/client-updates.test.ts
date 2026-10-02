import test from 'node:test';
import assert from 'node:assert/strict';
import { coalescedUpdate, KeyedRows } from '../src/client/ui/updates';

interface Value { id: string; label: string }

test('worker rows retain node identity, update only changed values and prune removed keys', () => {
  const rows = new KeyedRows<Value, { label: string }>();
  let creations = 0;
  let updates = 0;
  const reconcile = (values: Value[]) => rows.reconcile(values, (v) => v.id, (v) => v.label,
    (v) => { creations++; return { label: v.label }; }, (node, v) => { updates++; node.label = v.label; });
  const original = reconcile([{ id: 'a', label: 'working' }, { id: 'b', label: 'ready' }]);
  const changed = reconcile([{ id: 'a', label: 'done' }, { id: 'b', label: 'ready' }]);
  assert.equal(changed[0], original[0]);
  assert.equal(changed[1], original[1]);
  assert.equal(changed[0].label, 'done');
  assert.equal(creations, 2);
  assert.equal(updates, 1);
  const reordered = reconcile([{ id: 'b', label: 'ready' }, { id: 'a', label: 'done' }]);
  assert.equal(reordered[0], original[1]);
  assert.equal(updates, 1);
  reconcile([{ id: 'a', label: 'done' }]);
  const readded = reconcile([{ id: 'a', label: 'done' }, { id: 'b', label: 'new worker' }]);
  assert.notEqual(readded[1], original[1]);
  assert.equal(creations, 3);
});

test('UI update bursts render latest state once and canceled windows never render', () => {
  const queue = new Map<number, () => void>();
  let id = 0;
  let state = 'working';
  const seen: string[] = [];
  const updates = coalescedUpdate(() => seen.push(state), (fn) => { queue.set(++id, fn); return id; }, (id) => { queue.delete(id); });
  updates.schedule();
  state = 'done';
  updates.schedule();
  updates.schedule();
  assert.equal(queue.size, 1);
  const tick = queue.values().next().value!;
  queue.clear();
  tick();
  assert.deepEqual(seen, ['done']);
  updates.schedule();
  updates.cancel();
  assert.equal(queue.size, 0);
  assert.deepEqual(seen, ['done']);
});
