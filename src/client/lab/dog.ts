// The dog lab, for checking the dog's models by eye (Vite dev only, it isn't built: http://localhost:5173/lab/dog.html).
// One real Dog for each thing it does, side by side, lit and outlined like the office. Query params:
//   breed=<breed>|all           which breed (dog-<breed>.glb, the pup by default), or a row of each, front to back
//                               (with act=, side by side)
//   coat=<n>                    which of DOG_COATS they wear
//   theme=halloween|christmas   dressed up for a holiday
//   act=<act>                   just that one, close up (stand, walk, run, wag, sniff, sit, bark, lie, nap)
//   face=<radians>              which way they face: 0 looks at the camera, the default is three-quarters
//   walk=<m/s>, run=<m/s>       how fast the walker and the runner go (the server's TROT is 1.3, RUN 3.4)
//   roam=1                      close up on the walker or runner, it really goes (the camera follows),
//                               to see its paws against the floor's grid, and __ready.slip says how fast
//                               each paw still moves when it's down (0 when they keep pace with the floor)
//   floor=0                     no floor, only its grid, to see what goes under it
//   proxies=1                   shows the capsules the mouse picks it by
//   cycle=<seconds>             each dog moves on to the next act this often, to watch the clips fade
//   swap=<breed>[,<breed>...]   once they're in, every dog turns into this breed, as a floor's dog does when
//                               someone takes the elevator to another floor, or into each in turn without
//                               waiting (riding past floors): they should end up the last; __ready.swap says
//                               how that went
//   t=<seconds>                 steps every dog to t at 60 fps and draws one frame, for screenshots
// Once it has drawn, window.__ready holds what it found in each model, to check against the contract.

import * as THREE from 'three';
import { DOG_BREEDS, dogBreed, type DogBreed, type DogState } from '../../shared/dog';
import type { Theme } from '../../shared/protocol';
import { Dog } from '../features/dog/world';
import { loadModel } from '../world/models';
import { stage } from './stage';

const ACTS = ['stand', 'walk', 'run', 'wag', 'sniff', 'sit', 'bark', 'lie', 'nap'] as const;
type Act = (typeof ACTS)[number];
/** Every bone each breed's model should have. */
const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'eye_L', 'eye_R', 'ear_L', 'ear_tip_L', 'ear_R', 'ear_tip_R',
  'tail_1', 'tail_2', 'tail_3',
  ...['front_upper', 'front_lower', 'front_paw', 'back_upper', 'back_lower', 'back_paw'].flatMap((b) => [`${b}_L`, `${b}_R`]),
];
const SOCKETS = ['socket_head', 'socket_back', 'socket_nose', 'socket_neck'];
const SPACING = 1.3;
/** How far apart the rows are, front to back, with every breed. */
const ROW = 1.6;

const q = new URLSearchParams(location.search);
const breeds: DogBreed[] = q.get('breed') === 'all' ? [...DOG_BREEDS] : [dogBreed(q.get('breed'))];
const coat = Number(q.get('coat') ?? 0);
const theme: Theme | null = q.get('theme') === 'halloween' || q.get('theme') === 'christmas' ? (q.get('theme') as Theme) : null;
const only = ACTS.find((a) => a === q.get('act'));
const face = q.has('face') ? Number(q.get('face')) : 0.9;
const speeds = { walk: Number(q.get('walk') ?? 1.3), run: Number(q.get('run') ?? 3.4) };
const roam = q.get('roam') === '1' && (only === 'walk' || only === 'run');
const cycle = Number(q.get('cycle') ?? 0);
const swaps = (q.get('swap') ?? '').split(',').filter(Boolean).map(dogBreed);
const swapTo = swaps.at(-1) ?? null;
const stepTo = q.has('t') ? Number(q.get('t')) : null;
/** How many dogs side by side, and how many rows of them: one act of every breed is one row. */
const across = only ? (breeds.length > 1 ? breeds.length : 1) : ACTS.length;
const rows = only ? 1 : breeds.length;

// ---- Like the office (see stage.ts) ------------------------------------------------------------
const { effect, renderer, scene, camera } = stage(document.getElementById('c') as HTMLCanvasElement, q.get('floor') !== '0');
/** Where the camera looks from and at, beside wherever `at` is. */
function aim(at = new THREE.Vector3()) {
  camera.aspect = innerWidth / innerHeight;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // Close up on one, or far enough back to fit the whole row (and its name tags) across; the rows behind
  // are seen over the ones in front.
  const d = across === 1 ? 2.6 : Math.max(0.9 / tan, (across * SPACING) / 2 / (tan * camera.aspect)) + (rows - 1) * ROW;
  const middle = at.clone().setZ(at.z - ((rows - 1) * ROW) / 2);
  const y = 0.5;
  const rise = rows > 1 ? 0.55 : 0.2;
  camera.position.set(middle.x, y + d * rise, middle.z + d);
  camera.lookAt(middle.x, y, middle.z);
  camera.updateProjectionMatrix();
}
aim();
addEventListener('resize', () => aim());

