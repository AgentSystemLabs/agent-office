import test from 'node:test';
import assert from 'node:assert/strict';
import { DESK_BY_ID } from '../src/shared/layout.js';
import { NavGrid, pathLength } from '../src/shared/nav.js';
import { BUILTIN_MAPS, OFFICE_PLAN, checkCustomMaps, mapChoices, planMap, planOf, seatHereOn } from '../src/shared/maps/index.js';
import { clockWork, workedMs } from '../src/server/workers.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

test('every built-in map places every seat the office has, by the same ids', () => {
  for (const config of BUILTIN_MAPS) {
    const plan = planMap(config);
    assert.deepEqual(new Set(plan.byId.keys()), new Set(DESK_BY_ID.keys()), `${config.id} has the office's seats`);
    for (const [id, d] of plan.byId) {
      const office = DESK_BY_ID.get(id)!;
      assert.equal(!!d.station, !!office.station, `${id} is a kiosk on both`);
      assert.equal(d.station, office.station);
      assert.equal(!!d.room, !!office.room, `${id} is a meeting chair on both`);
    }
  }
});

test('in the castle every worker can walk from its seat to the door and to the front of the line', () => {
  const plan = planOf('castle');
  const nav = new NavGrid(plan.bounds, plan.obstacles!);
  assert.ok(plan.lineup.length >= 4, 'a line in front of the throne');
  for (const spot of plan.lineup) assert.ok(nav.walkable(spot.x, spot.z), `the line's spot at (${spot.x}, ${spot.z}) is clear`);
  for (const d of plan.byId.values()) {
    for (const to of [plan.door, plan.lineup[0]]) {
      const way = nav.wayFrom(d, [to.x, to.z]);
      for (const [x, z] of way.slice(1)) assert.ok(nav.walkable(x, z), `${d.id} walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      assert.ok(pathLength(way) < 3 * Math.hypot(to.x - d.x, to.z - d.z) + 10, `${d.id} doesn't go the long way round`);
    }
  }
  // The throne is a seat of its own, somewhere you can sit only on the castle's floors.
  assert.ok(plan.throne);
  assert.ok(seatHereOn(plan, 'throne:0', false));
  assert.equal(seatHereOn(plan, 'couch:0', false), undefined);
  assert.equal(seatHereOn(OFFICE_PLAN, 'throne:0', false), undefined);
  assert.ok(seatHereOn(OFFICE_PLAN, 'couch:0', false));
});

test('a custom map extends a built-in one, changing only what it gives', () => {
  const [mine] = checkCustomMaps([{ file: 'mine.json', json: { id: 'mine', name: 'My hall', extends: 'castle', boards: { issues: { z: -21 } }, lineup: { count: 3 } } }]);
  assert.equal(mine.error, undefined);
  const plan = planOf('mine', [mine]);
  const castle = planOf('castle');
  assert.equal(plan.name, 'My hall');
  assert.equal(plan.boards.issues.z, -21);
  assert.equal(plan.boards.issues.x, castle.boards.issues.x, 'the rest of the board stays put');
  assert.equal(plan.lineup.length, 3);
  assert.deepEqual(plan.desks, castle.desks);
  assert.ok(mapChoices([mine]).some((c) => c.id === 'mine' && c.custom && !c.error));
});

test("a map that can't be used says why, and the building stays on the office", () => {
  const checked = checkCustomMaps([
    { file: 'office.json', json: { id: 'bad-office', name: 'x', extends: 'office' } },
    { file: 'small.json', json: { id: 'small', name: 'Small', extends: 'castle', tables: [{ x: 0, z: 0, length: 4, seats: 2 }] } },
    { file: 'far.json', json: { id: 'far', name: 'Far', extends: 'castle', door: { x: 99, z: 0 } } },
    { file: 'thing.json', json: { id: 'thing', name: 'Thing', extends: 'castle', props: [{ kind: 'spaceship', x: 0, z: 0 }] } },
    { file: 'dupe.json', json: { id: 'castle', name: 'Castle 2', extends: 'castle' } },
    { file: 'loop.json', json: { id: 'loop', name: 'Loop', extends: 'loop' } },
    { file: 'low.json', json: { id: 'low', name: 'Low', extends: 'castle', hall: { height: 9 } } },
  ]);
  const why = Object.fromEntries(checked.map((m) => [m.file, m.error ?? '']));
  assert.match(why['office.json'], /office is built in code/);
  assert.match(why['small.json'], /seat 4, and a map needs 28/);
  assert.match(why['far.json'], /outside the hall/);
  assert.match(why['thing.json'], /spaceship/);
  assert.match(why['dupe.json'], /built-in map/);
  assert.match(why['loop.json'], /extends itself/);
  assert.match(why['low.json'], /\(a banner\) reaches 11\.2 m up, over the hall's 9 m walls/);
  assert.equal(planOf('small', checked), OFFICE_PLAN);
  assert.equal(planOf('nowhere'), OFFICE_PLAN);
});

test('a worker keeps count of how long it has worked, over every stretch', () => {
  const info = { status: 'idle' } as WorkerInfo;
  clockWork(info, 'working', 1000);
  assert.equal(info.workingSince, 1000);
  // Still working: the stretch keeps going.
  clockWork(info, 'working', 5000);
  assert.equal(info.workingSince, 1000);
  assert.equal(workedMs(info, 7000), 6000);
  clockWork(info, 'done', 11_000);
  assert.equal(info.workedMs, 10_000);
  assert.equal(info.workingSince, undefined);
  clockWork(info, 'working', 20_000);
  clockWork(info, 'needs_input', 25_000);
  assert.equal(info.workedMs, 15_000);
  // Asleep, it doesn't count.
  clockWork(info, 'offline', 90_000);
  assert.equal(workedMs(info, 100_000), 15_000);
});
