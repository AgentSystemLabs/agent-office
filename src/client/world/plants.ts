import * as THREE from 'three';
import { mergeByColor, mesh, toon } from './toon';
import type { GreenKind } from '../../shared/layout';

// The indoor greenery built in code, in the office's toon style: the tall floor plants, the hanging
// baskets, the little pots on sills and shelves and the kitchen herbs. The Blender species in
// plants.glb (see office.ts) stand on the office floor too; these fill in the rest of the building
// with something green: the lounge, the meeting room, the loft, the balcony and the roof.
//
// Everything here is built from a few primitives (flat ellipsoids for leaves, thin cylinders for
// stems), merged by mergeByColor into a draw call or two per plant. The origin is on the floor (or
// the desk, or the shelf) under the middle of the pot, facing +z like every model in models.ts.

/** Earthy colors for the code-built greenery: terracotta and ceramic pots, wood and wicker. */
const C = {
  terracotta: '#c1694a',
  clay: '#a8563d',
  ceramic: '#ece4d3',
  basket: '#c19668',
  wicker: '#a97d4f',
  wood: '#b98a5e',
  woodDark: '#8a5a3b',
  soil: '#4a3728',
  bark: '#7d5c40',
  leaf: '#4f9c4f',
  leafDark: '#37743c',
  leafLight: '#7fc76a',
  leafOlive: '#6f9d4f',
  bloom: '#fffdf5',
  bloomPink: '#f0a3b8',
  bloomYellow: '#ffd166',
} as const;

const SPHERE = new THREE.SphereGeometry(0.5, 7, 5);
const CYL = new THREE.CylinderGeometry(0.5, 0.5, 1, 10);

/**
 * A flat leaf `len` long and `wide` across, growing out from (x, y, z) `dir` radians round the
 * vertical, its tip `tilt` radians above level (negative to droop).
 */
function leaf(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, dir: number, len: number, wide: number, tilt: number) {
  const m = mesh(SPHERE, mat, 0, 0, 0);
  m.scale.set(len, len * 0.11, wide);
  const c = Math.cos(tilt) * len * 0.5;
  m.position.set(x + Math.cos(dir) * c, y + Math.sin(tilt) * len * 0.5, z - Math.sin(dir) * c);
  m.rotation.y = dir;
  m.rotation.z = tilt;
  parent.add(m);
}

/** A stem from (x0, y0, z0) to (x1, y1, z1), `r` round. */
function stem(parent: THREE.Object3D, mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number) {
  const d = new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0);
  const m = mesh(CYL, mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, false);
  m.scale.set(r * 2, d.length(), r * 2);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  parent.add(m);
}

/** A tapered pot `r` round inside at its rim and `h` tall, standing on y = 0. */
function pot(r: number, h: number, color: string, opts: { rim?: boolean; saucer?: boolean; soil?: boolean } = {}): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(color);
  g.add(mesh(new THREE.CylinderGeometry(r, r * 0.78, h, 16), mat, 0, h / 2, 0));
  if (opts.rim !== false) g.add(mesh(new THREE.CylinderGeometry(r * 1.06, r * 1.06, h * 0.16, 16), mat, 0, h * 0.92, 0));
  if (opts.saucer) g.add(mesh(new THREE.CylinderGeometry(r * 1.18, r * 1.1, 0.03, 16), toon(C.clay), 0, 0.015, 0, false));
  if (opts.soil !== false) g.add(mesh(new THREE.CylinderGeometry(r * 0.92, r * 0.9, 0.04, 14), toon(C.soil), 0, h - 0.05, 0, false));
  return g;
}

/** A trailing vine from (x, y, z), wandering out `dir` and drooping under its own weight. */
function vine(parent: THREE.Object3D, x: number, y: number, z: number, dir: number, len: number, leaves = 7) {
  const leafMat = toon(C.leaf);
  const stemMat = toon(C.leafDark);
  let px = x;
  let py = y;
  let pz = z;
  const step = len / leaves;
  const dx = Math.cos(dir) * 0.6;
  const dz = -Math.sin(dir) * 0.6;
  for (let i = 0; i < leaves; i++) {
    const droop = (i + 1) / leaves;
    const nx = px + dx * step * (1 - droop * 0.5);
    const ny = py - step * (0.3 + 0.9 * droop);
    const nz = pz + dz * step * (1 - droop * 0.5);
    stem(parent, stemMat, px, py, pz, nx, ny, nz, 0.008);
    leaf(parent, leafMat, nx, ny, nz, dir + (i % 2 ? 0.9 : -0.9), step * 1.7, step * 1.3, -0.2 - 0.5 * droop);
    px = nx;
    py = ny;
    pz = nz;
  }
}

