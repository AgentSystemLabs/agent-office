import * as THREE from 'three';
import type { DogBreed } from '../../../shared/dog';
import type { Model } from '../../world/models';

// The office cat, in blocks: a Group of named bone nodes (same names the dog's rig had, so world.ts
// moves the jaw and eyes, dresses it and picks it the same way) with a block or two on each, and
// clips made by code for each thing it does. Its materials are named for what they're painted with
// (see PAINT in world.ts).

const mat = (name: string) => {
  const m = new THREE.MeshStandardMaterial({ name, roughness: 0.9, metalness: 0 });
  m.userData.outlineParameters = { visible: false };
  return m;
};

const E = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z));

export interface Cat extends Model {
  pick: THREE.Mesh[];
  top: number;
  drop: Record<string, number>;
}

/** How each kind of cat differs: body length and width, height, and how big its tail and ears are. */
const BUILD: Record<DogBreed, { len: number; wide: number; tall: number; tail: number; ears: number }> = {
  pup: { len: 1, wide: 1, tall: 1, tail: 1, ears: 1 },
  corgi: { len: 0.95, wide: 1.1, tall: 0.95, tail: 0.9, ears: 1.15 },
  dachshund: { len: 1.2, wide: 0.9, tall: 0.9, tail: 1.1, ears: 1 },
  pug: { len: 0.9, wide: 1.25, tall: 0.95, tail: 0.8, ears: 0.9 },
  shiba: { len: 1.05, wide: 1, tall: 1.05, tail: 1.2, ears: 1 },
  pomeranian: { len: 0.95, wide: 1.15, tall: 1, tail: 1.5, ears: 1.1 },
};

