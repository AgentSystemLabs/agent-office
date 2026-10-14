import * as THREE from 'three';
import { SCRANTON, SCRANTON_HEIGHT, CORRIDORS, PARTITIONS, WORKSTATIONS, FURNISHINGS, RECEPTION_BLOCKS, CONFERENCE_CHAIRS, ROOMS, point, partitionRect, furnitureRect, deskRect, scrantonNav, type Partition } from '../../../shared/scranton';
import type { Rect, NavGrid } from '../../../shared/nav';
import type { Collider } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { chair } from '../../world/office/seats';
import { glassPane } from '../../world/office/materials';
import { mesh, toon } from '../../world/toon';
import { plaque, furnishing, reception, workstation } from './props';
import { batchStatic } from './batch';

export interface ScrantonView { root: THREE.Group; nav: NavGrid }
declare module '../../world/types' {
  interface OfficeHandles { scranton: ScrantonView }
}
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
function collider(r: Rect, top: number, bottom?: number): Collider {
  return { minX: r[0], maxX: r[1], minZ: r[2], maxZ: r[3], top, bottom };
}

function partition(p: Partition): THREE.Group {
  const g = new THREE.Group();
  const width = p.to - p.from;
  g.position.set(p.axis === 'x' ? (p.from + p.to) / 2 : p.at, 0, p.axis === 'x' ? p.at : (p.from + p.to) / 2);
  if (p.axis === 'z') g.rotation.y = Math.PI / 2;
  const wall = toon('#c9cbb5');
  const trim = toon('#8b9580');
  if (!p.glass) g.add(mesh(box(width, SCRANTON_HEIGHT, 0.18), wall, 0, SCRANTON_HEIGHT / 2, 0));
  else {
    g.add(mesh(box(width, 0.78, 0.18), wall, 0, 0.39, 0));
    g.add(mesh(box(width, 0.35, 0.18), wall, 0, SCRANTON_HEIGHT - 0.175, 0));
    const sections = Math.max(1, Math.ceil(width / 2.6));
    const w = width / sections;
    for (let i = 0; i < sections; i++) {
      const x = -width / 2 + w * (i + 0.5);
      const pane = glassPane(w - 0.1, 2.18);
      pane.position.set(x, 1.88, 0);
      g.add(pane);
      g.add(mesh(box(0.07, 2.2, 0.14), trim, x - w / 2 + 0.035, 1.88, 0));
      // Horizontal blinds are a defining part of Michael's office and the conference room.
      if (!p.outer && p.glass) for (let y = 1.02; y < 2.98; y += 0.2) {
        const slat = mesh(box(w - 0.1, 0.023, 0.1), toon('#bcbcad'), x, y, 0.04, false);
        slat.rotation.x = -0.25;
        g.add(slat);
      }
    }
    for (const y of [0.8, 2.99]) g.add(mesh(box(width, 0.06, 0.15), trim, 0, y, 0));
  }
  g.add(mesh(box(width, 0.12, 0.2), trim, 0, 0.06, 0));
  return g;
}

/** A permanent adjoining suite: its furniture cannot hire or displace coding workers. */
export const scranton: Fixture<'scranton'> = (site) => {
  const root = new THREE.Group();
  root.name = 'scranton-extension';
  const colliders: Collider[] = [];
  const suite: Rect = [SCRANTON.minX, SCRANTON.maxX, SCRANTON.minZ, SCRANTON.maxZ];
  const carpet = toon('#8e9290').clone();
  carpet.fog = false;
  for (const r of [suite, ...CORRIDORS]) {
    root.add(mesh(box(r[1] - r[0], 0.25, r[3] - r[2]), carpet, (r[0] + r[1]) / 2, -0.125, (r[2] + r[3]) / 2));
    colliders.push(collider(r, 0));
    // Visible from below, with the top open for inspecting the floor plan in third person.
    const ceiling = mesh(new THREE.PlaneGeometry(r[1] - r[0], r[3] - r[2]), new THREE.MeshBasicMaterial({ color: '#e6e5db', fog: false }), (r[0] + r[1]) / 2, SCRANTON_HEIGHT, (r[2] + r[3]) / 2, false);
    ceiling.rotation.x = Math.PI / 2;
    root.add(ceiling);
    colliders.push(collider(r, SCRANTON_HEIGHT + 0.1, SCRANTON_HEIGHT));
  }
  for (const p of PARTITIONS) {
    root.add(partition(p));
    colliders.push(collider(partitionRect(p), 99));
  }
  for (const s of WORKSTATIONS) {
    root.add(workstation(s));
    colliders.push(collider(deskRect(s), 0.78));
  }
  root.add(reception());
  colliders.push(...RECEPTION_BLOCKS.map((r) => collider(r, 1.13)));
  for (const f of FURNISHINGS) {
    root.add(furnishing(f));
    colliders.push(collider(furnitureRect(f), f.height));
  }
  for (const at of CONFERENCE_CHAIRS) {
    const seat = chair('#74796b');
    seat.position.set(at[0], 0, at[1]);
    root.add(seat);
  }
  const boardAt = point(10.5, 0.15);
  const screen = mesh(box(2.7, 1.35, 0.035), toon('#faf9f1'), boardAt[0], 1.85, boardAt[1]);
  root.add(screen);
  const logo = plaque('DUNDER MIFFLIN · SCRANTON', 3.5);
  const logoAt = point(1.2, 2.0);
  logo.position.set(logoAt[0], 2.6, logoAt[1]);
  logo.rotation.y = Math.PI / 2;
  root.add(logo);
  for (const key of ['michael', 'conference', 'kitchen', 'annex', 'breakroom', 'ryan'] as const) {
    const r = ROOMS[key];
    const label = plaque(r.label.toUpperCase(), key === 'annex' ? 2.6 : 1.7);
    label.position.set(r.at[0], 2.95, r.at[1] - 1.0);
    root.add(label);
  }
  // Fluorescent fittings and restrained local lighting preserve the original office's illumination.
  for (const at of [point(6, 8), point(18.5, 9), point(26, 11), [21.5, -15] as [number, number]]) {
    root.add(mesh(box(1.4, 0.04, 0.36), new THREE.MeshBasicMaterial({ color: '#fffde4', fog: false }), at[0], 3.27, at[1], false));
    const light = new THREE.PointLight('#fff7de', 13, 13, 2);
    light.position.set(at[0], 2.9, at[1]);
    root.add(light);
  }
  // The enclosed building stair core, pictured through its landing window.
  const stairs = new THREE.Group();
  stairs.name = 'scranton-stairwell';
  const at = point(18.5, 3.2);
  for (let i = 0; i < 12; i++) stairs.add(mesh(box(3.2, 0.16, 0.38), toon('#a9aaa6'), at[0], -0.05 + i * 0.08, at[1] + 2.1 - i * 0.38));
  root.add(stairs);
  colliders.push(collider(furnitureRect({ at, width: 7.2, depth: 6.0 }), 99));
  const wayfinding = plaque('DUNDER MIFFLIN →', 1.6);
  wayfinding.position.set(17.92, 2.94, -4.2);
  wayfinding.rotation.y = -Math.PI / 2;
  root.add(wayfinding);
  site.wall('east', -4.2, 1.6, 1.9, 3.2);
  batchStatic(root);
  return { group: root, colliders, handle: { scranton: { root, nav: scrantonNav() } } };
};