/** A hanging pot on a cord `cord` long, its origin at the hook (the ceiling or a bracket). */
export function hangingPothos(cord = 0.45): THREE.Group {
  const g = new THREE.Group();
  const potR = 0.17;
  const potH = 0.2;
  g.add(mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.025, 10), toon(C.wood), 0, -0.012, 0, false));
  g.add(mesh(new THREE.TorusGeometry(0.035, 0.011, 6, 12), toon(C.woodDark), 0, -0.04, 0, false));
  stem(g, toon(C.woodDark), 0, -0.05, 0, 0, -cord, 0, 0.012);
  const basket = pot(potR, potH, C.basket, { rim: false, soil: false });
  basket.position.y = -cord - potH;
  g.add(basket);
  g.add(mesh(new THREE.CylinderGeometry(potR * 1.05, potR * 1.05, 0.035, 14), toon(C.wicker), 0, -cord, 0, false));
  g.add(mesh(new THREE.CylinderGeometry(potR * 0.9, potR * 0.88, 0.04, 14), toon(C.soil), 0, -cord + 0.01, 0, false));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.4;
    leaf(g, toon(i % 2 ? C.leaf : C.leafDark), Math.cos(a) * potR * 0.8, -cord + 0.1, -Math.sin(a) * potR * 0.8, a, 0.15, 0.13, 0.7);
    vine(g, Math.cos(a) * potR * 0.85, -cord + 0.02, -Math.sin(a) * potR * 0.85, a, 0.5 + (i % 3) * 0.14);
  }
  return mergeByColor(g);
}

/** A little pot of trailing pothos for a shelf, its origin under the middle of the pot. */
export function trailingPothos(): THREE.Group {
  const g = new THREE.Group();
  const potR = 0.125;
  const potH = 0.15;
  g.add(pot(potR, potH, C.ceramic));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.7;
    leaf(g, toon(i % 2 ? C.leaf : C.leafLight), Math.cos(a) * potR * 0.7, potH + 0.06, -Math.sin(a) * potR * 0.7, a, 0.12, 0.11, 0.5);
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    vine(g, Math.cos(a) * potR * 0.85, potH - 0.01, -Math.sin(a) * potR * 0.85, a, 0.4 + (i % 3) * 0.15, 6);
  }
  return mergeByColor(g);
}

/** A little round-leaved plant for a table or desk, in a cream pot: about 0.25 m tall. */
export function tablePlant(): THREE.Group {
  const g = new THREE.Group();
  const potR = 0.095;
  const potH = 0.12;
  g.add(pot(potR, potH, C.ceramic));
  const stems = 7;
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + 0.2;
    const h = 0.15 + (i % 3) * 0.045;
    const r = potR * 0.55;
    stem(g, toon(C.leafDark), Math.cos(a) * r * 0.4, potH - 0.02, -Math.sin(a) * r * 0.4, Math.cos(a) * r, potH + h, -Math.sin(a) * r, 0.008);
    leaf(g, toon(i % 2 ? C.leaf : C.leafOlive), Math.cos(a) * r, potH + h, -Math.sin(a) * r, a, 0.1, 0.09, 0.35 + (i % 3) * 0.1);
  }
  return mergeByColor(g);
}

/**
 * One palm frond: a stalk arching from (x, z) at `angle`, up over `rise`, out `reach`, with
 * leaflets either side of it, longest at the base and swept toward the drooping tip.
 */
function frond(parent: THREE.Object3D, x: number, z: number, angle: number, rise: number, reach: number) {
  const leafMat = toon(C.leaf);
  const stemMat = toon(C.leafDark);
  const dirX = Math.cos(angle);
  const dirZ = -Math.sin(angle);
  const n = 7;
  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(x, rise, z),
    new THREE.Vector3(x + dirX * reach * 0.35, rise + 1.05, z + dirZ * reach * 0.35),
    new THREE.Vector3(x + dirX * reach, rise + 0.28, z + dirZ * reach),
  );
  const pts = curve.getPoints(n);
  for (let i = 1; i <= n; i++) stem(parent, stemMat, pts[i - 1].x, pts[i - 1].y, pts[i - 1].z, pts[i].x, pts[i].y, pts[i].z, 0.009);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const p = pts[i];
    const size = Math.max(0.1, reach * 0.3) * (1 - 0.35 * t);
    const tilt = 0.55 - 1.5 * t * t;
    for (const side of [-1, 1]) leaf(parent, leafMat, p.x, p.y, p.z, angle + side * (0.85 + 0.5 * t), size * 1.6, size * 0.5, tilt);
  }
}

