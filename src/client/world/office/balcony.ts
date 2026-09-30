import * as THREE from 'three';
import { ASHTRAY, BALCONY, EXIT_STAIRS, SLAB, STREET_Y } from '../../../shared/layout';
import { bulb, type NightParts } from '../outside';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon } from '../toon';
import type { Collider, Interactable } from '../types';
import type { Fixture } from './fixture';
import { PALETTE, box, floorTexture, glassPane } from './materials';
import { floorPlant, plant } from './props';
import { seatable } from './seats';

// Outside the office's walls: the smoking balcony off the south wall, the posts under the bottom
// floor's, and the steps from the exit door down to the street.

/** A sagging string of party bulbs from `a` to `b`, in `bulbs` (one per color); they light up at night. */
function stringLights(a: THREE.Vector3, b: THREE.Vector3, sag: number, bulbs: [string, THREE.Material][], night: NightParts): THREE.Group {
  const mid = a.clone().add(b).multiplyScalar(0.5);
  mid.y -= sag * 2;
  const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
  const g = new THREE.Group();
  g.add(mesh(new THREE.TubeGeometry(curve, 24, 0.012, 4), toon(PALETTE.ink), 0, 0, 0, false));
  const n = Math.max(2, Math.round(curve.getLength() / 0.5));
  for (let i = 1; i < n; i++) {
    const p = curve.getPoint(i / n);
    const [color, mat] = bulbs[i % bulbs.length];
    g.add(mesh(new THREE.SphereGeometry(0.055, 8, 6), mat, p.x, p.y - 0.06, p.z, false));
    night.halos.push({ at: new THREE.Vector3(p.x, p.y - 0.06, p.z), size: 0.55, color });
  }
  return mergeByMaterial(g);
}

/**
 * The smoking balcony off the south wall, over the garage entrance: a deck with a glass railing on
 * its three open sides, string lights, a bench under the window, a bistro table, plants and the
 * ashtray, where you take a smoke break.
 */
