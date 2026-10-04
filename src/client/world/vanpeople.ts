import * as THREE from 'three';
import { Vox } from './vox';
import { line } from './vanvox';
import { treeMaterial } from './voxtrees';
import { BCPLACE, SCIENCE, STANLEY, offRoad } from './vanzones';
import type { Grid } from './vantraffic';

// The people of the city, in blocks like everyone else here: walkers with coffee and backpacks, joggers,
// dog walkers and cyclists. By day they fill the sidewalks, the Stanley Park seawall and the plazas; in
// the evening most go home and a few are left under the street lamps.

type Kind = 'walk' | 'jog' | 'dog' | 'bike';
interface Look {
  kind: Kind;
  shirt: string;
  pants: string;
  skin: string;
  hair: string;
  style: 0 | 1 | 2;
  extra: string;
  coffee: boolean;
  pack: boolean;
}

const fill = (v: Vox, i0: number, j0: number, k0: number, i1: number, j1: number, k1: number, c: string, jit = 0.05) => {
  for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) for (let k = k0; k < k1; k++) v.put(i, j, k, c, jit);
};

/** One person, facing +x, in tenth-of-a-meter blocks: shoes, legs, a shirt, arms, a head with hair. */
function person(l: Look): THREE.BufferGeometry {
  const v = new Vox(0.1, 0.05);
  const legTop = l.kind === 'bike' ? 3 : 1;
  fill(v, -1, legTop, -2, 1, 8, 0, l.pants);
  fill(v, -1, legTop, 0, 1, 8, 2, l.pants);
  if (l.kind !== 'bike') {
    fill(v, -1, 0, -2, 2, 1, 0, '#202228');
    fill(v, -1, 0, 0, 2, 1, 2, '#202228');
  } else {
    fill(v, 0, 3, -2, 2, 4, 0, '#202228');
    fill(v, 0, 3, 0, 2, 4, 2, '#202228');
  }
  fill(v, -1, 8, -3, 2, 14, 3, l.shirt);
  for (const k of [-4, 3]) {
    fill(v, -1, 10, k, 1, 14, k + 1, l.shirt);
    fill(v, -1, 9, k, 1, 10, k + 1, l.skin);
  }
  fill(v, -2, 14, -2, 3, 19, 3, l.skin);
  v.put(2, 16, -1, '#1c1c24', 0.01);
  v.put(2, 16, 1, '#1c1c24', 0.01);
  v.put(2, 14, 0, '#b86a5e', 0.02);
  // Hair: short, long, or a cap / toque / helmet.
  if (l.style === 2) {
    fill(v, -2, 18, -2, 3, 20, 3, l.extra);
    fill(v, 3, 18, -2, 4, 19, 3, l.extra);
  } else {
    fill(v, -2, 19, -2, 3, 20, 3, l.hair);
    fill(v, -2, 15, -2, -1, 19, 3, l.hair);
    fill(v, -2, 17, -2, 3, 19, -1, l.hair);
    fill(v, -2, 17, 2, 3, 19, 3, l.hair);
    fill(v, 2, 18, -2, 3, 19, 3, l.hair);
    if (l.style === 1) {
      fill(v, -3, 9, -2, -1, 19, 3, l.hair);
      fill(v, -2, 11, -3, 1, 17, -2, l.hair);
      fill(v, -2, 11, 3, 1, 17, 4, l.hair);
    }
  }
  if (l.pack) fill(v, -3, 9, -2, -1, 14, 2, l.extra);
  if (l.coffee) {
    fill(v, 1, 9, 3, 2, 11, 4, '#f1ece1', 0.02);
    v.put(1, 11, 3, '#7a4b2a', 0.02);
  }
  if (l.kind === 'jog') fill(v, -2, 17, -2, 3, 18, 3, l.extra);
  if (l.kind === 'dog') {
    const coat = l.extra;
    fill(v, 0, 3, 5, 5, 6, 7, coat);
    fill(v, 0, 1, 5, 1, 3, 6, coat);
    fill(v, 0, 1, 6, 1, 3, 7, coat);
    fill(v, 4, 1, 5, 5, 3, 6, coat);
    fill(v, 4, 1, 6, 5, 3, 7, coat);
    fill(v, 5, 5, 5, 7, 8, 7, coat);
    v.put(7, 6, 5, '#1c1c24', 0.01);
    v.put(5, 8, 5, '#6b4a2a', 0.01);
    v.put(-1, 6, 6, coat, 0.01);
    v.put(0, 8, 4, '#c0392b', 0.01);
    v.put(1, 7, 5, '#c0392b', 0.01);
    v.put(0, 9, 3, '#c0392b', 0.01);
  }
  if (l.kind === 'bike') {
    const wheel = (cx: number) => {
      for (let i = -4; i <= 4; i++)
        for (let j = -4; j <= 4; j++) {
          const d = Math.hypot(i, j);
          if (d <= 4.4 && d >= 3.2) v.put(cx + i, 4 + j, 0, '#17181b', 0.02);
        }
      v.put(cx, 4, 0, '#9aa3ad', 0.02);
    };
    wheel(-6);
    wheel(6);
    const fr = '#2b2f3a';
    line(v, [-6, 4, 0], [-1, 7, 0], fr);
    line(v, [-1, 7, 0], [5, 7, 0], fr);
    line(v, [5, 7, 0], [6, 4, 0], fr);
    line(v, [-1, 7, 0], [0, 4, 0], fr);
    fill(v, 5, 8, -2, 6, 9, 3, fr);
    fill(v, -2, 7, -1, 0, 8, 1, '#202228');
  }
  return v.build();
}