/** A tall areca palm in a terracotta pot: thin canes, each throwing a few arched fronds. About 1.6 m. */
export function arecaPalm(): THREE.Group {
  const g = new THREE.Group();
  const potR = 0.25;
  const potH = 0.36;
  g.add(pot(potR, potH, C.terracotta, { saucer: true }));
  const caneMat = toon(C.bark);
  const canes = 7;
  for (let i = 0; i < canes; i++) {
    const a = (i / canes) * Math.PI * 2 + 0.5;
    const r = potR * 0.45;
    const top = potH + 0.3 + (i % 3) * 0.16;
    const bx = Math.cos(a) * r;
    const bz = -Math.sin(a) * r;
    const tx = bx + Math.cos(a) * 0.06;
    const tz = bz - Math.sin(a) * 0.06;
    stem(g, caneMat, bx, potH - 0.05, bz, tx, top, tz, 0.022);
    frond(g, tx, tz, a, top, 0.78 + (i % 2) * 0.18);
    if (i % 2 === 0) frond(g, tx, tz, a + 0.8, top - 0.1, 0.66);
  }
  return mergeByColor(g);
}

/** A fiddle-leaf fig: a woody trunk with big broad leaves. About 1.7 m. */
export function fiddleFig(): THREE.Group {
  const g = new THREE.Group();
  const potR = 0.25;
  const potH = 0.42;
  g.add(pot(potR, potH, C.terracotta, { saucer: true }));
  const bark = toon(C.bark);
  const top = 1.62;
  stem(g, bark, 0, potH - 0.08, 0, 0.03, top, 0.02, 0.045);
  const br = { x: Math.sin(0.35) * 0.3, y: 1.16, z: 0 };
  const bl = { x: Math.sin(-0.4) * 0.26, y: 1.36, z: 0 };
  stem(g, bark, 0, 0.95, 0, br.x, br.y, br.z, 0.028);
  stem(g, bark, 0, 1.18, 0, bl.x, bl.y, bl.z, 0.024);
  const leafMat = toon(C.leaf);
  const darkMat = toon(C.leafDark);
  // Leaves spiral up the trunk in pairs, biggest in the middle, the top ones fanning out.
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    const y = 0.62 + t * 0.98;
    const a = i * 2.4 + 0.3;
    const size = (0.32 - 0.1 * Math.abs(t - 0.35)) * (1 - 0.2 * t);
    const tilt = 0.35 - 0.65 * t;
    const r = 0.05 + 0.07 * t;
    leaf(g, i % 2 ? leafMat : darkMat, Math.cos(a) * r, y, -Math.sin(a) * r, a + 0.25, size, size * 0.55, tilt);
    leaf(g, i % 2 ? darkMat : leafMat, Math.cos(a + Math.PI) * r, y + 0.06, -Math.sin(a + Math.PI) * r, a + Math.PI - 0.25, size * 0.92, size * 0.5, tilt - 0.08);
  }
  leaf(g, leafMat, br.x, br.y, br.z, 0.35, 0.3, 0.16, 0.5);
  leaf(g, darkMat, br.x, br.y + 0.04, br.z, 0.35 + 2.6, 0.26, 0.14, 0.42);
  leaf(g, leafMat, bl.x, bl.y, bl.z, -0.4, 0.3, 0.16, 0.5);
  leaf(g, darkMat, bl.x, bl.y + 0.04, bl.z, -0.4 + 2.6, 0.26, 0.14, 0.42);
  for (let i = 0; i < 4; i++) {
    const a = i * 1.7;
    leaf(g, i % 2 ? darkMat : leafMat, Math.cos(a) * 0.04, top - 0.02, -Math.sin(a) * 0.04, a, 0.24, 0.13, 0.85);
  }
  return mergeByColor(g);
}

