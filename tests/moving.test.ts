import test from 'node:test';
import assert from 'node:assert/strict';
import { spotFits } from '../src/client/moving.js';
import { BALCONY_DOOR, ELEVATOR, EXIT_DOOR, FLOOR, JUKEBOX, MEETING_ROOM, WINDOWS } from '../src/shared/layout.js';
import { JUKEBOX_HOME } from '../src/shared/jukebox.js';
import type { WallId, WallRect } from '../src/shared/decor.js';

// Where the jukebox will and won't stand, the way the office is actually furnished. moving.ts reads
// the same colliders and fixtures the player walks into and hangs pictures on, so these check it
// against a stand-in floor: the jukebox's own corner, the ways out, the meeting room, the furniture.

interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
  bottom?: number;
}

/** An office floor: the jukebox where it lives, and whatever else is told to put in the way. */
function floorHere(opts: { colliders?: Box[]; fixtures?: WallRect[]; walls?: Box[]; at?: { x: number; z: number } } = {}) {
  const at = opts.at ?? JUKEBOX_HOME;
  const jukebox = {
    collider: { minX: at.x - 0.7, maxX: at.x + 0.7, minZ: at.z - 0.7, maxZ: at.z + 0.7, top: JUKEBOX.height },
    fixture: { wall: 'east' as WallId, u0: at.z - 0.7, u1: at.z + 0.7, y0: 0, y1: JUKEBOX.height },
  };
  return {
    colliders: [jukebox.collider, ...(opts.colliders ?? [])],
    wallColliders: new Set(opts.walls ?? []),
    jukebox,
    fixtures: () => [jukebox.fixture as WallRect, ...(opts.fixtures ?? [])],
  };
}

/** Something in the way, as a box you'd walk into. */
function at(x: number, z: number, half = 0.5, top = 1): Box {
  return { minX: x - half, maxX: x + half, minZ: z - half, maxZ: z + half, top };
}

test('it stands in its corner of the lounge, which nothing is in the way of', () => {
  assert.ok(spotFits(floorHere() as never, 'east', JUKEBOX_HOME.z), 'the corner it lives in');
});

test('the ways out stay clear: no window, no balcony doors, no exit door, no elevator', () => {
  const floor = floorHere() as never;
  // Every opening the office has, on the wall it's on: the jukebox won't stand in front of one.
  for (const o of [...WINDOWS, EXIT_DOOR, BALCONY_DOOR, { wall: 'north' as WallId, u: ELEVATOR.x, width: ELEVATOR.width }]) {
    assert.ok(!spotFits(floor, o.wall, o.u), `in front of the ${o.width} m opening at ${o.u} on ${o.wall}`);
    // Nor just clipping its edge.
    assert.ok(!spotFits(floor, o.wall, o.u + o.width / 2 + JUKEBOX.width / 2 - 0.1), `clipping it on ${o.wall}`);
  }
  // And clear wall beside one is still good for it.
  assert.ok(spotFits(floor, 'west', 10.5), 'the west wall past the exit door');
});

test('the glass-walled meeting room under the loft is for meetings, not music', () => {
  const floor = floorHere() as never;
  // On the south and east walls, in the stretch the meeting room's glass runs.
  assert.ok(!spotFits(floor, 'south', MEETING_ROOM.minX + 0.5), 'against the south wall, in the meeting room');
  assert.ok(!spotFits(floor, 'east', MEETING_ROOM.minZ + 0.5), 'against the east wall, in it too');
  // The same walls west of the room, where the lounge is, are fine.
  assert.ok(spotFits(floor, 'south', -1.5), 'the south wall west of the meeting room');
});

test('it stands clear of the furniture in front of it', () => {
  // The cabinet is JUKEBOX.depth out from the wall, and needs CLEAR (moving.ts's) in front of that,
  // so the desk in front of its corner puts it out of reach there and nowhere else on that wall.
  const floor = floorHere({ colliders: [at(JUKEBOX_HOME.x - JUKEBOX.depth / 2 - 0.5, JUKEBOX_HOME.z, 0.5, 0.78)] }) as never;
  assert.ok(!spotFits(floor, 'east', JUKEBOX_HOME.z), 'a desk right in front of its corner');
  // Further along the same wall, past the desk, is fine.
  assert.ok(spotFits(floor, 'east', JUKEBOX_HOME.z + 2.5), 'clear of the desk');
});

test('the walls themselves are what it stands against, and the ceiling is up out of its way', () => {
  const wall = { minX: FLOOR.maxX, maxX: FLOOR.maxX + 0.3, minZ: FLOOR.minZ, maxZ: FLOOR.maxZ, top: 99 };
  const ceiling = { minX: FLOOR.minX, maxX: FLOOR.maxX, minZ: FLOOR.minZ, maxZ: FLOOR.maxZ, bottom: 6.8, top: 7.1 };
  const floor = floorHere({ walls: [wall], colliders: [ceiling] }) as never;
  assert.ok(spotFits(floor, 'east', JUKEBOX_HOME.z), 'the wall behind it and the ceiling over it are no obstacle');
});

test('anything you could walk over is no obstacle either', () => {
  const floor = floorHere({ colliders: [{ minX: 16, maxX: 18, minZ: 4, maxZ: 7, top: 0.1 }] }) as never;
  assert.ok(spotFits(floor, 'east', 5.4), 'a rug under it');
});

test('a board or the TV already on the wall keeps its stretch of it', () => {
  const tv: WallRect = { wall: 'east', u0: -3.4, u1: 3.4, y0: 0.3, y1: 4.2 };
  const floor = floorHere({ fixtures: [tv] }) as never;
  assert.ok(!spotFits(floor, 'east', 0), 'in front of the TV');
  assert.ok(!spotFits(floor, 'east', 3.6), 'clipping its edge');
  assert.ok(spotFits(floor, 'east', 5.4), 'past it');
});

test('putting it back where it came from is never its own way', () => {
  // The jukebox's collider and its bit of wall are where it stands: neither may block it there.
  for (const [wall, u] of [
    ['east', 5.4],
    ['west', -6],
    ['north', -7],
    ['south', 7],
  ] as const) {
    const spot = wall === 'east' || wall === 'west' ? { x: wall === 'east' ? 17.58 : -17.58, z: u } : { x: u, z: wall === 'north' ? -12.58 : 12.58 };
    const floor = floorHere({ at: spot }) as never;
    assert.ok(spotFits(floor, wall, u), `${wall} at ${u}: its own place fits it`);
  }
});