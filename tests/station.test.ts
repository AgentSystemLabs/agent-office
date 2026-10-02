// The space station (shared/maps/station.ts): its plan, what's cut through its hull, its airlock,
// the script that ejects workers through it, and where whoever's been ejected drifts to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { NavGrid, pathLength } from '../src/shared/nav.js';
import { ADRIFT, AIRLOCK, HULL, adrift, adriftFrom, checkCustomMaps, planOf } from '../src/shared/maps/index.js';

test('on the station every worker can walk from its seat to the hatch, the line and the airlock', () => {
  const plan = planOf('station');
  assert.equal(plan.style, 'station');
  const nav = new NavGrid(plan.bounds, plan.obstacles!);
  const lock = plan.airlock!;
  assert.ok(lock, 'the station has an airlock');
  assert.ok(nav.walkable(lock.front[0], lock.front[1]), 'the spot in front of the airlock is clear');
  assert.ok(plan.lineup.length >= 4, 'a line in front of the captain’s chair');
  /** Every step along `way` (after its first `skip` points) is on open deck. */
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
    for (const to of [plan.door, ...plan.lineup, { x: lock.front[0], z: lock.front[1] }]) {
      const way = nav.wayFrom(d, [to.x, to.z]);
      clear(way, 1, `${d.id} going`);
      assert.ok(pathLength(way) < 3 * Math.hypot(to.x - d.x, to.z - d.z) + 10, `${d.id} doesn't go the long way round`);
    }
  }
  // Security can get from its post to every seat and back.
  const post = plan.sendHome!.escort!.post;
  assert.ok(nav.walkable(post.x, post.z));
  assert.ok(plan.throne, 'a captain’s chair to sit in');
});

test('the airlock is in the hull, its chamber outside it, and nothing cut through a wall runs into anything else', () => {
  const plan = planOf('station');
  const lock = plan.airlock!;
  const b = plan.bounds;
  assert.equal(lock.wall, 'east');
  assert.deepEqual(lock.out, [1, 0]);
  assert.equal(lock.door[0], b.maxX, 'its inner door is in the east wall');
  assert.ok(lock.front[0] < b.maxX && lock.chamber[0] > b.maxX + HULL && lock.hatch[0] > lock.chamber[0], 'front of it inside, the chamber and the hatch outside');
  assert.ok(Math.abs(lock.hatch[0] - (b.maxX + HULL + AIRLOCK.depth)) < 1e-9);
  const openings = plan.openings!;
  assert.equal(openings.filter((o) => o.kind === 'door').length, 1);
  assert.equal(openings.filter((o) => o.kind === 'airlock').length, 1);
  assert.equal(openings.filter((o) => o.kind === 'viewport').length, 11, 'three forward, four down each side');
  for (const o of openings) {
    assert.ok(o.y + o.height < plan.height, `${o.kind} at ${o.u} fits under the ceiling`);
    for (const p of openings) if (p !== o && p.wall === o.wall) assert.ok(Math.abs(p.u - o.u) >= (p.width + o.width) / 2, `${o.kind} at ${o.u} is clear of ${p.kind} at ${p.u}`);
  }
  // Either side of the airlock, a window to watch from.
  const beside = openings.filter((o) => o.wall === 'east' && o.kind === 'viewport' && Math.abs(o.u - lock.door[1]) < 8);
  assert.equal(beside.length, 2);
  // A board never hangs over a window.
  for (const board of Object.values(plan.boards)) {
    const wall = board.x < 0 ? 'west' : 'east';
    for (const o of openings) if (o.wall === wall) assert.ok(Math.abs(o.u - board.z) > (o.width + board.width) / 2, `the ${board.label} board is clear of the ${o.kind} at ${o.u}`);
  }
});

test('a worker sent home on the station is ejected, and kept', () => {
  const send = planOf('station').sendHome!;
  assert.ok(send.keeps, 'whoever is ejected is kept, adrift');
  assert.ok(send.escort);
  const does = send.steps.map((s) => s.do);
  assert.ok(does.indexOf('eject') > does.indexOf('walk'), 'walked to the airlock, then out of it');
  assert.deepEqual(send.steps.find((s) => s.do === 'walk'), { do: 'walk', to: 'airlock' });
  // The castle still locks its own up, and the office keeps nobody.
  assert.ok(planOf('castle').sendHome!.keeps);
  assert.equal(planOf('office').sendHome, undefined);
});

