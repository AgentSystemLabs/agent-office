import * as THREE from 'three';
import { GONG, SLAB } from '../../../shared/layout';
import { boxFootprint } from '../../../shared/maps/props';
import type { PropConfig } from '../../../shared/maps';
import { mesh, roundedBox, textPlane, toon } from '../toon';
import type { Collider, Interactable } from '../types';
import type { Door } from './shell';
import type { Fixture } from './fixture';
import { GLASS, PALETTE, box } from './materials';
import { pendant, wallBoard } from './props';

declare module '../types' {
  interface OfficeHandles {
    mapProps: MapPropsView;
  }
}

export interface MapPropsView {
  signs: THREE.Mesh[];
  boards: THREE.Mesh[];
  customBoards: Map<string, THREE.Mesh[]>;
  updateProps(props: PropConfig[]): void;
  onUpdate?: () => void;
}

/**
 * Builds generic custom map elements declared in JSON:
 * - wall: interior walls and partitions
 * - door: sliding doors with optional room badge
 * - meeting_table: conference table with chairs and meeting interaction
 * - meeting_sign: live room status screen
 * - meeting_board: live meeting notes board
 * - custom_board: live custom tasks / US board
 * - floor: floor slabs with collision
 * - lamp: ceiling pendant lamp
 */
