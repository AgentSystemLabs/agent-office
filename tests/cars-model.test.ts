import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Quaternion, Vector3 } from 'three';
import { CAR, SEATS } from '../src/shared/garage';
import { openModel } from './glb';

// cars.glb (exported by blender/scripts/build_cars.py) against what features/cars/world.ts counts on: each
// car's five roots by name, the materials it paints, the old code-built cars' footprint (the colliders, the
// seats and the camera are placed by it), and front wheels with their origins at their hubs, to steer about.

const FILE = new URL('../src/client/models/cars.glb', import.meta.url);
const cars = openModel('cars');
const { gltf, nodes, byName } = cars;

const KINDS = ['lambo', 'ferrari'] as const;
const PARTS = ['', '_top', '_open', '_wheel_l', '_wheel_r'];
/** What features/cars/world.ts paints: CAR_COLORS there, and Paint, Glass, Screen, Lamp and Tail, which it makes itself. */
const MATERIALS = ['Paint', 'Glass', 'Screen', 'Lamp', 'Tail', 'Dark', 'Tire', 'RimGold', 'RimSilver', 'Caliper', 'Chrome', 'Badge', 'Seat'];
const AXLE = { lambo: 1.42, ferrari: 1.36 };
const WHEEL = { r: 0.36, y: 0.37, x: 0.79 };

type Primitive = { attributes: Record<string, number>; material?: number; indices?: number };
type Accessor = { bufferView?: number; byteOffset?: number; count: number; componentType: number; type: string };
const primitives = (name: string) => (gltf.meshes[nodes[byName(name)].mesh ?? -1]?.primitives ?? []) as Primitive[];
const materialOf = (p: Primitive) => gltf.materials?.[p.material ?? -1]?.name ?? '';
const accessor = (i: number) => gltf.accessors[i] as Accessor;

const bin = (() => {
  const b = readFileSync(FILE);
  const json = 20 + b.readUInt32LE(12);
  assert.equal(b.toString('ascii', json + 4, json + 8), 'BIN\0', 'the second chunk is the binary one');
  return b.subarray(json + 8, json + 8 + b.readUInt32LE(json));
})();
const views = (gltf as unknown as { bufferViews: { byteOffset?: number; byteStride?: number }[] }).bufferViews;

/** A root's vertices where they stand in the model, only those of `materials` if given. */
function verticesOf(name: string, materials?: string[]): Vector3[] {
  const m = cars.worldMatrix(byName(name));
  const out: Vector3[] = [];
  for (const p of primitives(name)) {
    if (materials && !materials.includes(materialOf(p))) continue;
    const a = accessor(p.attributes.POSITION);
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
const trianglesOf = (name: string) => primitives(name).reduce((n, p) => n + accessor(p.indices!).count / 3, 0);
const near = (a: number, b: number, tolerance = 0.01) => Math.abs(a - b) <= tolerance;

test('each car is five roots, none hanging from another, and nothing else', () => {
  const names = nodes.map((n) => n.name ?? '');
  const want = KINDS.flatMap((k) => PARTS.map((p) => k + p));
  assert.deepEqual([...names].sort(), [...want].sort());
  for (const name of want) assert.equal(cars.parentName(byName(name)), undefined, `${name} hangs from nothing`);
});

test('its materials are the ones features/cars/world.ts paints', () => {
  for (const m of cars.materials()) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would come out magenta)`);
  for (const kind of KINDS)
    assert.ok(
      primitives(kind).some((p) => materialOf(p) === 'Paint'),
      `the ${kind} has paint for its colour`,
    );
});

test("the body, cabin and seats sit at the origin unturned, in the old cars' footprint, nose to +z", () => {
  for (const kind of KINDS) {
    for (const part of ['', '_top', '_open']) {
      const { at, turn } = cars.placed(byName(kind + part));
      assert.ok(at.length() < 1e-4 && turn.angleTo(new Quaternion()) < 1e-4, `${kind}${part} is at the origin, unturned`);
    }
    const box = boundsOf(kind);
    assert.ok(box.max.z - box.min.z <= CAR.length + 0.03 && box.max.z - box.min.z > CAR.length - 0.2, `the ${kind} is ${(box.max.z - box.min.z).toFixed(2)} long`);
    assert.ok(box.max.x - box.min.x <= CAR.width + 0.04, `the ${kind} is ${(box.max.x - box.min.x).toFixed(2)} wide`);
    assert.ok(near(box.min.y, 0), `the ${kind} stands on its wheels at 0 (${box.min.y.toFixed(3)})`);
    // The headlights at the front, the taillights at the back.
    assert.ok(boundsOf(kind, ['Lamp']).min.z > 1.5 && boundsOf(kind, ['Tail']).max.z < -1.9, `the ${kind} faces +z`);
    // The cabin's roof comes up to the old roof, which the colliders' top is.
    const top = boundsOf(`${kind}_top`);
    assert.ok(near(top.max.y, CAR.roof, 0.03), `the ${kind}'s roof is ${top.max.y.toFixed(3)} up`);
  }
});

test('the seats are where the driver and passenger sit, a wheel in front of the driver', () => {
  for (const kind of KINDS) {
    const seats = verticesOf(`${kind}_open`, ['Seat']);
    for (const s of Object.values(SEATS)) {
      const own = seats.filter((v) => Math.abs(v.x - s.x) < 0.3);
      assert.ok(own.length, `a seat at x ${s.x}`);
      const box = new Box3().setFromPoints(own);
      assert.ok(box.min.z < s.z && box.max.z > s.z - 0.5, `the ${kind}'s seat at ${s.x} runs ${box.min.z.toFixed(2)} to ${box.max.z.toFixed(2)}`);
    }
    const wheel = new Box3().setFromPoints(verticesOf(`${kind}_open`, ['Dark']).filter((v) => v.y > 0.75 && v.y < 1.2 && Math.abs(v.x - SEATS.driver.x) < 0.25 && v.z > SEATS.driver.z));
    assert.ok(!wheel.isEmpty(), `the ${kind} has a steering wheel in front of the driver`);
  }
});

test('the front wheels turn about their hubs, where the old ones were, the right size', () => {
  for (const kind of KINDS) {
    for (const [side, sx] of [
      ['_wheel_l', 1],
      ['_wheel_r', -1],
    ] as const) {
      const name = kind + side;
      const { at, turn } = cars.placed(byName(name));
      assert.ok(at.distanceTo(new Vector3(sx * WHEEL.x, WHEEL.y, AXLE[kind])) < 0.005, `${name}'s hub is at ${at.toArray().map((n) => n.toFixed(3))}`);
      assert.ok(turn.angleTo(new Quaternion()) < 1e-4, `${name} isn't turned`);
      const tire = boundsOf(name, ['Tire']);
      assert.ok(near((tire.max.y - tire.min.y) / 2, WHEEL.r), `${name} is ${((tire.max.y - tire.min.y) / 2).toFixed(3)} round`);
      // Its rim on the outside.
      const rim = boundsOf(name, kind === 'lambo' ? ['RimGold'] : ['RimSilver']).getCenter(new Vector3());
      assert.ok(Math.sign(rim.x - at.x) === sx, `${name}'s rim faces out`);
    }
  }
});

test('each car is in budget', () => {
  for (const kind of KINDS) {
    const tris = PARTS.reduce((n, p) => n + trianglesOf(kind + p), 0);
    assert.ok(tris < 20_000, `the ${kind} is ${tris} triangles`);
  }
});
