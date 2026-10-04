import * as THREE from 'three';
import { Vox } from './vox';
import { treeMaterial } from './voxtrees';
import { offRoad } from './vanzones';

/** How the streets are laid out (see city.ts): roads down x = streetX + k * period, and z likewise. */
export interface Grid {
  period: number;
  road: number;
  walk: number;
  streetX: number;
  streetZ: number;
  radius: number;
}

const S = 0.2;
const fill = (v: Vox, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: string, j = 0.05) => {
  for (let i = Math.round(x0 / S); i < Math.round(x1 / S); i++)
    for (let h = Math.round(y0 / S); h < Math.round(y1 / S); h++) for (let k = Math.round(z0 / S); k < Math.round(z1 / S); k++) v.put(i, h, k, c, j);
};
const GLASS = '#26323f';
const TYRE = '#17181b';

function wheels(v: Vox, xs: number[], z: number, r: number) {
  for (const x of xs) for (const s of [-1, 1]) fill(v, x - r, 0, s > 0 ? z - 0.2 : -z, x + r, r * 2, s > 0 ? z : -z + 0.2, TYRE, 0.02);
}

/** A car in blocks, nose along +x: body, a glassed cabin with pillars, wheels, lamps. */
function car(body: string, kind: 'sedan' | 'suv' | 'taxi'): THREE.BufferGeometry {
  const v = new Vox(S, 0.05);
  const L = kind === 'suv' ? 2.4 : 2.2;
  const top = kind === 'suv' ? 1.9 : 1.6;
  fill(v, -L, 0.2, -0.9, L, 0.9, 0.9, body);
  fill(v, L - 1, 0.9, -0.9, L, 1, 0.9, body);
  const c0 = kind === 'suv' ? -L + 0.2 : -1.4;
  const c1 = kind === 'suv' ? L - 0.8 : 0.8;
  fill(v, c0, 1, -0.8, c1, top - 0.2, 0.8, GLASS, 0.02);
  for (const x of [c0, c1 - 0.2, (c0 + c1) / 2 - 0.1]) fill(v, x, 1, -0.8, x + 0.2, top - 0.2, 0.8, body);
  fill(v, c0, top - 0.2, -0.8, c1, top, 0.8, body);
  wheels(v, [-L + 0.9, L - 0.9], 0.9, 0.3);
  fill(v, L - 0.2, 0.5, -0.8, L, 0.7, -0.4, '#fff6d0', 0.02);
  fill(v, L - 0.2, 0.5, 0.4, L, 0.7, 0.8, '#fff6d0', 0.02);
  fill(v, -L, 0.5, -0.8, -L + 0.2, 0.7, -0.4, '#c9242b', 0.02);
  fill(v, -L, 0.5, 0.4, -L + 0.2, 0.7, 0.8, '#c9242b', 0.02);
  fill(v, -L, 0.2, -0.9, -L + 0.2, 0.4, 0.9, '#2a2c31');
  fill(v, L - 0.2, 0.2, -0.9, L, 0.4, 0.9, '#2a2c31');
  if (kind === 'taxi') {
    fill(v, -0.6, top, -0.4, 0.2, top + 0.2, 0.4, '#fff7d6');
    fill(v, -L, 0.5, -0.9, L, 0.7, 0.9, '#f4f4f0', 0.03);
  }
  return v.build();
}

/** A city bus: white with a blue band, a row of windows, a destination sign. */
function bus(): THREE.BufferGeometry {
  const v = new Vox(S, 0.04);
  const L = 5.4, W = 1.2;
  fill(v, -L, 0.4, -W, L, 1.2, W, '#f4f6f9');
  fill(v, -L, 0.8, -W, L, 1.2, W, '#1f5fbf');
  fill(v, -L, 1.2, -W, L, 2.4, W, GLASS, 0.02);
  for (let x = -L; x < L; x += 1.6) fill(v, x, 1.2, -W, x + 0.2, 2.4, W, '#f4f6f9');
  fill(v, -L, 2.4, -W, L, 2.8, W, '#e8ecf1');
  fill(v, L - 0.2, 2, -W + 0.2, L, 2.4, W - 0.2, '#ffb02e', 0.02);
  fill(v, -L, 0.4, -W, L, 0.6, W, '#2a2c31');
  wheels(v, [-L + 1.4, L - 1.6], W, 0.4);
  return v.build();
}

