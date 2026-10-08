import * as THREE from 'three';
import { BALCONY, EXIT_STAIRS, SLAB, STREET_Y } from '../../../shared/layout';
import { bulb, type NightParts } from '../outside';
import { mergeByMaterial, mesh, textPlane, toon } from '../toon';
import type { Collider, Interactable } from '../types';
import type { Fixture } from './fixture';
import { PALETTE, box, glassPane } from './materials';
import { floorPlant, plant } from './props';
import { seatable } from './seats';
import { VoxelFurniture } from './voxel-furniture';

// Outside the office's walls: the balcony off the south wall, the posts under the bottom
// floor's, and the steps from the exit door down to the street. The balcony is a pastel voxel
// terrace: checkered tiles, a candy-striped rail, bunting, a parasol and window boxes.

/** The terrace's paints: soft pastels, with a dusty plum where something used to be black. */
const C = {
  pink: '#f6c1d1',
  rose: '#ef9fb5',
  peach: '#fbd3b8',
  butter: '#fbe9a8',
  mint: '#c3ead4',
  sky: '#b9dcf4',
  lav: '#d5c8ee',
  cream: '#fff5e4',
  plum: '#a99bc4',
  leaf: '#86cc98',
  leafDk: '#62b180',
  soil: '#9a7560',
};
const CANDY = [C.mint, C.lav, C.pink, C.sky, C.butter];
const FLOWERS = [C.pink, C.butter, C.lav, C.cream, C.peach, C.sky];

/** A tiny steady hash, so the same tile is always the same color. */
const hash = (a: number, b: number) => {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
};

/** A row of little blossoms on stems, `n` of them along x from `x0`, standing on y. */
function flowerRow(v: VoxelFurniture, x0: number, y: number, z: number, n: number, gap: number, seed: number) {
  for (let i = 0; i < n; i++) {
    const x = x0 + i * gap;
    const h = 0.12 + hash(i, seed) * 0.12;
    const color = FLOWERS[Math.floor(hash(i + 3, seed + 7) * FLOWERS.length)];
    v.add(C.leafDk, 0.03, h, 0.03, x, y + h / 2, z, false, 0.015);
    v.add(C.leaf, 0.09, 0.03, 0.05, x + 0.05, y + h * 0.4, z, false, 0.015);
    v.add(C.butter, 0.05, 0.05, 0.05, x, y + h + 0.025, z, false, 0.025);
    for (const [dx, dz] of [[0.055, 0], [-0.055, 0], [0, 0.055], [0, -0.055]]) v.add(color, 0.055, 0.045, 0.055, x + dx, y + h + 0.02, z + dz, false, 0.0275);
  }
}

/**
 * A string of party bulbs from `a` to `b`, in `bulbs` (one per color), hung as a chain of little
 * cubes; with `flags`, a stepped pennant hangs between every two bulbs. The bulbs light up at night.
 */
function stringLights(a: THREE.Vector3, b: THREE.Vector3, sag: number, bulbs: [string, THREE.Material][], night: NightParts, flags?: VoxelFurniture): THREE.Group {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y -= sag * 2;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const g = new THREE.Group();
  const wire = toon(C.plum);
  const links = Math.round(curve.getLength() / 0.05);
  for (let i = 0; i <= links; i++) {
    const p = curve.getPoint(i / links);
    g.add(mesh(new THREE.BoxGeometry(0.035, 0.035, 0.035), wire, p.x, p.y, p.z, false));
  }
  const n = Math.max(2, Math.round(curve.getLength() / 0.5));
  for (let i = 1; i < n; i++) {
    const p = curve.getPoint(i / n);
    const [color, mat] = bulbs[i % bulbs.length];
    g.add(mesh(new THREE.BoxGeometry(0.08, 0.1, 0.08), mat, p.x, p.y - 0.07, p.z, false));
    night.halos.push({ at: new THREE.Vector3(p.x, p.y - 0.07, p.z), size: 0.55, color });
  }
  if (flags) {
    for (let i = 0; i < n; i++) {
      const p = curve.getPoint((i + 0.5) / n);
      const color = [C.pink, C.butter, C.mint, C.sky, C.lav, C.peach][i % 6];
      for (const [k, w] of [0.26, 0.2, 0.14, 0.08, 0.04].entries()) flags.add(color, w, 0.05, 0.025, p.x, p.y - 0.06 - k * 0.05, p.z, false, 0.025);
    }
  }
  return mergeByMaterial(g);
}

