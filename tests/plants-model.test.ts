import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Quaternion, Vector3 } from 'three';
import { openModel } from './glb';

// plants.glb (exported by blender/scripts/build_plants.py) against what world/office/props.ts counts on: each
// species by name, its pot a root standing on the floor at the origin with its leaves hung under it as
// `<species>_leaves` (Christmas hides those, see holiday.ts), the materials it paints, and the old
// code-built pot's footprint, which the plants' colliders, nav circles and Christmas trees are placed by.

const plants = openModel('plants');
const { gltf, nodes, byName } = plants;

const FLOOR = ['monstera', 'snake_plant', 'ficus'];
const SPECIES = [...FLOOR, 'succulent'];
/** PLANT_COLORS in world/office/props.ts. */
const MATERIALS = ['Pot', 'Glaze', 'Soil', 'Bark', 'Leaf', 'LeafDark'];
const POTS = ['Pot', 'Glaze'];

type Primitive = { attributes: Record<string, number>; material?: number; indices?: number };
const primitives = (name: string) => (gltf.meshes[nodes[byName(name)].mesh ?? -1]?.primitives ?? []) as Primitive[];
const materialOf = (p: Primitive) => gltf.materials?.[p.material ?? -1]?.name ?? '';

/** A node's bounds in the model, from its mesh's primitives (only those in `materials`, if given). */
function boundsOf(name: string, materials?: string[]): Box3 {
  const i = byName(name);
  const box = new Box3();
  assert.ok(primitives(name).length, `${name} has a mesh`);
  for (const p of primitives(name)) {
    if (materials && !materials.includes(materialOf(p))) continue;
    const a = gltf.accessors[p.attributes.POSITION];
    box.union(new Box3(new Vector3().fromArray(a.min!), new Vector3().fromArray(a.max!)).applyMatrix4(plants.worldMatrix(i)));
  }
  return box;
}

/** A species' triangles, its pot's and its leaves'. */
const trianglesOf = (species: string) =>
  [species, `${species}_leaves`].reduce((n, name) => n + primitives(name).reduce((m, p) => m + gltf.accessors[p.indices!].count / 3, 0), 0);

/** How far out from the middle a box reaches along x or z, the way the walls run. */
const reach = (box: Box3) => Math.max(-box.min.x, box.max.x, -box.min.z, box.max.z);

const near = (a: number, b: number, tolerance = 0.005) => Math.abs(a - b) <= tolerance;
const fmt = (v: Vector3) => v.toArray().map((n) => n.toFixed(3)).join(', ');

test('each species is its pot, a root node at the origin, with its leaves hung under it', () => {
  const names = nodes.map((n) => n.name ?? '');
  assert.deepEqual([...names].sort(), SPECIES.flatMap((s) => [s, `${s}_leaves`]).sort(), 'only the pots and their leaves, each named once');
  for (const species of SPECIES) {
    const pot = byName(species);
    assert.equal(plants.parentName(pot), undefined, `${species} hangs from nothing`);
    const leaves = byName(`${species}_leaves`);
    assert.equal(plants.parentName(leaves), species, `${species}_leaves hangs from its pot`);
    for (const i of [pot, leaves]) {
      const { at, turn } = plants.placed(i);
      assert.ok(at.length() < 1e-4, `${nodes[i].name} is at ${fmt(at)}`);
      assert.ok(turn.angleTo(new Quaternion()) < 1e-4, `${nodes[i].name} isn't turned: it faces +z as modelled`);
    }
  }
});

test('its materials are the ones world/office/props.ts paints, the pot and soil on the pot and the rest on the leaves', () => {
  const names = plants.materials();
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would come out magenta)`);
  for (const species of SPECIES) {
    const pot = primitives(species).map(materialOf);
    assert.equal(pot.filter((m) => POTS.includes(m)).length, 1, `${species}'s pot is one pot material (${pot})`);
    assert.ok(pot.includes('Soil') && pot.length === 2, `${species}'s pot holds its soil and nothing else (${pot})`);
    // Hiding the leaves at Christmas leaves the whole pot, and only the pot, for the tree to stand in.
    const leaves = primitives(`${species}_leaves`).map(materialOf);
    assert.ok(leaves.length && leaves.every((m) => !POTS.includes(m) && m !== 'Soil'), `${species}_leaves is only what grows (${leaves})`);
  }
});