// ---- The dogs -----------------------------------------------------------------------------------
const report: Record<string, unknown> = { breeds, coat, theme, cycle, roam, swap: swaps, t: stepTo };
const done = (facts: Record<string, unknown>) => {
  Object.assign(report, facts);
  (window as unknown as { __ready: unknown }).__ready = report;
};

/** One leg of a lab dog's day: already there doing `act`, or (the walker and the runner) forever on its way. */
function legFor(act: Act, breed: DogBreed, x: number, z: number): DogState {
  const at: [number, number] = [x, z];
  const name = breeds.length > 1 ? `${breed} ${act}` : act;
  if (act === 'walk' || act === 'run') {
    return { name, coat, breed, speed: speeds[act], elapsed: 0, act: 'stand', path: [at, [x + Math.sin(face) * 1e4, z + Math.cos(face) * 1e4]] };
  }
  return { name, coat, breed, speed: 0, elapsed: 0, act, path: [at], face, workerId: act === 'bark' || act === 'nap' ? 'lab' : undefined, petBy: act === 'wag' ? 'you' : undefined };
}

/** Each breed's material for each skinned part, in the order a copy's parts traverse (the dogs' are repainted). */
const partNames = new Map<DogBreed, string[]>();

/** A breed's model as it is in the file: its clips, materials, bones and sockets (a copy of its own, never shown). */
async function inspect(breed: DogBreed) {
  const { scene: model, clips } = await loadModel(`dog-${breed}`);
  model.updateMatrixWorld(true);
  const materials = new Set<string>();
  const parts: string[] = [];
  const rest = new THREE.Box3();
  let tris = 0;
  model.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    materials.add((m.material as THREE.Material).name);
    if (m.isSkinnedMesh) parts.push((m.material as THREE.Material).name);
    tris += (m.geometry.index?.count ?? 0) / 3;
    rest.expandByObject(m, true);
  });
  partNames.set(breed, parts);
  const round = (a: number[]) => a.map((v) => +v.toFixed(3));
  return {
    clips: clips.map((c) => `${c.name} ${c.duration.toFixed(2)}s`),
    missingClips: ACTS.filter((a) => !clips.some((c) => c.name === a)),
    materials: [...materials],
    missingBones: BONES.filter((b) => !model.getObjectByName(b)),
    tris,
    sockets: Object.fromEntries(
      SOCKETS.map((n) => {
        const o = model.getObjectByName(n);
        if (!o) return [n, null];
        const at = new THREE.Vector3();
        const turn = new THREE.Quaternion();
        const scale = new THREE.Vector3();
        o.matrixWorld.decompose(at, turn, scale);
        return [n, { parent: o.parent?.name, at: round(at.toArray()), quat: round(turn.toArray()), scale: round(scale.toArray()) }];
      }),
    ),
    restBounds: { min: round(rest.min.toArray()), max: round(rest.max.toArray()) },
  };
}

const picker = new THREE.Raycaster();
picker.camera = camera;
/** A ray's first hit on a dog, past its name tag and bubbles. */
const hitOn = (dog: Dog) => picker.intersectObject(dog.root, true).find((h) => !(h.object as THREE.Sprite).isSprite);

/** A dog's picking capsules, as its bones carry them: [radius, length] for each bone. */
function capsules(dog: Dog) {
  const out: Record<string, number[]> = {};
  dog.root.traverse((o) => {
    const m = o as THREE.Mesh;
    const g = m.geometry as THREE.CapsuleGeometry | undefined;
    if (m.isMesh && g?.type === 'CapsuleGeometry' && m.parent) out[m.parent.name] = [+g.parameters.radius.toFixed(3), +g.parameters.height.toFixed(3)];
  });
  return out;
}

/**
 * Where a dog's skin reaches now, in its own space (x across, y up, z forward); which parts go more
 * than a centimeter under the floor, how many vertices and how deep; how much of it the mouse can
 * pick, as the share of rays from the camera to its skin (every fifth vertex) that hit it, with the
 * bones whose skin the misses were on; and how high its name tag floats.
 */
