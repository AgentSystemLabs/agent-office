import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stationBrief } from '../src/server/stations.js';

test("the coordinator's brief drives the phase plan in plans/, and ends with the request", () => {
  const brief = stationBrief('coordinator');
  assert.match(brief, /Coordinator/);
  assert.match(brief, /skill:\/\/coordinator/);
  assert.match(brief, /plans\/<phase>\/checklist\.md/);
  assert.match(brief, /plans\/<phase>\/timeline\.md/);
  assert.match(brief, /one dated line per event/);
  assert.match(brief, /never answer a decision that belongs to the user/);
  assert.ok(brief.endsWith('The request:'));
});
