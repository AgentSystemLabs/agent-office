import * as THREE from 'three';
import type { Drink } from '../../../shared/rooftop';
import { mesh, toon, toonUnique } from '../toon';

// What people hold and carry (a mug of coffee, a drink, a cigarette, a box of their things), and taking
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

/** Clear glass, faintly blue; no cartoon outline, so the drink inside shows through it. */
const GLASS = new THREE.MeshBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.38, depthWrite: false });
GLASS.userData.outlineParameters = { visible: false };

/** A drink from the rooftop bar in its glass, standing on y = 0. */
export function drinkGlass(d: Drink, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const S = scale;
  const cyl = (rTop: number, rBottom: number, h: number, mat: THREE.Material, y: number, x = 0) => {
    g.add(mesh(new THREE.CylinderGeometry(rTop * S, rBottom * S, h * S, 14), mat, x * S, y * S, 0, false));
  };
  const liquid = toon(d.color);
  // A stem and a foot, for the glasses that have them.
  const stem = (h: number) => {
    cyl(0.032, 0.034, 0.006, GLASS, 0.003);
    cyl(0.005, 0.005, h, GLASS, h / 2);
  };
  switch (d.glass) {
    case 'pint':
      cyl(0.044, 0.036, 0.15, GLASS, 0.075);
      cyl(0.041, 0.034, 0.115, liquid, 0.06);
      cyl(0.043, 0.041, 0.022, toon('#fffaf0'), 0.128);
      break;
    case 'wine':
      stem(0.07);
      cyl(0.042, 0.03, 0.075, GLASS, 0.107);
      cyl(0.036, 0.028, 0.035, liquid, 0.088);
      break;
    case 'martini': {
      stem(0.075);
      cyl(0.065, 0.005, 0.07, GLASS, 0.11);
      cyl(0.052, 0.005, 0.055, liquid, 0.103);
      // An olive on a stick.
      const olive = mesh(new THREE.SphereGeometry(0.013 * S, 10, 8), toon('#7a9a3a'), 0.012 * S, 0.12 * S, 0, false);
      g.add(olive);
      const pick = mesh(new THREE.CylinderGeometry(0.002 * S, 0.002 * S, 0.09 * S, 6), toon('#c98b5a'), 0.02 * S, 0.14 * S, 0, false);
      pick.rotation.z = -0.35;
      g.add(pick);
      break;
    }
    case 'highball': {
      cyl(0.034, 0.032, 0.15, GLASS, 0.075);
      cyl(0.031, 0.029, 0.12, liquid, 0.062);
      // Ice, and a straw.
      for (const [x, y] of [
        [-0.01, 0.11],
        [0.012, 0.095],
      ]) {
        const cube = mesh(new THREE.BoxGeometry(0.02 * S, 0.02 * S, 0.02 * S), toon('#f4fbff'), x * S, y * S, 0.004 * S, false);
        cube.rotation.set(0.4, 0.6, 0.2);
        g.add(cube);
      }
      if (d.id !== 'water') {
        const straw = mesh(new THREE.CylinderGeometry(0.004 * S, 0.004 * S, 0.19 * S, 6), toon(d.id === 'maitai' ? '#ef476f' : '#06d6a0'), 0.012 * S, 0.13 * S, 0, false);
        straw.rotation.z = -0.22;
        g.add(straw);
      }
      if (d.id === 'maitai') {
        // A paper umbrella, and a wedge of pineapple on the rim.
        const umbrella = mesh(new THREE.ConeGeometry(0.035 * S, 0.018 * S, 10), toon('#ffd166'), -0.018 * S, 0.19 * S, 0, false);
        umbrella.rotation.z = 0.4;
        g.add(umbrella);
        g.add(mesh(new THREE.BoxGeometry(0.028 * S, 0.02 * S, 0.01 * S), toon('#ffd166'), 0.03 * S, 0.148 * S, 0, false));
      } else if (d.id === 'mojito') {
        for (const [x, z] of [
          [-0.012, 0.006],
          [0.006, -0.01],
          [0.01, 0.01],
        ])
          g.add(mesh(new THREE.SphereGeometry(0.009 * S, 6, 5), toon('#3f8f45'), x * S, 0.117 * S, z * S, false));
        g.add(mesh(new THREE.CylinderGeometry(0.018 * S, 0.018 * S, 0.006 * S, 10, 1, false, 0, Math.PI), toon('#9bc53d'), 0.022 * S, 0.15 * S, 0, false));
      }
      break;
    }
    case 'shot':
      cyl(0.026, 0.022, 0.06, GLASS, 0.03);
      cyl(0.023, 0.02, 0.042, liquid, 0.024);
      // A wedge of lime balanced on the rim.
      g.add(mesh(new THREE.CylinderGeometry(0.016 * S, 0.016 * S, 0.008 * S, 10, 1, false, 0, Math.PI), toon('#9bc53d'), 0.022 * S, 0.065 * S, 0, false));
      break;
  }
  return g;
}

/** Takes a glass from drinkGlass out of the hand holding it, and frees what it was made of (its materials are shared). */
export function putDownGlass(g: THREE.Group) {
  g.removeFromParent();
  g.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
}

/** A cigarette, lit end toward +z, and the material of its glowing tip. */
export function cigarette(): { group: THREE.Group; ember: THREE.MeshToonMaterial } {
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