/** A square-sided tapered lamp on a post: a cube that glows at night, in a cap and a base. */
function lantern(v: VoxelFurniture, parts: THREE.Group, night: NightParts, x: number, y: number, z: number) {
  parts.add(mesh(new THREE.BoxGeometry(0.2, 0.22, 0.2), bulb(night, '#ffe9a8', 0.55), x, y + 0.14, z, false));
  v.add(C.butter, 0.28, 0.06, 0.28, x, y + 0.28, z, false, 0.035);
  v.add(C.butter, 0.18, 0.05, 0.18, x, y + 0.33, z, false, 0.03);
  v.add(C.butter, 0.07, 0.05, 0.07, x, y + 0.38, z, false, 0.025);
  v.add(C.butter, 0.26, 0.05, 0.26, x, y + 0.005, z, false, 0.035);
}

/**
 * The balcony off the south wall, over the garage entrance: a deck of pastel tiles with a candy
 * rail and glass on its three open sides, bunting and string lights, a bench under the window, a
 * bistro table under a parasol on a round rug, window boxes and plants.
 */
export function buildBalcony(group: THREE.Group, colliders: Collider[], interactables: Interactable[], night: NightParts) {
  const { minX, maxX, minZ, maxZ } = BALCONY;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // The voxel pieces that don't move go in `vox` (one mesh per color); the flat ones in `parts`, merged at the end.
  const vox = new VoxelFurniture();
  const parts = new THREE.Group();

  // The slab: a lavender block with a peach lip round its open edges and a scalloped fringe under the front.
  vox.add('#e6dcf5', w, SLAB - 0.05, d, cx, -SLAB / 2 - 0.02, cz, false, 0.2);
  vox.add(C.peach, w + 0.1, 0.22, 0.1, cx, -0.09, maxZ + 0.03, false, 0.05);
  for (const sx of [minX - 0.03, maxX + 0.03]) vox.add(C.peach, 0.1, 0.22, d, sx, -0.09, cz, false, 0.05);
  const teeth = Math.round(w / 0.4);
  for (let i = 0; i < teeth; i++) {
    const x = minX + (i + 0.5) * (w / teeth);
    vox.add(i % 2 ? C.pink : C.lav, w / teeth - 0.04, 0.1, 0.08, x, -0.25, maxZ + 0.03, false, 0.04);
  }

  // The deck: checkered tiles with a peach border and now and then a butter or sky one, grouted by the slab showing through.
  const nx = Math.round(w / 0.5);
  const nz = Math.round(d / 0.5);
  const tw = w / nx;
  const td = d / nz;
  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < nz; j++) {
      const border = i === 0 || i === nx - 1 || j === nz - 1;
      const r = hash(i, j);
      const color = border ? C.peach : r > 0.93 ? C.butter : r > 0.86 ? C.sky : (i + j) % 2 ? C.mint : C.cream;
      vox.add(color, tw - 0.02, 0.05, td - 0.02, minX + (i + 0.5) * tw, -0.023, minZ + (j + 0.5) * td, false, 0.125);
    }
  }
  colliders.push({ minX, maxX, minZ, maxZ, bottom: -SLAB, top: 0 });

  // The railing: pastel posts with cream caps, a candy-striped top rail, a kick rail and glass between, on the three open sides.
  const railH = 1.05;
  const inset = 0.06;
  const sides: [number, number, number, number][] = [
    [minX + inset, maxZ - inset, maxX - inset, maxZ - inset],
    [minX + inset, minZ, minX + inset, maxZ - inset],
    [maxX - inset, minZ, maxX - inset, maxZ - inset],
  ];
  for (const [x0, z0, x1, z1] of sides) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const alongX = z0 === z1;
    const n = Math.ceil(len / 1.6);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      vox.add(C.pink, 0.1, railH, 0.1, px, railH / 2, pz, false, 0.05);
      vox.add(C.cream, 0.17, 0.07, 0.17, px, railH + 0.085, pz, false, 0.035);
      vox.add(C.rose, 0.13, 0.05, 0.13, px, 0.025, pz, false, 0.05);
    }
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const px = x0 + (x1 - x0) * t;
      const pz = z0 + (z1 - z0) * t;
      const seg = len / n;
      vox.add(CANDY[(i + (alongX ? 0 : 2)) % CANDY.length], alongX ? seg : 0.14, 0.1, alongX ? 0.14 : seg, px, railH + 0.04, pz, false, 0.05);
      vox.add(C.peach, alongX ? seg : 0.1, 0.09, alongX ? 0.1 : seg, px, 0.045, pz, false, 0.045);
      const pane = glassPane(seg - 0.12, railH - 0.2);
      pane.position.set(px, (railH - 0.2) / 2 + 0.1, pz);
      pane.rotation.y = alongX ? 0 : Math.PI / 2;
      parts.add(pane);
    }
    colliders.push({ minX: Math.min(x0, x1) - 0.05, maxX: Math.max(x0, x1) + 0.05, minZ: Math.min(z0, z1) - 0.05, maxZ: Math.max(z0, z1) + 0.05, bottom: -SLAB, top: 99 });
  }

  // Lamp posts on the outer corners, with bunting and string lights to them from the wall and between them.
  const poleH = 2.7;
  const sw = new THREE.Vector3(minX + inset, poleH, maxZ - inset);
  const se = new THREE.Vector3(maxX - inset, poleH, maxZ - inset);
  for (const p of [sw, se]) {
    vox.add(C.butter, 0.08, poleH - railH, 0.08, p.x, (poleH + railH) / 2, p.z, false, 0.04);
    lantern(vox, parts, night, p.x, poleH, p.z);
  }
  const bulbs = ['#ffd166', '#ff8fa3', '#8ecae6', '#caffbf'].map((c): [string, THREE.Material] => [c, bulb(night, c, 0.4)]);
  parts.add(stringLights(sw, se, 0.35, bulbs, night, vox));
  parts.add(stringLights(sw, new THREE.Vector3(-6.5, 3.5, minZ + 0.02), 0.3, bulbs, night));
  parts.add(stringLights(new THREE.Vector3(-6.5, 3.5, minZ + 0.02), se, 0.35, bulbs, night));
  // At night they light the deck, the table and whoever's out there.
  for (const x of [cx - 3.2, cx + 3.2]) night.lamps.push({ x, y: 2.4, z: cz, reach: 5.5, color: '#ffc9a6', power: 2.4 });

  // Window boxes hung on the outside of the front rail, full of blossoms.
  for (const [i, bx] of [minX + 2.3, cx, maxX - 2.3].entries()) {
    const bz = maxZ + 0.07;
    vox.add(C.peach, 1.1, 0.22, 0.22, bx, 0.62, bz, false, 0.055);
    vox.add(C.lav, 1.16, 0.05, 0.27, bx, 0.74, bz, false, 0.05);
    vox.add(C.soil, 1.0, 0.03, 0.16, bx, 0.76, bz, false, 0.04);
    for (const sx of [-0.4, 0.4]) vox.add(C.pink, 0.06, 0.2, 0.08, bx + sx, 0.84 - 0.2, maxZ - 0.01, false, 0.03);
    flowerRow(vox, bx - 0.45, 0.77, bz, 7, 0.15, i * 11 + 1);
  }

  // A welcome mat at the door and a round, stepped rug under the table.
  vox.add(C.lav, 1.3, 0.02, 0.65, -4, 0.012, minZ + 0.6, false, 0.065);
  vox.add(C.cream, 1.0, 0.025, 0.4, -4, 0.014, minZ + 0.6, false, 0.05);
  vox.add(C.rose, 0.7, 0.03, 0.15, -4, 0.016, minZ + 0.6, false, 0.05);
  const tx = 0.2;
  const tz = cz + 0.2;
  vox.add(C.lav, 2.5, 0.02, 2.3, tx, 0.012, tz, true, 0.1);
  vox.add(C.cream, 2.0, 0.025, 1.8, tx, 0.014, tz, true, 0.1);
  vox.add(C.pink, 1.4, 0.03, 1.2, tx, 0.016, tz, true, 0.1);

  // A bench under the window: sky-blue slats, cream cushions, a candy back and two pillows.
  const bench = new VoxelFurniture();
  bench.add(C.sky, 2, 0.08, 0.46, 0, 0.4, 0, false, 0.04);
  for (const sx of [-0.5, 0.5]) bench.add(C.cream, 0.94, 0.04, 0.4, sx, 0.46, 0.02, false, 0.04);
  for (let i = 0; i < 10; i++) bench.add(CANDY[i % CANDY.length], 0.18, 0.4, 0.05, -0.9 + i * 0.2, 0.69, -0.2, false, 0.04);
  bench.add(C.cream, 2.06, 0.06, 0.1, 0, 0.92, -0.2, false, 0.03);
  for (const sx of [-0.97, 0.97]) {
    bench.add(C.lav, 0.08, 0.38, 0.44, sx, 0.19, 0, false, 0.04);
    bench.add(C.pink, 0.1, 0.06, 0.4, sx, 0.62, 0.02, false, 0.03);
    bench.add(C.pink, 0.07, 0.15, 0.07, sx, 0.52, 0.12, false, 0.035);
  }
  bench.add(C.rose, 0.3, 0.28, 0.1, -0.55, 0.64, -0.1, false, 0.035);
  bench.add(C.butter, 0.28, 0.26, 0.1, 0.6, 0.63, -0.1, false, 0.035);
  const benchGroup = bench.build();
  benchGroup.position.set(-9, 0, minZ + 0.3);
  // Somewhere to sit, so not merged with the rest: its own meshes carry what E is about when you look at it.
  group.add(benchGroup);
  colliders.push({ minX: -10, maxX: -8, minZ, maxZ: minZ + 0.55, top: 0.49 });
  seatable(benchGroup, 'bench', 1.6, interactables);

  // The bistro table, a stepped round top on a pedestal, with a cup, a cake and a posy; and a striped parasol over it.
  const table = new VoxelFurniture();
  table.add(C.cream, 0.9, 0.06, 0.9, 0, 0.74, 0, true, 0.05);
  table.add(C.pink, 0.78, 0.03, 0.78, 0, 0.77, 0, true, 0.05);
  table.add(C.cream, 0.84, 0.03, 0.84, 0, 0.765, 0, true, 0.05);
  table.add(C.lav, 0.09, 0.7, 0.09, 0, 0.37, 0, false, 0.045);
  table.add(C.pink, 0.5, 0.04, 0.5, 0, 0.02, 0, true, 0.05);
  table.add(C.lav, 0.3, 0.05, 0.3, 0, 0.065, 0, true, 0.05);
  table.add(C.rose, 0.1, 0.1, 0.1, 0.18, 0.84, 0.05, false, 0.025);
  table.add(C.cream, 0.14, 0.015, 0.14, 0.18, 0.795, 0.05, false, 0.025);
  table.add(C.peach, 0.16, 0.07, 0.16, -0.2, 0.84, 0.12, true, 0.03);
  table.add(C.pink, 0.1, 0.03, 0.1, -0.2, 0.89, 0.12, true, 0.03);
  table.add(C.mint, 0.08, 0.1, 0.08, -0.05, 0.84, -0.2, false, 0.03);
  flowerRow(table, -0.05, 0.89, -0.2, 1, 0.1, 5);
  table.add(C.cream, 0.05, 1.38, 0.05, 0, 1.45, 0, false, 0.025);
  for (const [k, half] of [1.05, 0.85, 0.65, 0.45, 0.25].entries()) {
    const y = 2.06 + k * 0.08;
    const cols = Math.round((half * 2) / 0.2);
    for (let c = 0; c < cols; c++) {
      const x = -half + (c + 0.5) * 0.2;
      const edge = c === 0 || c === cols - 1;
      table.add(c % 2 ? C.cream : C.pink, 0.2, 0.08, half * 2 - (edge ? 0.4 : 0), x, y, 0, false, 0.1);
    }
  }
  table.add(C.butter, 0.1, 0.1, 0.1, 0, 2.5, 0, false, 0.05);
  const tableGroup = table.build();
  tableGroup.position.set(tx, 0, tz);
  group.add(tableGroup);
  colliders.push({ minX: tx - 0.4, maxX: tx + 0.4, minZ: tz - 0.4, maxZ: tz + 0.4, top: 0.77 });
  for (const sx of [-1, 1]) {
    const x = tx + sx * 0.8;
    const stool = new VoxelFurniture();
    stool.add(sx < 0 ? C.sky : C.peach, 0.42, 0.07, 0.42, 0, 0.455, 0, true, 0.04);
    stool.add(C.cream, 0.3, 0.03, 0.3, 0, 0.485, 0, true, 0.03);
    for (const [lx, lz] of [[-0.12, -0.12], [0.12, -0.12], [-0.12, 0.12], [0.12, 0.12]]) stool.add(C.lav, 0.05, 0.42, 0.05, lx, 0.21, lz, false, 0.025);
    stool.add(C.lav, 0.3, 0.025, 0.3, 0, 0.14, 0, true, 0.025);
    const sg = stool.build();
    sg.position.set(x, 0, tz);
    group.add(sg);
    colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: tz - 0.2, maxZ: tz + 0.2, top: 0.49 });
    seatable(sg, sx < 0 ? 'stool-1' : 'stool-2', 0.9, interactables);
  }
  for (const [i, [px, pz, sc]] of [
    [maxX - 0.55, minZ + 0.5, 1.1],
    [minX + 0.55, maxZ - 0.55, 0.9],
  ].entries()) {
    // Starting past the monstera, which spreads too wide for a spot this near the rail.
    const p = plant(floorPlant(i + 1), sc);
    p.position.set(px, 0, pz);
    group.add(p);
    const r = 0.3 * sc;
    colliders.push({ minX: px - r, maxX: px + r, minZ: pz - r, maxZ: pz + r, top: 0.5 * sc });
  }

  group.add(vox.build());
  group.add(mergeByMaterial(parts));

  // The sign, pastel in a little block frame.
  const sign = textPlane('Balcony', { bg: '#fbe3ea', color: '#7a6a9b', size: 56, border: '#b9a4e0' });
  sign.scale.multiplyScalar(0.8);
  sign.position.set(-6.5, 2.2, minZ + 0.02);
  group.add(sign);
  const sp = sign.geometry.parameters;
  const sw2 = sp.width * 0.8;
  const sh2 = sp.height * 0.8;
  const frame = new VoxelFurniture();
  frame.add(C.lav, sw2 + 0.16, 0.07, 0.05, 0, sh2 / 2 + 0.03, 0, false, 0.035);
  frame.add(C.lav, sw2 + 0.16, 0.07, 0.05, 0, -sh2 / 2 - 0.03, 0, false, 0.035);
  for (const sx of [-1, 1]) frame.add(C.pink, 0.07, sh2 + 0.13, 0.05, sx * (sw2 / 2 + 0.05), 0, 0, false, 0.035);
  const fg = frame.build();
  fg.position.set(-6.5, 2.2, minZ + 0.005);
  group.add(fg);
}