export const mapProps: Fixture<'mapProps'> = (site) => {
  const signs: THREE.Mesh[] = [];
  const boards: THREE.Mesh[] = [];
  const customBoards = new Map<string, THREE.Mesh[]>();
  const customGroup = new THREE.Group();
  site.group.add(customGroup);

  const customColliders: Collider[] = [];
  const customDoors: Door[] = [];
  const customInteractables: Interactable[] = [];

  const wallMat = site.looks.wall;
  const trimMat = site.looks.trim;
  const woodMat = toon(PALETTE.wood);
  const inkMat = toon(PALETTE.ink);
  const aluMat = toon('#aab4be');
  const night = site.get('night');

  function updateProps(props: PropConfig[]) {
    // 1. Clear previous custom items
    customGroup.clear();
    for (const c of customColliders) {
      const i = site.colliders.indexOf(c);
      if (i >= 0) site.colliders.splice(i, 1);
    }
    customColliders.length = 0;
    for (const d of customDoors) {
      const i = site.doors.indexOf(d);
      if (i >= 0) site.doors.splice(i, 1);
    }
    customDoors.length = 0;
    for (const it of customInteractables) {
      const i = site.interactables.indexOf(it);
      if (i >= 0) site.interactables.splice(i, 1);
    }
    customInteractables.length = 0;
    signs.length = 0;
    boards.length = 0;
    customBoards.clear();

    // 2. Gong
    const gongProp = props.find((p) => p.kind === 'gong');
    if (gongProp) {
      site.get('gong').moveTo({ x: gongProp.x, y: gongProp.y ?? 0, z: gongProp.z, rotY: gongProp.rotY ?? 0 });
    } else {
      site.get('gong').moveTo(GONG);
    }

    // 4. Build props
    for (const p of props) {
      const x = p.x;
      const z = p.z;
      const y = p.y ?? 0;
      const rotY = p.rotY ?? 0;

      switch (p.kind) {
        case 'wall': {
          const w = p.width ?? 0.16;
          const len = p.length ?? 3;
          const h = p.height ?? 3.2;
          const mat = p.color ? toon(p.color) : wallMat;
          const m = mesh(box(w, h, len), mat, x, y + h / 2, z, false);
          m.rotation.y = rotY;
          m.userData.wall = true;
          customGroup.add(m);
          const trim = mesh(box(w + 0.04, 0.25, len), trimMat, x, y + 0.125, z, false);
          trim.rotation.y = rotY;
          customGroup.add(trim);
          const [minX, maxX, minZ, maxZ] = boxFootprint(x, z, w, len, rotY);
          const c: Collider = { minX, maxX, minZ, maxZ, top: y + h, bottom: y };
          customColliders.push(c);
          site.colliders.push(c);
          break;
        }

        case 'floor': {
          const w = p.width ?? 5;
          const len = p.length ?? 5;
          const mat = p.color ? toon(p.color) : site.planks;
          const fl = mesh(new THREE.BoxGeometry(w, 0.04, len), mat, x, y + 0.01, z, false);
          fl.rotation.y = rotY;
          customGroup.add(fl);
          const [minX, maxX, minZ, maxZ] = boxFootprint(x, z, w, len, rotY);
          const c: Collider = { minX, maxX, minZ, maxZ, bottom: -SLAB, top: y };
          customColliders.push(c);
          site.colliders.push(c);
          break;
        }

        case 'ceiling': {
          const w = p.width ?? 5;
          const len = p.length ?? 5;
          const h = p.y ?? 3.2;
          const mat = p.color ? toon(p.color) : (site.get('stack')?.ceiling ?? toon('#ffffff'));
          const ceil = mesh(box(w, 0.04, len), mat, x, h + 0.02, z, false);
          ceil.rotation.y = rotY;
          customGroup.add(ceil);
          const [minX, maxX, minZ, maxZ] = boxFootprint(x, z, w, len, rotY);
          const c: Collider = { minX, maxX, minZ, maxZ, bottom: h, top: h + SLAB };
          customColliders.push(c);
          site.colliders.push(c);
          break;
        }

        case 'door': {
          const dw = p.width ?? 1.3;
          const dh = p.height ?? 2.25;
          buildDoor(customGroup, customDoors, site.doors, x, z, y, rotY, dw, dh, aluMat, p.name);
          break;
        }

        case 'meeting_table': {
          const tw = p.width ?? 2.4;
          const td = p.length ?? 1.3;
          buildMeetingTable(customGroup, customColliders, site.colliders, customInteractables, site.interactables, x, z, y, rotY, tw, td, woodMat, inkMat);
          break;
        }

        case 'meeting_sign': {
          const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.88), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide, toneMapped: false }));
          sign.position.set(x, y || 1.45, z);
          sign.rotation.y = rotY;
          const plate = mesh(roundedBox(0.6, 0.94, 0.03, 0.02), toon(PALETTE.ink), 0, 0, -0.02, false);
          sign.add(plate);
          customGroup.add(sign);
          signs.push(sign);
          const it: Interactable = { kind: 'meeting', x, z, radius: 2.0 };
          customInteractables.push(it);
          site.interactables.push(it);
          sign.userData.interact = it;
          break;
        }

        case 'meeting_board': {
          const bw = p.width ?? 2.4;
          const bh = p.height ?? 1.2;
          const { group: bg, face } = wallBoard(bw, bh, '#aab4be');
          bg.position.set(x, y || 1.9, z);
          bg.rotation.y = rotY;
          customGroup.add(bg);
          boards.push(face);
          const it: Interactable = { kind: 'meeting', x, z, radius: 2.5 };
          customInteractables.push(it);
          site.interactables.push(it);
          bg.userData.interact = it;
          break;
        }

        case 'custom_board': {
          const bw = p.width ?? 5.0;
          const bh = p.height ?? 3.0;
          const bId = p.boardId || 'jira';
          const { group: bg, face } = wallBoard(bw, bh, PALETTE.wood);
          bg.position.set(x, y || 2.1, z);
          bg.rotation.y = rotY;
          customGroup.add(bg);

          const signText = p.name ?? '🎯 Jira';
          const signPlane = textPlane(signText, { bg: '#fffaf3', size: 64 });
          signPlane.scale.multiplyScalar(1.3);
          signPlane.position.set(0, bh / 2 + 0.5, 0.04);
          bg.add(signPlane);

          if (!customBoards.has(bId)) customBoards.set(bId, []);
          customBoards.get(bId)!.push(face);

          const nx = Math.sin(rotY);
          const nz = Math.cos(rotY);
          const it: Interactable = { kind: 'customboard', boardId: bId, x: x + nx * 1.6, z: z + nz * 1.6, radius: 2.5 };
          customInteractables.push(it);
          site.interactables.push(it);
          bg.userData.interact = it;
          break;
        }

        case 'lamp': {
          const lamp = pendant(0.4);
          lamp.position.set(x, (y || 3.2) - 0.4, z);
          customGroup.add(lamp);
          night.halos.push({ at: new THREE.Vector3(x, (y || 3.2) - 0.45, z), size: 1.3, color: '#ffe08a' });
          break;
        }

        case 'sign': {
          const signText = p.name ?? 'Meeting rooms';
          const signPlane = textPlane(signText, { bg: '#2b2d42', color: '#fffaf3', size: 56, border: '#ffd166' });
          signPlane.scale.multiplyScalar(0.7);
          signPlane.position.set(x, y || 3.1, z);
          signPlane.rotation.y = rotY;
          customGroup.add(signPlane);
          break;
        }

        case 'expand_sign': {
          site.get('wing').moveSign({ x, y: y || 4.2, z });
          break;
        }
      }
    }
  }

  // Initial setup if plan has config
  if (site.plan?.config?.props) {
    updateProps(site.plan.config.props);
  }

  const view: MapPropsView = { signs, boards, customBoards, updateProps };
  function doUpdate(props: PropConfig[]) {
    updateProps(props);
    view.onUpdate?.();
  }
  view.updateProps = doUpdate;

  return { handle: { mapProps: view } };
};