const SKIN = ['#f1c9a5', '#e0ac85', '#c68642', '#8d5524', '#f5d5b8', '#d9a577'];
const SHIRTS = ['#1f2937', '#2d6cdf', '#e5484d', '#f2f2f2', '#2f9e6b', '#f2b134', '#7a5cff', '#35b6c9', '#ff7a59', '#4b5563'];
const PANTS = ['#2a3a5a', '#1f2229', '#6b6f78', '#3b4a3a', '#c9b79c', '#111827'];
const HAIR = ['#2b1d12', '#5b3a1e', '#c9a24a', '#171717', '#8b8b8b', '#7a2d1a'];
const BRIGHT = ['#ff4d6d', '#ffd23f', '#3ddc97', '#4cc9f0', '#ff9f1c'];
const COATS = ['#d9a441', '#efe9dc', '#2a2a2e', '#a0642f'];

interface Walker {
  look: number;
  slot: number;
  thr: number;
  speed: number;
  ph: number;
  /** Sidewalk and bike lane: the street's line, which side, which way; or a loop: its centre, radii, and which way round. */
  alongX?: boolean;
  line?: number;
  off?: number;
  dir: number;
  at: number;
  cx?: number;
  cz?: number;
  a?: number;
  b?: number;
  y?: number;
}

