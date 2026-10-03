import * as THREE from 'three';
import type { MenuItem } from '../../../shared/rooftop';
import { mesh, toon } from '../toon';

// What the rooftop café serves, as it looks in a hand: a cup, a mug, a tall glass or a plate, standing
// on y = 0 and about a hand's size.

/** Clear glass, faintly blue; no cartoon outline, so the drink inside shows through it. */
const GLASS = new THREE.MeshBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0.38, depthWrite: false });
GLASS.userData.outlineParameters = { visible: false };

const CHINA = '#fffaf3';
const BREAD = '#e3b76f';

/** A drink or a bite from the café, standing on y = 0 (`scale` makes it bigger, for a worker's small hand). */
export function serving(item: MenuItem, scale = 1): THREE.Group {
  const g = new THREE.Group();
  const S = scale;
  const cyl = (rTop: number, rBottom: number, h: number, mat: THREE.Material, y: number, x = 0, z = 0) => {
    g.add(mesh(new THREE.CylinderGeometry(rTop * S, rBottom * S, h * S, 14), mat, x * S, y * S, z * S, false));
  };
  const ball = (r: number, color: string, x: number, y: number, z: number, sy = 1) => {
    const m = mesh(new THREE.SphereGeometry(r * S, 10, 8), toon(color), x * S, y * S, z * S, false);
    m.scale.y = sy;
    g.add(m);
  };
  const liquid = toon(item.color);
  const china = toon(CHINA);
  switch (item.id) {
    case 'espresso':
    case 'cappuccino': {
      // A small cup on its saucer, with the handle on the -x side, and foam on a cappuccino.
      cyl(0.055, 0.05, 0.008, china, 0.004);
      cyl(0.038, 0.028, 0.05, china, 0.033);
      cyl(0.033, 0.033, 0.004, liquid, 0.056);
      if (item.id === 'cappuccino') cyl(0.031, 0.031, 0.008, toon('#f5ead9'), 0.058);
      g.add(mesh(new THREE.TorusGeometry(0.014 * S, 0.005 * S, 6, 12), china, -0.04 * S, 0.035 * S, 0, false));
      break;
    }
    case 'flatwhite':
    case 'blackTea':
    case 'hotChocolate': {
      // A mug, handle on the -x side.
      cyl(0.04, 0.036, 0.085, china, 0.0425);
      cyl(0.035, 0.035, 0.004, liquid, 0.08);
      g.add(mesh(new THREE.TorusGeometry(0.022 * S, 0.006 * S, 6, 12), china, -0.045 * S, 0.045 * S, 0, false));
      if (item.id === 'hotChocolate') cyl(0.03, 0.03, 0.006, toon('#f5ead9'), 0.084);
      if (item.id === 'flatwhite') cyl(0.024, 0.024, 0.005, toon('#f5ead9'), 0.0835);
      break;
    }
    case 'mintTea':
    case 'orangeJuice':
    case 'lemonade':
    case 'sparkling': {
      // A tall glass with ice, a straw and a slice on the rim; the tea has a sprig of mint.
      cyl(0.034, 0.032, 0.15, GLASS, 0.075);
      cyl(0.031, 0.029, item.id === 'mintTea' ? 0.13 : 0.115, liquid, 0.062);
      if (item.id !== 'mintTea') {
        for (const [x, y] of [
          [-0.01, 0.11],
          [0.012, 0.095],
        ]) {
          const cube = mesh(new THREE.BoxGeometry(0.02 * S, 0.02 * S, 0.02 * S), toon('#f4fbff'), x * S, y * S, 0.004 * S, false);
          cube.rotation.set(0.4, 0.6, 0.2);
          g.add(cube);
        }
        const straw = mesh(new THREE.CylinderGeometry(0.004 * S, 0.004 * S, 0.19 * S, 6), toon('#f4f1ea'), 0.012 * S, 0.13 * S, 0, false);
        straw.rotation.z = -0.22;
        g.add(straw);
        const slice = item.id === 'orangeJuice' ? '#ff9f1c' : item.id === 'lemonade' ? '#f7e26b' : '#9bc53d';
        g.add(mesh(new THREE.CylinderGeometry(0.016 * S, 0.016 * S, 0.008 * S, 10, 1, false, 0, Math.PI), toon(slice), 0.026 * S, 0.15 * S, 0, false));
      } else {
        for (const [x, z] of [
          [-0.012, 0.006],
          [0.006, -0.01],
          [0.01, 0.012],
        ])
          ball(0.012, '#3f8f45', x, 0.14, z, 0.5);
      }
      break;
    }
    default: {
      // Everything else goes on a plate.
      cyl(0.075, 0.06, 0.01, china, 0.005);
      plated(item, g, S, ball);
    }
  }
  return g;
}

