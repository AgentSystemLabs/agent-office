import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CASTLE } from '../src/shared/maps/castle.js';
import { STATION } from '../src/shared/maps/station.js';
import { DESK_BY_ID } from '../src/shared/layout.js';
import { NavGrid, pathLength } from '../src/shared/nav.js';
import { BUILTIN_MAPS, DEFAULT_DAIS, OFFICE_PLAN, checkCustomMaps, mapChoices, planMap, planOf, seatHereOn, type MapConfig } from '../src/shared/maps/index.js';
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
  /** Every step along `way` (after its first `skip` points) is on open floor. */
  const clear = (way: [number, number][], skip: number, what: string) => {
    for (let i = skip + 1; i < way.length; i++) {
      const [x0, z0] = way[i - 1];
      const [x1, z1] = way[i];
      const n = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 0.2);
      for (let k = 0; k <= n; k++) {
        const x = x0 + ((x1 - x0) * k) / n;
        const z = z0 + ((z1 - z0) * k) / n;
        assert.ok(nav.walkable(x, z), `${what} walks into something at (${x.toFixed(2)}, ${z.toFixed(2)})`);
      }
    }
  };
  for (const d of plan.byId.values()) {
    for (const to of [plan.door, ...plan.lineup]) {
      // Off its seat (it hops down beside it, then walks)…
      const way = nav.wayFrom(d, [to.x, to.z]);
      clear(way, 1, `${d.id} going`);
      assert.ok(pathLength(way) < 3 * Math.hypot(to.x - d.x, to.z - d.z) + 10, `${d.id} doesn't go the long way round`);
      // …and back to it (up to beside it, where it hops on).
      const back = nav.wayTo([to.x, to.z], d);
      clear(back.slice(0, -1), 0, `${d.id} coming back`);
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
  assert.match(why['small.json'], /seat 4, and a map needs 32/);
  assert.match(why['far.json'], /outside the hall/);
  assert.match(why['thing.json'], /spaceship/);
  assert.match(why['dupe.json'], /built-in map/);
  assert.match(why['loop.json'], /extends itself/);
  assert.match(why['low.json'], /\(a banner\) reaches 11\.2 m up, over the hall's 9 m walls/);
  assert.equal(planOf('small', checked), OFFICE_PLAN);
  assert.equal(planOf('nowhere'), OFFICE_PLAN);
});

test("a custom map can't ask a browser to build what would hang it, and says why", () => {
  const brazier = { kind: 'brazier', x: 0, z: 0 };
  const checked = checkCustomMaps([
    { file: 'thin.json', json: { id: 'thin', name: 'Thin', extends: 'castle', props: [{ kind: 'window', x: 0, z: -29.9, y: 1, width: 0 }] } },
    { file: 'steps.json', json: { id: 'steps', name: 'Steps', extends: 'castle', throne: { dais: { steps: 1e9 } } } },
    { file: 'many.json', json: { id: 'many', name: 'Many', extends: 'castle', props: Array.from({ length: 5000 }, () => brazier) } },
    { file: 'crowd.json', json: { id: 'crowd', name: 'Crowd', extends: 'castle', tables: [{ x: 0, z: 0, length: 20, seats: 40 }] } },
    { file: 'word.json', json: { id: 'word', name: 'Word', extends: 'castle', props: [{ kind: 'torch', x: -12.9, z: 0, y: 'high' }] } },
    { file: 'spaced.json', json: { id: ' spaced ', name: 'Spaced', extends: 'castle' } },
    { file: 'sides.json', json: { id: 'sides', name: 'Sides', extends: 'castle', tables: [{ x: 0, z: 0, length: 20, seats: 12, sides: 'left' }] } },
    { file: 'pillar.json', json: { id: 'pillar', name: 'Pillar', extends: 'castle', herald: { x: -10.4, z: -18 } } },
    { file: 'line.json', json: { id: 'line', name: 'Line', extends: 'castle', lineup: { x: 6.8, z: -12 } } },
  ]);
  const why = Object.fromEntries(checked.map((m) => [m.file, m.error ?? '']));
  assert.match(why['thin.json'], /props\[\d+\]\.width should be between/);
  assert.match(why['steps.json'], /throne\.dais\.steps should be between 0 and 10/);
  assert.match(why['many.json'], /5000 props, and a map can have 400/);
  assert.match(why['crowd.json'], /seats should be between 1 and 12/);
  assert.match(why['word.json'], /\.y should be a number/);
  assert.match(why['spaced.json'], /id should be up to 40 lowercase/);
  assert.match(why['sides.json'], /sides should be "both", "inner" or "outer"/);
  assert.match(why['pillar.json'], /the herald \(-10\.4, -18\.0\) is inside something/);
  assert.match(why['line.json'], /lineup spot 1 \(6\.8, -12\.0\) is inside something/);
});

test('a custom map takes away what it extends with null, and merges no prototype keys', () => {
  const [plain] = checkCustomMaps([{ file: 'plain.json', json: JSON.parse('{"id":"plain","name":"Plain","extends":"castle","throne":null,"herald":null,"lineup":null,"door":{"__proto__":{"rotY":1.2}}}') }]);
  assert.equal(plain.error, undefined);
  const plan = planOf('plain', [plain]);
  assert.equal(plan.throne, undefined);
  assert.equal(plan.herald, undefined);
  assert.deepEqual(plan.lineup, []);
  assert.equal(Object.getPrototypeOf(plain.config!.door), Object.prototype);
  // With no dais given, the throne sits on the default one, the height the plan says.
  const [low] = checkCustomMaps([{ file: 'low.json', json: { id: 'low', name: 'Low', extends: 'castle', throne: { dais: null } } }]);
  assert.equal(low.error, undefined);
  const p = planOf('low', [low]);
  assert.deepEqual(p.dais, DEFAULT_DAIS);
  assert.equal(p.throne!.y, DEFAULT_DAIS.height);
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

/** Numbers to 4 places, so the JSON reads like someone wrote it. */
function rounded(v: unknown): unknown {
  if (typeof v === 'number') return Math.round(v * 1e4) / 1e4;
  if (Array.isArray(v)) return v.map(rounded);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, rounded(x)]));
  return v;
}

