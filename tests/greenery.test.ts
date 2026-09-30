import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3, type Object3D } from 'three';
import { BALCONY, BOOKSHELF, DESK_SIZE, FLOOR, GREEN_KINDS, GREEN_PLANTS, HANGING_PLANTS, MEETING_TABLE, PLANTS, SILL_PLANTS, WALL_HEIGHT, WINDOWS, builtDesks, greenPlantKind, type GreenKind } from '../src/shared/layout.js';
import { greenPlant, hangingPothos, sillPothos } from '../src/client/world/plants.js';

// The code-built greenery (world/plants.ts) against what world/office.ts counts on: each species
// standing on the floor under the middle of its pot, no wider than the collider it is given (0.3 *
// scale, as for the Blender plants), and the layout keeping them inside the room, clear of the desks
// and the furniture and, for the baskets, well over head height. The office is built in a browser,
// so the plants' own builders are what is measured here, in Node.

/** What a plant reaches, exactly: the bounds of its vertices (a Box3 would round a leaf's tilt up). */
function bounds(root: Object3D): { min: Vector3; max: Vector3; reach: number } {
  root.updateMatrixWorld(true);
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  const v = new Vector3();
  root.traverse((o) => {
    const m = o as import('three').Mesh;
    if (!m.isMesh) return;
    const pos = m.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
      min.min(v);
      max.max(v);
    }
  });
  return { min, max, reach: Math.max(-min.x, max.x, -min.z, max.z) };
}

/** A scaled copy of a plant, measured. */
const sized = (root: Object3D, scale: number) => {
  root.scale.setScalar(scale);
  return bounds(root);
};

test('each code-built species stands on its pot, and its leaves spread as far as its spots allow', () => {
  // office.ts gives each plant a collider of 0.3 * scale; these are the spreads the spots in
  // GREEN_PLANTS and on the balcony are chosen to fit, in metres at scale 1.
  const spread: Record<GreenKind, number> = { areca_palm: 1.14, fiddle_fig: 0.35, peace_lily: 0.57 };
  for (const kind of GREEN_KINDS) {
    const plant = greenPlant(kind);
    const { min, max, reach } = bounds(plant);
    assert.ok(Math.abs(min.y) < 1e-3, `${kind} stands on the floor (its lowest point is at ${min.y.toFixed(3)})`);
    assert.ok(max.y > 0.8 && max.y < 2.1, `${kind} is ${max.y.toFixed(2)} m tall`);
    assert.ok(reach <= spread[kind], `${kind}'s leaves reach ${reach.toFixed(2)} m out, past the ${spread[kind]} its spots allow`);
    // Its pot, what stands within 0.4 m of the floor, fits the collider the office gives it.
    const v = new Vector3();
    let pot = 0;
    plant.traverse((o) => {
      const m = o as import('three').Mesh;
      if (!m.isMesh) return;
      const pos = m.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (v.y < 0.4) pot = Math.max(pot, Math.hypot(v.x, v.z));
      }
    });
    assert.ok(pot < 0.3, `${kind}'s pot reaches ${pot.toFixed(3)} m, past its 0.3 m collider`);
  }
  // They take turns down a row, so no two neighbours match.
  assert.deepEqual([0, 1, 2, 3, 4].map((i) => greenPlantKind(i)), [GREEN_KINDS[0], GREEN_KINDS[1], GREEN_KINDS[2], GREEN_KINDS[0], GREEN_KINDS[1]]);
});

