import * as THREE from 'three';
import { mesh, toon, toonUnique } from '../toon';

export { serving } from './serving';

// What people hold and carry (a mug of coffee, a cigarette, a box of their things), and taking
// off what they wore.

/** A full mug of coffee standing on y = 0, with its handle on the -x side. */
export function coffeeMug(scale = 1): THREE.Group {
  const mug = new THREE.Group();
  const r = 0.05 * scale;
  const height = 0.1 * scale;
  const china = toon('#fffaf3');
  mug.add(mesh(new THREE.CylinderGeometry(r, r * 0.88, height, 16), china, 0, height / 2, 0, false));
  mug.add(mesh(new THREE.CylinderGeometry(r * 0.8, r * 0.8, height * 0.04, 16), toon('#6f4518'), 0, height, 0, false));
  mug.add(mesh(new THREE.TorusGeometry(height * 0.28, r * 0.2, 6, 12), china, -r, height / 2, 0, false));
  return mug;
}

/** Takes something from `serving` out of the hand holding it, and frees what it was made of (its materials are shared). */
export function putDownGlass(g: THREE.Group) {
  g.removeFromParent();
  g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}

/** A cigarette, lit end toward +z, and the material of its glowing tip. */
export function cigarette(): { group: THREE.Group; ember: THREE.MeshStandardMaterial } {
  const group = new THREE.Group();
  group.add(mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.12, 8).rotateX(Math.PI / 2), toon('#fffaf3'), 0, 0, 0.01, false));
  group.add(mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.045, 8).rotateX(Math.PI / 2), toon('#e9a03b'), 0, 0, -0.07, false));
  const ember = toonUnique('#ff6a2b');
  ember.emissive = new THREE.Color('#ff3b00');
  ember.emissiveIntensity = 0.3;
  group.add(mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.02, 8).rotateX(Math.PI / 2), ember, 0, 0, 0.078, false));
  return { group, ember };
}

/**
 * An open cardboard box with someone's desk things in it: a plant, a photo, a mug, a rubber duck and
 * some papers. It stands on y = 0 with its front toward +z.
 */
export function boxOfStuff(): THREE.Group {
  const g = new THREE.Group();
  const W = 0.52;
  const H = 0.26;
  const D = 0.3;
  const T = 0.02;
  const card = toon('#c8955c');
  g.add(mesh(new THREE.BoxGeometry(W, T, D), card, 0, T / 2, 0));
  for (const s of [-1, 1]) {
    g.add(mesh(new THREE.BoxGeometry(W, H, T), card, 0, H / 2, s * (D - T) / 2));
    g.add(mesh(new THREE.BoxGeometry(T, H, D - 2 * T), card, s * (W - T) / 2, H / 2, 0));
  }
  // Full to the brim.
  g.add(mesh(new THREE.BoxGeometry(W - 2 * T, 0.01, D - 2 * T), toon('#8b6a47'), 0, H * 0.7, 0, false));
  // Flaps: the front one hangs down over the front, the side ones stick up and out.
  const flapMat = toon('#b5824c');
  const front = new THREE.Group();
  front.position.set(0, H, D / 2);
  front.rotation.x = 1.2;
  front.add(mesh(new THREE.BoxGeometry(W, T, 0.14), flapMat, 0, 0, 0.07));
  g.add(front);
  for (const s of [-1, 1]) {
    const flap = new THREE.Group();
    flap.position.set((s * W) / 2, H, 0);
    flap.rotation.z = s * 0.95;
    flap.add(mesh(new THREE.BoxGeometry(0.13, T, D), flapMat, s * 0.065, 0, 0));
    g.add(flap);
  }

  // A potted plant in the back corner.
  g.add(mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.11, 10), toon('#e76f51'), -0.15, H - 0.03, -0.04, false));
  for (const [x, y, z, r, c] of [
    [-0.15, 0.1, -0.04, 0.07, '#5fb760'],
    [-0.2, 0.07, 0.0, 0.05, '#3f8f45'],
    [-0.11, 0.15, -0.07, 0.05, '#6fcf6a'],
  ] as const)
    g.add(mesh(new THREE.SphereGeometry(r, 10, 8), toon(c), x, H + y, z, false));
  // Papers sticking up at the back.
  for (const [x, rz] of [
    [-0.01, 0.16],
    [0.05, -0.1],
  ]) {
    const paper = mesh(new THREE.BoxGeometry(0.17, 0.22, 0.004), toon('#fffaf3'), x, H - 0.01, -0.1, false);
    paper.rotation.set(-0.1, 0, rz);
    g.add(paper);
  }
  // A framed photo, leaning back.
  const photo = new THREE.Group();
  photo.add(mesh(new THREE.BoxGeometry(0.16, 0.13, 0.02), toon('#2b2d42'), 0, 0, 0, false));
  photo.add(mesh(new THREE.BoxGeometry(0.12, 0.09, 0.005), toon('#8ecae6'), 0, 0, 0.011, false));
  photo.add(mesh(new THREE.SphereGeometry(0.018, 8, 6), toon('#ffd166'), 0.03, 0.02, 0.014, false));
  photo.position.set(0.1, H + 0.04, -0.05);
  photo.rotation.set(-0.3, 0, -0.12);
  g.add(photo);
  // A mug and the rubber duck, up front.
  const mug = coffeeMug(0.9);
  mug.position.set(0.0, H - 0.07, 0.07);
  g.add(mug);
  const duck = new THREE.Group();
  const duckBody = mesh(new THREE.SphereGeometry(0.05, 10, 8), toon('#ffd166'), 0, 0, 0, false);
  duckBody.scale.y = 0.8;
  duck.add(duckBody);
  duck.add(mesh(new THREE.SphereGeometry(0.032, 10, 8), toon('#ffd166'), 0, 0.055, 0.02, false));
  duck.add(mesh(new THREE.ConeGeometry(0.014, 0.03, 6).rotateX(Math.PI / 2), toon('#f4a261'), 0, 0.05, 0.06, false));
  duck.position.set(0.16, H + 0.01, 0.06);
  duck.rotation.y = -0.4;
  g.add(duck);
  return g;
}

/** Takes a costume off whatever wore it, and frees what it was made of (its materials are shared). */
export function undress(parts: THREE.Object3D[]) {
  for (const o of parts) {
    o.removeFromParent();
    o.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
  }
  parts.length = 0;
}
