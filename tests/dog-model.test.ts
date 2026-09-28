import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { openModel } from './glb';

// dog.glb (exported by blender/scripts/build_dog.py) against what world/dog.ts counts on: the names it
// finds the model's parts by, and roughly the size and shape of the dog the office was laid out for.

const dog = openModel('dog');
const { gltf, nodes, byName } = dog;

const CLIPS = ['walk', 'run', 'stand', 'wag', 'sniff', 'sit', 'bark', 'lie', 'nap'];
const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'eye_L', 'eye_R', 'ear_L', 'ear_tip_L', 'ear_R', 'ear_tip_R',
  'tail_1', 'tail_2', 'tail_3',
  ...['front_upper', 'front_lower', 'front_paw', 'back_upper', 'back_lower', 'back_paw'].flatMap((b) => [`${b}_L`, `${b}_R`]),
];
const MATERIALS = ['Fur', 'Light', 'Ear', 'Ink', 'Shine', 'Nose', 'Tongue', 'Collar', 'Tag'];

test('it has a clip for walking, for running and for everything the dog does, by name', () => {
  const names = dog.clips();
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
    assert.equal(dog.parentName(i), want.bone, `${name} is a child of ${want.bone}`);
    const { at, turn } = dog.placed(i);
    assert.ok(at.distanceTo(new Vector3().fromArray(want.at)) < 0.05, `${name} is at ${at.toArray().map((v) => v.toFixed(3))}, not near ${want.at}`);
    assert.ok(Math.abs(turn.w) > 0.999, `${name} isn't turned in the rest pose (${turn.toArray().map((v) => v.toFixed(3))})`);
  }
});

test('its materials are the ones the code paints, and only those', () => {
  const names = dog.materials();
  for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
  for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would wear the coat)`);
});

test('standing, it is the old dog\'s size: feet on the floor, under 0.85 m tall, nose out front along +z', () => {
  const box = dog.bounds();
  assert.ok(Math.abs(box.min.y) < 0.03, `feet at y ${box.min.y.toFixed(3)}, not 0`);
  assert.ok(box.max.y > 0.5 && box.max.y < 0.85, `${box.max.y.toFixed(3)} m tall`);
  assert.ok(box.max.z > -box.min.z, `reaches ${box.max.z.toFixed(3)} forward but ${(-box.min.z).toFixed(3)} back`);
});
