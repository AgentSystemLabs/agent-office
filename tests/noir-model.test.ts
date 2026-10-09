import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Quaternion, Vector3 } from 'three';
import { BALCONY_DOOR, DESK_SIZE, EXIT_DOOR, LADDER, WINDOWS } from '../src/shared/layout';
import { openModel } from './glb';

// noir.glb (exported by blender/scripts/build_noir.py) against what world/office/noir.ts counts on: the
// seven pieces by name, each a root of its own standing at its origin and facing +z as modelled, the
// materials it paints, and the footprints that keep them on the desks they go on and clear of the
// laptop, the dancing place and the knick-knack each desk already has.

const PIECES = ['desk_lamp', 'rotary_phone', 'typewriter', 'file_stack', 'filing_cabinet', 'venetian_blind', 'desk_blotter'];

/** NOIR_COLORS in world/office/noir.ts, which is every material the model may carry (palette() paints a name it has no color for magenta). */
const PAINTED = ['Brass', 'Shade', 'Bakelite', 'Steel', 'WoodWarm', 'Paper', 'Folder', 'Leather', 'Slat', 'Cord', 'Ink'];

const props = openModel('noir');
const { gltf, nodes, byName } = props;

type Primitive = { attributes: Record<string, number>; material?: number; indices?: number };
const primitives = (name: string) => (gltf.meshes[nodes[byName(name)].mesh ?? -1]?.primitives ?? []) as Primitive[];
const materialOf = (p: Primitive) => gltf.materials?.[p.material ?? -1]?.name ?? '';

/** A piece's bounds, from its mesh's primitives (only those in `materials`, if given). */
function boundsOf(name: string, materials?: string[]): Box3 {
  const i = byName(name);
  const box = new Box3();
  assert.ok(primitives(name).length, `${name} has a mesh`);
  for (const p of primitives(name)) {
    if (materials && !materials.includes(materialOf(p))) continue;
    const a = gltf.accessors[p.attributes.POSITION];
    box.union(new Box3(new Vector3().fromArray(a.min!), new Vector3().fromArray(a.max!)).applyMatrix4(props.worldMatrix(i)));
  }
  return box;
}

const trianglesOf = (name: string) => primitives(name).reduce((n, p) => n + gltf.accessors[p.indices!].count / 3, 0);

const near = (a: number, b: number, tolerance = 0.005) => Math.abs(a - b) <= tolerance;
const fmt = (v: Vector3) => v.toArray().map((n) => n.toFixed(3)).join(', ');

test('each piece is a root node of its own, at the origin and facing +z as modelled, named once', () => {
  const names = nodes.map((n) => n.name ?? '');
  assert.deepEqual([...names].sort(), [...PIECES].sort(), 'only the pieces, each named once');
  for (const name of PIECES) {
    const i = byName(name);
    assert.equal(props.parentName(i), undefined, `${name} hangs from nothing`);
    const { at, turn } = props.placed(i);
    assert.ok(at.length() < 1e-4, `${name} is at ${fmt(at)}`);
    assert.ok(turn.angleTo(new Quaternion()) < 1e-4, `${name} isn't turned`);
  }
});

test('its materials are the ones world/office/noir.ts paints, and only those', () => {
  const names = props.materials();
  for (const m of PAINTED) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(PAINTED.includes(m), `${m} isn't a material the code knows (it would come out magenta)`);
});

test('every piece that stands somewhere has its footprint centred on its origin and sits on it', () => {
  // The blind hangs from its rail instead, so its origin is the rail at the top of the drop; the
  // cabinet is stood against a wall, so its back rather than its middle is the fixed edge.
  const NOT_CENTRED = ['venetian_blind', 'filing_cabinet'];
  for (const name of PIECES.filter((n) => !NOT_CENTRED.includes(n))) {
    const box = boundsOf(name);
    const middle = box.getCenter(new Vector3());
    assert.ok(Math.hypot(middle.x, middle.z) < 5e-3, `${name}'s footprint is centred on its origin (${fmt(middle)})`);
    assert.ok(near(box.min.y, 0, 5e-3), `${name} stands on the floor at its origin (${box.min.y.toFixed(4)})`);
  }
  // The cabinet's back, without the brass pulls, is what the office puts on the wall.
  assert.ok(near(boundsOf('filing_cabinet').min.z, -0.31, 5e-3), `its back is at ${boundsOf('filing_cabinet').min.z.toFixed(4)}`);
});

