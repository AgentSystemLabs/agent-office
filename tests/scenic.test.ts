import test from 'node:test';
import assert from 'node:assert/strict';
import { CAR, DRIVE, onPavement, paved, steerLimit } from '../src/shared/garage.js';
import { FLOOR, GOLF_HOLE, ROAD, WALL_T } from '../src/shared/layout.js';
import { CHECKPOINTS, FARM, FOOTHILLS, LAKE, LIGHTHOUSE, LOOP, LOOP_HALF, LOOP_LENGTH, LOOP_PAVED, MOUNTAINS, STREET_END, STREET_Z, TUNNEL, nearLoop, placeAt, shoreX } from '../src/shared/scenic.js';
import { LapTimer, lapTime } from '../src/client/laps.js';
import { Garage } from '../src/server/garage.js';

test('the loop leaves one end of the street and comes back to the other, dead straight and in one piece', () => {
  const first = LOOP[0];
  const last = LOOP[LOOP.length - 1];
  assert.deepEqual([first.x, first.z], [STREET_END, STREET_Z]);
  assert.deepEqual([last.x, last.z], [-STREET_END, STREET_Z]);
  // Heading east off the east end, and east again back onto the west end: in line with the street.
  assert.ok(first.tx > 0.999 && last.tx > 0.999, 'in line with the street at both ends');
  for (let i = 1; i < LOOP.length; i++) assert.ok(Math.hypot(LOOP[i].x - LOOP[i - 1].x, LOOP[i].z - LOOP[i - 1].z) < 2.01, `no gap at ${i}`);
  assert.ok(LOOP_LENGTH > 1000, `a drive worth taking (${LOOP_LENGTH.toFixed(0)} m, plus the street)`);
});

test('no bend on it is tighter than a car can take flat out, and a car fits on it all the way round', () => {
  // The tightest a car turns at top speed.
  const tightest = DRIVE.wheelbase / Math.tan(steerLimit(DRIVE.top));
  for (let i = 3; i < LOOP.length - 3; i++) {
    const a = LOOP[i - 3];
    const b = LOOP[i + 3];
    const turn = Math.abs(Math.atan2(Math.sin(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz)), Math.cos(Math.atan2(b.tx, b.tz) - Math.atan2(a.tx, a.tz))));
    const radius = (b.d - a.d) / (turn || 1e-9);
    assert.ok(radius > tightest, `a bend of ${radius.toFixed(1)} m at (${LOOP[i].x.toFixed(0)}, ${LOOP[i].z.toFixed(0)})`);
  }
  for (const p of LOOP) {
    const rotY = Math.atan2(p.tx, p.tz);
    assert.ok(onPavement({ x: p.x, z: p.z, rotY }), `on it at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
    // And over to either side, nearly to the edge (round the outside of the tightest bends, a car's
    // corners stick out past its middle's line).
    for (const side of [-1, 1]) {
      const off = side * (LOOP_PAVED - CAR.width / 2 - 0.35);
      assert.ok(onPavement({ x: p.x + p.tz * off, z: p.z - p.tx * off, rotY }), `over to the side at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
    }
  }
});

test('off the side of the loop is grass: nothing is paved past its shoulder', () => {
  for (let i = 0; i < LOOP.length; i += 5) {
    const p = LOOP[i];
    // Where it's still the street's (or right by it), the street's own sidewalks and lot count.
    if (Math.abs(p.z - STREET_Z) < 8 && Math.abs(p.x) < STREET_END + 12) continue;
    for (const side of [-1, 1]) {
      const off = side * (LOOP_PAVED + 0.3);
      assert.ok(!paved(p.x + p.tz * off, p.z - p.tx * off), `the verge at (${p.x.toFixed(0)}, ${p.z.toFixed(0)})`);
    }
  }
  assert.ok(!paved(0, 200), 'nor inside the loop');
});

test('nearLoop finds the nearest bit of the loop, as looking at every point would', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 400; k++) {
    const p = LOOP[Math.floor(rand() * LOOP.length)];
    const x = p.x + (rand() - 0.5) * 40;
    const z = p.z + (rand() - 0.5) * 40;
    let best = Infinity;
    for (let i = 0; i < LOOP.length - 1; i++) {
      const a = LOOP[i];
      const b = LOOP[i + 1];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (z - a.z) * ez) / (ex * ex + ez * ez)));
      best = Math.min(best, Math.hypot(x - a.x - ex * t, z - a.z - ez * t));
    }
    const at = nearLoop(x, z);
    // By the street, the few meters of it the loop's measured from count too.
    if (best > 30 || (Math.abs(x) < STREET_END + 30 && Math.abs(z - STREET_Z) < 30)) continue;
    assert.ok(at && Math.abs(at.off - best) < 1e-6, `(${x.toFixed(1)}, ${z.toFixed(1)}): ${at?.off} vs ${best}`);
  }
  // Which side: going east along the street's east end, the office (north, -z) is on the left.
  assert.equal(nearLoop(STREET_END + 10, STREET_Z - 2)!.side, 1);
  assert.equal(nearLoop(STREET_END + 10, STREET_Z + 2)!.side, -1);
});