function posed(dog: Dog) {
  const inv = dog.root.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const sunk: Record<string, { n: number; deepest: number[] }> = {};
  const missed: Record<string, number> = {};
  const names = (dog.breed && partNames.get(dog.breed)) ?? [];
  let rays = 0;
  let hits = 0;
  let part = 0;
  let tag: number | null = null;
  const round = (a: number[]) => a.map((x) => +x.toFixed(3));
  dog.root.traverse((o) => {
    if ((o as THREE.Sprite).isSprite && o.userData.text === undefined) tag = +o.position.y.toFixed(3);
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const name = names[part++] ?? `part ${part}`;
    const { position, skinIndex, skinWeight } = m.geometry.attributes;
    for (let i = 0; i < position.count; i++) {
      m.getVertexPosition(i, v).applyMatrix4(m.matrixWorld);
      if (i % 5 === 0) {
        rays++;
        picker.set(camera.position, v.clone().sub(camera.position).normalize());
        if (hitOn(dog)) hits++;
        else {
          let k = 0;
          for (let c = 1; c < 4; c++) if (skinWeight.getComponent(i, c) > skinWeight.getComponent(i, k)) k = c;
          const bone = m.skeleton.bones[skinIndex.getComponent(i, k)].name;
          missed[bone] = (missed[bone] ?? 0) + 1;
        }
      }
      box.expandByPoint(v.applyMatrix4(inv));
      if (v.y < -0.01) {
        const s = (sunk[name] ??= { n: 0, deepest: [0, 0, 0] });
        s.n++;
        if (v.y < s.deepest[1]) s.deepest = round(v.toArray());
      }
    }
  });
  return { breed: dog.breed, min: round(box.min.toArray()), max: round(box.max.toArray()), tag, sunk, pickable: +(hits / rays).toFixed(3), missed, box };
}

/** Straight down onto a dog, at a spot in its own space: how high up it's hit, or null for a miss. */
function pick(dog: Dog, x: number, z: number): number | null {
  const from = new THREE.Vector3(x, 0, z).applyMatrix4(dog.root.matrixWorld).setY(3);
  picker.set(from, new THREE.Vector3(0, -1, 0));
  const hit = hitOn(dog);
  return hit ? +hit.point.y.toFixed(3) : null;
}

