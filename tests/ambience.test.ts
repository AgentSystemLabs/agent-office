import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../src/shared/rng.js';
import { birdCall, gap, loopNoise, pickSpecies, waveEnvelope, type Species } from '../src/client/features/ambience/noise.js';

const rmsOf = (d: Float32Array) => Math.sqrt(d.reduce((s, v) => s + v * v, 0) / d.length);
/** How much each sample follows the one before: near 0 for white noise, near 1 for a rumble. */
const follow = (d: Float32Array) => {
  let num = 0;
  for (let i = 1; i < d.length; i++) num += d[i] * d[i - 1];
  return num / (rmsOf(d) ** 2 * d.length);
};

test('noise loops come out at one level, tilted as white, pink and brown are, and never clip', () => {
  const white = loopNoise('white', 20000, 2000, mulberry32(1));
  const pink = loopNoise('pink', 20000, 2000, mulberry32(1));
  const brown = loopNoise('brown', 20000, 2000, mulberry32(1));
  for (const d of [white, pink, brown]) {
    assert.equal(d.length, 20000);
    assert.ok(Math.abs(rmsOf(d) - 0.25) < 0.01);
    assert.ok(d.every((v) => Math.abs(v) <= 1));
  }
  assert.ok(follow(white) < 0.1);
  assert.ok(follow(pink) > 0.3 && follow(pink) < follow(brown));
  assert.ok(follow(brown) > 0.9);
});

test('a noise loop joins its end to its start without a jump', () => {
  const brown = loopNoise('brown', 20000, 2000, mulberry32(5));
  let biggest = 0;
  for (let i = 1; i < brown.length; i++) biggest = Math.max(biggest, Math.abs(brown[i] - brown[i - 1]));
  assert.ok(Math.abs(brown[0] - brown[brown.length - 1]) <= biggest * 1.5);
});

test('a wave starts and ends on the wash and crests once, a third or so of the way through', () => {
  const env = waveEnvelope(200, 0.4, 0.15);
  assert.ok(Math.abs(env[0] - 0.15) < 1e-6 && Math.abs(env[199] - 0.15) < 1e-6);
  assert.ok(Math.max(...env) <= 1 && Math.min(...env) >= 0.15 - 1e-6);
  const crest = env.indexOf(Math.max(...env));
  assert.ok(crest > 60 && crest < 100);
  for (let i = 1; i <= crest; i++) assert.ok(env[i] >= env[i - 1]);
  for (let i = crest + 1; i < 200; i++) assert.ok(env[i] <= env[i - 1]);
});

test('every bird calls in tune, in order and briefly, and no two calls come out the same', () => {
  const species: Species[] = ['robin', 'dove', 'tit', 'warbler'];
  const rnd = mulberry32(42);
  for (const s of species) {
    const a = birdCall(s, rnd);
    const b = birdCall(s, rnd);
    assert.ok(a.length >= 2);
    let prev = -1;
    for (const n of a) {
      assert.ok(n.at > prev && n.dur > 0 && n.f0 > 200 && n.f0 < 8000 && n.f1 > 200 && n.f1 < 8000 && n.gain > 0 && n.gain <= 1);
      prev = n.at;
    }
    const last = a[a.length - 1];
    assert.ok(last.at + last.dur < 4, `${s} runs ${last.at + last.dur}s`);
    assert.notDeepEqual(a, b);
    assert.deepEqual(birdCall(s, mulberry32(9)), birdCall(s, mulberry32(9)));
  }
});

test('the gaps between sounds are irregular and stay in range, and every species gets its turn', () => {
  const rnd = mulberry32(3);
  const gaps = Array.from({ length: 200 }, () => gap(rnd, 3, 13));
  assert.ok(gaps.every((g) => g >= 3 && g <= 13));
  assert.ok(new Set(gaps.map((g) => g.toFixed(2))).size > 150);
  assert.equal(new Set(Array.from({ length: 200 }, () => pickSpecies(rnd))).size, 4);
});
