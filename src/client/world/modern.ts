import * as THREE from 'three';
import { FLOOR, LOFT, MEETING_ROOM, WALL_HEIGHT } from '../../shared/layout';
import { mergeByMaterial, mesh, textPlane, toon } from './toon';

/** Architectural finishes only: nothing occupies a walking route or changes a seat's footprint. */
export function buildModernInterior(): THREE.Group {
  const group = new THREE.Group();
  group.name = 'modern-interior';
  const parts = new THREE.Group();
  const graphite = toon('#152333');
  const panel = toon('#25364a');
  const blue = toon('#87dcff', { emissive: '#246eac' });
  const add = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number) =>
    parts.add(mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, false));

  // Above the boards and windows: acoustic fins and continuous blue coves.
  for (const x of [-10, -1.8, 6.4]) {
    add(6.9, 1.28, 0.06, graphite, x, 5.5, FLOOR.minZ + 0.04);
    for (let i = 0; i < 24; i++) add(0.065, 1.2, 0.09, panel, x - 3.2 + i * 0.28, 5.5, FLOOR.minZ + 0.09);
    add(6.9, 0.035, 0.08, blue, x, 4.83, FLOOR.minZ + 0.1);
  }
  for (const x of [FLOOR.minX + 0.06, FLOOR.maxX - 0.06]) {
    add(0.08, 0.04, 25.4, blue, x, 5.05, 0);
    add(0.09, 0.16, 25.4, graphite, x, 5.16, 0);
  }

  // Floating acoustic ceiling rafts, suspended above each desk pod.
  for (const x of [-10.5, -1.5]) {
    for (const z of [-4, 4]) {
      add(5.7, 0.12, 3.3, graphite, x, WALL_HEIGHT - 0.45, z);
      for (let i = 0; i < 7; i++) add(5.5, 0.04, 0.08, panel, x, WALL_HEIGHT - 0.53, z - 1.35 + i * 0.45);
      // Flush floor inlays define each pod without blocking its approaches.
      for (const dz of [-2.26, 2.26]) add(5.9, 0.006, 0.035, blue, x, 0.025, z + dz);
    }
  }

  // Framed media wall around the existing lounge TV; the screen stays unobstructed.
  for (const z of [-3.55, 3.55]) {
    add(0.09, 4.2, 0.1, graphite, FLOOR.maxX - 0.12, 2.25, z);
    add(0.035, 4.05, 0.035, blue, FLOOR.maxX - 0.19, 2.25, z);
  }
  for (const y of [0.18, 4.32]) add(0.08, 0.08, 7.2, graphite, FLOOR.maxX - 0.12, y, 0);

  // Meeting-room privacy band with clear upper and lower glazing, plus a lit fascia.
  const room = MEETING_ROOM;
  const frost = new THREE.MeshBasicMaterial({ color: '#7ca5bc', transparent: true, opacity: 0.24, depthWrite: false, side: THREE.DoubleSide });
  for (const [a, b] of [[room.minX, room.door.x0], [room.door.x1, room.maxX]]) {
    group.add(mesh(new THREE.BoxGeometry(b - a, 0.34, 0.012), frost, (a + b) / 2, 1.35, room.minZ - 0.065, false));
  }
  group.add(mesh(new THREE.BoxGeometry(0.012, 0.34, room.maxZ - room.minZ), frost, room.minX - 0.065, 1.35, (room.minZ + room.maxZ) / 2, false));
  add(room.maxX - room.minX, 0.025, 0.08, blue, (room.minX + room.maxX) / 2, room.height - 0.07, room.minZ - 0.1);
  add(0.08, 0.025, room.maxZ - room.minZ, blue, room.minX - 0.1, room.height - 0.07, (room.minZ + room.maxZ) / 2);
  add(LOFT.maxX - LOFT.minX, 0.03, 0.06, blue, (LOFT.minX + LOFT.maxX) / 2, LOFT.y + LOFT.height - 0.12, LOFT.minZ - 0.11);

  // Kitchen splashback: behind the existing counter, below the south windows.
  add(5.2, 0.34, 0.025, panel, -14.5, 1.23, FLOOR.maxZ - 0.055);
  add(5.1, 0.025, 0.04, blue, -14.5, 1.4, FLOOR.maxZ - 0.075);
  group.add(mergeByMaterial(parts));

  const label = (text: string, x: number, y: number, z: number, rotY = 0) => {
    const sign = textPlane(text, { bg: '#152333', color: '#a5e4ff', size: 44 });
    sign.scale.setScalar(0.8);
    sign.position.set(x, y, z);
    sign.rotation.y = rotY;
    group.add(sign);
  };
  label('AGENT OFFICE  /  OPERATIONS', -5.8, 6.35, FLOOR.minZ + 0.12);
  label('01  /  COLLABORATION', FLOOR.maxX - 0.2, 4.62, 0, -Math.PI / 2);
  label('02  /  RECHARGE', -14.5, 3.1, FLOOR.maxZ - 0.13, Math.PI);
  return group;
}