/** A built-in map as a map of your own: its own id, one table or prop a line. */
function mapJson(map: MapConfig, id: string, name: string): string {
  const { tables, props, ...rest } = rounded({ ...map, id, name, description: `A copy of the ${map.name.toLowerCase()}, to make your own.` }) as MapConfig;
  const list = (xs: unknown[]) => `[\n${xs.map((x) => `    ${JSON.stringify(x)}`).join(',\n')}\n  ]`;
  return `${JSON.stringify({ ...rest, tables: '@tables', props: '@props' }, null, 2).replace('"@tables"', list(tables)).replace('"@props"', list(props ?? []))}\n`;
}

for (const [map, id, name] of [
  [CASTLE, 'my-castle', 'My castle'],
  [STATION, 'my-station', 'My station'],
] as const) {
  test(`docs/maps/${map.id}.json is the ${map.name.toLowerCase()}, ready to copy into .agent-office/maps/ and change`, () => {
    const file = path.join(import.meta.dirname, '..', 'docs', 'maps', `${map.id}.json`);
    const want = mapJson(map, id, name);
    // After changing the castle or the station: UPDATE_CASTLE_JSON=1 node --import tsx --test tests/maps.test.ts
    if (process.env.UPDATE_CASTLE_JSON) writeFileSync(file, want);
    assert.equal(readFileSync(file, 'utf8'), want, `docs/maps/${map.id}.json is out of date: write it again with UPDATE_CASTLE_JSON=1`);
    const [mine] = checkCustomMaps([{ file: `${map.id}.json`, json: JSON.parse(want) }]);
    assert.equal(mine.error, undefined);
    const plan = planOf(id, [mine]);
    const builtin = planOf(map.id);
    assert.equal(plan.desks.length, builtin.desks.length);
    for (const d of plan.desks) assert.ok(Math.abs(d.x - builtin.byId.get(d.id)!.x) < 1e-3 && Math.abs(d.z - builtin.byId.get(d.id)!.z) < 1e-3, `${d.id} is where the ${map.id} has it`);
  });
}

test('every map in docs/maps.md loads', () => {
  const doc = readFileSync(path.join(import.meta.dirname, '..', 'docs', 'maps.md'), 'utf8');
  const maps = [...doc.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]) as { id: string });
  assert.ok(maps.length >= 2);
  const checked = checkCustomMaps(maps.map((json) => ({ file: `${json.id}.json`, json })));
  for (const m of checked) assert.equal(m.error, undefined, `${m.file}: ${m.error}`);
});