export function buildPeople(rnd: () => number, g: Grid): { group: THREE.Group; update(t: number, dt: number, dark: number): void } {
  const group = new THREE.Group();
  const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
  const looks: Look[] = [];
  const make = (kind: Kind, n: number) => {
    for (let i = 0; i < n; i++) {
      const sporty = kind === 'jog' || kind === 'bike';
      looks.push({
        kind,
        shirt: sporty ? pick(BRIGHT) : pick(SHIRTS),
        pants: sporty ? '#1f2229' : pick(PANTS),
        skin: pick(SKIN),
        hair: pick(HAIR),
        style: kind === 'bike' ? 2 : kind === 'jog' ? (rnd() < 0.5 ? 2 : 0) : (Math.floor(rnd() * 3) as 0 | 1 | 2),
        extra: kind === 'dog' ? pick(COATS) : pick(sporty ? BRIGHT : SHIRTS),
        coffee: kind === 'walk' && rnd() < 0.4,
        pack: kind === 'walk' && rnd() < 0.4,
      });
    }
  };
  make('walk', 14);
  make('jog', 4);
  make('dog', 4);
  make('bike', 4);
  const byKind = (k: Kind) => looks.map((l, i) => (l.kind === k ? i : -1)).filter((i) => i >= 0);
  const SPEED: Record<Kind, number> = { walk: 1.4, jog: 3, dog: 1.1, bike: 5.5 };
  const counts = looks.map(() => 0);
  const walkers: Walker[] = [];
  const add = (kind: Kind, w: Omit<Walker, 'look' | 'slot' | 'thr' | 'speed' | 'ph'>) => {
    const ids = byKind(kind);
    const look = pick(ids);
    walkers.push({ ...w, look, slot: counts[look]++, thr: rnd(), speed: SPEED[kind] * (0.8 + rnd() * 0.4), ph: rnd() * 6.28 });
  };
  const P = g.radius * 0.7;
  const lanes: [boolean, number][] = [];
  for (const k of [-1, 0, 1]) {
    lanes.push([true, g.streetZ + k * g.period]);
    lanes.push([false, g.streetX + k * g.period]);
  }
  const mix: Kind[] = ['walk', 'walk', 'walk', 'walk', 'walk', 'walk', 'jog', 'dog', 'bike'];
  for (const [alongX, ln] of lanes)
    for (const side of [-1, 1])
      for (let n = 0; n < 12; n++) {
        const kind = mix[Math.floor(rnd() * mix.length)];
        const dir = rnd() < 0.5 ? 1 : -1;
        // Bikes ride the edge of the road with the traffic; everyone else the sidewalk.
        const off = kind === 'bike' ? side * (g.road / 2 - 1.1) : side * (g.road / 2 + g.walk / 2);
        add(kind, { alongX, line: ln, off, dir: kind === "bike" ? side * (alongX ? 1 : -1) : dir, at: (rnd() * 2 - 1) * P });
      }
  const ring = (cx: number, cz: number, a: number, b: number, n: number, kinds: Kind[], y = 1) => {
    for (let i = 0; i < n; i++) add(kinds[Math.floor(rnd() * kinds.length)], { cx, cz, a, b, y, dir: rnd() < 0.55 ? 1 : -1, at: rnd() * 6.28 });
  };
  const R = STANLEY.r;
  ring(STANLEY.x, STANLEY.z, R * 0.965, (R * 0.965) / 1.15, 40, ['walk', 'walk', 'walk', 'jog', 'jog', 'dog', 'bike', 'bike']);
  ring(STANLEY.x, STANLEY.z, R * 0.55, R * 0.55, 18, ['walk', 'walk', 'dog', 'jog']);
  ring(SCIENCE.x, SCIENCE.z - 5, 21, 21, 12, ['walk', 'walk', 'dog', 'jog']);
  ring(BCPLACE.x, BCPLACE.z, 40, 31, 14, ['walk', 'walk', 'jog']);

  const meshes = looks.map((l, i) => {
    const m = new THREE.InstancedMesh(person(l), treeMaterial, Math.max(1, counts[i]));
    m.count = counts[i];
    m.frustumCulled = false;
    m.castShadow = true;
    group.add(m);
    return m;
  });
  const place = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler(0, 0, 0, 'YXZ');
  const p = new THREE.Vector3();
  const sc = new THREE.Vector3();
  let clock = 0;
  const move = (dt: number, dark: number) => {
    clock += dt;
    for (const w of walkers) {
      let x: number, z: number, dx: number, dz: number;
      if (w.cx !== undefined) {
        w.at += (w.dir * w.speed * dt) / w.a!;
        x = w.cx + w.a! * Math.cos(w.at);
        z = w.cz! + w.b! * Math.sin(w.at);
        dx = -w.a! * Math.sin(w.at) * w.dir;
        dz = w.b! * Math.cos(w.at) * w.dir;
      } else {
        w.at += w.dir * w.speed * dt;
        if (w.at > g.radius * 0.7) w.at -= g.radius * 1.4;
        if (w.at < -g.radius * 0.7) w.at += g.radius * 1.4;
        x = w.alongX ? w.at : w.line! + w.off!;
        z = w.alongX ? w.line! + w.off! : w.at;
        dx = w.alongX ? w.dir : 0;
        dz = w.alongX ? 0 : w.dir;
      }
      // Evenings are quiet: the dusk sends most people home, the late few are the ones with the highest numbers.
      const hide = w.thr < dark * 0.85 || (w.cx === undefined && offRoad(x, z));
      const look = looks[w.look];
      const step = clock * w.speed * (look.kind === 'bike' ? 0 : 3.2) + w.ph;
      const bob = look.kind === 'bike' ? 0 : Math.abs(Math.sin(step)) * (look.kind === 'jog' ? 0.09 : 0.04);
      e.set(look.kind === 'bike' ? 0 : Math.sin(step) * 0.05, Math.atan2(-dz, dx), look.kind === 'jog' ? -0.14 : look.kind === 'bike' ? -0.08 : -0.02);
      q.setFromEuler(e);
      p.set(x, (w.y ?? 0) + bob, z);
      sc.setScalar(hide ? 0 : 0.88);
      place.compose(p, q, sc);
      meshes[w.look].setMatrixAt(w.slot, place);
    }
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  };
  move(0, 0);
  return { group, update: (_t, dt, dark) => move(dt, dark) };
}