/** A peace lily: dark leaves on long stalks with a couple of white blooms. About 0.9 m. */
export function peaceLily(): THREE.Group {
  const g = new THREE.Group();
  const potR = 0.17;
  const potH = 0.26;
  g.add(pot(potR, potH, C.ceramic, { saucer: true }));
  const leafMat = toon(C.leafDark);
  const stemMat = toon(C.leafOlive);
  const leaves = 10;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + 0.4;
    const h = 0.42 + (i % 3) * 0.12;
    const out = 0.16 + (i % 3) * 0.06;
    const bx = Math.cos(a) * potR * 0.35;
    const bz = -Math.sin(a) * potR * 0.35;
    const tx = bx + Math.cos(a) * out;
    const tz = bz - Math.sin(a) * out;
    stem(g, stemMat, bx, potH - 0.05, bz, tx, potH + h, tz, 0.012);
    leaf(g, leafMat, tx, potH + h, tz, a, 0.24, 0.12, -0.15 + (i % 2) * 0.1);
  }
  for (const [a, h] of [
    [1.1, 0.5],
    [4.3, 0.62],
  ] as const) {
    const bx = Math.cos(a) * potR * 0.3;
    const bz = -Math.sin(a) * potR * 0.3;
    const tx = bx + Math.cos(a) * 0.1;
    const tz = bz - Math.sin(a) * 0.1;
    stem(g, stemMat, bx, potH - 0.05, bz, tx, potH + h, tz, 0.011);
    // The white spathe stands up behind the little yellow spadix.
    const spathe = mesh(SPHERE, toon(C.bloom), tx, potH + h, tz);
    spathe.scale.set(0.16, 0.11, 0.08);
    spathe.rotation.y = a;
    spathe.rotation.z = 0.5;
    g.add(spathe);
    const spadix = mesh(CYL, toon(C.bloomYellow), 0, 0, 0);
    spadix.scale.set(0.016, 0.14, 0.016);
    spadix.position.set(tx, potH + h + 0.05, tz);
    spadix.rotation.z = 0.5;
    g.add(spadix);
  }
  return mergeByColor(g);
}

/** A pot of kitchen herbs, `kind`: bushy basil or upright rosemary. About 0.35 m. */
export function herbPot(kind: 'basil' | 'rosemary'): THREE.Group {
  const g = new THREE.Group();
  const potR = 0.1;
  const potH = 0.13;
  g.add(pot(potR, potH, C.terracotta));
  const leafMat = toon(kind === 'basil' ? C.leaf : C.leafOlive);
  const stemMat = toon(C.leafDark);
  const stems = kind === 'basil' ? 6 : 5;
  for (let i = 0; i < stems; i++) {
    const a = (i / stems) * Math.PI * 2 + 0.3;
    const r = potR * (kind === 'basil' ? 0.5 : 0.4);
    const h = (kind === 'basil' ? 0.24 : 0.3) + (i % 3) * 0.05;
    const bx = Math.cos(a) * r * 0.4;
    const bz = -Math.sin(a) * r * 0.4;
    const tx = Math.cos(a) * r;
    const tz = -Math.sin(a) * r;
    stem(g, stemMat, bx, potH - 0.03, bz, tx, potH + h, tz, 0.008);
    const pairs = kind === 'basil' ? 3 : 5;
    for (let j = 0; j < pairs; j++) {
      const t = (j + 1) / (pairs + 1);
      const px = bx + (tx - bx) * t;
      const pz = bz + (tz - bz) * t;
      const py = potH + h * t;
      const size = kind === 'basil' ? 0.075 : 0.05;
      const wide = size * (kind === 'basil' ? 0.95 : 0.45);
      leaf(g, leafMat, px, py, pz, a + 0.9, size, wide, 0.3);
      leaf(g, leafMat, px, py, pz, a - 0.9, size, wide, 0.3);
    }
    leaf(g, leafMat, tx, potH + h, tz, a, kind === 'basil' ? 0.09 : 0.06, kind === 'basil' ? 0.08 : 0.03, 0.6);
  }
  return mergeByColor(g);
}

/** A wooden stool for a pot to stand on, about 0.5 m tall. */
export function plantStand(): THREE.Group {
  const g = new THREE.Group();
  const wood = toon(C.wood);
  const dark = toon(C.woodDark);
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.045, 14), wood, 0, 0.47, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.17, 0.02, 14), dark, 0, 0.44, 0, false));
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4;
    stem(g, dark, Math.cos(a) * 0.19, 0, Math.sin(a) * 0.19, Math.cos(a) * 0.1, 0.45, Math.sin(a) * 0.1, 0.02);
  }
  return mergeByColor(g);
}