test("the banker's lamp is a lamp: a weighted base, a stem and a green shade over the top", () => {
  const lamp = boundsOf('desk_lamp');
  const shade = boundsOf('desk_lamp', ['Shade']);
  const brass = boundsOf('desk_lamp', ['Brass']);
  const size = lamp.getSize(new Vector3());
  assert.ok(lamp.max.y > 0.26 && lamp.max.y < 0.3, `the lamp is ${lamp.max.y.toFixed(3)} m tall`);
  // The shade is the green glass, up on top and clear of the base: the lamp reads by its colour.
  assert.ok(shade.max.y > 0.2, `the shade is up at ${shade.max.y.toFixed(3)}`);
  assert.ok(shade.min.y > lamp.min.y + 0.15, `the shade is clear of the base (from ${shade.min.y.toFixed(3)})`);
  // The shade is modelled lying along the desk (the z the office's forward is), so it is longer
  // there than it is across, and it overhangs the base it stands on.
  assert.ok(size.z > 0.22 && size.z < 0.27, `the shade runs ${size.z.toFixed(3)} m along`);
  assert.ok(size.z > size.x, `it overhangs the ${(brass.max.x - brass.min.x).toFixed(3)} m base`);
  // The brass base is wide and low, and the stem between the two is thin.
  assert.ok(brass.max.x - brass.min.x > 0.14, `the base is ${(brass.max.x - brass.min.x).toFixed(3)} across`);
});

test('the telephone and the typewriter are the sizes a desk takes, and both stand on it', () => {
  const phone = boundsOf('rotary_phone').getSize(new Vector3());
  assert.ok(phone.x > 0.2 && phone.x < 0.28, `the phone is ${phone.x.toFixed(3)} m wide`);
  // A bakelite desk phone stands about 0.15 m: the handset rides on the cradle on top of it.
  assert.ok(phone.y > 0.13 && phone.y < 0.2, `the phone is ${phone.y.toFixed(3)} m tall`);
  const writer = boundsOf('typewriter').getSize(new Vector3());
  assert.ok(writer.x > 0.38 && writer.x < 0.46, `the typewriter is ${writer.x.toFixed(3)} m wide`);
  // The paper stands up out of the carriage, so it is the tallest thing on the desk.
  assert.ok(writer.y > 0.28 && writer.y < 0.4, `the typewriter with its paper is ${writer.y.toFixed(3)} m tall`);
  assert.ok(boundsOf('typewriter', ['Paper']).max.y > 0.28, 'the sheet of paper is up in the carriage');
});

test('the filing cabinet is a standard four-drawer one, drawers facing +z, standing 1.32 m', () => {
  const box = boundsOf('filing_cabinet');
  const size = box.getSize(new Vector3());
  assert.ok(near(size.x, 0.47, 0.02), `${size.x.toFixed(3)} m wide`);
  // The body is 0.62 m deep and the brass pulls stand about 0.05 m proud of it.
  assert.ok(size.z > 0.62 && size.z < 0.7, `${size.z.toFixed(3)} m deep, the pulls proud of a 0.62 m body`);
  assert.ok(near(box.max.y, 1.32, 0.02), `${box.max.y.toFixed(3)} m tall`);
  // The brass label holders and pulls are all on the front, so +z is the front.
  const brass = boundsOf('filing_cabinet', ['Brass']);
  assert.ok(brass.max.z > box.max.z - 0.1, `the brass is on the front (to ${brass.max.z.toFixed(3)} of ${box.max.z.toFixed(3)})`);
  assert.ok(brass.min.z > box.min.z, 'none of it is behind the cabinet');
  // Four drawers: four label holders, each its own island of brass up the front.
  assert.ok(boundsOf('filing_cabinet', ['Paper']).max.z > box.min.z, 'the drawer labels are on the front too');
});