try {
  const models: Record<string, unknown> = {};
  for (const breed of new Set([...breeds, ...swaps])) models[breed] = await inspect(breed);
  report.models = models;
  const began = performance.now();
  const sounds = { bark() {}, yip() {} };
  const first = only ? ACTS.indexOf(only) : 0;
  const dogs = breeds.flatMap((breed, b) =>
    (only ? [only] : ACTS).map((act: Act, i) => {
      const column = only ? b : i;
      const x = (column - (across - 1) / 2) * SPACING;
      const z = only ? 0 : -b * ROW;
      const dog = new Dog(sounds, () => false);
      const leg = legFor(act, breed, x, z);
      // Dressed and sent on its way before its model is in, like the office does on connect.
      dog.setCostume(theme);
      dog.sync(leg, performance.now());
      dog.update(0);
      scene.add(dog.root);
      return { act, breed, x, z, dog, leg };
    }),
  );
  const ready = await Promise.all(dogs.map((d) => d.dog.ready));
  report.ok = ready.every(Boolean);
  report.attachMs = +((performance.now() - began) / dogs.length).toFixed(1);
  report.capsules = Object.fromEntries(breeds.map((b) => [b, capsules(dogs.find((d) => d.breed === b)!.dog)]));

  let clock = 0;
  let turn = 0;
  /** Roaming: how fast each paw bone goes over the floor, frame by frame, once it's well under way. */
  const PAWS = ['front_paw_L', 'front_paw_R', 'back_paw_L', 'back_paw_R'];
  let paws = PAWS.map((name) => ({ name, bone: dogs[0].dog.root.getObjectByName(name), was: new THREE.Vector3(), speeds: [] as number[] }));
  const step = (dt: number) => {
    clock += dt;
    const next = cycle > 0 ? Math.floor(clock / cycle) : 0;
    dogs.forEach((d, i) => {
      if (next !== turn) {
        d.act = ACTS[(first + i + next) % ACTS.length];
        d.leg = legFor(d.act, d.breed, d.x, d.z);
      }
      // The walker and the runner start their (very long) legs over every frame, so they keep on
      // the spot, or roaming, are put `clock` seconds along them.
      if (next !== turn || d.act === 'walk' || d.act === 'run') d.dog.sync(d.leg, performance.now() - (roam ? clock * 1000 : 0));
      d.dog.update(dt);
    });
    turn = next;
    if (!roam) return;
    aim(dogs[0].dog.root.position);
    dogs[0].dog.root.updateMatrixWorld(true);
    for (const p of paws) {
      if (!p.bone) continue;
      const now = p.bone.getWorldPosition(new THREE.Vector3());
      if (clock > 1) p.speeds.push(Math.hypot(now.x - p.was.x, now.z - p.was.z) / dt);
      p.was.copy(now);
    }
  };

  // Every dog turns into another breed, the way a floor's dog does when you ride to another floor: how
  // long until they all have it on, and what the renderer holds before and after (once it has drawn both).
  if (swapTo) {
    step(1 / 60);
    effect.render(scene, camera);
    const before = { ...renderer.info.memory };
    const from = performance.now();
    // Each breed's load resolves true only for the last one asked for.
    const loads = swaps.map((breed) => {
      for (const d of dogs) {
        d.breed = breed;
        d.leg = legFor(d.act, breed, d.x, d.z);
        d.dog.sync(d.leg, performance.now());
      }
      return Promise.all(dogs.map((d) => d.dog.ready));
    });
    const settled = await Promise.all(loads);
    const swapped = settled.at(-1) ?? [];
    const ms = +(performance.now() - from).toFixed(1);
    paws = PAWS.map((name) => ({ name, bone: dogs[0].dog.root.getObjectByName(name), was: new THREE.Vector3(), speeds: [] as number[] }));
    step(1 / 60);
    effect.render(scene, camera);
    report.swap = {
      to: swapTo,
      ok: swapped.every(Boolean),
      dropped: settled.slice(0, -1).map((s) => s.every((ok) => !ok)),
      ms,
      shows: [...new Set(dogs.map((d) => d.dog.breed))],
      memory: { before, after: { ...renderer.info.memory } },
    };
  }

  const facts = () => {
    scene.updateMatrixWorld(true);
    const out: Record<string, unknown> = {};
    for (const d of dogs) {
      const { box, ...bounds } = posed(d.dog);
      // Down through its middle, and near its front and back ends (the forepaws, lying down).
      const x = (box.min.x + box.max.x) / 2;
      const along = (k: number) => pick(d.dog, x, THREE.MathUtils.lerp(box.min.z, box.max.z, k));
      // What the office's crosshair pays each frame it's on the dog: a ray from the camera through its middle.
      const ndc = d.dog.root.localToWorld(new THREE.Vector3(x, (box.min.y + box.max.y) / 2, (box.min.z + box.max.z) / 2)).project(camera);
      picker.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
      const began = performance.now();
      for (let i = 0; i < 20; i++) picker.intersectObjects([d.dog.root], true);
      const pickMs = +((performance.now() - began) / 20).toFixed(2);
      out[breeds.length > 1 ? `${d.breed} ${d.act}` : d.act] = { ...bounds, pickMs, picks: { back: along(0.15), middle: along(0.5), front: along(0.85) } };
    }
    // Slowest it goes while it's down (the fifth percentile, so one odd frame doesn't count).
    const slip = Object.fromEntries(paws.filter((p) => p.speeds.length).map((p) => [p.name, +[...p.speeds].sort((a, b) => a - b)[Math.floor(p.speeds.length * 0.05)].toFixed(3)]));
    return { posed: out, draws: renderer.info.render.calls, tris: renderer.info.render.triangles, ...(roam ? { slip } : {}) };
  };
  document.getElementById('info')!.textContent = [breeds.join(' '), swapTo && `swap to ${swapTo}`, `coat ${coat}`, theme, cycle && `cycle ${cycle}s`, stepTo !== null && `t=${stepTo}s`]
    .filter(Boolean)
    .join('  ');
  if (q.get('proxies') === '1') {
    const wire = new THREE.MeshBasicMaterial({ color: '#0077ff', wireframe: true });
    for (const d of dogs) d.dog.root.traverse((o) => ((o as THREE.Mesh).material as THREE.Material | undefined)?.visible === false && ((o as THREE.Mesh).material = wire));
  }

  if (stepTo !== null) {
    for (let i = 0; i < Math.round(stepTo * 60); i++) step(1 / 60);
    effect.render(scene, camera);
    done(facts());
  } else {
    let last = performance.now();
    const frame = (now: number) => {
      step(Math.min((now - last) / 1000, 0.1));
      last = now;
      effect.render(scene, camera);
      requestAnimationFrame(frame);
    };
    frame(last);
    done(facts());
  }
} catch (err) {
  console.error(err);
  done({ ok: false, error: String(err) });
}