/** A wicker basket planter for a floor plant, `r` round at the rim and `h` tall. */
export function basketPot(r: number, h: number): THREE.Group {
  const g = new THREE.Group();
  g.add(mesh(new THREE.CylinderGeometry(r, r * 0.82, h, 14), toon(C.basket), 0, h / 2, 0));
  g.add(mesh(new THREE.TorusGeometry(r, 0.025, 6, 18), toon(C.wicker), 0, h, 0, false));
  for (const a of [0.6, 0.6 + Math.PI]) {
    const handle = mesh(new THREE.TorusGeometry(r * 0.72, 0.018, 6, 14, Math.PI), toon(C.wicker), Math.cos(a) * r * 0.55, h * 0.75, -Math.sin(a) * r * 0.55, false);
    handle.rotation.set(Math.PI / 2, 0, a);
    g.add(handle);
  }
  g.add(mesh(new THREE.CylinderGeometry(r * 0.9, r * 0.88, 0.05, 14), toon(C.soil), 0, h - 0.05, 0, false));
  return mergeByColor(g);
}

/**
 * A wooden window box `w` wide, planted with low greenery and a few little flowers, for a railing
 * or a sill: its origin on the surface it stands on, its long side across x.
 */
export function windowBox(w: number): THREE.Group {
  const g = new THREE.Group();
  const d = 0.24;
  const h = 0.2;
  g.add(mesh(new THREE.BoxGeometry(w, h, d), toon(C.wood), 0, h / 2, 0));
  g.add(mesh(new THREE.BoxGeometry(w * 1.04, 0.04, d * 1.06), toon(C.woodDark), 0, h - 0.02, 0, false));
  g.add(mesh(new THREE.BoxGeometry(w * 0.92, 0.03, d * 0.86), toon(C.soil), 0, h - 0.005, 0, false));
  const leafMat = toon(C.leaf);
  const darkMat = toon(C.leafDark);
  const blooms = [toon(C.bloomPink), toon(C.bloomYellow), toon(C.bloom)];
  const n = Math.max(3, Math.round(w / 0.22));
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (i + 0.5) * (w / n);
    const mat = i % 2 ? leafMat : darkMat;
    const size = 0.09 + (i % 3) * 0.02;
    for (let j = 0; j < 5; j++) {
      const a = (j / 5) * Math.PI * 2;
      leaf(g, mat, x, h + 0.02, 0, a, size * 1.3, size * 0.8, 0.5 + (j % 2) * 0.4);
    }
    if (i % 2 === 0) {
      const bloom = mesh(SPHERE, blooms[(i / 2) % 3], x, h + 0.14, 0);
      bloom.scale.set(0.05, 0.04, 0.05);
      g.add(bloom);
    }
  }
  return mergeByColor(g);
}

/**
 * A potted trailing plant for a windowsill, about 0.3 m tall with the vines hanging. It is built
 * with its +z facing the room (the office turns it onto its wall), and its vines all trail that way
 * and to the sides, never back into the wall it stands against.
 */
export function sillPothos(): THREE.Group {
  const g = new THREE.Group();
  const potR = 0.11;
  const potH = 0.13;
  g.add(pot(potR, potH, C.terracotta, { saucer: true }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.5;
    leaf(g, toon(i % 2 ? C.leaf : C.leafLight), Math.cos(a) * potR * 0.7, potH + 0.05, -Math.sin(a) * potR * 0.7, a, 0.11, 0.1, 0.45);
  }
  for (let i = 0; i < 4; i++) {
    const a = -Math.PI / 2 + [-1.15, -0.4, 0.4, 1.15][i];
    vine(g, Math.cos(a) * potR * 0.8, potH - 0.01, -Math.sin(a) * potR * 0.8, a, 0.32 + (i % 2) * 0.12, 5);
  }
  return mergeByColor(g);
}

/** One of the code-built species, built and `scale` times its modelled size. */
export function greenPlant(kind: GreenKind, scale = 1): THREE.Group {
  const built = kind === 'areca_palm' ? arecaPalm() : kind === 'fiddle_fig' ? fiddleFig() : peaceLily();
  built.scale.setScalar(scale);
  return built;
}
