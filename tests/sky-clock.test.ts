import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Sky } from '../src/server/sky.js';

test('the sky keeps the clock someone picked, and keeps it across a restart', () => {
  const clockFile = path.join(mkdtempSync(path.join(tmpdir(), 'sky-clock-')), 'sky-clock.json');
  const heard: boolean[] = [];
  const sky = new Sky({ weather: 'clear', realTime: false, clockFile }, (s) => heard.push(!!s.realTime));
  assert.equal(sky.state.realTime, undefined);
  sky.setClock(true);
  assert.equal(sky.state.realTime, true);
  assert.deepEqual(heard, [true]);
  // After a restart the pick wins over the command line.
  assert.equal(new Sky({ weather: 'clear', realTime: false, clockFile }, () => {}).state.realTime, true);
  sky.setClock(false);
  assert.equal(sky.state.realTime, undefined);
  assert.equal(new Sky({ weather: 'clear', realTime: true, clockFile }, () => {}).state.realTime, undefined);
});
