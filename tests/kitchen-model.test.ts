import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Vector3 } from 'three';
import { openModel } from './glb';

// kitchen.glb (exported by blender/scripts/build_kitchen.py) against what world/kitchen.ts counts on: the
// three parts it's made of, by name, the materials it paints, and the old code-built kitchen's footprint,
// which the office's colliders, sounds and holiday pumpkins are placed by.
//
// The model faces +z like every other; kitchen.ts stands it at x -14.5, z 12.2 turned round to face into
// the room, so what's at +x here ends up on the west side. That's why the machine is at +1.2 and the
// fridge at -3.2: in the office they land at x -15.7 and -11.3, where the old ones stood.

const kitchen = openModel('kitchen');
const { gltf, nodes, byName } = kitchen;

const PARTS = ['counter', 'coffee_machine', 'fridge'];
const MATERIALS = ['Cabinet', 'Wood', 'Chrome', 'Dark', 'White', 'Glow', 'Fridge', 'Note', 'Memo', 'Red'];

/** A part's bounds in the model, from its mesh's primitives (only those in `material`, if given). */
function boundsOf(name: string, material?: string): Box3 {
  const i = byName(name);
  const box = new Box3();
  const mesh = gltf.meshes[nodes[i].mesh ?? -1];
  assert.ok(mesh, `${name} has a mesh`);
  for (const p of mesh.primitives as { attributes: Record<string, number>; material?: number }[]) {
    if (material && gltf.materials?.[p.material ?? -1]?.name !== material) continue;
    const a = gltf.accessors[p.attributes.POSITION];
    box.union(new Box3(new Vector3().fromArray(a.min!), new Vector3().fromArray(a.max!)).applyMatrix4(kitchen.worldMatrix(i)));
  }
  return box;
}

const near = (a: number, b: number, tolerance = 0.005) => Math.abs(a - b) <= tolerance;
const fmt = (v: Vector3) => v.toArray().map((n) => n.toFixed(3)).join(', ');

test('it is three parts side by side, each its own root node, found by name', () => {
  for (const name of PARTS) {
    const i = byName(name);
    assert.ok(i >= 0, `a node called ${name}`);
    assert.equal(kitchen.parentName(i), undefined, `${name} hangs from nothing`);
  }
});

test('its materials are the ones kitchen.ts paints, and only those', () => {
  const names = kitchen.materials();
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would come out magenta)`);
  // Only the machine's light glows.
  const glowing = PARTS.filter((name) => !boundsOf(name, 'Glow').isEmpty());
  assert.deepEqual(glowing, ['coffee_machine']);
});

test('the counter is the old one\'s size, its wooden top at 1.03 m where the collider and the pumpkins are', () => {
  const top = boundsOf('counter', 'Wood');
  assert.ok(near(top.max.y, 1.03), `the top is at ${top.max.y.toFixed(3)}`);
  assert.ok(near(top.min.x, -2.55) && near(top.max.x, 2.55), `the top runs ${top.min.x.toFixed(3)} to ${top.max.x.toFixed(3)} across`);
  assert.ok(near(top.min.z, -0.55) && near(top.max.z, 0.55), `the top runs ${top.min.z.toFixed(3)} to ${top.max.z.toFixed(3)} front to back`);
  const cupboards = boundsOf('counter', 'Cabinet');
  assert.ok(near(cupboards.min.y, 0.08) && cupboards.max.y <= 0.95 + 0.005, `the cupboards stand ${fmt(cupboards.min)} to ${fmt(cupboards.max)}`);
  assert.ok(near(cupboards.min.x, -2.5) && near(cupboards.max.x, 2.5), 'the cupboards are 5 m long');
  assert.ok(boundsOf('counter').min.y > -0.005, 'nothing under the floor');
});

test('the machine sits on the counter where the old one did, and its front faces +z', () => {
  const { at } = kitchen.placed(byName('coffee_machine'));
  assert.ok(at.distanceTo(new Vector3(1.2, 1.03, 0)) < 1e-3, `the machine's origin is at ${fmt(at)}`);
  const box = boundsOf('coffee_machine');
  assert.ok(box.min.y > 1.03 - 0.005, `it stands on the top, not in it (${box.min.y.toFixed(3)})`);
  // Under the wall's fixture over it (1.8 m), and about as wide as the old one.
  assert.ok(box.max.y <= 1.8, `${box.max.y.toFixed(3)} m high`);
  assert.ok(box.max.x - box.min.x <= 0.62, `${(box.max.x - box.min.x).toFixed(3)} m wide`);
  // The portafilter and the drip tray stick out the front; the back is flat and near the wall.
  assert.ok(box.max.z > 0.45 && box.max.z < 0.55, `reaches ${box.max.z.toFixed(3)} forward`);
  assert.ok(-box.min.z < 0.3, `reaches ${(-box.min.z).toFixed(3)} back`);
  // Clear of the holiday pumpkins' spots on the counter (see holiday.ts): x -1.5 and 2.15 here.
  assert.ok(box.min.x > -1.5 + 0.14 && box.max.x < 2.15 - 0.11, `runs ${box.min.x.toFixed(3)} to ${box.max.x.toFixed(3)} across`);
});

test('the fridge stands where the old one did, inside its collider, handles out the front', () => {
  const { at } = kitchen.placed(byName('fridge'));
  assert.ok(at.distanceTo(new Vector3(-3.2, 0, 0)) < 1e-3, `the fridge's origin is at ${fmt(at)}`);
  const body = boundsOf('fridge', 'Fridge');
  assert.ok(near(body.min.x, -3.75) && near(body.max.x, -2.65), `the body runs ${body.min.x.toFixed(3)} to ${body.max.x.toFixed(3)} across`);
  assert.ok(near(body.max.y, 2.2), `${body.max.y.toFixed(3)} m tall`);
  assert.ok(body.min.z >= -0.5 - 0.005 && body.max.z <= 0.5 + 0.005, `the body runs ${body.min.z.toFixed(3)} to ${body.max.z.toFixed(3)} front to back`);
  const all = boundsOf('fridge');
  assert.ok(near(all.min.y, 0), 'on its feet on the floor');
  assert.ok(all.max.z > body.max.z && all.max.z < 0.58, `the handles reach ${all.max.z.toFixed(3)} forward`);
});

test('the whole kitchen is the old one\'s footprint: 6.3 m long, 2.2 m tall', () => {
  const box = kitchen.bounds();
  assert.ok(near(box.min.x, -3.75) && near(box.max.x, 2.55), `runs ${box.min.x.toFixed(3)} to ${box.max.x.toFixed(3)} across`);
  assert.ok(near(box.max.y, 2.2), `${box.max.y.toFixed(3)} m tall`);
  assert.ok(box.min.z > -0.56 && box.max.z < 0.58, `runs ${box.min.z.toFixed(3)} to ${box.max.z.toFixed(3)} front to back`);
  assert.ok(kitchen.triangles() < 9000, `${kitchen.triangles()} triangles`);
});
