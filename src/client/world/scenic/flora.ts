import * as THREE from 'three';
import { mesh, toon } from '../toon';
import { G } from './kit';

// What grows along the loop (and the rocks): pines, leafy trees, palms and boulders, each standing on
// the street's level.

export const PINES = ['#2d6a4f', '#40916c', '#1b4332', '#52796f'];
export const LEAVES = ['#5fb760', '#3f8f45', '#6fcf6a', '#74a57f'];
export const AUTUMN = ['#f4a259', '#e76f51', '#e9c46a'];

/** A pine, feet at (x, z) on the street's level: three cones on a stubby trunk. */
export function pine(into: THREE.Group, x: number, z: number, s: number, color: string, turn: number) {
  const g = new THREE.Group();
  // No ends on the trunk or the cones: nobody sees under a pine.
  g.add(mesh(new THREE.CylinderGeometry(0.18, 0.26, 1.6, 6, 1, true), toon('#6f4e37'), 0, 0.8, 0));
  const leaf = toon(color);
  g.add(mesh(new THREE.ConeGeometry(1.9, 3.2, 7, 1, true), leaf, 0, 2.7, 0));
  g.add(mesh(new THREE.ConeGeometry(1.45, 2.6, 7, 1, true), leaf, 0, 4.1, 0));
  g.add(mesh(new THREE.ConeGeometry(0.95, 2.1, 7, 1, true), leaf, 0, 5.4, 0));
  g.position.set(x, G, z);
  g.rotation.y = turn;
  g.scale.set(s, s * (0.9 + (turn % 0.3)), s);
  into.add(g);
}

/** A leafy tree: a trunk and a couple of faceted blobs of leaves. */
export function leafy(into: THREE.Group, x: number, z: number, s: number, color: string, turn: number) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.28, 2.1, 6, 1, true), toon('#8a5a3b'), 0, 1.05, 0));
  const leaf = toon(color);
  g.add(mesh(new THREE.IcosahedronGeometry(1.7, 1), leaf, 0, 3.2, 0));
  g.add(mesh(new THREE.IcosahedronGeometry(1.15, 1), leaf, 0.8, 3.9, 0.35));
  g.position.set(x, G, z);
  g.rotation.y = turn;
  g.scale.setScalar(s);
  into.add(g);
}

/** A palm, leaning a little: a trunk in segments, fronds drooping all round, and coconuts. */
export function palm(into: THREE.Group, x: number, z: number, s: number, turn: number) {
  const g = new THREE.Group();
  const bark = toon('#b08968');
  let lean = 0;
  let y = 0;
  for (let i = 0; i < 6; i++) {
    const seg = mesh(new THREE.CylinderGeometry(0.15 - i * 0.008, 0.2 - i * 0.008, 1.15, 6), bark, lean, y + 0.55, 0);
    seg.rotation.z = -0.05 - i * 0.03;
    g.add(seg);
    lean += 0.08 + i * 0.045;
    y += 1.08;
  }
  const frond = toon('#52b788');
  for (let k = 0; k < 8; k++) {
    const f = new THREE.Group();
    f.position.set(lean, y + 0.05, 0);
    f.rotation.y = (k / 8) * Math.PI * 2;
    // A long leaf, widest near its stem and drooping to a point.
    const leaf = mesh(new THREE.ConeGeometry(0.42, 3, 4).rotateX(Math.PI / 2).scale(1, 0.22, 1).translate(0, 0, 1.5), frond);
    leaf.rotation.x = 0.35 + (k % 2) * 0.2;
    f.add(leaf);
    g.add(f);
  }
  for (let k = 0; k < 3; k++) g.add(mesh(new THREE.SphereGeometry(0.16, 6, 5), toon('#7f5539'), lean + Math.cos(k * 2.1) * 0.25, y - 0.15, Math.sin(k * 2.1) * 0.25));
  g.position.set(x, G, z);
  g.rotation.y = turn;
  g.scale.setScalar(s);
  into.add(g);
}

/** A boulder: a lumpy, faceted grey rock, half sunk in the ground. */
export function boulder(into: THREE.Group, x: number, z: number, r: number, turn: number, color = '#9d99a8') {
  const geo = new THREE.IcosahedronGeometry(r, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * 0.7);
  geo.computeVertexNormals();
  const m = mesh(geo, toon(color), x, G + r * 0.25, z);
  m.rotation.set(turn * 0.3, turn, turn * 0.2);
  into.add(m);
}