export function buildCat(breed: DogBreed): Cat {
  const b = BUILD[breed] ?? BUILD.pup;
  const fur = mat('Fur');
  const light = mat('Light');
  const ear = mat('Ear');
  const ink = mat('Ink');
  const nose = mat('Nose');
  const tongue = mat('Tongue');
  const collar = mat('Collar');
  const tag = mat('Tag');
  const pick: THREE.Mesh[] = [];
  const unseen = new THREE.MeshBasicMaterial({ visible: false });

  const bone = (name: string, parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.name = name;
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const box = (parent: THREE.Object3D, m: THREE.Material, w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  const hit = (parent: THREE.Object3D, w: number, h: number, d: number, x = 0, y = 0, z = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), unseen);
    m.position.set(x, y, z);
    parent.add(m);
    pick.push(m);
  };

  const model = new THREE.Group();
  model.name = 'cat';
  const hipsY = 0.19 * b.tall;
  const hips = bone('hips', model, 0, hipsY, -0.12 * b.len);
  const spine = bone('spine', hips, 0, 0, 0.12 * b.len);
  const chest = bone('chest', spine, 0, 0, 0.12 * b.len);
  box(hips, fur, 0.13 * b.wide, 0.12, 0.17 * b.len, 0, 0, 0.02);
  box(spine, fur, 0.13 * b.wide, 0.12, 0.14 * b.len, 0, 0, 0.0);
  box(chest, fur, 0.14 * b.wide, 0.14, 0.14, 0, 0.005, 0.0);
  box(spine, light, 0.1 * b.wide, 0.03, 0.2 * b.len, 0, -0.06, 0.04);
  // Tabby stripes across the back.
  for (const z of [-0.06, 0.0, 0.06]) box(spine, ink, 0.135 * b.wide, 0.012, 0.02, 0, 0.062, z);
  hit(hips, 0.15, 0.14, 0.3 * b.len, 0, 0, 0.1);
  hit(chest, 0.16, 0.16, 0.16);
  const back = bone('socket_back', spine, 0, 0.07, 0);
  void back;

  // Neck and head.
  const neck = bone('neck', chest, 0, 0.05, 0.07);
  bone('socket_neck', neck, 0, 0, 0);
  box(neck, fur, 0.1, 0.09, 0.07, 0, 0, 0.0);
  const head = bone('head', neck, 0, 0.04, 0.05);
  box(head, fur, 0.14, 0.12, 0.12, 0, 0.01, 0.03);
  box(head, light, 0.07, 0.045, 0.04, 0, -0.03, 0.095);
  box(head, nose, 0.02, 0.014, 0.014, 0, -0.005, 0.118);
  box(head, ink, 0.006, 0.05, 0.006, -0.0, -0.037, 0.114);
  // Whiskers, thin and pale.
  for (const s of [-1, 1]) for (const y of [-0.025, -0.045]) box(head, light, 0.07, 0.003, 0.003, s * 0.08, y, 0.1);
  bone('socket_head', head, 0, 0.065, 0.02);
  bone('socket_nose', head, 0, -0.005, 0.12);
  const jaw = bone('jaw', head, 0, -0.045, 0.06);
  box(jaw, light, 0.06, 0.016, 0.06, 0, 0, 0.0);
  box(jaw, tongue, 0.03, 0.008, 0.035, 0, 0.008, 0.005);
  hit(head, 0.15, 0.14, 0.16, 0, 0, 0.04);
  for (const [s, side] of [[-1, 'L'], [1, 'R']] as const) {
    const eye = bone(`eye_${side}`, head, s * 0.04, 0.025, 0.092);
    box(eye, ink, 0.022, 0.026, 0.01);
    box(eye, mat('Shine'), 0.008, 0.008, 0.004, s * 0.003, 0.006, 0.006);
    // Pointed ears: a block, with a smaller one on top for the tip.
    const e = bone(`ear_${side}`, head, s * 0.05, 0.075, 0.015);
    box(e, fur, 0.045 * b.ears, 0.045 * b.ears, 0.025, 0, 0.012, 0);
    box(e, ear, 0.025 * b.ears, 0.026 * b.ears, 0.012, 0, 0.012, 0.007);
    const tip = bone(`ear_tip_${side}`, e, 0, 0.04 * b.ears, 0);
    box(tip, fur, 0.022 * b.ears, 0.025 * b.ears, 0.022);
    hit(e, 0.06, 0.07, 0.04, 0, 0.025, 0);
  }
  // The collar and its tag, round the neck.
  box(neck, collar, 0.115, 0.022, 0.09, 0, -0.03, -0.0);
  box(neck, tag, 0.02, 0.02, 0.008, 0, -0.058, 0.048);

  // Tail: three blocks, curled up at the end.
  const tail1 = bone('tail_1', hips, 0, 0.02, -0.1 * b.len);
  box(tail1, fur, 0.04, 0.04, 0.09 * b.tail, 0, 0, -0.04 * b.tail);
  const tail2 = bone('tail_2', tail1, 0, 0, -0.09 * b.tail);
  box(tail2, fur, 0.04, 0.04, 0.09 * b.tail, 0, 0, -0.04 * b.tail);
  box(tail2, ink, 0.042, 0.042, 0.02, 0, 0, -0.03 * b.tail);
  const tail3 = bone('tail_3', tail2, 0, 0, -0.09 * b.tail);
  box(tail3, fur, 0.04, 0.04, 0.08 * b.tail, 0, 0, -0.04 * b.tail);
  box(tail3, light, 0.042, 0.042, 0.03, 0, 0, -0.07 * b.tail);
  hit(tail1, 0.07, 0.07, 0.2 * b.tail, 0, 0, -0.1 * b.tail);
  hit(tail3, 0.07, 0.07, 0.2 * b.tail, 0, 0, -0.06 * b.tail);

  // Legs: upper, lower and a paw each, on the chest (front) and hips (back).
  for (const [s, side] of [[-1, 'L'], [1, 'R']] as const) {
    for (const [pre, parent, z, tall] of [['front', chest, 0.0, 0.1], ['back', hips, 0.0, 0.09]] as const) {
      const up = bone(`${pre}_upper_${side}`, parent, s * 0.055 * b.wide, -0.045, z);
      box(up, fur, 0.05, tall, 0.055, 0, -tall / 2 + 0.02, 0);
      const low = bone(`${pre}_lower_${side}`, up, 0, -tall + 0.02, 0);
      box(low, fur, 0.04, 0.07, 0.045, 0, -0.03, 0);
      const paw = bone(`${pre}_paw_${side}`, low, 0, -0.065, 0.005);
      box(paw, light, 0.045, 0.03, 0.065, 0, -0.005, 0.012);
      hit(up, 0.07, tall + 0.05, 0.08, 0, -tall / 2, 0);
      hit(paw, 0.06, 0.06, 0.08, 0, -0.01, 0.01);
    }
  }

  // ---- Clips ------------------------------------------------------------------------------------------
  const names: string[] = [];
  model.traverse((o) => o.name && o !== model && names.push(o.name));
  type Pose = Record<string, [number, number, number]>;
  const clip = (name: string, duration: number, pose: (t: number) => Pose, hipsDrop: (t: number) => number = () => 0) => {
    const N = 16;
    const times: number[] = [];
    const quats = new Map<string, number[]>();
    const ys: number[] = [];
    for (let k = 0; k <= N; k++) {
      const t = (k / N) * duration;
      times.push(t);
      const p = pose(t);
      for (const n of names) {
        if (n.startsWith('eye') || n === 'jaw' || n.startsWith('socket')) continue;
        const r = p[n] ?? [0, 0, 0];
        const q = E(r[0], r[1], r[2]);
        const arr = quats.get(n) ?? [];
        arr.push(q.x, q.y, q.z, q.w);
        quats.set(n, arr);
      }
      ys.push(hipsY + hipsDrop(t));
    }
    const tracks: THREE.KeyframeTrack[] = [...quats].map(([n, v]) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, v));
    tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, ys.flatMap((y) => [0, y, -0.12 * b.len])));
    return new THREE.AnimationClip(name, duration, tracks);
  };

  const sw = (t: number, d: number, ph = 0) => Math.sin(((t / d) * 2 + ph) * Math.PI);
  /** The tail curled up like a question mark, swaying a little. */
  const tailUp = (t: number, d: number, amp = 0.15, sway = 0.15): Pose => ({
    tail_1: [-0.7, sw(t, d) * sway, 0],
    tail_2: [-0.5, sw(t, d, 0.3) * amp, 0],
    tail_3: [-0.5, sw(t, d, 0.6) * amp, 0],
  });
  const gait = (t: number, d: number, amp: number): Pose => ({
    ...tailUp(t, d, 0.1, 0.1),
    front_upper_L: [sw(t, d) * amp, 0, 0],
    front_upper_R: [sw(t, d, 1) * amp, 0, 0],
    back_upper_L: [sw(t, d, 1) * amp, 0, 0],
    back_upper_R: [sw(t, d) * amp, 0, 0],
    front_lower_L: [Math.max(0, -sw(t, d)) * amp * 1.1, 0, 0],
    front_lower_R: [Math.max(0, sw(t, d)) * amp * 1.1, 0, 0],
    back_lower_L: [Math.max(0, sw(t, d)) * amp * 1.1, 0, 0],
    back_lower_R: [Math.max(0, -sw(t, d)) * amp * 1.1, 0, 0],
    spine: [sw(t, d, 0.5) * 0.04, 0, 0],
    neck: [0.1 + sw(t, d, 0.5) * 0.03, 0, 0],
  });
  /** Sitting: haunches down, front up, tail curled round. */
  const sit = (t: number): Pose => ({
    hips: [-0.75, 0, 0],
    spine: [0.45, 0, 0],
    chest: [0.15, 0, 0],
    neck: [-0.1, 0, 0],
    back_upper_L: [1.6, 0, 0.2],
    back_upper_R: [1.6, 0, -0.2],
    back_lower_L: [-1.6, 0, 0],
    back_lower_R: [-1.6, 0, 0],
    tail_1: [0.1, 0, 0],
    tail_2: [0, sw(t, 4) * 0.35 + 0.5, 0],
    tail_3: [0, sw(t, 4, 0.3) * 0.2 + 0.5, 0],
  });
  const lie = (t: number): Pose => ({
    spine: [0, 0, 0],
    front_upper_L: [-1.3, 0, 0.1],
    front_upper_R: [-1.3, 0, -0.1],
    front_lower_L: [1.6, 0, 0],
    front_lower_R: [1.6, 0, 0],
    back_upper_L: [1.2, 0, 0.5],
    back_upper_R: [1.2, 0, -0.5],
    back_lower_L: [-1.5, 0, 0],
    back_lower_R: [-1.5, 0, 0],
    tail_1: [0.2, 0.7, 0],
    tail_2: [0, 0.5 + sw(t, 5) * 0.05, 0],
    tail_3: [0, 0.5, 0],
  });
  const clips: THREE.AnimationClip[] = [
    clip('stand', 3, (t) => ({ ...tailUp(t, 3), chest: [sw(t, 3) * 0.012, 0, 0] })),
    clip('walk', 0.8, (t) => gait(t, 0.8, 0.55)),
    clip('run', 0.5, (t) => ({ ...gait(t, 0.5, 0.95), spine: [sw(t, 0.5) * 0.18, 0, 0], tail_1: [-0.3, 0, 0] }), (t) => Math.abs(sw(t, 0.5)) * 0.02),
    clip('sit', 4, sit, () => -0.075),
    clip('lie', 5, lie, () => -0.12),
    clip('nap', 5, (t) => ({ ...lie(t), neck: [0.5 + sw(t, 5) * 0.03, 0, 0], head: [0.3, 0, 0.2] }), () => -0.125),
    clip('sniff', 2, (t) => ({ ...tailUp(t, 2), neck: [0.7, 0, 0], head: [0.3 + Math.abs(sw(t, 0.5)) * 0.15, 0, 0], front_upper_L: [-0.2, 0, 0], front_upper_R: [-0.2, 0, 0] })),
    clip('bark', 1.4, (t) => ({ ...tailUp(t, 1.4, 0.2, 0.2), neck: [-0.35, 0, 0], head: [-0.15, 0, 0], chest: [-0.1, 0, 0] })),
    clip('wag', 0.9, (t) => ({ ...sit(t), tail_1: [-0.4, sw(t, 0.3) * 0.5, 0], tail_2: [-0.2, sw(t, 0.3, 0.3) * 0.4, 0], tail_3: [-0.2, sw(t, 0.3, 0.6) * 0.4, 0] }), () => -0.075),
  ];

  return {
    scene: model,
    clips,
    pick,
    top: hipsY + 0.2,
    drop: { stand: 0, walk: 0, run: 0, sit: 0.1, lie: 0.2, nap: 0.21, sniff: 0.03, bark: 0, wag: 0.1 },
  };
}
