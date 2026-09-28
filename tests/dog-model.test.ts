import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

// dog.glb (exported by blender/scripts/build_dog.py) against what world/dog.ts counts on: the names it
// finds the model's parts by, and roughly the size and shape of the dog the office was laid out for.

interface GltfNode {
  name?: string;
  children?: number[];
  mesh?: number;
  skin?: number;
  matrix?: number[];
  translation?: [number, number, number];
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
}

interface Gltf {
  nodes: GltfNode[];
  skins?: { joints: number[] }[];
  animations?: { name?: string }[];
  materials?: { name?: string }[];
  meshes: { primitives: { attributes: Record<string, number> }[] }[];
  accessors: { min?: number[]; max?: number[] }[];
}

/** The JSON chunk of a binary glTF: after a 12-byte header (magic, version, length), a chunk's length, its type, then the JSON. */
function readGlb(file: URL): Gltf {
  const b = readFileSync(file);
  assert.equal(b.toString('ascii', 0, 4), 'glTF', 'a binary glTF');
  assert.equal(b.readUInt32LE(4), 2, 'glTF 2');
  assert.equal(b.readUInt32LE(8), b.length, 'the header gives the whole length');
  const length = b.readUInt32LE(12);
  assert.equal(b.toString('ascii', 16, 20), 'JSON', 'the first chunk is the JSON');
  return JSON.parse(b.toString('utf8', 20, 20 + length)) as Gltf;
}

const gltf = readGlb(new URL('../src/client/models/dog.glb', import.meta.url));
const { nodes } = gltf;
const byName = (name: string) => nodes.findIndex((n) => n.name === name);

/** Where each node sits in the file's world, from its own transform and its parents'. */
const parentOf = new Map<number, number>();
nodes.forEach((n, i) => n.children?.forEach((c) => parentOf.set(c, i)));
function worldMatrix(i: number): Matrix4 {
  const local = (n: GltfNode) =>
    n.matrix
      ? new Matrix4().fromArray(n.matrix)
      : new Matrix4().compose(new Vector3(...(n.translation ?? [0, 0, 0])), new Quaternion(...(n.rotation ?? [0, 0, 0, 1])), new Vector3(...(n.scale ?? [1, 1, 1])));
  const m = local(nodes[i]);
  for (let p = parentOf.get(i); p !== undefined; p = parentOf.get(p)) m.premultiply(local(nodes[p]));
  return m;
}

const CLIPS = ['walk', 'run', 'stand', 'wag', 'sniff', 'sit', 'bark', 'lie', 'nap'];
const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'eye_L', 'eye_R', 'ear_L', 'ear_tip_L', 'ear_R', 'ear_tip_R',
  'tail_1', 'tail_2', 'tail_3',
  ...['front_upper', 'front_lower', 'front_paw', 'back_upper', 'back_lower', 'back_paw'].flatMap((b) => [`${b}_L`, `${b}_R`]),
];
const MATERIALS = ['Fur', 'Light', 'Ear', 'Ink', 'Shine', 'Nose', 'Tongue', 'Collar', 'Tag'];

test('it has a clip for walking, for running and for everything the dog does, by name', () => {
  const names = (gltf.animations ?? []).map((a) => a.name);
  for (const c of CLIPS) assert.ok(names.includes(c), `a clip called ${c} (found ${names.join(', ')})`);
});

test('one skeleton with every bone the code and the clips know, named with underscores', () => {
  assert.equal(gltf.skins?.length, 1, 'one armature');
  const joints = (gltf.skins?.[0]?.joints ?? []).map((j) => nodes[j].name);
  for (const b of BONES) assert.ok(joints.includes(b), `a bone called ${b}`);
  assert.equal(BONES.length, 28);
});

test('the costume sockets sit on their bones, where the costumes were tuned for, turned like the dog', () => {
  const sockets = { socket_head: { bone: 'head', at: [0, 0.56, 0.29] }, socket_back: { bone: 'spine', at: [0, 0.3, -0.17] } };
  for (const [name, want] of Object.entries(sockets)) {
    const i = byName(name);
    assert.ok(i >= 0, `a node called ${name}`);
    assert.equal(nodes[parentOf.get(i) ?? -1]?.name, want.bone, `${name} is a child of ${want.bone}`);
    const at = new Vector3();
    const turn = new Quaternion();
    worldMatrix(i).decompose(at, turn, new Vector3());
    assert.ok(at.distanceTo(new Vector3().fromArray(want.at)) < 0.05, `${name} is at ${at.toArray().map((v) => v.toFixed(3))}, not near ${want.at}`);
    assert.ok(Math.abs(turn.w) > 0.999, `${name} isn't turned in the rest pose (${turn.toArray().map((v) => v.toFixed(3))})`);
  }
});

test('its materials are the ones the code paints, and only those', () => {
  const names = (gltf.materials ?? []).map((m) => m.name ?? '');
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would wear the coat)`);
});

test('standing, it is the old dog\'s size: feet on the floor, under 0.85 m tall, nose out front along +z', () => {
  const box = new Box3();
  nodes.forEach((n, i) => {
    if (n.mesh === undefined) return;
    for (const p of gltf.meshes[n.mesh].primitives) {
      const a = gltf.accessors[p.attributes.POSITION];
      assert.ok(a.min && a.max, 'POSITION accessors carry their min and max');
      box.union(new Box3(new Vector3().fromArray(a.min), new Vector3().fromArray(a.max)).applyMatrix4(worldMatrix(i)));
    }
  });
  assert.ok(Math.abs(box.min.y) < 0.03, `feet at y ${box.min.y.toFixed(3)}, not 0`);
  assert.ok(box.max.y > 0.5 && box.max.y < 0.85, `${box.max.y.toFixed(3)} m tall`);
  assert.ok(box.max.z > -box.min.z, `reaches ${box.max.z.toFixed(3)} forward but ${(-box.min.z).toFixed(3)} back`);
});
