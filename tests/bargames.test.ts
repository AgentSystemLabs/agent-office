import test from 'node:test';
import assert from 'node:assert/strict';
import { AXE_TARGET, DART, GREEN, ROUND, axeScore, dartScore, landing, meterAt, onBackWall, score, tossOk, type BarGame } from '../src/shared/bargames.js';

/** A point `r` meters out from the board's middle, `deg` degrees clockwise from straight up. */
const at = (r: number, deg: number): [number, number] => [r * Math.sin((deg * Math.PI) / 180), r * Math.cos((deg * Math.PI) / 180)];

test('darts: the numbers go round the board clockwise from 20 at the top', () => {
  const single = (DART.outer + DART.trebleIn) / 2;
  assert.deepEqual(dartScore(...at(single, 0)), { points: 20, label: '20' });
  assert.deepEqual(dartScore(...at(single, 18)), { points: 1, label: '1' });
  assert.deepEqual(dartScore(...at(single, 90)), { points: 6, label: '6' });
  assert.deepEqual(dartScore(...at(single, 180)), { points: 3, label: '3' });
  assert.deepEqual(dartScore(...at(single, 270)), { points: 11, label: '11' });
  assert.deepEqual(dartScore(...at(single, 342)), { points: 5, label: '5' });
  // Each wedge is 18° wide, centered on its number: 8° off 20 is still 20, 10° off is 1.
  assert.equal(dartScore(...at(single, 8)).points, 20);
  assert.equal(dartScore(...at(single, 10)).points, 1);
  assert.equal(dartScore(...at(single, -10)).points, 5);
});

test('darts: bulls, trebles, doubles, and off the scoring area', () => {
  assert.deepEqual(dartScore(0, 0), { points: 50, label: 'Bull' });
  assert.deepEqual(dartScore(0.01, 0), { points: 25, label: '25' });
  assert.deepEqual(dartScore(0, (DART.trebleIn + DART.trebleOut) / 2), { points: 60, label: 'T20' });
  assert.deepEqual(dartScore(...at((DART.doubleIn + DART.doubleOut) / 2, 180)), { points: 6, label: 'D3' });
  assert.deepEqual(dartScore(0, (DART.doubleOut + DART.board) / 2), { points: 0, label: 'Out' });
  assert.deepEqual(dartScore(0.3, 0.3), { points: 0, label: 'Miss' });
});

test('axes: the rings, the bullseye and the killshots, counting the best part of the edge', () => {
  assert.deepEqual(axeScore(0, 0, true), { points: 6, label: 'Bull' });
  assert.equal(axeScore(0.12, 0, true).points, 4);
  assert.equal(axeScore(0.22, 0, true).points, 3);
  assert.equal(axeScore(0.32, 0, true).points, 2);
  assert.equal(axeScore(0.42, 0, true).points, 1);
  assert.deepEqual(axeScore(0.6, 0, true), { points: 0, label: 'Board' });
  assert.deepEqual(axeScore(1.2, 0, true), { points: 0, label: 'Wall' });
  // An edge whose middle is just outside the bull still touches it, so it counts as one.
  assert.equal(axeScore(0, AXE_TARGET.rings[0].r + AXE_TARGET.blade / 2 - 0.01, true).points, 6);
  assert.equal(axeScore(0, AXE_TARGET.rings[0].r + AXE_TARGET.blade / 2 + 0.01, true).points, 4);
  const k = AXE_TARGET.kill;
  assert.deepEqual(axeScore(k.u, k.v, true), { points: 8, label: 'Killshot' });
  assert.deepEqual(axeScore(-k.u, k.v, true), { points: 8, label: 'Killshot' });
  // One that bounced off scores nothing, even dead center.
  assert.deepEqual(axeScore(0, 0, false), { points: 0, label: 'Drop' });
  assert.equal(score('axe', 0, 0, true).points, 6);
  assert.equal(score('darts', 0, 0, false).points, 50);
});

test('the best rounds there are: three treble twenties, five killshots', () => {
  const t20 = dartScore(0, (DART.trebleIn + DART.trebleOut) / 2).points;
  assert.equal(t20 * ROUND.darts, 180);
  assert.equal(AXE_TARGET.kill.points * ROUND.axe, 40);
});

test('the meter runs up and down, and back up again', () => {
  assert.equal(meterAt(0, 1), 0);
  assert.equal(meterAt(0.5, 1), 0.5);
  assert.equal(meterAt(1, 1), 1);
  assert.ok(Math.abs(meterAt(1.25, 1) - 0.75) < 1e-9);
  assert.ok(Math.abs(meterAt(2.25, 1) - 0.25) < 1e-9);
});

test('a dart let go in the green lands within a centimeter and a half of the aim; off it, soft drops and hard sails high', () => {
  const g = GREEN.darts;
  for (const p of [g.at - g.width / 2, g.at, g.at + g.width / 2]) {
    const l = landing('darts', 0, 0.103, p);
    assert.ok(Math.abs(l.v - 0.103) <= 0.0151, `at ${p}`);
  }
  // Aimed at treble 20 in the green, it's a treble 20.
  assert.equal(dartScore(landing('darts', 0, 0.103, g.at).u, landing('darts', 0, 0.103, g.at).v).label, 'T20');
  assert.ok(landing('darts', 0, 0, 0.2).v < -0.4, 'thrown far too soft, it drops well under the board');
  assert.ok(landing('darts', 0, 0, 1).v > DART.board, 'thrown as hard as it goes, it sails over');
  // The hand's own miss is small.
  const j = landing('darts', 0, 0, g.at, [1, -1]);
  assert.ok(Math.abs(j.u) <= 0.006 && Math.abs(j.v) <= 0.006);
});

test('an axe let go in the green sticks where it was aimed; off the green it bounces off', () => {
  const g = GREEN.axe;
  for (const p of [g.at - g.width / 2, g.at, g.at + g.width / 2]) assert.ok(landing('axe', 0, 0, p).stick, `at ${p}`);
  assert.ok(!landing('axe', 0, 0, g.at - g.width).stick);
  assert.ok(!landing('axe', 0, 0, g.at + g.width).stick);
  assert.equal(axeScore(landing('axe', 0, 0, g.at).u, landing('axe', 0, 0, g.at).v, true).points, 6);
  // Aimed off the back wall (into the floor), nothing sticks however it's thrown.
  assert.ok(!onBackWall(0, -1.45));
  assert.ok(!landing('axe', 0, -1.45, g.at).stick);
});

test('the office only passes on throws someone could make', () => {
  const ok = (t: Record<string, unknown>) => tossOk({ game: 'darts', u: 0, v: 0, n: 1, ...t } as { game: unknown; u: unknown; v: unknown; n: unknown });
  assert.ok(ok({}));
  for (const game of ['darts', 'axe'] as BarGame[]) {
    assert.ok(ok({ game, n: ROUND[game] }));
    assert.ok(!ok({ game, n: ROUND[game] + 1 }));
  }
  assert.ok(!ok({ game: 'bowling' }));
  assert.ok(!ok({ n: 0 }));
  assert.ok(!ok({ n: 1.5 }));
  assert.ok(!ok({ u: Number.NaN }));
  assert.ok(!ok({ v: Infinity }));
  assert.ok(!ok({ u: '0' }));
  assert.ok(!ok({ v: 9 }));
});
