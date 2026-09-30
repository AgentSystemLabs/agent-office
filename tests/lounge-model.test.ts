import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Quaternion, Vector3 } from 'three';
import { openModel } from './glb';

// lounge.glb (exported by blender/scripts/build_lounge.py) against what world/office/props.ts counts on: its four
// pieces by name, each a root standing on the floor at the origin and facing +z, the materials it paints, and
// the old code-built lounge's sizes, which the couch's and the table's colliders, the seats' hips (SEATING in
// shared/layout.ts) and the holiday pumpkin on the table (holiday.ts) are placed by.

const FILE = new URL('../src/client/models/lounge.glb', import.meta.url);
const lounge = openModel('lounge');
const { gltf, nodes, byName } = lounge;

const PIECES = ['sofa', 'pillow', 'pouf', 'coffee_table'];
/** LOUNGE_COLORS in world/office/props.ts, and Cloth, which each pillow and pouf there paints its own color. */
const MATERIALS = ['Sofa', 'WoodDark', 'Wood', 'Frame', 'Cloth'];
const MADE_OF: Record<string, string[]> = { sofa: ['Sofa', 'WoodDark'], pillow: ['Cloth'], pouf: ['Cloth'], coffee_table: ['Wood', 'Frame'] };

type Primitive = { attributes: Record<string, number>; material?: number; indices?: number };
type Accessor = { bufferView?: number; byteOffset?: number; count: number; componentType: number; type: string; min?: number[]; max?: number[] };
const primitives = (name: string) => (gltf.meshes[nodes[byName(name)].mesh ?? -1]?.primitives ?? []) as Primitive[];
const materialOf = (p: Primitive) => gltf.materials?.[p.material ?? -1]?.name ?? '';
const accessor = (i: number) => gltf.accessors[i] as Accessor;

/** The .glb's binary chunk, where the vertices are: straight after the JSON chunk (whose length is padded to 4). */
const bin = (() => {
  const b = readFileSync(FILE);
  const json = 20 + b.readUInt32LE(12);
  assert.equal(b.toString('ascii', json + 4, json + 8), 'BIN\0', 'the second chunk is the binary one');
  return b.subarray(json + 8, json + 8 + b.readUInt32LE(json));
})();
const views = (gltf as unknown as { bufferViews: { byteOffset?: number; byteStride?: number }[] }).bufferViews;

/** A piece's vertices where they stand in the model, only those of `materials` if given. */
function verticesOf(name: string, materials?: string[]): Vector3[] {
  const m = lounge.worldMatrix(byName(name));
  const out: Vector3[] = [];
  for (const p of primitives(name)) {
    if (materials && !materials.includes(materialOf(p))) continue;
    const a = accessor(p.attributes.POSITION);
    assert.ok(a.componentType === 5126 && a.type === 'VEC3', 'positions are three floats');
    const view = views[a.bufferView ?? -1];
    const stride = view.byteStride ?? 12;
    const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
    for (let k = 0; k < a.count; k++) {
      const o = start + k * stride;
      out.push(new Vector3(bin.readFloatLE(o), bin.readFloatLE(o + 4), bin.readFloatLE(o + 8)).applyMatrix4(m));
    }
  }
  assert.ok(out.length, `${name} has vertices${materials ? ` of ${materials}` : ''}`);
  return out;
}

const boundsOf = (name: string, materials?: string[]) => new Box3().setFromPoints(verticesOf(name, materials));
const highest = (vs: Vector3[]) => Math.max(...vs.map((v) => v.y));
/** How far out from the middle a box reaches along x or z. */
const reach = (box: Box3) => Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);
const trianglesOf = (name: string) => primitives(name).reduce((n, p) => n + accessor(p.indices!).count / 3, 0);

const near = (a: number, b: number, tolerance = 0.005) => Math.abs(a - b) <= tolerance;
const fmt = (v: Vector3) => v.toArray().map((n) => n.toFixed(3)).join(', ');

test('it is four pieces, each a root node at the origin, facing +z as modelled', () => {
  const names = nodes.map((n) => n.name ?? '');
  assert.deepEqual([...names].sort(), [...PIECES].sort(), 'only the four pieces, each named once');
  for (const name of PIECES) {
    const i = byName(name);
    assert.equal(lounge.parentName(i), undefined, `${name} hangs from nothing`);
    const { at, turn } = lounge.placed(i);
    assert.ok(at.length() < 1e-4, `${name} is at ${fmt(at)}`);
    assert.ok(turn.angleTo(new Quaternion()) < 1e-4, `${name} isn't turned`);
  }
});

