import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NavGrid, type Pt } from '../src/shared/nav.js';
import { checkCustomMaps, dungeonClear, levelRoute, planOf, prisonSeat, wasting } from '../src/shared/maps/index.js';
import { Jail, MAX_PRISONERS } from '../src/server/jail.js';

/** Every step along `way` is walkable: in the hall on `hall`, down in the dungeon (below `ceiling`, by `level`) on `vault`, and on the stairs, on them. */
function walkable(way: Pt[], ok: (x: number, z: number) => boolean, what: string) {
  for (let i = 1; i < way.length; i++) {
    const [x0, z0] = way[i - 1];
    const [x1, z1] = way[i];
    const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
    for (let k = 0; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      const z = z0 + ((z1 - z0) * k) / n;
      assert.ok(ok(x, z), `${what} walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
    }
  }
}

test('the castle has a dungeon, and locks up whoever is sent home in it', () => {
  const plan = planOf('castle');
  const d = plan.dungeon!;
  assert.ok(d, 'a dungeon under the hall');
  assert.ok(plan.sendHome?.keeps, 'workers sent home are kept');
  assert.equal(plan.sendHome!.escort!.name, 'Kingsguard');
  assert.ok(plan.sendHome!.escort!.post.below, 'on watch down in the dungeon');
  assert.ok(d.floor < -4 && d.ceiling < 0, 'under the floor');
  assert.equal(d.steps.at(-1)!.top, d.floor, 'the stairs go all the way down');
  assert.ok(d.steps.every((s, i) => i === 0 || d.steps[i - 1].top - s.top < 0.3), 'a step at a time, none too high to walk');
  assert.ok(d.seats.length >= 40, `room for plenty (${d.seats.length})`);
  // The seats fill round the cells, one each, then round again.
  assert.deepEqual(
    d.seats.slice(0, d.cells.length).map((s) => s.cell),
    d.cells.map((_, i) => i),
  );
});

test('in the castle a worker can be walked from any seat down the stairs to any cell, and the escort back to its post', () => {
  const plan = planOf('castle');
  const d = plan.dungeon!;
  const hall = new NavGrid(plan.bounds, plan.obstacles!);
  const vault = new NavGrid(d.bounds, d.obstacles);
  const post = plan.sendHome!.escort!.post;
  assert.ok(vault.walkable(post.x, post.z), 'the escort’s post is clear');
  assert.ok(hall.walkable(...d.stairs.top), 'the way onto the stairs is clear');
  assert.ok(vault.walkable(...d.stairs.foot), 'the foot of the stairs is clear');
  // Which grid a point is on: past the top of the stairs, the dungeon's.
  for (const seat of plan.desks) {
    const off = hall.wayFrom(seat, d.stairs.top);
    walkable(off.slice(1), (x, z) => hall.walkable(x, z), `${seat.id} going to the stairs`);
    for (const [i, c] of d.cells.entries()) {
      const down = levelRoute(d, hall, vault, d.stairs.top, false, c.outside, true);
      const at = down.indexOf(d.stairs.start);
      assert.equal(down[at + 1], d.stairs.end, 'down the stairs');
      walkable(down.slice(at + 2), (x, z) => vault.walkable(x, z), `down to cell ${i}`);
      const back = levelRoute(d, hall, vault, c.outside, true, [post.x, post.z], true);
      walkable(back, (x, z) => vault.walkable(x, z), `from cell ${i} back to the post`);
    }
  }
  // And back up, out of the dungeon, to the hall.
  const up = levelRoute(d, hall, vault, [post.x, post.z], true, [0, 0], false);
  assert.ok(up.some((p) => p === d.stairs.end) && up.some((p) => p === d.stairs.start), 'up the stairs');
  assert.deepEqual(up.at(-1), [0, 0]);
});

test('a prisoner stays in the seat it was thrown into, and once every seat has been taken the oldest are bones on the heap', () => {
  const d = planOf('castle').dungeon!;
  const n = d.seats.length;
  assert.equal(prisonSeat(d, 0, 1), d.seats[0]);
  assert.equal(prisonSeat(d, 5, 20), d.seats[5]);
  // One more than there are seats: the first goes to the heap, and the newest takes its seat.
  assert.equal(prisonSeat(d, 0, n + 1), null);
  assert.equal(prisonSeat(d, n, n + 1), d.seats[0]);
  assert.equal(prisonSeat(d, 1, n + 1), d.seats[1], 'nobody else moves');
});

test('locked up, a worker wastes away: thinner till it starves to death, then it rots to the bone', () => {
  const p = { starveMs: 24 * 3_600_000, rotMs: 12 * 3_600_000 };
  const at = 1_000_000;
  const h = (n: number) => at + n * 3_600_000;
  assert.deepEqual(wasting(at, at, p), { thin: 0, dead: false, rot: 0 });
  assert.deepEqual(wasting(at, h(12), p), { thin: 0.5, dead: false, rot: 0 });
  assert.deepEqual(wasting(at, h(24), p), { thin: 1, dead: true, rot: 0 });
  assert.deepEqual(wasting(at, h(30), p), { thin: 1, dead: true, rot: 0.5 });
  assert.deepEqual(wasting(at, h(100), p), { thin: 1, dead: true, rot: 1 });
  // A clock a little behind doesn't bring anyone back.
  assert.deepEqual(wasting(at, at - 5000, p), { thin: 0, dead: false, rot: 0 });
});

test('a map of your own can script sending workers home its own way, and says what is wrong with a script that can’t work', () => {
  const [kind, noEscort, noDungeon, after, place, ok, doorOnly] = checkCustomMaps([
    { file: 'kind.json', json: { id: 'kind', name: 'Kind', extends: 'castle', sendHome: { steps: [{ do: 'dance' }] } } },
    { file: 'no-escort.json', json: { id: 'no-escort', name: 'No escort', extends: 'castle', sendHome: { escort: null, steps: [{ do: 'fetch' }, { do: 'walk', to: 'door' }] } } },
    { file: 'no-dungeon.json', json: { id: 'no-dungeon', name: 'No dungeon', extends: 'castle', dungeon: null } },
    { file: 'after.json', json: { id: 'after', name: 'After', extends: 'castle', sendHome: { steps: [{ do: 'jail' }, { do: 'say', text: 'hi' }] } } },
    { file: 'place.json', json: { id: 'place', name: 'Place', extends: 'castle', sendHome: { steps: [{ do: 'walk', to: 'moon' }] } } },
    {
      file: 'ok.json',
      json: {
        id: 'ok',
        name: 'Quick',
        extends: 'castle',
        sendHome: { steps: [{ do: 'pack' }, { do: 'walk', to: 'dungeon', run: true }, { do: 'say', text: ['bye', 'oh no'] }, { do: 'jail' }], starveHours: 0.5, rotHours: 0.25 },
      },
    },
    { file: 'door.json', json: { id: 'door', name: 'Out', extends: 'castle', dungeon: null, sendHome: { escort: null, steps: [{ do: 'pack' }, { do: 'walk', to: 'door' }] } } },
  ]);
  assert.match(kind.error!, /"dance", which isn't a step there is/);
  assert.match(noEscort.error!, /an escort fetching the worker, and no escort/);
  assert.match(noDungeon.error!, /and the map has no dungeon/);
  assert.match(after.error!, /locked up by then, so only its escort/);
  assert.match(place.error!, /should be one of "door", "stairs"/);
  assert.equal(ok.error, undefined);
  const quick = planOf('ok', [ok]).sendHome!;
  assert.ok(quick.keeps);
  assert.equal(quick.starveMs, 30 * 60_000);
  assert.equal(quick.rotMs, 15 * 60_000);
  assert.equal(doorOnly.error, undefined);
  const out = planOf('door', [doorOnly]);
  assert.equal(out.dungeon, undefined);
  assert.equal(out.sendHome!.keeps, false, 'walked out, not kept');
  // Without a sendHome at all a worker walks out, the way it always has.
  const [plain] = checkCustomMaps([{ file: 'plain.json', json: { id: 'plain', name: 'Plain', extends: 'castle', dungeon: null, sendHome: null } }]);
  assert.equal(plain.error, undefined);
  assert.equal(planOf('plain', [plain]).sendHome, undefined);
});

test('a dungeon has to fit: under the hall, its stairs clear of the tables, its cells clear of each other', () => {
  const cells = (extra: unknown[]) => ({ cells: [{ x: -9.1, z: 17.6, rotY: 0, width: 4.6, depth: 4 }, ...extra] });
  const [outside, table, overlap, steep, ok] = checkCustomMaps([
    { file: 'outside.json', json: { id: 'outside', name: 'x', extends: 'castle', dungeon: { x: 10 } } },
    { file: 'table.json', json: { id: 'table', name: 'x', extends: 'castle', props: [{ kind: 'table', x: 8.3, z: 16, width: 1.4, length: 3 }] } },
    { file: 'overlap.json', json: { id: 'overlap', name: 'x', extends: 'castle', dungeon: cells([{ x: -8, z: 17.6, rotY: 0, width: 4.6, depth: 4 }]) } },
    { file: 'steep.json', json: { id: 'steep', name: 'x', extends: 'castle', dungeon: { stairs: { rotY: 0.3 } } } },
    { file: 'ok.json', json: { id: 'mine', name: 'x', extends: 'castle', dungeon: cells([]) } },
  ]);
  assert.match(outside.error!, /dungeon should be under the hall/);
  assert.match(table.error!, /stairs come up through something in the hall/);
  assert.match(overlap.error!, /runs into dungeon\.cells\[0\]/);
  assert.match(steep.error!, /should be a quarter turn/);
  assert.equal(ok.error, undefined);
  const d = planOf('mine', [ok]).dungeon!;
  assert.equal(d.cells.length, 1);
  assert.equal(d.seats.length, d.cells[0].spots.length);
  for (const s of d.cells[0].spots) assert.ok(s.x > -11.4 && s.x < -6.8 && s.z > 13.6 && s.z < 17.6, 'every seat inside the cell');
  assert.ok(!dungeonClear(d, -9.1, 15.6), 'inside a cell isn’t somewhere to walk');
  assert.ok(dungeonClear(d, -9.1, 19), 'in front of it is');
});

test('the jail remembers everyone locked up, keeps the latest by name, and survives a restart', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'jail-'));
  let now = 1000;
  const jail = new Jail(dir, () => now);
  assert.deepEqual(jail.state(), { prisoners: [], bones: 0 });
  jail.add({ id: 'w1', name: 'Pixel', color: '#ef476f', workedMs: 60_000 });
  now = 2000;
  const s = jail.add({ id: 'w2', name: 'Byte', color: '#06d6a0' });
  assert.deepEqual(s.prisoners, [
    { id: 'w1', name: 'Pixel', color: '#ef476f', at: 1000, workedMs: 60_000 },
    { id: 'w2', name: 'Byte', color: '#06d6a0', at: 2000 },
  ]);
  // Back after a restart, just as it was.
  assert.deepEqual(new Jail(dir).state(), s);
  // Past the most kept by name, the oldest are only counted: bones on the heap.
  for (let i = 0; i < MAX_PRISONERS; i++) jail.add({ id: `x${i}`, name: `X${i}`, color: '#000000' });
  const full = jail.state();
  assert.equal(full.prisoners.length, MAX_PRISONERS);
  assert.equal(full.bones, 2);
  assert.equal(full.prisoners[0].id, 'x0');
  // A broken file is an empty dungeon, not a broken office.
  const bad = mkdtempSync(path.join(tmpdir(), 'jail-'));
  const j2 = new Jail(bad);
  j2.add({ id: 'a', name: 'A', color: '#111111' });
  assert.ok(readFileSync(path.join(bad, 'jail.json'), 'utf8').includes('"A"'));
});
