import test from 'node:test';
import assert from 'node:assert/strict';
import { BALL, HOOP, SWEET, backboard, idealSpeed, launch, lookAtRim, meter, outOfReach, shotSpeed, simulate, throwOk, throwPitch, underCeiling, type BallHit, type Solid } from '../src/shared/hoop.js';
import { FLOOR, LOFT, WALL_HEIGHT } from '../src/shared/layout.js';
import { Court } from '../src/server/court.js';

// The floor, the wall behind the hoop, the ceiling and the backboard: all a shot at the hoop meets.
const room: Solid[] = [
  { ...FLOOR, bottom: -0.3, top: 0 },
  { minX: FLOOR.minX - 0.3, maxX: FLOOR.minX, minZ: FLOOR.minZ, maxZ: FLOOR.maxZ, top: 99 },
  { ...FLOOR, bottom: WALL_HEIGHT, top: WALL_HEIGHT + 0.3 },
  backboard(),
];

/** A shot from `dist` meters straight out from the rim, let go of at `power` on the meter. */
function shoot(dist: number, power: number, hits?: BallHit[]) {
  const from = { x: HOOP.rim.x + dist, y: 1.4, z: HOOP.z };
  const pitch = underCeiling(from, throwPitch(lookAtRim(from)));
  const v = shotSpeed(idealSpeed(from, pitch)!, power);
  const s = launch({ ...from, vx: -v * Math.cos(pitch), vy: v * Math.sin(pitch), vz: 0 });
  simulate(s, 30, room, hits);
  return s;
}

test('a shot let go of right in the sweet spot drops through the ring, from close up to way out', () => {
  for (const dist of [2, 4.2, 6, 9, 12, 15]) {
    const hits: BallHit[] = [];
    const s = shoot(dist, SWEET.at, hits);
    assert.ok(s.scored, `from ${dist} m`);
    assert.ok(!s.touched.rim && !s.touched.board, `nothing but net from ${dist} m`);
    assert.equal(hits.filter((h) => h.kind === 'score').length, 1, 'it goes in once');
  }
});

test('well short of the sweet spot, or at the top of the meter, misses (close in, a long one can still bank in)', () => {
  for (const dist of [4.2, 8]) assert.ok(!shoot(dist, SWEET.at - 0.25).scored, `short from ${dist} m`);
  for (const dist of [8, 12]) assert.ok(!shoot(dist, 1).scored, `long from ${dist} m`);
});

test('a long shot stays under the ceiling', () => {
  const from = { x: HOOP.rim.x + 15.5, y: 1.4, z: HOOP.z };
  const pitch = underCeiling(from, throwPitch(lookAtRim(from)));
  const v = idealSpeed(from, pitch)!;
  assert.ok(from.y + (v * Math.sin(pitch)) ** 2 / 19.6 < WALL_HEIGHT - BALL.r);
});

test('the same throw flies exactly the same way every time, so every page sees the same shot', () => {
  const a = shoot(7, 0.71);
  const b = shoot(7, 0.71);
  assert.deepEqual([a.x, a.y, a.z, a.t, a.scored], [b.x, b.y, b.z, b.t, b.scored]);
});

test('a dropped ball bounces, rolls to a stop on the floor and can be picked up there', () => {
  const s = launch({ x: 0, y: 1.2, z: 0, vx: 1, vy: 0.5, vz: 0 });
  simulate(s, 30, room);
  assert.ok(s.still && !s.lost);
  assert.ok(Math.abs(s.y - BALL.r) < 0.01, `on the floor (${s.y})`);
  assert.ok(!outOfReach(s));
});

test('up on something tall it is out of reach, but not up in the loft', () => {
  assert.ok(outOfReach({ x: 5.4, y: 3.05 + BALL.r, z: -5.4 }), 'on top of the whiteboard');
  assert.ok(!outOfReach({ x: (LOFT.minX + LOFT.maxX) / 2, y: LOFT.y + BALL.r, z: (LOFT.minZ + LOFT.maxZ) / 2 }), 'on the loft floor');
  assert.ok(outOfReach({ x: (LOFT.minX + LOFT.maxX) / 2, y: LOFT.y + LOFT.height + 0.2 + BALL.r, z: (LOFT.minZ + LOFT.maxZ) / 2 }), 'on the loft roof');
});

test('the meter runs up to the top and back down', () => {
  assert.equal(meter(0), 0);
  assert.ok(meter(0.5) > 0.4 && meter(0.5) < 0.6);
  assert.ok(Math.abs(meter(1.05) - 1) < 1e-9);
  assert.ok(Math.abs(meter(1.575) - 0.5) < 1e-9);
  assert.ok(Math.abs(meter(2.1)) < 1e-9);
});

test('the office only passes on throws from inside the building, no faster than anyone throws', () => {
  const ok = { x: -12, y: 1.4, z: 10, vx: -5, vy: 5, vz: 0 };
  assert.ok(throwOk(ok));
  assert.ok(!throwOk({ ...ok, vx: -BALL.maxSpeed, vy: 5 }), 'too fast');
  assert.ok(!throwOk({ ...ok, x: Number.NaN }), 'not a number');
  assert.ok(!throwOk({ ...ok, x: 60 }), 'out in the street');
});

test('the court: one person has the ball at a time, and only they can throw it', () => {
  let now = 1_000_000;
  const c = new Court(() => now);
  assert.deepEqual(c.state(), {}, 'under the hoop to start with');
  assert.ok(c.take('ann'));
  assert.ok(!c.take('bob'), 'Ann has it');
  assert.deepEqual(c.state(), { holder: 'ann' });
  const throwAt = { x: -12, y: 1.4, z: 10, vx: -5, vy: 6, vz: 0 };
  assert.ok(!c.throw('bob', throwAt), "it isn't Bob's to throw");
  assert.ok(c.throw('ann', throwAt));
  now += 400;
  assert.deepEqual(c.state(), { shot: { ...throwAt, by: 'ann', elapsed: 400 } });
  assert.ok(c.take('bob'), 'Bob catches the rebound');
  assert.ok(!c.throw('bob', { ...throwAt, vx: 1e6 }), 'not that fast');
});

test('the court: leaving the floor with the ball puts it back under the hoop', () => {
  const c = new Court();
  assert.ok(c.take('ann'));
  assert.ok(!c.left('bob'), "Bob didn't have it");
  assert.ok(c.left('ann'));
  assert.deepEqual(c.state(), {});
});

test('the court: nobody grabs the ball over and over faster than a person could', () => {
  let now = 1_000_000;
  const c = new Court(() => now);
  const drop = { x: -12, y: 1.4, z: 10, vx: 0, vy: 0, vz: 0 };
  assert.ok(c.take('ann'));
  assert.ok(c.throw('ann', drop));
  assert.ok(!c.take('ann'), 'straight back again is too soon');
  now += 200;
  assert.ok(c.take('ann'));
});
