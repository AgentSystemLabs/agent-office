// The dog lab, for checking dog.glb by eye (Vite dev only, it isn't built: http://localhost:5173/lab/dog.html).
// One real Dog for each thing it does, side by side, lit and outlined like the office. Query params:
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
//   t=<seconds>                 steps every dog to t at 60 fps and draws one frame, for screenshots
// Once it has drawn, window.__ready holds what it found in the model, to check against the contract.

import * as THREE from 'three';
import type { DogState } from '../../shared/dog';
import type { Theme } from '../../shared/protocol';
import { Dog } from '../world/dog';
import { loadModel } from '../world/models';
import { stage } from './stage';

const ACTS = ['stand', 'walk', 'run', 'wag', 'sniff', 'sit', 'bark', 'lie', 'nap'] as const;
type Act = (typeof ACTS)[number];
/** Every bone dog.glb should have. */
const BONES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'eye_L', 'eye_R', 'ear_L', 'ear_tip_L', 'ear_R', 'ear_tip_R',
  'tail_1', 'tail_2', 'tail_3',
  ...['front_upper', 'front_lower', 'front_paw', 'back_upper', 'back_lower', 'back_paw'].flatMap((b) => [`${b}_L`, `${b}_R`]),
];
const SOCKETS = ['socket_head', 'socket_back'];
const SPACING = 1.3;

const q = new URLSearchParams(location.search);
const coat = Number(q.get('coat') ?? 0);
const theme: Theme | null = q.get('theme') === 'halloween' || q.get('theme') === 'christmas' ? (q.get('theme') as Theme) : null;
const only = ACTS.find((a) => a === q.get('act'));
const face = q.has('face') ? Number(q.get('face')) : 0.9;
const speeds = { walk: Number(q.get('walk') ?? 1.3), run: Number(q.get('run') ?? 3.4) };
const roam = q.get('roam') === '1' && (only === 'walk' || only === 'run');
const cycle = Number(q.get('cycle') ?? 0);
const stepTo = q.has('t') ? Number(q.get('t')) : null;

// ---- Like the office (see stage.ts) ------------------------------------------------------------
const { effect, scene, camera } = stage(document.getElementById('c') as HTMLCanvasElement, q.get('floor') !== '0');
/** Where the camera looks from and at, beside wherever `at` is. */
function aim(at = new THREE.Vector3()) {
  camera.aspect = innerWidth / innerHeight;
  const tan = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // Close up on one, or far enough back to fit the whole row (and its name tags) across.
  const d = only ? 2.6 : Math.max(0.9 / tan, (ACTS.length * SPACING) / 2 / (tan * camera.aspect));
  const y = 0.5;
  camera.position.set(at.x, y + d * 0.2, at.z + d);
  camera.lookAt(at.x, y, at.z);
  camera.updateProjectionMatrix();
}
aim();
addEventListener('resize', () => aim());

// ---- The dogs -----------------------------------------------------------------------------------
const report: Record<string, unknown> = { coat, theme, cycle, roam, t: stepTo };
const done = (facts: Record<string, unknown>) => {
  Object.assign(report, facts);
  (window as unknown as { __ready: unknown }).__ready = report;
};

/** One leg of a lab dog's day: already there doing `act`, or (the walker and the runner) forever on its way. */
function legFor(act: Act, x: number): DogState {
  const at: [number, number] = [x, 0];
  if (act === 'walk' || act === 'run') {
    return { name: act, coat, speed: speeds[act], elapsed: 0, act: 'stand', path: [at, [x + Math.sin(face) * 1e4, Math.cos(face) * 1e4]] };
  }
  return { name: act, coat, speed: 0, elapsed: 0, act, path: [at], face, workerId: act === 'bark' || act === 'nap' ? 'lab' : undefined, petBy: act === 'wag' ? 'you' : undefined };
}