test('the loop keeps clear of the building, the golf hole, the mountains, the lake, the farm and the sea', () => {
  const dist = (x: number, z: number) => Math.min(...LOOP.map((p) => Math.hypot(p.x - x, p.z - z)));
  for (const [x, z, r] of [...MOUNTAINS, ...FOOTHILLS]) assert.ok(dist(x, z) > r + 8, `the mountain at (${x}, ${z})`);
  for (const p of LOOP) {
    assert.ok(Math.hypot((p.x - LAKE.x) / (LAKE.rx + 12), (p.z - LAKE.z) / (LAKE.rz + 12)) > 1, 'the lake');
    assert.ok(p.x - shoreX(p.z) > 20, `the sea at z ${p.z.toFixed(0)}`);
    assert.ok(!(p.x > FLOOR.minX - WALL_T - 10 && p.x < FLOOR.maxX + WALL_T + 10 && p.z < ROAD.maxZ + 30), 'the building');
    assert.ok(Math.hypot(p.x - GOLF_HOLE.x, p.z - GOLF_HOLE.z) > 40, 'the golf hole');
    for (const f of [...FARM.fields, FARM.pasture]) assert.ok(!(p.x > f.minX - LOOP_PAVED && p.x < f.maxX + LOOP_PAVED && p.z > f.minZ - LOOP_PAVED && p.z < f.maxZ + LOOP_PAVED), 'the fields');
  }
  for (const b of [FARM.barn, FARM.silo, FARM.windmill]) assert.ok(dist(b.x, b.z) > 20, 'the farm buildings');
  assert.ok(LIGHTHOUSE.x < shoreX(LIGHTHOUSE.z), 'the lighthouse is out in the sea');
  // The tunnel is dead straight, so its walls run along the road.
  const inside = LOOP.filter((p) => p.x < TUNNEL.x0 && p.x > TUNNEL.x1 && Math.abs(p.z - TUNNEL.z) < 20);
  assert.ok(inside.length > 20);
  for (const p of inside) assert.ok(Math.abs(p.z - TUNNEL.z) < 0.01 && p.tx < -0.9999, `straight through at x ${p.x.toFixed(1)}`);
  assert.ok(TUNNEL.width / 2 > LOOP_PAVED, 'wide enough for the road and its shoulders');
  assert.equal(LOOP_HALF, (ROAD.maxZ - ROAD.minZ) / 2, 'as wide as the street');
});

test('each bit of the loop is somewhere: the farm, the pines, the mountains and the tunnel, the beach, the coast, and the town', () => {
  const along = LOOP.map((p) => p.place).filter((p, i, all) => p !== all[i - 1]);
  assert.deepEqual(along, ['farm', 'forest', 'mountains', 'tunnel', 'mountains', 'beach', 'coast', 'town']);
  assert.equal(placeAt(0, STREET_Z), 'town');
  assert.equal(placeAt(200, 150), 'forest');
  assert.equal(placeAt(-20, TUNNEL.z), 'tunnel');
  assert.equal(placeAt(-218, 250), 'beach');
  assert.equal(placeAt(0, -300), null);
});

test('the office takes a driver out on the loop at their word, and nowhere off it', () => {
  const g = new Garage();
  assert.ok(g.enter('ada', 8, 'driver'));
  const p = LOOP[Math.floor(LOOP.length / 2)];
  assert.ok(g.drive('ada', 8, { x: p.x, z: p.z, rotY: 0, speed: 12, steer: 0 }), 'out on the loop');
  assert.equal(g.drive('ada', 8, { x: p.x, z: p.z + 30, rotY: 0, speed: 12, steer: 0 }), undefined, 'not off across the grass');
});

test('a lap is timed from the line in front of the office all the way round, past every checkpoint', () => {
  const laps = new LapTimer();
  const z = STREET_Z;
  // Over the line the first time: the clock starts, but that's no lap.
  assert.equal(laps.update(-1, z, 0), null);
  assert.equal(laps.update(1, z, 0.1), null);
  assert.equal(laps.running(1), null, 'not showing till you are out on the loop');
  // Back and forth over the line without going round: still no lap.
  assert.equal(laps.update(-1, z, 2), null);
  assert.equal(laps.update(1, z, 3), null);
  // Round every checkpoint...
  for (const d of CHECKPOINTS) {
    const p = LOOP.find((q) => q.d >= d)!;
    laps.update(p.x, p.z, 10);
  }
  assert.equal(laps.running(40), 37);
  // ...and back over the line (from the far end of the street): a lap, and the best so far.
  laps.update(-50, z, 70);
  laps.update(-1, z, 74.9);
  assert.equal(laps.update(0.5, z, 75), 72);
  assert.deepEqual(laps.done, { time: 72, best: true, at: 75 });
  // A slower one isn't the best; a jump across the line (a reload, a teleport) isn't a crossing.
  for (const d of CHECKPOINTS) laps.update(LOOP.find((q) => q.d >= d)!.x, LOOP.find((q) => q.d >= d)!.z, 100);
  laps.update(-2, z, 150);
  assert.equal(laps.update(2, z, 155), 80);
  assert.equal(laps.best, 72);
  assert.equal(laps.done?.best, false);
  laps.update(-60, z, 160);
  assert.equal(laps.update(60, z, 161), null, 'jumped');
  assert.equal(lapTime(72.04), '1:12.0');
  assert.equal(lapTime(59.96), '1:00.0');
  assert.equal(lapTime(9.5), '0:09.5');
});