/** The balcony, out the glass doors on the south wall. */
export const balcony: Fixture = (site) => {
  buildBalcony(site.group, site.colliders, site.interactables, site.get('night'));
  return {};
};

/** The bottom floor's balcony stands on candy-striped posts down to the street, at its outer corners (the ones above it hang off their walls). */
export function buildBalconyPosts(group: THREE.Group, colliders: Collider[]) {
  const { minX, maxX, maxZ } = BALCONY;
  const postH = -SLAB - STREET_Y;
  for (const x of [minX + 0.25, maxX - 0.25]) {
    const post = new VoxelFurniture();
    const bands = Math.ceil(postH / 0.4);
    for (let i = 0; i < bands; i++) {
      const h = Math.min(0.4, postH - i * 0.4);
      post.add(i % 2 ? '#fff5e4' : '#f6c1d1', 0.24, h, 0.24, 0, i * 0.4 + h / 2, 0, false, 0.06);
    }
    post.add('#d5c8ee', 0.34, 0.1, 0.34, 0, postH - 0.05, 0, false, 0.05);
    post.add('#d5c8ee', 0.34, 0.1, 0.34, 0, 0.05, 0, false, 0.05);
    const g = post.build();
    g.position.set(x, STREET_Y, maxZ - 0.25);
    group.add(g);
    colliders.push({ minX: x - 0.14, maxX: x + 0.14, minZ: maxZ - 0.39, maxZ: maxZ - 0.11, bottom: STREET_Y, top: -SLAB });
  }
}