/** The bite on its plate (the plate's top is at y = 0.01). */
function plated(item: MenuItem, g: THREE.Group, S: number, ball: (r: number, color: string, x: number, y: number, z: number, sy?: number) => void) {
  const gold = toon(item.color);
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const m = mesh(geo, mat, x * S, y * S, z * S, false);
    g.add(m);
    return m;
  };
  switch (item.id) {
    case 'croissant':
    case 'almondCroissant': {
      // A crescent of puffed segments, fattest in the middle.
      const n = 7;
      for (let i = 0; i < n; i++) {
        const a = ((i - (n - 1) / 2) / ((n - 1) / 2)) * 1.0;
        const r = 0.02 + 0.014 * (1 - Math.abs(a));
        const seg = add(new THREE.SphereGeometry(r * S, 10, 8), gold, Math.sin(a) * 0.05, 0.01 + r * 0.9, 0.012 - Math.cos(a) * 0.035);
        seg.scale.set(1, 0.85, 1.15);
        seg.rotation.y = a;
      }
      if (item.id === 'almondCroissant') {
        // Icing sugar on top, and flaked almonds.
        add(new THREE.CylinderGeometry(0.03 * S, 0.03 * S, 0.004 * S, 10), toon('#fffaf0'), 0, 0.058, -0.022);
        for (const [x, z] of [
          [-0.025, -0.018],
          [0.022, -0.02],
          [0, -0.032],
          [0.035, -0.002],
        ])
          add(new THREE.BoxGeometry(0.014 * S, 0.003 * S, 0.008 * S), toon('#f2dcb3'), x, 0.062, z);
      }
      break;
    }
    case 'painAuChocolat': {
      const body = add(new THREE.CapsuleGeometry(0.026 * S, 0.06 * S, 4, 10), gold, 0, 0.038, 0);
      body.rotation.z = Math.PI / 2;
      body.scale.set(1, 1, 0.85);
      add(new THREE.BoxGeometry(0.075 * S, 0.006 * S, 0.012 * S), toon('#3b2214'), 0, 0.066, 0.004);
      break;
    }
    case 'toastie': {
      // Two triangles of toasted bread, one leaning on the other, the cheese showing.
      const tri = new THREE.CylinderGeometry(0.05 * S, 0.05 * S, 0.026 * S, 3);
      add(tri, toon(BREAD), -0.012, 0.025, 0).rotation.y = Math.PI / 6;
      const upper = add(tri, toon(BREAD), 0.014, 0.043, 0.006);
      upper.rotation.y = Math.PI / 6 + 0.3;
      add(new THREE.CylinderGeometry(0.047 * S, 0.047 * S, 0.008 * S, 3), toon('#f5c542'), -0.012, 0.039, 0).rotation.y = Math.PI / 6;
      ball(0.012, '#d9372b', 0.03, 0.062, 0.012, 0.5);
      break;
    }
    case 'avocadoToast': {
      add(new THREE.BoxGeometry(0.09 * S, 0.016 * S, 0.07 * S), toon(BREAD), 0, 0.018, 0);
      add(new THREE.BoxGeometry(0.078 * S, 0.01 * S, 0.058 * S), gold, 0, 0.03, 0);
      for (const [x, z] of [
        [-0.02, 0.01],
        [0.015, -0.012],
        [0.025, 0.014],
      ])
        ball(0.008, '#d9372b', x, 0.038, z, 0.5);
      break;
    }
    case 'fruitCup': {
      // A little glass of strawberries, orange and blueberries.
      const tall = add(new THREE.CylinderGeometry(0.036 * S, 0.028 * S, 0.06 * S, 14), GLASS, 0, 0.04, 0);
      tall.castShadow = false;
      for (const [x, y, z, c] of [
        [-0.014, 0.05, 0.006, '#e5484d'],
        [0.014, 0.052, -0.006, '#ff9f1c'],
        [0, 0.07, 0.012, '#e5484d'],
        [-0.012, 0.072, -0.012, '#3a4a9f'],
        [0.016, 0.07, 0.01, '#3a4a9f'],
      ] as const)
        ball(0.013, c, x, y, z);
      break;
    }
    case 'bagel': {
      const ring = add(new THREE.TorusGeometry(0.036 * S, 0.016 * S, 8, 16), gold, 0, 0.026, 0);
      ring.rotation.x = Math.PI / 2;
      const spread = add(new THREE.TorusGeometry(0.036 * S, 0.01 * S, 6, 16), toon('#fff7ea'), 0, 0.04, 0);
      spread.rotation.x = Math.PI / 2;
      break;
    }
    case 'falafelWrap': {
      // A wrapped tortilla in paper, leaning, with salad poking out of the top.
      add(new THREE.CylinderGeometry(0.03 * S, 0.022 * S, 0.1 * S, 12), toon('#f2e3c2'), 0, 0.04, 0).rotation.z = Math.PI / 2 - 0.3;
      add(new THREE.CylinderGeometry(0.031 * S, 0.026 * S, 0.05 * S, 12), toon('#c9b99a'), -0.015, 0.037, 0).rotation.z = Math.PI / 2 - 0.3;
      ball(0.016, '#5fb760', 0.045, 0.062, 0, 0.7);
      ball(0.01, '#8a6a3a', 0.04, 0.07, 0.012);
      break;
    }
  }
}