function buildDoor(group: THREE.Group, customDoors: Door[], siteDoors: Door[], x: number, z: number, y: number, rotY: number, w: number, h: number, frameMat: THREE.Material, name?: string) {
  const half = w / 2;
  const leafW = half;
  const doorGroup = new THREE.Group();
  doorGroup.position.set(x, y, z);
  doorGroup.rotation.y = rotY;

  const F = 0.06;
  const T = 0.16;
  doorGroup.add(mesh(box(w, F, T + 0.04), frameMat, 0, h - F / 2, 0, false));
  for (const sx of [-half + F / 2, half - F / 2]) {
    doorGroup.add(mesh(box(F, h, T + 0.04), frameMat, sx, h / 2, 0, false));
  }

  if (name) {
    for (const s of [1, -1]) {
      const badgePlate = mesh(roundedBox(0.92, 0.32, 0.03, 0.02), toon(PALETTE.ink), 0, h + 0.35, s * 0.19, false);
      badgePlate.rotation.y = s === 1 ? 0 : Math.PI;
      doorGroup.add(badgePlate);
      const badge = textPlane(`🤝 ${name}`, { bg: '#2b2d42', color: '#fffaf3', size: 54, border: '#fffaf3' });
      badge.scale.multiplyScalar(0.65);
      badge.position.set(0, h + 0.35, s * 0.21);
      badge.rotation.y = s === 1 ? 0 : Math.PI;
      doorGroup.add(badge);
    }
  }

  const leaves: [THREE.Group, number][] = [];
  for (const s of [-1, 1]) {
    const leaf = new THREE.Group();
    for (const ly of [0.04, h - 0.04]) leaf.add(mesh(box(leafW, 0.07, 0.04), frameMat, 0, ly, 0, false));
    for (const lx of [-leafW / 2 + 0.03, leafW / 2 - 0.03]) leaf.add(mesh(box(0.06, h, 0.04), frameMat, lx, h / 2, 0, false));
    const pane = mesh(new THREE.PlaneGeometry(leafW - 0.08, h - 0.14), GLASS, 0, h / 2, 0, false);
    leaf.add(pane);
    leaf.add(mesh(box(0.03, 0.4, 0.06), toon(PALETTE.ink), -s * (leafW / 2 - 0.08), 1.05, 0, false));
    const x0 = s * (leafW / 2);
    leaf.position.set(x0, 0, -0.1);
    doorGroup.add(leaf);
    leaves.push([leaf, x0]);
  }
  group.add(doorGroup);

  const door: Door = {
    x,
    y,
    z,
    open: 0,
    show: (k: number) => {
      const e = k * k * (3 - 2 * k);
      for (const [leaf, x0] of leaves) leaf.position.x = x0 + Math.sign(x0) * e * (leafW - 0.04);
    },
  };
  customDoors.push(door);
  siteDoors.push(door);
}

function buildMeetingTable(
  group: THREE.Group,
  customColliders: Collider[],
  siteColliders: Collider[],
  customInteractables: Interactable[],
  siteInteractables: Interactable[],
  x: number,
  z: number,
  y: number,
  rotY: number,
  w: number,
  d: number,
  woodMat: THREE.Material,
  inkMat: THREE.Material,
) {
  const h = 0.76;
  const table = new THREE.Group();
  table.position.set(x, y, z);
  table.rotation.y = rotY;
  table.add(mesh(roundedBox(w, 0.06, d, 0.06), woodMat, 0, h, 0));
  for (const dx of [-w / 2 + 0.25, w / 2 - 0.25]) {
    for (const dz of [-d / 2 + 0.2, d / 2 - 0.2]) {
      table.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, h, 8), inkMat, dx, h / 2, dz, false));
    }
  }
  group.add(table);

  const [minX, maxX, minZ, maxZ] = boxFootprint(x, z, w, d, rotY);
  const c: Collider = { minX, maxX, minZ, maxZ, top: y + h, bottom: y };
  customColliders.push(c);
  siteColliders.push(c);

  const it: Interactable = { kind: 'meeting', x, z, radius: 2.9 };
  customInteractables.push(it);
  siteInteractables.push(it);
  table.userData.interact = it;

  const chairs: [number, number, number][] = [
    [-0.6, -d / 2 - 0.42, 0],
    [0.6, -d / 2 - 0.42, 0],
    [-0.6, d / 2 + 0.42, Math.PI],
    [0.6, d / 2 + 0.42, Math.PI],
  ];
  for (const [cx, cz, r] of chairs) {
    const ch = new THREE.Group();
    ch.position.set(cx, 0, cz);
    ch.rotation.y = r;
    const chairMat = toon(PALETTE.chairs[Math.abs(Math.round(cx * 10 + cz * 10)) % PALETTE.chairs.length]);
    ch.add(mesh(roundedBox(0.48, 0.07, 0.46, 0.04), chairMat, 0, 0.46, 0));
    ch.add(mesh(roundedBox(0.44, 0.38, 0.05, 0.03), chairMat, 0, 0.68, -0.2));
    ch.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.44, 6), inkMat, 0, 0.22, 0, false));
    ch.add(mesh(new THREE.BoxGeometry(0.44, 0.03, 0.06), inkMat, 0, 0.02, 0, false));
    ch.add(mesh(new THREE.BoxGeometry(0.06, 0.03, 0.44), inkMat, 0, 0.02, 0, false));
    table.add(ch);
  }
}