/** The model as it is in the file: its clips, materials, bones and sockets (a copy of its own, never shown). */
function inspect(scene: THREE.Object3D, clips: THREE.AnimationClip[]) {
  scene.updateMatrixWorld(true);
  const materials = new Set<string>();
  const rest = new THREE.Box3();
  scene.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isMesh) return;
    materials.add((m.material as THREE.Material).name);
    if (m.isSkinnedMesh) partNames.push((m.material as THREE.Material).name);
    rest.expandByObject(m, true);
  });
  const round = (a: number[]) => a.map((v) => +v.toFixed(3));
  return {
    clips: clips.map((c) => `${c.name} ${c.duration.toFixed(2)}s`),
    missingClips: ACTS.filter((a) => !clips.some((c) => c.name === a)),
    materials: [...materials],
    missingBones: BONES.filter((b) => !scene.getObjectByName(b)),
    sockets: Object.fromEntries(
      SOCKETS.map((n) => {
        const o = scene.getObjectByName(n);
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

/** The file's material for each skinned part, in the order a copy's parts traverse (the dogs' are repainted). */
const partNames: string[] = [];

const picker = new THREE.Raycaster();
picker.camera = camera;
/** A ray's first hit on a dog, past its name tag and bubbles. */
const hitOn = (dog: Dog) => picker.intersectObject(dog.root, true).find((h) => !(h.object as THREE.Sprite).isSprite);

/**
 * Where a dog's skin reaches now, in its own space (x across, y up, z forward); which parts go more
 * than a centimeter under the floor, how many vertices and how deep; and how much of it the mouse can
 * pick, as the share of rays from the camera to its skin (every fifth vertex) that hit it, with the
 * bones whose skin the misses were on.
 */
function posed(dog: Dog) {
  const inv = dog.root.matrixWorld.clone().invert();
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  const sunk: Record<string, { n: number; deepest: number[] }> = {};
  const missed: Record<string, number> = {};
  let rays = 0;
  let hits = 0;
  let part = 0;
  const round = (a: number[]) => a.map((x) => +x.toFixed(3));
  dog.root.traverse((o) => {
    const m = o as THREE.SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const name = partNames[part++] ?? `part ${part}`;
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
  return { min: round(box.min.toArray()), max: round(box.max.toArray()), sunk, pickable: +(hits / rays).toFixed(3), missed, box };
}

/** Straight down onto a dog, at a spot in its own space: how high up it's hit, or null for a miss. */
function pick(dog: Dog, x: number, z: number): number | null {
  const from = new THREE.Vector3(x, 0, z).applyMatrix4(dog.root.matrixWorld).setY(3);
  picker.set(from, new THREE.Vector3(0, -1, 0));
  const hit = hitOn(dog);
  return hit ? +hit.point.y.toFixed(3) : null;
}

try {
  const probe = await loadModel('dog');
  Object.assign(report, inspect(probe.scene, probe.clips));
  const began = performance.now();
  const sounds = { bark() {}, yip() {} };
  const first = only ? ACTS.indexOf(only) : 0;
  const dogs = (only ? [only] : ACTS).map((act: Act, i, all) => {
    const x = (i - (all.length - 1) / 2) * SPACING;
    const dog = new Dog(sounds, () => false);
    const leg = legFor(act, x);
    // Dressed and sent on its way before its model is in, like the office does on connect.
    dog.setCostume(theme);
    dog.sync(leg, performance.now());
    dog.update(0);
    scene.add(dog.root);
    return { act, x, dog, leg };
  });
  const ready = await Promise.all(dogs.map((d) => d.dog.ready));
  report.ok = ready.every(Boolean);
  report.attachMs = +((performance.now() - began) / dogs.length).toFixed(1);
  if (q.get('proxies') === '1') {
    const wire = new THREE.MeshBasicMaterial({ color: '#0077ff', wireframe: true });
    for (const d of dogs) d.dog.root.traverse((o) => ((o as THREE.Mesh).material as THREE.Material | undefined)?.visible === false && ((o as THREE.Mesh).material = wire));
  }

  let clock = 0;
  let turn = 0;
  /** Roaming: how fast each paw bone goes over the floor, frame by frame, once it's well under way. */
  const PAWS = ['front_paw_L', 'front_paw_R', 'back_paw_L', 'back_paw_R'];
  const paws = PAWS.map((name) => ({ name, bone: dogs[0].dog.root.getObjectByName(name), was: new THREE.Vector3(), speeds: [] as number[] }));
  const step = (dt: number) => {
    clock += dt;
    const next = cycle > 0 ? Math.floor(clock / cycle) : 0;
    dogs.forEach((d, i) => {
      if (next !== turn) {
        d.act = ACTS[(first + i + next) % ACTS.length];
        d.leg = legFor(d.act, d.x);
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
      out[d.act] = { ...bounds, pickMs, picks: { back: along(0.15), middle: along(0.5), front: along(0.85) } };
    }
    // Slowest it goes while it's down (the fifth percentile, so one odd frame doesn't count).
    const slip = Object.fromEntries(paws.filter((p) => p.speeds.length).map((p) => [p.name, +[...p.speeds].sort((a, b) => a - b)[Math.floor(p.speeds.length * 0.05)].toFixed(3)]));
    return { posed: out, ...(roam ? { slip } : {}) };
  };
  document.getElementById('info')!.textContent = [`coat ${coat}`, theme, cycle && `cycle ${cycle}s`, stepTo !== null && `t=${stepTo}s`]
    .filter(Boolean)
    .join('  ');

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
