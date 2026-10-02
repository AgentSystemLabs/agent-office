import test from 'node:test';
import assert from 'node:assert/strict';
import { OfficePerformanceEdits } from '../src/client/shared/office-performance';
import { DEFAULT_OFFICE_PERFORMANCE } from '../src/shared/performance';

test('rapid office controls accumulate pending changes across earlier acknowledgements', () => {
  let server = { ...DEFAULT_OFFICE_PERFORMANCE };
  const edits = new OfficePerformanceEdits(() => server);
  const first = edits.set('screenFps', 4);
  const second = edits.set('usageScanSeconds', 30);
  assert.equal(second.screenFps, 4);
  assert.equal(second.usageScanSeconds, 30);
  server = first;
  assert.equal(edits.acknowledge(server), false);
  assert.deepEqual(edits.value(), second);
  server = second;
  assert.equal(edits.acknowledge(server), true);
  assert.deepEqual(edits.value(), second);
});

test('office rejection/timeout recovers current server values and reset is concrete', () => {
  const edits = new OfficePerformanceEdits(() => ({ ...DEFAULT_OFFICE_PERFORMANCE, screenFps: 1 }));
  edits.set('changesPollSeconds', 10);
  edits.recover();
  assert.equal(edits.value().changesPollSeconds, DEFAULT_OFFICE_PERFORMANCE.changesPollSeconds);
  assert.equal(edits.value().screenFps, 1);
  assert.deepEqual(edits.reset(), DEFAULT_OFFICE_PERFORMANCE);
});