/**
 * Outside the exit: a concrete landing level with the office floor, and steps running south
 * along the west wall down to the street, with a railing on the open side.
 */
export function buildExitStairs(group: THREE.Group, colliders: Collider[]) {
  const { minX, maxX, landingZ0, landingZ1, steps, run } = EXIT_STAIRS;
  const width = maxX - minX;
  const rise = -STREET_Y / steps;
  const treads = steps - 1;
  const L = landingZ1 - landingZ0;
  // Side profile: x runs south from the landing's north end, y is height.
  const profile = new THREE.Shape();
  profile.moveTo(0, STREET_Y);
  profile.lineTo(0, 0);
  profile.lineTo(L, 0);
  for (let i = 1; i <= treads; i++) {
    profile.lineTo(L + (i - 1) * run, -i * rise);
    profile.lineTo(L + i * run, -i * rise);
  }
  profile.lineTo(L + treads * run, STREET_Y);
  profile.closePath();
  const block = mesh(new THREE.ExtrudeGeometry(profile, { depth: width, bevelEnabled: false }), toon('#d3d6dd'), maxX, 0, landingZ0);
  block.rotation.y = -Math.PI / 2;
  group.add(block);
  const tread = toon('#b9bdc6');
  const cx = (minX + maxX) / 2;
  group.add(mesh(box(width, 0.04, L), tread, cx, -0.015, landingZ0 + L / 2, false));
  colliders.push({ minX, maxX, minZ: landingZ0, maxZ: landingZ1, bottom: STREET_Y, top: 0 });
  for (let i = 1; i <= treads; i++) {
    const z0 = landingZ1 + (i - 1) * run;
    group.add(mesh(box(width, 0.04, run + 0.02), tread, cx, -i * rise - 0.015, z0 + run / 2, false));
    colliders.push({ minX, maxX, minZ: z0, maxZ: z0 + run, bottom: STREET_Y, top: -i * rise });
  }

  // The railing: round the landing's open sides, then down the stairs.
  const ink = toon(PALETTE.deskLeg);
  const railX = minX + 0.06;
  const railH = 1.0;
  const post = (x: number, y: number, z: number) => group.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, railH, 6), ink, x, y + railH / 2, z, false));
  const rail = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => {
    const len = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const r = mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), ink, (x0 + x1) / 2, (y0 + y1) / 2 + railH, (z0 + z1) / 2, false);
    r.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x1 - x0, y1 - y0, z1 - z0).normalize());
    group.add(r);
  };
  const nz = landingZ0 + 0.06;
  post(maxX - 0.05, 0, nz);
  post(railX, 0, nz);
  post(railX, 0, landingZ1);
  rail(maxX - 0.05, 0, nz, railX, 0, nz);
  rail(railX, 0, nz, railX, 0, landingZ1);
  const bottomZ = landingZ1 + (treads - 0.5) * run;
  for (let i = 2; i <= treads; i += 3) post(railX, -i * rise, landingZ1 + (i - 0.5) * run);
  post(railX, -treads * rise, bottomZ);
  rail(railX, 0, landingZ1, railX, -treads * rise, bottomZ);
  colliders.push({ minX: minX - 0.05, maxX: minX + 0.1, minZ: landingZ0, maxZ: bottomZ, bottom: STREET_Y, top: 99 });
  colliders.push({ minX, maxX, minZ: landingZ0 - 0.05, maxZ: landingZ0 + 0.1, bottom: STREET_Y, top: 99 });
}