test('the blind hangs from its rail: the rail at the top, the slats falling below the origin', () => {
  const blind = boundsOf('venetian_blind');
  const slats = boundsOf('venetian_blind', ['Slat']);
  const rail = boundsOf('venetian_blind', ['WoodWarm']);
  // The office hangs it at a window's head (WINDOWS' y1), so the rail is the top of the model.
  // The rail's end caps stand a couple of millimetres proud of it.
  assert.ok(blind.max.y <= 5e-3, `the rail is at the top of the model (${blind.max.y.toFixed(4)})`);
  assert.ok(blind.min.y < -2, `it falls ${Math.abs(blind.min.y).toFixed(2)} m from the rail`);
  // The wood is the rail and the tilt wand that hangs off it, so the rail itself is its top.
  assert.ok(rail.max.y > slats.max.y, 'the slats hang below the rail');
  assert.ok(slats.max.y < 0 && slats.min.y < -1.5, `the slats fall from ${slats.max.y.toFixed(2)} to ${slats.min.y.toFixed(2)}`);
  assert.ok(slats.max.y > blind.min.y, 'the slats stop short of the bottom of the cords');
  // Cut for the office's windows: 3 m wide, filling the 2.2 m between their sill and head.
  const size = blind.getSize(new Vector3());
  assert.ok(near(size.x, 3, 0.05), `${size.x.toFixed(3)} m wide`);
  const win = WINDOWS[0];
  assert.ok(Math.abs(blind.min.y - (win.y0 - win.y1)) < 0.25, `it spans the window's ${(win.y1 - win.y0).toFixed(2)} m drop`);
});

test('the blotter is a desk pad, thin, and it fits the desk it goes on', () => {
  const pad = boundsOf('desk_blotter');
  const size = pad.getSize(new Vector3());
  assert.ok(size.x <= DESK_SIZE.width, `${size.x.toFixed(3)} m is no wider than the desk (${DESK_SIZE.width})`);
  assert.ok(size.z <= DESK_SIZE.depth, `${size.z.toFixed(3)} m is no deeper than the desk (${DESK_SIZE.depth})`);
  assert.ok(size.y < 0.12, `it is ${size.y.toFixed(3)} m thick, a pad and not a box`);
});

test('where noir.ts puts them they stay on the desk, clear of the laptop and the dancing place', () => {
  // The desk's own frame, as buildDesk() sets it out: x along it, z out toward the chair.
  const half = { x: DESK_SIZE.width / 2 - 0.03, z: DESK_SIZE.depth / 2 - 0.02 };
  // The laptop is 0.78 m wide and stands at 1.3 times (features/workers/laptop.ts), so it takes the
  // middle of the top and the noir props have to stay out of it.
  const LAPTOP_HALF = (0.78 * 1.3) / 2;
  const ON_DESK = [
    ['desk_lamp', { x: -0.88, z: 0.3 }],
    ['typewriter', { x: -0.84, z: -0.32 }],
  ] as const;
  for (const [name, at] of ON_DESK) {
    const box = boundsOf(name);
    const minX = at.x + box.min.x;
    const maxX = at.x + box.max.x;
    const minZ = at.z + box.min.z;
    const maxZ = at.z + box.max.z;
    const where = `${name} runs x ${minX.toFixed(3)} to ${maxX.toFixed(3)}, z ${minZ.toFixed(3)} to ${maxZ.toFixed(3)}`;
    assert.ok(minX > -half.x && maxX < half.x, `${where}: on the desk across`);
    assert.ok(minZ > -half.z && maxZ < half.z, `${where}: on the desk front to back`);
    assert.ok(maxX < -LAPTOP_HALF || minX > LAPTOP_HALF, `${where}: clear of the laptop (which reaches ${LAPTOP_HALF.toFixed(3)})`);
    // Whoever dances when a pull request merges stands at (0.72, 0.18), up front.
    assert.ok(maxX < 0.72 - 0.25 || minX > 0.72 + 0.25 || maxZ < 0.18 - 0.25 || minZ > 0.18 + 0.25, `${where}: clear of the dancing place`);
  }
  // The typewriter stands in the back corner its desk's knick-knack leaves free (seats.ts's buildDesk):
  // a mug or books at x 0.84 (index % 3 of 0 or 2), a plant at x -0.85 (1).
  for (const right of [false, true]) {
    const box = boundsOf('typewriter');
    const minX = (right ? 0.84 : -0.84) + box.min.x;
    const maxX = (right ? 0.84 : -0.84) + box.max.x;
    assert.ok(right ? minX > LAPTOP_HALF : maxX < -LAPTOP_HALF, `the typewriter in the ${right ? 'right' : 'left'} back corner runs x ${minX.toFixed(3)} to ${maxX.toFixed(3)}`);
    // Clear of the knick-knack in the other back corner is automatic; what matters is its own side:
    // a mug at x 0.85 and books at x 0.84 both reach about 0.13 in, and a plant at x -0.85 about 0.1.
    const knick = right ? -1 : 1;
    assert.ok(right ? minX > 0.5 : maxX < -0.5, `it is well over on its own side of the desk (${knick > 0 ? 'left' : 'right'})`);
  }
});

