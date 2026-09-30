import test from 'node:test';
import assert from 'node:assert/strict';
import { FALL_SECONDS, Faint, OUT_SECONDS } from '../src/client/faint.js';

/** Frames of `dt` seconds, with the meters spent or not, as the frame loop would. */
function frames(f: Faint, seconds: number, spent: boolean, dt = 1 / 60): string {
  let phase = f.phase;
  for (let t = 0; t < seconds; t += dt) phase = f.update(dt, spent);
  return phase;
}

test('up on your feet nothing happens, however spent the meters are', () => {
  const f = new Faint();
  assert.equal(f.phase, 'up');
  assert.equal(f.down, false);
  assert.equal(frames(f, 30, false), 'up');
  assert.equal(f.update(1 / 60, false), 'up');
  assert.equal(f.fall, 0);
});

test('the moment a meter is spent you go down, and it ends in coming round', () => {
  const f = new Faint();
  assert.equal(f.update(1 / 60, true), 'falling');
  assert.equal(f.down, true);
  assert.equal(frames(f, FALL_SECONDS, true), 'out');
  assert.equal(frames(f, OUT_SECONDS, true), 'wake');
  assert.equal(frames(f, 30, true), 'wake', 'and it waits there until the caller has put you somewhere');
});

test('you are flat out by the end of the fall, and stay there', () => {
  const f = new Faint();
  assert.equal(f.update(1 / 60, true), 'falling');
  // The frame it starts on, you're still upright: the fall is from there.
  assert.equal(f.fall, 0);
  f.update(FALL_SECONDS / 2, true);
  assert.ok(f.fall > 0 && f.fall < 1, `part way down: ${f.fall}`);
  assert.equal(frames(f, FALL_SECONDS / 2 + 1 / 60, true), 'out');
  assert.equal(f.fall, 1, 'flat out by the end of the fall');
  frames(f, OUT_SECONDS, true);
  assert.equal(f.fall, 1, 'and still flat out when the lights come back');
});

test('clearing it puts you back on your feet, and spent meters drop you again', () => {
  const f = new Faint();
  f.update(1 / 60, true);
  frames(f, FALL_SECONDS + OUT_SECONDS, true);
  f.clear();
  assert.equal(f.phase, 'up');
  assert.equal(f.down, false);
  assert.equal(f.fall, 0);
  assert.equal(frames(f, 5, false), 'up', 'and the meters being right again keeps you up');
  assert.equal(f.update(1 / 60, true), 'falling', 'until they run out another time');
});

test('the fall and the blackout are long enough to see, and short enough to sit through', () => {
  assert.ok(FALL_SECONDS >= 0.5 && FALL_SECONDS <= 2);
  assert.ok(OUT_SECONDS >= 2 && OUT_SECONDS <= 10);
});