test('whoever is ejected drifts out from the hatch, clear of the hull, the same for everyone', () => {
  const plan = planOf('station');
  const lock = plan.airlock!;
  const H = 3_600_000;
  const far = (d: { x: number; y: number; z: number }) => Math.hypot(d.x - lock.hatch[0], d.y - 1.3, d.z - lock.hatch[1]);
  const sides = new Set<number>();
  for (let i = 0; i < 60; i++) {
    const id = `worker-${i}`;
    assert.deepEqual(adrift(lock, id, 5000), adrift(lock, id, 5000), 'the same whenever it is asked');
    let last = 0;
    for (const age of [0, 20_000, 120_000, H, 6 * H, 48 * H, 2000 * H]) {
      const d = adrift(lock, id, age);
      assert.ok(d.x > lock.hatch[0] + 2, `${id} is out past the hatch at ${age} ms (x ${d.x.toFixed(1)})`);
      assert.ok(far(d) > ADRIFT.near - 1.5 && far(d) < ADRIFT.far + 1.5, `${id} is ${far(d).toFixed(1)} m off at ${age} ms`);
      // Further off as time goes by (give or take its bobbing about).
      assert.ok(far(d) > last - 1.5, `${id} doesn't come back`);
      last = far(d);
    }
    // Well off to one side of the airlock or the other: in front of a window, not behind the chamber.
    const d = adrift(lock, id, 10 * 60_000);
    assert.ok(Math.abs(d.z - lock.hatch[1]) > 3, `${id} is off to one side (z ${d.z.toFixed(1)})`);
    sides.add(Math.sign(d.z - lock.hatch[1]));
  }
  assert.equal(sides.size, 2, 'some to each side');
  assert.notDeepEqual(adrift(lock, 'a', 60_000), adrift(lock, 'b', 60_000));
  // Only the latest are still to be seen.
  assert.equal(adriftFrom(3), 0);
  assert.equal(adriftFrom(ADRIFT.shown + 12), 12);
});

test('a station of your own changes only what it gives, and says why when it can’t be built', () => {
  const sendHome = (steps: unknown[]) => ({ escort: { post: { x: 13.3, z: 15.3 } }, steps });
  const checked = checkCustomMaps([
    { file: 'mine.json', json: { id: 'mine', name: 'My station', extends: 'station', airlock: { x: -14.6, z: 13 }, props: [{ kind: 'viewport', x: 0, z: -29, y: 1.5, width: 8, height: 4 }], sendHome: sendHome([{ do: 'fetch' }, { do: 'eject' }, { do: 'return' }]) } },
    { file: 'pillar.json', json: { id: 'pillar', name: 'Pillar', extends: 'station', props: [{ kind: 'pillar', x: 0, z: 0 }] } },
    { file: 'clash.json', json: { id: 'clash', name: 'Clash', extends: 'station', props: [{ kind: 'viewport', x: 15, z: 12, width: 4 }] } },
    { file: 'afloat.json', json: { id: 'afloat', name: 'Afloat', extends: 'station', props: [{ kind: 'viewport', x: 0, z: 0 }] } },
    { file: 'wide.json', json: { id: 'wide', name: 'Wide', extends: 'station', props: [{ kind: 'viewport', x: 13, z: -29, width: 6 }] } },
    { file: 'tall.json', json: { id: 'tall', name: 'Tall', extends: 'station', props: [{ kind: 'viewport', x: 0, z: -29, y: 4, height: 3.5 }] } },
    { file: 'sealed.json', json: { id: 'sealed', name: 'Sealed', extends: 'station', airlock: null } },
    { file: 'dug.json', json: { id: 'dug', name: 'Dug', extends: 'station', dungeon: { x: 0, z: 0, width: 10, length: 10, depth: 4, stairs: { x: 0, z: -4 }, cells: [{ x: 0, z: 4, rotY: 3.1416, width: 4, depth: 3 }] } } },
    { file: 'moat.json', json: { id: 'moat', name: 'Moat', extends: 'castle', airlock: { x: 12.6, z: 0 } } },
    { file: 'door.json', json: { id: 'door', name: 'Door', extends: 'station', airlock: { x: 1, z: 28.6 } } },
    { file: 'quiet.json', json: { id: 'quiet', name: 'Quiet', extends: 'station', sendHome: null } },
  ]);
  const why = Object.fromEntries(checked.map((m) => [m.file, m.error ?? '']));
  assert.equal(why['mine.json'], '');
  const mine = planOf('mine', checked);
  assert.equal(mine.airlock!.wall, 'west');
  assert.deepEqual(mine.airlock!.out, [-1, 0]);
  assert.equal(mine.openings!.filter((o) => o.kind === 'viewport').length, 1, 'a list replaces the whole list');
  assert.deepEqual(mine.desks, planOf('station').desks);
  assert.match(why['pillar.json'], /a "pillar", which isn’t a kind of prop a station-style map has \(rib, viewport/);
  assert.match(why['clash.json'], /\(a viewport\) runs into the airlock in the east wall/);
  assert.match(why['afloat.json'], /\(a viewport\) should be on a wall: it's 15\.0 m from the nearest/);
  assert.match(why['wide.json'], /runs off the end of the north wall/);
  assert.match(why['tall.json'], /reaches 7\.5 m up, and the hall's walls are 7\.6 m/);
  assert.match(why['sealed.json'], /sendHome walks workers to the airlock, and the map has no airlock/);
  assert.match(why['dug.json'], /a station-style map has no dungeon/);
  assert.match(why['moat.json'], /only a station-style map has an airlock/);
  assert.match(why['door.json'], /the airlock runs into the way in in the south wall/);
  // With no script, a worker just walks out of the hatch, and nobody's kept.
  assert.equal(why['quiet.json'], '');
  assert.equal(planOf('quiet', checked).sendHome, undefined);
});
