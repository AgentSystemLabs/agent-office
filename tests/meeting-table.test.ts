import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3 } from 'three';
import { MEETING_LAPTOP, MEETING_SEATS, MEETING_TABLE, type DeskDef } from '../src/shared/layout.js';
import { COUNCIL, planOf } from '../src/shared/maps/index.js';
import { deskPoint, type Pt } from '../src/shared/nav.js';

// A full meeting's laptops (in the castle, its tomes) where the worlds put them on the table
// (world/office/meeting-room.ts, world/castle/seats.ts), each the size of the real model with its
// lid up: none reaches into another, and all of each is on the table.

/** The least room between two of them. */
const ROOM = 0.1;

/** An open laptop's footprint in its own frame: x across it, z out toward whoever is typing. */
async function footprint(style: 'laptop' | 'tome') {
  // The model paints its screen on a canvas, which is all it needs of a page.
  (globalThis as { document?: unknown }).document ??= { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) };
  const { Laptop } = await import('../src/client/features/workers/laptop.js');
  const laptop = new Laptop(style);
  laptop.update(10, undefined); // long enough for its lid to come all the way up
  const box = new Box3().setFromObject(laptop.root, true);
  laptop.dispose();
  return { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
}

type Footprint = Awaited<ReturnType<typeof footprint>>;

/** Its four corners on the floor plan, at `seat`'s place, `at.scale` the model's size and `at.z` toward the chair. */
function corners(seat: DeskDef, f: Footprint, at: { scale: number; z: number }): Pt[] {
  const [x0, x1, z0, z1] = [f.minX * at.scale, f.maxX * at.scale, f.minZ * at.scale + at.z, f.maxZ * at.scale + at.z];
  return [deskPoint(seat, x0, z0), deskPoint(seat, x1, z0), deskPoint(seat, x1, z1), deskPoint(seat, x0, z1)];
}

/** How far apart two four-sided shapes are: the widest gap across any of their sides (under 0, they overlap). */
function gap(a: Pt[], b: Pt[]): number {
  let widest = -Infinity;
  for (const shape of [a, b]) {
    for (let i = 0; i < shape.length; i++) {
      const [x0, z0] = shape[i];
      const [x1, z1] = shape[(i + 1) % shape.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      const along = (pts: Pt[]) => pts.map(([x, z]) => (x * (z1 - z0) - z * (x1 - x0)) / len);
      const [pa, pb] = [along(a), along(b)];
      widest = Math.max(widest, Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
    }
  }
  return widest;
}

function apart(seats: DeskDef[], shapes: Pt[][], where: string) {
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      const g = gap(shapes[i], shapes[j]);
      assert.ok(g >= ROOM, `${where}: ${seats[i].id} and ${seats[j].id} are ${g < 0 ? `${(-g).toFixed(2)} m into each other` : `only ${g.toFixed(2)} m apart`}`);
    }
  }
}

test('round the meeting table, no laptop reaches into another, and each is on the table', async () => {
  const f = await footprint('laptop');
  const shapes = MEETING_SEATS.map((seat) => corners(seat, f, MEETING_LAPTOP));
  apart(MEETING_SEATS, shapes, 'the meeting table');
  const t = MEETING_TABLE;
  shapes.forEach((shape, i) => {
    for (const [x, z] of shape) assert.ok(Math.abs(x - t.x) < t.width / 2 && Math.abs(z - t.z) < t.depth / 2, `${MEETING_SEATS[i].id}'s laptop is over the table's edge at (${x.toFixed(2)}, ${z.toFixed(2)})`);
  });
});

test('round the castle’s council table, no tome reaches into another, and each is on the table', async () => {
  const f = await footprint('tome');
  const plan = planOf('castle');
  const shapes = plan.meeting.map((seat) => corners(seat, f, COUNCIL.tome));
  assert.equal(shapes.length, MEETING_SEATS.length);
  apart(plan.meeting, shapes, 'the council table');
  const c = plan.council!;
  shapes.forEach((shape, i) => {
    for (const [x, z] of shape) assert.ok(Math.hypot(x - c.x, z - c.z) < COUNCIL.radius, `${plan.meeting[i].id}'s tome is over the table's edge at (${x.toFixed(2)}, ${z.toFixed(2)})`);
  });
});