test('the floor pots are the old pot\'s size, standing on the floor, their soil where the Christmas tree stands', () => {
  for (const species of FLOOR) {
    const pot = boundsOf(species, POTS);
    assert.ok(near(pot.min.y, 0, 1e-3), `${species}'s pot stands on the floor (${pot.min.y.toFixed(3)})`);
    assert.ok(near(pot.max.y, 0.5), `${species}'s pot is ${pot.max.y.toFixed(3)} m tall`);
    // 0.28 round at the top, inside the collider's 0.3 either way of the middle.
    assert.ok(reach(pot) > 0.27 && reach(pot) <= 0.285, `${species}'s pot is ${reach(pot).toFixed(3)} m round`);
    const middle = pot.getCenter(new Vector3());
    assert.ok(Math.hypot(middle.x, middle.z) < 1e-3, `${species}'s pot is centred on its origin (${fmt(middle)})`);
    const soil = boundsOf(species, ['Soil']);
    assert.ok(soil.max.y > 0.44 && soil.max.y < 0.46, `${species}'s soil is at ${soil.max.y.toFixed(3)}`);
  }
});

test('the floor plants grow out of their pots, under 1.5 m tall and clear of the walls where they stand', () => {
  // PLANTS stand 0.8 m from the walls at up to 1.4 times this size for the monstera (world/office/props.ts takes
  // turns with the species), and the snake plant and the ficus go by the balcony rail and in the loft's
  // corners, about 0.5 m in at up to 1.2 times.
  const most: Record<string, number> = { monstera: 0.8 / 1.4, snake_plant: 0.5 / 1.2, ficus: 0.5 / 1.1 };
  for (const species of FLOOR) {
    const leaves = boundsOf(`${species}_leaves`);
    assert.ok(leaves.min.y > 0.38, `${species}'s leaves start in its soil, not under it (${leaves.min.y.toFixed(3)})`);
    assert.ok(leaves.max.y > 1.1 && leaves.max.y <= 1.5, `${species} is ${leaves.max.y.toFixed(3)} m tall`);
    assert.ok(reach(leaves) <= most[species], `${species}'s leaves reach ${reach(leaves).toFixed(3)} m out`);
  }
});

test('the succulent is desk-sized: the old desk plant\'s pot, no taller than 0.35 m', () => {
  const pot = boundsOf('succulent', POTS);
  assert.ok(near(pot.min.y, 0, 1e-3), `its pot stands on the desk (${pot.min.y.toFixed(3)})`);
  assert.ok(near(pot.max.y, 0.175), `its pot is ${pot.max.y.toFixed(3)} m tall`);
  assert.ok(near(reach(pot), 0.098), `its pot is ${reach(pot).toFixed(3)} m round`);
  const all = plants.bounds();
  const leaves = boundsOf('succulent_leaves');
  assert.ok(leaves.min.y > 0.15, `its rosette sits in its pot (${leaves.min.y.toFixed(3)})`);
  assert.ok(leaves.max.y <= 0.35, `${leaves.max.y.toFixed(3)} m tall`);
  assert.ok(reach(leaves) < 0.12, `its leaves reach ${reach(leaves).toFixed(3)} m out`);
  assert.ok(all.min.y > -1e-3, 'nothing is under the floor');
});

test('each species is a few thousand triangles at most, the succulent under a thousand', () => {
  for (const species of FLOOR) assert.ok(trianglesOf(species) <= 4500, `${species}: ${trianglesOf(species)} triangles`);
  assert.ok(trianglesOf('succulent') < 1000, `succulent: ${trianglesOf('succulent')} triangles`);
});