test('its materials are the ones world/office/props.ts paints, and each piece is made of its own', () => {
  const names = lounge.materials();
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would come out magenta)`);
  for (const name of PIECES) {
    const used = [...new Set(primitives(name).map(materialOf))].sort();
    assert.deepEqual(used, [...MADE_OF[name]].sort(), `${name} is made of ${used}`);
  }
});

test('every piece stands on the floor, its origin under its middle', () => {
  for (const name of PIECES) {
    const box = boundsOf(name);
    assert.ok(near(box.min.y, 0, 1e-3), `${name} stands on the floor (${box.min.y.toFixed(3)})`);
    const middle = box.getCenter(new Vector3());
    assert.ok(Math.hypot(middle.x, middle.z) < 0.01, `${name} is centred on its origin (${fmt(middle)})`);
  }
});

test('the sofa is the old couch\'s size, 4.2 long and 1.0 deep, its back behind it so it faces +z', () => {
  const box = boundsOf('sofa');
  assert.ok(near(box.min.x, -2.1) && near(box.max.x, 2.1), `it runs ${box.min.x.toFixed(3)} to ${box.max.x.toFixed(3)} across`);
  assert.ok(near(box.min.z, -0.5) && near(box.max.z, 0.5), `it runs ${box.min.z.toFixed(3)} to ${box.max.z.toFixed(3)} front to back`);
  assert.ok(box.max.y > 0.9 && box.max.y <= 1.02, `its back is ${box.max.y.toFixed(3)} m high`);
  // Everything above the arms is the back, at the back.
  const high = verticesOf('sofa').filter((v) => v.y > 0.8);
  assert.ok(high.length && high.every((v) => v.z < -0.2), 'what stands above the arms is behind the seat');
  const arms = verticesOf('sofa', ['Sofa']).filter((v) => Math.abs(v.x) > 1.85 && v.z > -0.3);
  assert.ok(highest(arms) > 0.7 && highest(arms) < 0.82, `its arms are ${highest(arms).toFixed(3)} m high`);
});

test('its seat cushions are where a sitter\'s hips go, and where the collider\'s top is', () => {
  // The couch's places are 1.2 apart with hips 0.5 up, a sitter's bottom 0.1 under them. Its collider's top is
  // 0.47, so someone standing on it stands on the cushions.
  for (const x of [-1.2, 0, 1.2]) {
    // Its cushion, in front of the back cushions and between the arms.
    const seat = verticesOf('sofa', ['Sofa']).filter((v) => Math.abs(v.x - x) < 0.55 && v.z > -0.15);
    const top = highest(seat);
    assert.ok(near(top, 0.47), `the seat at ${x} is ${top.toFixed(3)} m up`);
  }
  // A sitter sits 0.05 back from the middle, a torso 0.26 round: the back cushions come to about their back,
  // so they lean into them a little.
  const back = verticesOf('sofa', ['Sofa']).filter((v) => Math.abs(v.x) < 1.7 && v.y > 0.5);
  const front = Math.max(...back.map((v) => v.z));
  assert.ok(front > -0.31 && front < -0.18, `the back cushions come forward to ${front.toFixed(3)}`);
});

test('the pillow is a plump square standing up, its face forward and its origin under it', () => {
  const box = boundsOf('pillow');
  const size = box.getSize(new Vector3());
  assert.ok(size.x > 0.4 && size.x < 0.5 && size.y > 0.4 && size.y < 0.5, `it's ${fmt(size)}`);
  assert.ok(size.z > 0.12 && size.z < 0.2 && size.z < size.x / 2, `it's ${size.z.toFixed(3)} thick, its face along z`);
});

test('the pouf is about the old floor seat\'s size, its top where a sitter\'s hips go', () => {
  const box = boundsOf('pouf');
  // The old seat was 0.6 round, its collider 0.5 either way of its middle.
  assert.ok(reach(box) > 0.45 && reach(box) <= 0.6, `it's ${reach(box).toFixed(3)} m round`);
  // A sitter's hips go 0.42 up, their bottom 0.1 under that, so they sink a little into it. Its collider's top is
  // 0.42 too, so someone standing on it stands on it.
  assert.ok(near(box.max.y, 0.42, 0.01), `it's ${box.max.y.toFixed(3)} m tall`);
});

test('the coffee table\'s top is 0.9 round at 0.46, on a pedestal inside its collider', () => {
  const top = boundsOf('coffee_table', ['Wood']);
  assert.ok(near(top.max.y, 0.46, 0.002), `its top is at ${top.max.y.toFixed(3)}, where the pumpkin stands`);
  assert.ok(near(reach(top), 0.9, 0.01), `its top is ${reach(top).toFixed(3)} m round`);
  const pedestal = boundsOf('coffee_table', ['Frame']);
  assert.ok(pedestal.max.y < top.max.y - 0.05, `the pedestal stays under the top (${pedestal.max.y.toFixed(3)})`);
  assert.ok(reach(pedestal) <= 0.8, `the pedestal reaches ${reach(pedestal).toFixed(3)} m out, inside the collider`);
});

test('each piece keeps to its triangle budget', () => {
  const most: Record<string, number> = { sofa: 5000, pillow: 800, pouf: 1500, coffee_table: 1000 };
  for (const name of PIECES) assert.ok(trianglesOf(name) <= most[name], `${name}: ${trianglesOf(name)} triangles`);
});
