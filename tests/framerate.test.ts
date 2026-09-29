import test from 'node:test';
import assert from 'node:assert/strict';
import { SlowFrames } from '../src/client/framerate.js';

// When the 3D office offers the 2D view for being slow (framerate.ts): frames averaging 50 ms or more
// through ten seconds, once it has warmed up, and only once.

/** Draws frames `dt` ms apart from `from` for `ms`; whether any of them said slow, and when it ended. */
function run(s: SlowFrames, from: number, ms: number, dt: number): { slow: boolean; at: number } {
  let slow = false;
  let at = from;
  for (; at < from + ms; at += dt) slow = s.frame(at, dt) || slow;
  return { slow, at };
}

test('a computer drawing 10 frames a second is slow, once the office has warmed up', () => {
  const s = new SlowFrames();
  // The first 8 seconds (loading, shaders compiling) don't count, nor do the 10 after only partly.
  assert.equal(run(s, 0, 17_000, 100).slow, false);
  assert.equal(run(s, 17_000, 2_000, 100).slow, true);
});

test('60 or 25 frames a second is fine', () => {
  for (const dt of [1000 / 60, 40]) assert.equal(run(new SlowFrames(), 0, 60_000, dt).slow, false);
});

test('it says so once', () => {
  const s = new SlowFrames();
  assert.equal(run(s, 0, 20_000, 100).slow, true);
  assert.equal(run(s, 20_000, 60_000, 100).slow, false);
});

test('a hidden tab, or a stall, starts the count over rather than counting as slow', () => {
  const s = new SlowFrames();
  const { at } = run(s, 0, 8_000, 16);
  // Fast frames, a 30 s gap (the tab was hidden), and a few slow ones after: not ten seconds of them.
  let now = run(s, at, 9_000, 16).at + 30_000;
  assert.equal(s.frame(now, 30_000), false);
  now += 100;
  assert.equal(run(s, now, 5_000, 100).slow, false);
});

test('a few hitches in otherwise smooth frames are fine', () => {
  const s = new SlowFrames();
  let slow = false;
  for (let at = 0, i = 0; at < 60_000; i++) {
    const dt = i % 50 === 0 ? 400 : 16;
    at += dt;
    slow = s.frame(at, dt) || slow;
  }
  assert.equal(slow, false);
});