test('the cabinets stand against the walls, back on the wall and inside the room', () => {
  const box = boundsOf('filing_cabinet');
  const size = box.getSize(new Vector3());
  const spots = [
    { x: -18 + 0.31, z: -11.8, rotY: Math.PI / 2, wall: 'west' as const },
    { x: -18 + 0.31, z: 8.2, rotY: Math.PI / 2, wall: 'west' as const },
    { x: -18 + 0.31, z: 10.2, rotY: Math.PI / 2, wall: 'west' as const },
    { x: -11.5, z: 13 - 0.31, rotY: Math.PI, wall: 'south' as const },
    { x: -7.1, z: 13 - 0.31, rotY: Math.PI, wall: 'south' as const },
    { x: -6.3, z: 13 - 0.31, rotY: Math.PI, wall: 'south' as const },
  ];
  const WALL_AT = { west: -18, east: 18, south: 13, north: -13 } as const;
  // Where the model's own x and z land in the room once it is turned by rotY about y.
  const turned = (mx: number, mz: number, r: number): [number, number] => [mx * Math.cos(r) + mz * Math.sin(r), -mx * Math.sin(r) + mz * Math.cos(r)];
  for (const spot of spots) {
    const corners = [box.min.x, box.max.x].flatMap((mx) => [box.min.z, box.max.z].map((mz) => turned(mx, mz, spot.rotY)));
    const along = corners.map(([dx]) => spot.x + dx);
    const across = corners.map(([, dz]) => spot.z + dz);
    const wall = WALL_AT[spot.wall];
    const eastWest = spot.wall === 'west' || spot.wall === 'east';
    // The face nearest the wall has to be against it, inside the room and not through it, and the
    // brass pulls (its front) have to be on the far side of that, facing into the room.
    const near = eastWest ? Math.min(...along) : Math.max(...across);
    const far = eastWest ? Math.max(...along) : Math.min(...across);
    assert.ok(near >= wall - 1e-3, `at ${spot.wall} its back is inside the room at ${near.toFixed(4)}, not through the wall (${wall})`);
    assert.ok(near - wall < 0.06, `at ${spot.wall} it stands ${(near - wall).toFixed(3)} off the wall, close against it`);
    assert.ok(Math.abs(far - wall) > Math.abs(near - wall), `at ${spot.wall} its front (the brass pulls) faces into the room`);
    // And the whole thing stays inside the room the other way, along the wall.
    const span = eastWest ? across : along;
    assert.ok(Math.min(...span) > -13.01 && Math.max(...span) < 13.01, `along the wall it runs ${Math.min(...span).toFixed(2)} to ${Math.max(...span).toFixed(2)}`);
  }
  // Nothing stands in a window: the south windows are at u -14, -9 and 1, the west ones at -9, -3 and 3.
  for (const spot of spots) {
    const along = spot.wall === 'west' || spot.wall === 'east';
    for (const w of WINDOWS) {
      if (w.wall !== spot.wall) continue;
      const u = along ? spot.z : spot.x;
      assert.ok(Math.abs(u - w.u) > w.width / 2 + 0.3, `a cabinet at ${spot.wall} u ${u.toFixed(2)} is clear of the window at u ${w.u}`);
    }
  }
  // Nor across a way out of the room, or in front of the ladder up the west wall.
  for (const spot of spots) {
    for (const d of [EXIT_DOOR, BALCONY_DOOR]) {
      if (d.wall !== spot.wall) continue;
      const along = d.wall === 'west' || d.wall === 'east';
      const u = along ? spot.z : spot.x;
      assert.ok(Math.abs(u - d.u) > d.width / 2 + 0.4, `a cabinet at ${d.wall} u ${u.toFixed(2)} is clear of the door at u ${d.u}`);
    }
    if (spot.wall !== 'west') continue;
    assert.ok(Math.abs(spot.z - LADDER.z) > LADDER.width / 2 + 0.4, `a cabinet at west z ${spot.z} is clear of the ladder at z ${LADDER.z}`);
  }
});

test('each piece is cheap: a prop a few thousand triangles at most, the blind under 7000', () => {
  for (const name of PIECES) {
    const limit = name === 'venetian_blind' ? 7000 : name === 'filing_cabinet' || name === 'typewriter' || name === 'rotary_phone' ? 3200 : 2000;
    assert.ok(trianglesOf(name) <= limit, `${name}: ${trianglesOf(name)} triangles (limit ${limit})`);
  }
});