interface Veh {
  alongX: boolean;
  lane: number;
  dir: number;
  at: number;
  speed: number;
  kind: number;
  slot: number;
  stretch: number;
}

const PAINTS = ['#f2f2ee', '#f2f2ee', '#2b2d33', '#8d949c', '#d94f4f', '#2d6cdf', '#2e9e6b', '#e0a537', '#7a5cff', '#8ecae6', '#c9ced4'];

/** The traffic: voxel cars, taxis, SUVs and buses running the streets, their lamps coming on at night. */
export function buildTraffic(rnd: () => number, g: Grid): { group: THREE.Group; update(dt: number, dark: number): void } {
  const group = new THREE.Group();
  const geos: THREE.BufferGeometry[] = [];
  const stretch: number[] = [];
  PAINTS.forEach((p, i) => {
    geos.push(car(p, i % 4 === 3 ? 'suv' : 'sedan'));
    stretch.push(1);
  });
  geos.push(car('#ffd23f', 'taxi'));
  stretch.push(1);
  geos.push(bus());
  stretch.push(2.35);
  const TAXI = PAINTS.length, BUS = TAXI + 1;

  const lanes: [boolean, number][] = [];
  for (const k of [-1, 0, 1]) {
    lanes.push([true, g.streetZ + k * g.period]);
    lanes.push([false, g.streetX + k * g.period]);
  }
  const vehicles: Veh[] = [];
  const counts = geos.map(() => 0);
  for (const [alongX, line] of lanes)
    for (let k = 0; k < 9; k++) {
      const dir = k % 2 ? 1 : -1;
      const n = vehicles.length;
      const kind = n % 11 === 0 ? BUS : n % 6 === 3 ? TAXI : Math.floor(rnd() * PAINTS.length);
      vehicles.push({
        alongX,
        lane: line + dir * (g.road / 4) * (alongX ? 1 : -1),
        dir,
        at: -g.radius + rnd() * g.radius * 2,
        speed: (kind === BUS ? 7 : 9) + rnd() * 6,
        kind,
        slot: counts[kind]++,
        stretch: stretch[kind],
      });
    }
  const meshes = geos.map((geo, i) => {
    const m = new THREE.InstancedMesh(geo, treeMaterial, Math.max(1, counts[i]));
    m.count = counts[i];
    m.frustumCulled = false;
    m.castShadow = true;
    group.add(m);
    return m;
  });
  const headMat = new THREE.MeshBasicMaterial({ color: '#fff6d0' });
  const tailMat = new THREE.MeshBasicMaterial({ color: '#ff2d2d' });
  const heads = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.2, 1.4).translate(2.3, 0.6, 0), headMat, vehicles.length);
  const tails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.2, 1.4).translate(-2.3, 0.6, 0), tailMat, vehicles.length);
  for (const m of [heads, tails]) {
    m.frustumCulled = false;
    group.add(m);
  }
  const place = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const at = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const move = (dt: number) => {
    vehicles.forEach((c, i) => {
      c.at += c.dir * c.speed * dt;
      if (c.at > g.radius) c.at -= g.radius * 2;
      if (c.at < -g.radius) c.at += g.radius * 2;
      if (c.alongX) at.set(c.at, 0, c.lane);
      else at.set(c.lane, 0, c.at);
      // The nose is +x: turned to face the way it's going.
      q.setFromAxisAngle(up, c.alongX ? (c.dir > 0 ? 0 : Math.PI) : c.dir > 0 ? -Math.PI / 2 : Math.PI / 2);
      sc.setScalar(offRoad(at.x, at.z) ? 0 : 1);
      place.compose(at, q, sc);
      meshes[c.kind].setMatrixAt(c.slot, place);
      sc.x *= c.stretch;
      place.compose(at, q, sc);
      heads.setMatrixAt(i, place);
      tails.setMatrixAt(i, place);
    });
    for (const m of [...meshes, heads, tails]) m.instanceMatrix.needsUpdate = true;
  };
  move(0);
  return {
    group,
    update(dt, dark) {
      move(dt);
      headMat.color.setScalar(0.75 + 0.25 * dark);
    },
  };
}

