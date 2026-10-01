import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { DOG_BREEDS, dogBreed, dogDefaults, type DogBreed } from '../src/shared/dog.js';
import { openModel } from './glb';

// Each breed's dog-<breed>.glb (exported by blender/scripts/build_dog.py) against what features/dog/world.ts counts
// on: the names it finds the model's parts by, the same for every breed, and roughly the size and shape of
// dog the office was laid out for.

const CLIPS = ['walk', 'run', 'stand', 'wag', 'sniff', 'sit', 'bark', 'lie', 'nap'];
const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'eye_L', 'eye_R', 'ear_L', 'ear_tip_L', 'ear_R', 'ear_tip_R',
  'tail_1', 'tail_2', 'tail_3',
  ...['front_upper', 'front_lower', 'front_paw', 'back_upper', 'back_lower', 'back_paw'].flatMap((b) => [`${b}_L`, `${b}_R`]),
];
const MATERIALS = ['Fur', 'Light', 'Ear', 'Ink', 'Shine', 'Nose', 'Tongue', 'Collar', 'Tag'];
const SOCKETS = { socket_head: 'head', socket_back: 'spine', socket_nose: 'head', socket_neck: 'neck' };

const models = Object.fromEntries(DOG_BREEDS.map((b) => [b, openModel(`dog-${b}`)])) as Record<DogBreed, ReturnType<typeof openModel>>;

for (const breed of DOG_BREEDS) {
  const dog = models[breed];
  const { gltf, nodes, byName } = dog;
  const at = (name: string) => dog.placed(byName(name)).at;

  test(`${breed}: a clip for walking, for running and for everything the dog does, by name`, () => {
    const names = dog.clips();
    for (const c of CLIPS) assert.ok(names.includes(c), `a clip called ${c} (found ${names.join(', ')})`);
  });

  test(`${breed}: one skeleton with every bone the code and the clips know, named with underscores`, () => {
    assert.equal(gltf.skins?.length, 1, 'one armature');
    const joints = (gltf.skins?.[0]?.joints ?? []).map((j) => nodes[j].name);
    for (const b of BONES) assert.ok(joints.includes(b), `a bone called ${b}`);
    assert.equal(BONES.length, 28);
  });

  test(`${breed}: the costume sockets sit on their bones, turned like the dog, where the costumes go`, () => {
    for (const [name, bone] of Object.entries(SOCKETS)) {
      const i = byName(name);
      assert.ok(i >= 0, `a node called ${name}`);
      assert.equal(dog.parentName(i), bone, `${name} is a child of ${bone}`);
      const { turn } = dog.placed(i);
      assert.ok(Math.abs(turn.w) > 0.999, `${name} isn't turned in the rest pose (${turn.toArray().map((v) => v.toFixed(3))})`);
    }
    const box = dog.bounds();
    // The nose out at the front, the collar behind and below the head, the wings' spot on the back behind that.
    assert.ok(box.max.z - at('socket_nose').z < 0.05, `the nose socket is at the front (${at('socket_nose').z.toFixed(3)} of ${box.max.z.toFixed(3)})`);
    assert.ok(at('socket_head').z < at('socket_nose').z, 'the head socket is behind the nose');
    assert.ok(at('socket_neck').z < at('socket_head').z && at('socket_neck').y < at('socket_head').y, 'the collar is behind and below the head');
    assert.ok(at('socket_back').z < at('socket_neck').z, 'the back socket is behind the collar');
    // The hat and antlers are tuned to sit 15 cm over socket_head: that's the crown, under the top of the dog.
    assert.ok(at('socket_head').y + 0.15 <= box.max.y + 0.01, 'the crown is under the top of the dog');
  });

  test(`${breed}: its materials are the ones the code paints, and only those`, () => {
    const names = dog.materials();
    for (const m of MATERIALS) assert.ok(names.includes(m), `a material called ${m}`);
    for (const m of names) assert.ok(MATERIALS.includes(m), `${m} isn't a material the code knows (it would wear the coat)`);
  });

  test(`${breed}: standing, feet on the floor, under 0.85 m tall, nose out front along +z, a creature's budget`, () => {
    const box = dog.bounds();
    assert.ok(Math.abs(box.min.y) < 0.03, `feet at y ${box.min.y.toFixed(3)}, not 0`);
    assert.ok(box.max.y > 0.45 && box.max.y < 0.85, `${box.max.y.toFixed(3)} m tall`);
    assert.ok(box.max.z > -box.min.z, `reaches ${box.max.z.toFixed(3)} forward but ${(-box.min.z).toFixed(3)} back`);
    assert.ok(dog.triangles() < 12_000, `${dog.triangles()} triangles`);
  });
}

test("the pup's costume sockets are where the costumes were first tuned for", () => {
  const dog = models.pup;
  const want = { socket_head: [0, 0.56, 0.29], socket_back: [0, 0.3, -0.17] };
  for (const [name, spot] of Object.entries(want)) {
    const at = dog.placed(dog.byName(name)).at;
    assert.ok(at.distanceTo(new Vector3().fromArray(spot)) < 0.01, `${name} is at ${at.toArray().map((v) => v.toFixed(3))}, not ${spot}`);
  }
});

test('the breeds are built as they should be: a corgi and a dachshund low, a dachshund the longest, a pug the shortest', () => {
  const size = (b: DogBreed) => models[b].bounds();
  const pup = size('pup');
  for (const low of ['corgi', 'dachshund'] as const) {
    const box = size(low);
    // Ears aside: the top of its back, where the socket for wings is.
    const back = models[low].placed(models[low].byName('socket_back')).at.y;
    assert.ok(back < models.pup.placed(models.pup.byName('socket_back')).at.y - 0.05, `a ${low}'s back is well under the pup's`);
    assert.ok(box.max.z - box.min.z > pup.max.z - pup.min.z, `a ${low} is longer than the pup`);
  }
  const length = (b: DogBreed) => size(b).max.z - size(b).min.z;
  for (const b of DOG_BREEDS) if (b !== 'dachshund') assert.ok(length('dachshund') > length(b), `a dachshund is longer than a ${b}`);
  for (const b of DOG_BREEDS) if (b !== 'pug') assert.ok(length('pug') < length(b), `a pug is shorter than a ${b}`);
});

test("a floor's dog keeps its name and coat, and gets a breed, from its id", () => {
  // Floors called much alike, as a repo cloned twice is ("app", "app-2", ...).
  const seen = new Set<DogBreed>();
  const pancakes = new Set<DogBreed>();
  for (let i = 0; i < 200; i++) {
    const d = dogDefaults(`floor-${i}`);
    assert.equal(dogDefaults(`floor-${i}`).breed, d.breed, 'the same breed every time');
    seen.add(d.breed);
    if (d.name === 'Pancake') pancakes.add(d.breed);
  }
  assert.equal(seen.size, DOG_BREEDS.length, 'every breed turns up');
  assert.ok(pancakes.size > 1, "a dog's breed doesn't go with its name");
  // What these floors were called and wore before there were breeds.
  assert.deepEqual({ ...dogDefaults('main'), breed: undefined }, { name: 'Pancake', coat: 5, breed: undefined });
  assert.equal(dogBreed(undefined), 'pup', 'an office that sends no breed has the pup');
  assert.equal(dogBreed('wolf'), 'pup', "a breed this page doesn't know is the pup");
  assert.equal(dogBreed('corgi'), 'corgi');
});