export function buildBalcony(group: THREE.Group, colliders: Collider[], interactables: Interactable[], night: NightParts) {
  const { minX, maxX, minZ, maxZ } = BALCONY;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;
  // Everything that doesn't move and isn't textured goes in here, merged at the end.
  const parts = new THREE.Group();
  parts.add(mesh(box(w, SLAB - 0.01, d), toon(PALETTE.wallTrim), cx, -SLAB / 2 - 0.005, cz));
  const deck = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshToonMaterial({ map: floorTexture(w, d), color: '#d6a574', gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap }));
  deck.rotation.x = -Math.PI / 2;
  deck.position.set(cx, 0.002, cz);
  deck.receiveShadow = true;
  group.add(deck);
  colliders.push({ minX, maxX, minZ, maxZ, bottom: -SLAB, top: 0 });

  // The railing: posts, a wooden top rail and glass between, on the three open sides.
  const railH = 1.05;
  const ink = toon(PALETTE.deskLeg);
  const wood = toon(PALETTE.wood);
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
      parts.add(mesh(box(0.06, railH, 0.06), ink, x0 + (x1 - x0) * t, railH / 2, z0 + (z1 - z0) * t, false));
    }
    const rail = mesh(alongX ? box(len + 0.1, 0.07, 0.12) : box(0.12, 0.07, len + 0.1), wood, (x0 + x1) / 2, railH + 0.02, (z0 + z1) / 2);
    parts.add(rail);
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const pane = glassPane(len / n - 0.1, railH - 0.2);
      pane.position.set(x0 + (x1 - x0) * t, (railH - 0.2) / 2 + 0.08, z0 + (z1 - z0) * t);
      pane.rotation.y = alongX ? 0 : Math.PI / 2;
      parts.add(pane);
    }
    colliders.push({ minX: Math.min(x0, x1) - 0.05, maxX: Math.max(x0, x1) + 0.05, minZ: Math.min(z0, z1) - 0.05, maxZ: Math.max(z0, z1) + 0.05, bottom: -SLAB, top: 99 });
  }

  // Lamp poles on the outer corners, with string lights to them from the wall and between them.
  const poleH = 2.7;
  const sw = new THREE.Vector3(minX + inset, poleH, maxZ - inset);
  const se = new THREE.Vector3(maxX - inset, poleH, maxZ - inset);
  for (const p of [sw, se]) parts.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, poleH - railH, 6), ink, p.x, (poleH + railH) / 2, p.z, false));
  const bulbs = ['#ffd166', '#ff8fa3', '#8ecae6', '#caffbf'].map((c): [string, THREE.Material] => [c, bulb(night, c, 0.4)]);
  parts.add(stringLights(sw, se, 0.35, bulbs, night));
  parts.add(stringLights(sw, new THREE.Vector3(-6.5, 3.5, minZ + 0.02), 0.3, bulbs, night));
  parts.add(stringLights(new THREE.Vector3(-6.5, 3.5, minZ + 0.02), se, 0.35, bulbs, night));
  // At night they light the deck, the table and whoever's out there.
  for (const x of [cx - 3.2, cx + 3.2]) night.lamps.push({ x, y: 2.4, z: cz, reach: 5.5, color: '#ffc9a6', power: 2.4 });

  // A bench under the window, a bistro table with two stools, and plants.
  const bench = new THREE.Group();
  bench.add(mesh(roundedBox(2, 0.08, 0.46, 0.05), wood, 0, 0.45, 0));
  bench.add(mesh(box(2, 0.32, 0.06), wood, 0, 0.78, -0.2));
  for (const sx of [-0.85, 0.85]) bench.add(mesh(box(0.06, 0.45, 0.4), ink, sx, 0.22, 0));
  bench.position.set(-9, 0, minZ + 0.3);
  // Somewhere to sit, so not merged with the rest: its own meshes carry what E is about when you look at it.
  group.add(bench);
  colliders.push({ minX: -10, maxX: -8, minZ, maxZ: minZ + 0.55, top: 0.49 });
  seatable(bench, 'bench', 1.6, interactables);
  const tx = 0.2;
  const tz = cz + 0.2;
  const table = new THREE.Group();
  table.add(mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.05, 20), toon('#fffaf3'), 0, 0.74, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.7, 8), ink, 0, 0.37, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.25, 0.28, 0.04, 16), ink, 0, 0.02, 0));
  table.add(mesh(new THREE.CylinderGeometry(0.06, 0.05, 0.12, 10), toon('#ef476f'), 0.15, 0.82, 0.05));
  table.position.set(tx, 0, tz);
  parts.add(table);
  colliders.push({ minX: tx - 0.4, maxX: tx + 0.4, minZ: tz - 0.4, maxZ: tz + 0.4, top: 0.77 });
  for (const sx of [-1, 1]) {
    const x = tx + sx * 0.8;
    const stool = new THREE.Group();
    stool.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 16), toon(sx < 0 ? '#5bc0eb' : '#ff8a5b'), 0, 0.46, 0));
    stool.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 6), ink, 0, 0.22, 0));
    stool.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.03, 12), ink, 0, 0.015, 0));
    stool.position.set(x, 0, tz);
    group.add(stool);
    colliders.push({ minX: x - 0.2, maxX: x + 0.2, minZ: tz - 0.2, maxZ: tz + 0.2, top: 0.49 });
    seatable(stool, sx < 0 ? 'stool-1' : 'stool-2', 0.9, interactables);
  }
  for (const [i, [px, pz, sc]] of [
    [maxX - 0.55, minZ + 0.5, 1.1],
    [minX + 0.55, maxZ - 0.55, 0.9],
  ].entries()) {
    // Starting past the monstera, which spreads too wide for a spot this near the rail.
    const p = plant(floorPlant(i + 1), sc);
    p.position.set(px, 0, pz);
    parts.add(p);
    const r = 0.3 * sc;
    colliders.push({ minX: px - r, maxX: px + r, minZ: pz - r, maxZ: pz + r, top: 0.5 * sc });
  }

  group.add(mergeByMaterial(parts));

  // The ashtray: a standing bin with a sand-filled bowl and a couple of butts in it.
  const tray = new THREE.Group();
  const steel = toon('#8d99ae');
  tray.add(mesh(new THREE.CylinderGeometry(0.2, 0.22, 0.05, 16), steel, 0, 0.025, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.8, 10), steel, 0, 0.45, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.2, 0.14, 0.14, 16), steel, 0, 0.9, 0));
  tray.add(mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.02, 16), toon('#e9d8a6'), 0, 0.965, 0, false));
  for (const [bx, bz, a] of [
    [0.06, 0.02, 0.4],
    [-0.05, -0.06, 2.1],
    [-0.02, 0.08, 1.2],
  ]) {
    const butt = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.07, 6).rotateZ(Math.PI / 2), toon(a > 1 ? '#fffaf3' : '#e9a03b'), bx, 0.98, bz, false);
    butt.rotation.y = a;
    tray.add(butt);
  }
  tray.position.set(ASHTRAY.x, 0, ASHTRAY.z);
  group.add(tray);
  colliders.push({ minX: ASHTRAY.x - 0.2, maxX: ASHTRAY.x + 0.2, minZ: ASHTRAY.z - 0.2, maxZ: ASHTRAY.z + 0.2, top: 1 });
  const it: Interactable = { kind: 'smoke', x: ASHTRAY.x, z: ASHTRAY.z, radius: 1.8 };
  interactables.push(it);
  tray.userData.interact = it;

  const sign = textPlane('🚬 Smoke break', { bg: '#2b2d42', color: '#fffaf3', size: 56, border: '#fffaf3' });
  sign.scale.multiplyScalar(0.8);
  sign.position.set(-6.5, 2.2, minZ + 0.02);
  group.add(sign);
}

/** The smoking balcony, out the glass doors on the south wall. */
export const balcony: Fixture = (site) => {
  buildBalcony(site.group, site.colliders, site.interactables, site.get('night'));
  return {};
};

/** The bottom floor's balcony stands on posts down to the street, at its outer corners (the ones above it hang off their walls). */
export function buildBalconyPosts(group: THREE.Group, colliders: Collider[]) {
  const { minX, maxX, maxZ } = BALCONY;
  const postH = -SLAB - STREET_Y;
  for (const x of [minX + 0.25, maxX - 0.25]) {
    group.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, postH, 12), toon('#e6e8ee'), x, STREET_Y + postH / 2, maxZ - 0.25));
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