test('every pot stands in a spot of its own, inside the room, clear of the desks and the furniture', () => {
  const desks = builtDesks(0).map((d) => [d.x - DESK_SIZE.width / 2, d.x + DESK_SIZE.width / 2, d.z - DESK_SIZE.depth / 2, d.z + DESK_SIZE.depth / 2] as [number, number, number, number]);
  const furniture: [string, number, number, number, number][] = [
    // The kitchen counter and its fridge, the lounge couch and its coffee table, the bookshelf, the
    // meeting table and the balcony's bench and bistro table, as office.ts and kitchen.ts put them.
    ['kitchen counter', -17, -10.75, 11.7, 12.7],
    ['couch', 10, 11, -2.2, 2.2],
    ['coffee table', 12.2, 13.8, -0.8, 0.8],
    ['bookshelf', BOOKSHELF.x - BOOKSHELF.width / 2, BOOKSHELF.x + BOOKSHELF.width / 2, BOOKSHELF.z - BOOKSHELF.depth / 2, FLOOR.maxZ],
    ['meeting table', MEETING_TABLE.x - MEETING_TABLE.width / 2, MEETING_TABLE.x + MEETING_TABLE.width / 2, MEETING_TABLE.z - MEETING_TABLE.depth / 2, MEETING_TABLE.z + MEETING_TABLE.depth / 2],
    ['balcony bench', -10, -8, BALCONY.minZ, BALCONY.minZ + 0.55],
    ['balcony table', -0.2, 0.6, 14.8, 15.6],
  ];
  const inBox = (x: number, z: number, r: number, [x0, x1, z0, z1]: readonly number[]) => x + r > x0 && x - r < x1 && z + r > z0 && z - r < z1;

  const every = [...PLANTS, ...GREEN_PLANTS];
  for (let i = 0; i < every.length; i++) {
    for (let j = i + 1; j < every.length; j++) {
      const d = Math.hypot(every[i][0] - every[j][0], every[i][1] - every[j][1]);
      assert.ok(d > 0.5, `two plants share a spot at (${every[i][0]}, ${every[i][1]}), ${d.toFixed(2)} m apart`);
    }
  }
  GREEN_PLANTS.forEach(([x, z, s], i) => {
    const kind = greenPlantKind(i);
    const where = `the ${kind} #${i} at (${x}, ${z})`;
    const { min, max } = sized(greenPlant(kind), s);
    // The balcony's plants stand on the balcony; the rest in the room.
    const on = z > FLOOR.maxZ + 0.2 ? BALCONY : FLOOR;
    assert.ok(x + min.x > on.minX && x + max.x < on.maxX && z + min.z > on.minZ && z + max.z < on.maxZ, `${where} leans into a wall`);
    const r = 0.3 * s;
    for (const d of desks) assert.ok(!inBox(x, z, r, d), `${where} stands in a desk`);
    for (const f of furniture) assert.ok(!inBox(x, z, r, f), `${where} stands in the ${f[0]}`);
  });
});

test('the pots on the sills stand on a low window, within it, and small enough for the ledge', () => {
  for (const spot of SILL_PLANTS) {
    const window = WINDOWS.find((o) => o.wall === spot.wall && o.u === spot.u);
    assert.ok(window, `there is a ${spot.wall} window at ${spot.u}`);
    assert.ok(window!.y0 <= 2, `the window at ${spot.u} is a low one, with a sill to stand on`);
    assert.ok(Math.abs(spot.offset) < window!.width / 2 - 0.3, `(${spot.wall} ${spot.u}) the pot stands within the window (${spot.offset})`);
  }
  // The office stands it 0.08 m in from the wall, so it must not reach more than that behind its
  // middle; its vines trail out over the sill into the room, and it is a ledge's size, not a floor's.
  const { min, max } = sized(sillPothos(), 0.6);
  assert.ok(-min.z < 0.1, `the sill pot pokes ${(-min.z).toFixed(3)} m into the wall it stands against`);
  assert.ok(max.z > 0.15 && max.z < 0.3, `its vines trail ${max.z.toFixed(2)} m out over the sill`);
  assert.ok(max.y < 0.25, `the sill plant is ${max.y.toFixed(2)} m tall`);
});

test('the hanging baskets hang from their hooks, well over head height, inside the room', () => {
  for (const [x, z, cord] of HANGING_PLANTS) {
    const { min, max, reach } = bounds(hangingPothos(cord));
    assert.ok(Math.abs(max.y) < 0.02, `the basket at (${x}, ${z}) hangs from its hook at the ceiling`);
    const low = WALL_HEIGHT + min.y;
    assert.ok(cord >= 2 && low > 1.9, `the basket at (${x}, ${z}) hangs to ${low.toFixed(2)} m: well over head height`);
    assert.ok(x - reach > FLOOR.minX + 0.1 && x + reach < FLOOR.maxX - 0.1, `the basket at (${x}, ${z}) hangs into the west or east wall`);
    assert.ok(z - reach > FLOOR.minZ + 0.1 && z + reach < FLOOR.maxZ - 0.1, `the basket at (${x}, ${z}) hangs into the north or south wall`);
  }
});
