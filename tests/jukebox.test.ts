import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Jukebox } from '../src/server/jukebox.js';
import { BALCONY_DOOR, ELEVATOR, EXIT_DOOR, FLOOR, JUKEBOX, WINDOWS } from '../src/shared/layout.js';
import { JUKEBOX_HOME, JUKEBOX_TUNES, blocksOpening, checkStreamUrl, isStreamTrack, jukeboxBox, jukeboxSpot, sameSpot, sanitizeSpot, stationUrl } from '../src/shared/jukebox.js';

// Where the jukebox stands, the way you hang a picture: someone aims at a wall, the office checks
// the spot and keeps it, and the music carries on from where it was.

function withFloor<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(path.join(tmpdir(), 'agent-office-jukebox-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Which quarter of a turn a spot faces, counted off 0 = +z (as everything else in the office). */
const quarter = (rotY: number) => ((Math.round(rotY / (Math.PI / 2)) % 4) + 4) % 4;

test('it stands in the corner of the lounge until somebody moves it', () => {
  assert.deepEqual(JUKEBOX_HOME, jukeboxSpot('east', JUKEBOX.z));
  // Its back to the east wall, its face into the room, where it always was.
  assert.equal(JUKEBOX_HOME.z, JUKEBOX.z);
  assert.equal(quarter(JUKEBOX_HOME.rotY), 3);
  assert.ok(Math.abs(JUKEBOX_HOME.x - (FLOOR.maxX - JUKEBOX.depth / 2 - 0.06)) < 1e-9, 'its back is to the east wall');
  assert.ok(sameSpot(JUKEBOX_HOME, jukeboxSpot('east', JUKEBOX.z)));
  assert.ok(!sameSpot(JUKEBOX_HOME, jukeboxSpot('west', -5)));
});

test('a spot on any wall stands it against that wall, facing into the room', () => {
  // Each wall, and the quarter of a turn its face turns to: north +z, south -z, west +x, east -x.
  const walls = [
    ['north', -6, 0],
    ['south', 3, 2],
    ['west', -8, 1],
    ['east', 11, 3],
  ] as const;
  for (const [wall, u, facing] of walls) {
    assert.equal(quarter(jukeboxSpot(wall, u).rotY), facing, `${wall}: a quarter turn, facing in`);
  }
  assert.deepEqual(jukeboxSpot('north', -6), { x: -6, z: FLOOR.minZ + 0.42, rotY: 0 });
  assert.deepEqual(jukeboxSpot('south', 3), { x: 3, z: FLOOR.maxZ - 0.42, rotY: Math.PI });
  assert.deepEqual(jukeboxSpot('west', -8), { x: FLOOR.minX + 0.42, z: -8, rotY: Math.PI / 2 });
  assert.deepEqual(jukeboxSpot('east', 11), { x: FLOOR.maxX - 0.42, z: 11, rotY: -Math.PI / 2 });
});

test('its cabinet box turns with it, so it always stands off a wall by half its depth', () => {
  for (const wall of ['north', 'south', 'west', 'east'] as const) {
    const box = jukeboxBox(jukeboxSpot(wall, 0));
    const along = wall === 'north' || wall === 'south' ? box.maxX - box.minX : box.maxZ - box.minZ;
    const out = wall === 'north' || wall === 'south' ? box.maxZ - box.minZ : box.maxX - box.minX;
    assert.ok(Math.abs(along - JUKEBOX.width) < 1e-9, `${wall}: it is ${JUKEBOX.width} m along the wall`);
    assert.ok(Math.abs(out - JUKEBOX.depth) < 1e-9, `${wall}: it is ${JUKEBOX.depth} m out into the room`);
  }
});

test('the office squares a spot up to a wall and keeps the cabinet inside the office', () => {
  // Turned a few degrees off square: it comes back square, and the spot itself is left alone.
  assert.deepEqual(sanitizeSpot({ x: 17.4, z: -2.2, rotY: -Math.PI / 2 + 0.4 }), { x: 17.4, z: -2.2, rotY: -Math.PI / 2 });
  // Well out in the street, either way of turning: pulled back to just inside the walls.
  const east = sanitizeSpot({ x: 99, z: 0, rotY: -Math.PI / 2 }) as { x: number };
  assert.ok(Math.abs(east.x - (FLOOR.maxX - JUKEBOX.depth / 2)) < 1e-9, 'against the east wall');
  const north = sanitizeSpot({ x: 0, z: -99, rotY: 0 }) as { z: number };
  assert.ok(Math.abs(north.z - (FLOOR.minZ + JUKEBOX.depth / 2)) < 1e-9, 'against the north wall');
  // Rounded to the millimeter, like the pictures on the walls.
  assert.deepEqual(sanitizeSpot({ x: 1.23456789, z: -2.3456789, rotY: 0 }), { x: 1.235, z: -2.346, rotY: 0 });
});

test('a spot the office cannot make sense of is refused, not guessed at', () => {
  for (const bad of [null, undefined, {}, 'east', { x: 1, z: 2 }, { x: 1, z: 2, rotY: 'sideways' }, { x: NaN, z: 0, rotY: 0 }, { x: Infinity, z: 0, rotY: 0 }]) {
    assert.equal(typeof sanitizeSpot(bad), 'string', `${JSON.stringify(bad)} is refused`);
  }
});

test('it will not stand in front of a window, the balcony doors, the exit door or the elevator', () => {
  // Every opening the office has: standing in front of it is refused, on the wall it's on.
  for (const o of [...WINDOWS, EXIT_DOOR, BALCONY_DOOR]) {
    assert.ok(blocksOpening(o.wall, o.u, JUKEBOX.width), `in front of the opening at ${o.u} on ${o.wall}`);
  }
  // The elevator's doors are the way in from the lift, so they count as an opening too.
  assert.ok(blocksOpening('north', ELEVATOR.x, JUKEBOX.width), "in the elevator's doorway");
  // An opening only blocks the wall it's on: the west wall's own windows and exit door are elsewhere.
  assert.ok(!blocksOpening('east', EXIT_DOOR.u, JUKEBOX.width), 'the exit door is on the west wall, not this one');
  assert.ok(!blocksOpening('north', WINDOWS[0].u, JUKEBOX.width), 'and those windows are on the south wall');
  // And each wall still has plenty of clear stretch left to stand on, so nothing is boxed in.
  for (const [wall, lo, hi] of [
    ['north', FLOOR.minX, FLOOR.maxX],
    ['south', FLOOR.minX, FLOOR.maxX],
    ['west', FLOOR.minZ, FLOOR.maxZ],
    ['east', FLOOR.minZ, FLOOR.maxZ],
  ] as const) {
    const clear = [];
    for (let u = lo; u <= hi; u += 0.25) if (!blocksOpening(wall, u, JUKEBOX.width)) clear.push(u);
    assert.ok(clear.length * 0.25 > 8, `the ${wall} wall has ${clear.length * 0.25} m clear of openings to stand on`);
  }
});

test('a floor with no spot saved stands the jukebox in its corner', () => {
  withFloor((dir) => {
    assert.deepEqual(new Jukebox(dir).state().spot, JUKEBOX_HOME);
  });
});

test('moving it stands it there for everyone, and the music carries on from the same bar', () => {
  withFloor((dir) => {
    const j = new Jukebox(dir);
    j.play({ track: JUKEBOX_TUNES[1].id }, 'Cody');
    const before = j.state();
    const spot = jukeboxSpot('west', -4);
    assert.deepEqual(j.place(spot), spot);

    const after = j.state();
    assert.deepEqual(after.spot, spot);
    // Same track, still on, and the same moment in it: nobody's song skipped.
    assert.equal(after.track, before.track);
    assert.equal(after.on, true);
    assert.ok(after.startedAt === before.startedAt, 'the track did not start again');
    // And the tune on isn't lost by a later one, either.
    j.play({ track: JUKEBOX_TUNES[2].id }, 'Mochi');
    assert.deepEqual(j.state().spot, spot);
  });
});

test('it stays where it was put across a restart, and a spot nobody could stand at is ignored', () => {
  withFloor((dir) => {
    const spot = jukeboxSpot('north', 6);
    new Jukebox(dir).place(spot);
    assert.deepEqual(new Jukebox(dir).state().spot, spot);
  });
  withFloor((dir) => {
    const file = path.join(dir, 'jukebox.json');
    writeFileSync(file, JSON.stringify({ on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now(), spot: { x: 'east', z: 4 } }));
    assert.deepEqual(new Jukebox(dir).state().spot, JUKEBOX_HOME, 'a broken spot means the corner of the lounge');
  });
  // Out in the street: clamped back inside rather than dropped.
  withFloor((dir) => {
    const file = path.join(dir, 'jukebox.json');
    writeFileSync(file, JSON.stringify({ on: false, track: JUKEBOX_TUNES[0].id, startedAt: Date.now(), spot: { x: 500, z: 0, rotY: -Math.PI / 2 } }));
    const spot = new Jukebox(dir).state().spot!;
    assert.ok(Math.abs(spot.x - (FLOOR.maxX - JUKEBOX.depth / 2)) < 1e-9, 'back to just inside the east wall');
  });
});

test("the spot is saved in the floor's jukebox.json, next to what it is playing", () => {
  withFloor((dir) => {
    const spot = jukeboxSpot('south', -9);
    new Jukebox(dir).place(spot);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'jukebox.json'), 'utf8')).spot, spot);
  });
});

test('a built-in station is one of the tunes, and plays its stream like a pasted one', () => {
  const station = JUKEBOX_TUNES.find((t) => t.url);
  assert.ok(station, 'a station ships with the jukebox');
  assert.equal(stationUrl(station.id), station.url, 'its link is the one in the list');
  assert.ok(!('error' in checkStreamUrl(station.url)), 'and it passes the same check as a pasted link');
  assert.ok(isStreamTrack(station.id), 'it is played from the internet, not synthesized');
  assert.ok(!isStreamTrack(JUKEBOX_TUNES[0].id), 'a tune is still a tune');

  withFloor((dir) => {
    const j = new Jukebox(dir);
    assert.deepEqual(j.play({ track: station.id }, 'Cody'), { changed: true });
    assert.equal(j.state().track, station.id);
    assert.equal(j.state().on, true);
    assert.equal(j.title(), station.title, 'it says the station is on');
    // It is what the jukebox had, like any other tune, so a restart puts it straight back on.
    assert.equal(new Jukebox(dir).state().track, station.id);
  });
});