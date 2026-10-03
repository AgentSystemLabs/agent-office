import { blockCylinder, blockBall } from '../../../world/blocky';
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash3 } from './leaves';
import { tint, type Grow } from './plants';

// The garden's ground: boulders, moss, stepping stones and the pond.

const TAU = Math.PI * 2;

function at(x: number, y: number, z: number, rotY = 0, sx = 1, sy = 1, sz = 1): THREE.Matrix4 {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(sx, sy, sz));
}

/** A rock: a roughened ball squashed to `h` high, half sunk in the ground, grey with moss on top. */
export function boulder(g: Grow, x: number, z: number, r: number, h: number, hex = '#7d807b', collide = true) {
  const geo = new THREE.IcosahedronGeometry(1, 2);
  geo.deleteAttribute('uv');
  geo.deleteAttribute('normal');
  const ball = mergeVertices(geo);
  const p = ball.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + 0.26 * (hash3(p.getX(i) * 2.1, p.getY(i) * 2.1, p.getZ(i) * 2.1) - 0.5) + 0.08 * (hash3(p.getX(i) * 7, p.getY(i) * 7, p.getZ(i) * 7) - 0.5);
    p.setXYZ(i, p.getX(i) * k, Math.max(p.getY(i) * k, -0.4), p.getZ(i) * k);
  }
  ball.computeVertexNormals();
  g.s.add('stone', ball, tint(g, hex, 0.1), at(x, h * 0.32, z, g.r() * TAU, r, h, r * (0.85 + 0.2 * g.r())), 0.12, 0, 0.75);
  if (collide) g.colliders.push({ minX: x - r * 0.85, maxX: x + r * 0.85, minZ: z - r * 0.85, maxZ: z + r * 0.85, top: h * 0.8 });
}

/** A low cushion of moss on the ground (or on a soil bed, at height `y`). */
export function moss(g: Grow, x: number, z: number, r: number, y = 0) {
  const geo = blockBall(1, 10, 5, 0, TAU, 0, Math.PI / 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 1 + 0.3 * (hash3(p.getX(i) * 3, 0, p.getZ(i) * 3) - 0.5);
    p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
  }
  geo.computeVertexNormals();
  g.s.add('moss', geo, tint(g, ['#4e8a3a', '#5a9640', '#3f7a38'][Math.floor(g.r() * 3)], 0.1), at(x, y, z, g.r() * TAU, r, 0.03 + 0.05 * g.r(), r * (0.7 + 0.3 * g.r())), 0.14);
}

/** Flat stepping stones along a winding line through `pts`. */
export function steppingStones(g: Grow, pts: [number, number][]) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
  const n = Math.round(curve.getLength() / 0.62);
  for (let i = 0; i <= n; i++) {
    const c = curve.getPoint(i / n);
    const r = 0.17 + 0.07 * g.r();
    const geo = blockCylinder(1, 1.06, 1, 8);
    g.s.add('stone', geo, tint(g, ['#8c908c', '#7d827e', '#9a9a92'][i % 3], 0.1), at(c.x + (g.r() - 0.5) * 0.12, 0.018, c.z + (g.r() - 0.5) * 0.12, g.r() * TAU, r * 1.15, 0.036, r * (0.8 + 0.2 * g.r())), 0.14, 0, 0.35);
    if (g.r() < 0.4) moss(g, c.x + (g.r() - 0.5) * 0.5, c.z + (g.r() - 0.5) * 0.5, 0.1 + 0.08 * g.r());
  }
}

/** A tiny pond: a ring of stones round dark water with lily pads and a pink lotus. Returns the water, to go in the scene as it is. */
export function pond(g: Grow, x: number, z: number, r: number): THREE.Mesh {
  g.s.add('soil', blockCylinder(r + 0.05, r + 0.05, 0.06, 24), '#232a26', at(x, 0.03, z), 0.08);
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    const rr = 0.17 + 0.07 * g.r();
    const geo = new THREE.BoxGeometry(1.5, 1.5, 1.5);
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    const s = mergeVertices(geo);
    s.computeVertexNormals();
    g.s.add('stone', s, tint(g, ['#8c908c', '#7a7f7a', '#9d9b92'][i % 3], 0.1), at(x + Math.cos(a) * (r + 0.1), 0.07, z + Math.sin(a) * (r + 0.1), g.r() * TAU, rr * 1.2, rr * 0.8, rr), 0.12, 0, 0.5);
  }
  const water = new THREE.Mesh(
    new THREE.PlaneGeometry(r * 1.8, r * 1.8).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#2f5b5a', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.9, envMapIntensity: 1.6 }),
  );
  water.position.set(x, 0.095, z);
  water.receiveShadow = true;
  for (const [dx, dz, s] of [
    [-0.25, 0.1, 0.14],
    [0.2, -0.22, 0.12],
    [0.12, 0.28, 0.1],
    [-0.1, -0.3, 0.09],
  ]) {
    const pad = new THREE.PlaneGeometry(s * 1.6, s * 1.6).rotateX(-Math.PI / 2);
    g.s.add('moss', pad, tint(g, '#3f7d3c', 0.1), at(x + dx * (r / 0.72), 0.099, z + dz * (r / 0.72), g.r() * TAU), 0.1);
  }
  return water;
}
