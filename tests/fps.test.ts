import test from 'node:test';
import assert from 'node:assert/strict';
import { FpsDuel } from '../src/server/fps.js';
import { ARENA, FPS, idleInput, moveFps, rayBox, traceShot, validInput, type FpsPlayer } from '../src/shared/fps.js';

const live = () => {
  const duel = new FpsDuel(); duel.join('a', 'Alice', 1000); duel.join('b', 'Bob', 1000); duel.tick(4000); return duel;
};
const player = (x = 0, z = 0): FpsPlayer => ({ id: 'a', name: 'Alice', x, z, y: 0, vy: 0, yaw: 0, pitch: 0, hp: 100, ammo: 30, reserve: 90, score: 0, reloadUntil: 0, ready: false });

test('duel admits exactly two players, starts a countdown, and snapshots cannot mutate authority', () => {
  const d = new FpsDuel(); assert.equal(d.join('a', 'Alice', 1000), true);
  assert.equal(d.state(1000).phase, 'waiting'); assert.equal(d.join('b', 'Bob', 1000), true);
  assert.equal(d.join('c', 'Charlie', 1000), false); assert.equal(d.state(1000).phase, 'countdown');
  d.state(1000).players[0].hp = 0; assert.equal(d.state(1000).players[0].hp, 100);
  d.tick(3999); assert.equal(d.state(3999).phase, 'countdown'); d.tick(4000); assert.equal(d.state(4000).phase, 'live');
});

test('input rejects non-finite values, malformed buttons and oversized angles', () => {
  assert.equal(validInput(idleInput()), true);
  for (const bad of [null, { ...idleInput(), forward: 99 }, { ...idleInput(), yaw: NaN }, { ...idleInput(), pitch: Infinity }, { ...idleInput(), fire: 'true' }, { ...idleInput(), yaw: 20 }]) assert.equal(validInput(bad as any), false);
  const d = live(); const before = d.state(4000).players[0];
  d.input('a', { ...idleInput(), forward: 99 }, 4050); d.tick(4050); assert.equal(d.state(4050).players[0].z, before.z);
});

test('movement cannot cross cover or arena walls; diagonals do not move faster', () => {
  const p = player(0, 4); for (let i = 0; i < 100; i++) moveFps(p, { ...idleInput(), forward: 1 }, .05);
  assert.ok(p.z >= 1.8 - 1e-6);
  const edge = player(15, 8); for (let i = 0; i < 100; i++) moveFps(edge, { ...idleInput(), side: 1 }, .05);
  assert.ok(edge.x <= 15.2);
  const straight = player(-11, 9), diagonal = player(-11, 9);
  moveFps(straight, { ...idleInput(), forward: 1 }, .1); moveFps(diagonal, { ...idleInput(), forward: 1, side: 1 }, .1);
  assert.ok(Math.abs(Math.hypot(diagonal.x + 11, diagonal.z - 9) - Math.abs(straight.z - 9)) < 1e-8);
});

test('ray tests handle parallel rays, cover, headshots, body shots and misses', () => {
  assert.equal(rayBox({ x: 10, y: 1, z: 4 }, { x: 0, y: 0, z: -1 }, ARENA[6]), null);
  const p = player(-11, 9), target = { ...player(-11, -9), id: 'b' };
  assert.equal(traceShot(p, target).hit, null); // crate at (-11,3)
  p.x = -14; target.x = -14;
  assert.equal(traceShot(p, target).headshot, true);
  p.pitch = Math.atan2(.9 - FPS.eye, 18);
  assert.equal(traceShot(p, target).hit, 'b'); assert.equal(traceShot(p, target).headshot, false);
  p.yaw = .2; assert.equal(traceShot(p, target).hit, null);
});

test('server releases stale movement and fire input', () => {
  const d = live(); d.input('a', { ...idleInput(), forward: 1, fire: true }, 4050); d.tick(4050);
  const moved = d.state(4050).players[0]; assert.ok(moved.z < 9); assert.equal(moved.ammo, 29);
  d.tick(4400); const stopped = d.state(4400).players[0]; assert.equal(stopped.z, moved.z); assert.equal(stopped.ammo, moved.ammo);
});

test('rate-limited shots consume ammo, reload blocks firing and transfers only reserve rounds', () => {
  const d = live(); const shoot = (at: number) => { d.input('a', { ...idleInput(), fire: true }, at); return d.tick(at); };
  assert.equal(shoot(4050).length, 1); assert.equal(shoot(4100).length, 0); assert.equal(shoot(4200).length, 1);
  d.reload('a', 4200); assert.equal(shoot(4300).length, 0);
  d.input('a', idleInput(), 6000); d.tick(6000); const p = d.state(6000).players[0];
  assert.equal(p.ammo, 30); assert.equal(p.reserve, 88); assert.equal(p.reloadUntil, 0);
  for (let i = 0; i < 35; i++) shoot(6200 + i * 150);
  assert.equal(d.state(11300).players[0].ammo, 0); assert.equal(shoot(11500).length, 0);
});

test('elimination scores once, round reset swaps spawns, match needs both rematch votes', () => {
  const d2 = live(); let now = 4000;
  for (let r = 0; r < 5; r++) {
    // Northern/southern spawn alternate. Walk horizontally to the outer west/east lane.
    for (let i = 0; i < 120; i++) {
      now += 50;
      for (const p of d2.state(now).players) d2.input(p.id, { ...idleInput(), side: p.x > -14 ? -1 : 0, yaw: 0 }, now);
      d2.tick(now);
    }
    const [a, b] = d2.state(now).players;
    now += 150; d2.input('a', { ...idleInput(), yaw: Math.atan2(-(b.x - a.x), -(b.z - a.z)), fire: true }, now);
    assert.equal(d2.tick(now)[0]?.hit, 'b');
    assert.equal(d2.state(now).players[0].score, r + 1);
    assert.equal(d2.tick(now + 50).length, 0);
    if (r < 4) { const oldZ = a.z; now += 3500; d2.tick(now); assert.notEqual(d2.state(now).players[0].z, oldZ); now += 3000; d2.tick(now); }
  }
  assert.equal(d2.state(now).phase, 'finished'); d2.rematch('a', now); assert.equal(d2.state(now).phase, 'finished');
  d2.rematch('b', now); assert.equal(d2.state(now).phase, 'countdown'); assert.equal(d2.state(now).players[0].score, 0);
});

test('timeout draws, disconnect resets survivor, replacement starts a fresh match', () => {
  const d = live(); d.tick(94000); assert.equal(d.state(94000).phase, 'intermission'); assert.equal(d.state(94000).winner, null);
  assert.equal(d.leave('a', 94050), true); assert.equal(d.state(94050).phase, 'waiting');
  assert.equal(d.leave('a', 94050), false); d.join('c', 'Charlie', 94500);
  assert.equal(d.state(94500).phase, 'countdown'); assert.ok(d.state(94500).players.every(p => p.score === 0 && p.hp === 100));
});
