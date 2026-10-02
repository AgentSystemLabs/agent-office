import * as THREE from 'three';
import { MEETING_BOARD, MEETING_LAPTOP, MEETING_ROOM, MEETING_SEATS, MEETING_TABLE, deskSeat, type DeskDef } from '../../../shared/layout';
import type { NightParts } from '../outside';
import { mesh, roundedBox, textPlane, toon } from '../toon';
import type { Collider, DeskView, Interactable } from '../types';
import type { Fixture } from './fixture';
import { PALETTE, box, glassPane } from './materials';
import { wallBoard } from './props';
import { chair } from './seats';
import type { Door } from './shell';

/** A chair at the meeting table, with its laptop on the table in front of it. */
function buildMeetingSeat(def: DeskDef, index: number): DeskView {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, MEETING_TABLE.height, MEETING_LAPTOP.z);
  laptopAnchor.scale.setScalar(MEETING_LAPTOP.scale);
  group.add(laptopAnchor);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.4, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  group.add(seatAnchor);
  const ch = chair(['#2b2d42', '#ef476f', '#118ab2', '#06d6a0', '#ffd166'][index % 5]);
  ch.position.set(0, 0, 0.85);
  group.add(ch);
  // A merge's dance party: up on its chair rather than the table, where the laptops are close together.
  const stage = new THREE.Object3D();
  stage.position.set(0, 0.48, 0.85);
  group.add(stage);
  // Nobody is hired here from the floor, so there's no '+' over a free chair: a meeting fills them.
  const vacancy = new THREE.Group();
  group.add(vacancy);
  return { def, group, laptopAnchor, seatAnchor, stage, chair: ch, vacancy, vacancyY: 0 };
}

/**
 * The meeting room under the loft: glass walls from the loft's posts round to the outside walls, a
 * sliding glass door facing the lounge, a long table with its chairs (MEETING_SEATS), a board on the
 * back wall for the meeting's output and a sign by the door for how it's going.
 */
export function buildMeetingRoom(group: THREE.Group, colliders: Collider[], interactables: Interactable[], desks: Map<string, DeskView>, doors: Door[], night: NightParts): { board: THREE.Mesh; sign: THREE.Mesh } {
  const R = MEETING_ROOM;
  const H = R.height;
  const T = 0.1;
  const frameMat = toon('#ffffff');
  const walls = new THREE.Group();
  const bar = (w: number, h: number, d: number, x: number, y: number, z: number) => walls.add(mesh(box(w, h, d), frameMat, x, y, z, false));
  /** A run of glass along x (north wall) or z (west wall), from a to b, in panes about `pane` wide. */
  const run = (axis: 'x' | 'z', a: number, b: number, at: number, pane = 2.2) => {
    const len = b - a;
    const n = Math.max(1, Math.round(len / pane));
    for (let i = 0; i < n; i++) {
      const g = glassPane(len / n, H);
      const u = a + (i + 0.5) * (len / n);
      if (axis === 'x') g.position.set(u, H / 2, at);
      else {
        g.position.set(at, H / 2, u);
        g.rotation.y = Math.PI / 2;
      }
      walls.add(g);
    }
    for (let i = 0; i <= n; i++) {
      const u = a + i * (len / n);
      if (axis === 'x') bar(0.08, H, T + 0.04, u, H / 2, at);
      else bar(T + 0.04, H, 0.08, at, H / 2, u);
    }
    for (const y of [0.05, H - 0.05]) {
      if (axis === 'x') bar(len, 0.1, T + 0.06, (a + b) / 2, y, at);
      else bar(T + 0.06, 0.1, len, at, y, (a + b) / 2);
    }
    colliders.push(axis === 'x' ? { minX: a, maxX: b, minZ: at - T / 2, maxZ: at + T / 2, top: H } : { minX: at - T / 2, maxX: at + T / 2, minZ: a, maxZ: b, top: H });
  };
  run('x', R.minX, R.door.x0, R.minZ);
  run('x', R.door.x1, R.maxX, R.minZ);
  run('z', R.minZ, R.maxZ, R.minX);
  // Over the door, up to the loft's floor.
  bar(R.door.x1 - R.door.x0, 0.1, T + 0.06, (R.door.x0 + R.door.x1) / 2, 2.3, R.minZ);
  group.add(walls);

  // The door: two glass leaves that slide apart over the glass on either side when someone comes up.
  const dx = (R.door.x0 + R.door.x1) / 2;
  const half = (R.door.x1 - R.door.x0) / 2;
  const alu = toon('#aab4be');
  const leaves: [THREE.Group, number][] = [];
  for (const side of [-1, 1]) {
    const leaf = new THREE.Group();
    const h = 2.25;
    for (const y of [0.04, h - 0.04]) leaf.add(mesh(box(half, 0.07, 0.04), alu, 0, y, 0, false));
    for (const x of [-half / 2 + 0.03, half / 2 - 0.03]) leaf.add(mesh(box(0.06, h, 0.04), alu, x, h / 2, 0, false));
    const pane = glassPane(half - 0.12, h - 0.14);
    pane.position.y = h / 2;
    leaf.add(pane);
    leaf.add(mesh(box(0.03, 0.4, 0.07), toon(PALETTE.ink), -side * (half / 2 - 0.1), 1.05, 0, false));
    const x0 = dx + (side * half) / 2;
    leaf.position.set(x0, 0, R.minZ - T / 2 - 0.04);
    group.add(leaf);
    leaves.push([leaf, x0]);
  }
  doors.push({
    x: dx,
    y: 0,
    z: R.minZ,
    open: 0,
    show: (k) => {
      const e = k * k * (3 - 2 * k);
      for (const [leaf, x0] of leaves) leaf.position.x = x0 + Math.sign(x0 - dx) * e * (half - 0.06);
    },
  });
  const label = textPlane('🤝 Meeting room', { bg: '#2b2d42', color: '#fffaf3', size: 56, border: '#fffaf3' });
  label.scale.multiplyScalar(0.62);
  // In front of the glass wall's frame (out to R.minZ - 0.08) and the sliding leaves (to R.minZ - 0.11),
  // which it runs across once its text is wider than the door.
  label.position.set(dx, 2.52, R.minZ - 0.13);
  label.rotation.y = Math.PI;
  group.add(label);

  // The table, on two pedestals, and its chairs.
  const table = new THREE.Group();
  const top = MEETING_TABLE;
  table.add(mesh(roundedBox(top.width, 0.08, top.depth, 0.1), toon(PALETTE.wood), 0, top.height - 0.04, 0));
  for (const sx of [-1, 1]) {
    table.add(mesh(new THREE.CylinderGeometry(0.1, 0.12, top.height - 0.08, 10), toon(PALETTE.deskLeg), sx * (top.width / 2 - 0.7), (top.height - 0.08) / 2, 0));
    table.add(mesh(roundedBox(0.9, 0.05, 0.8, 0.05), toon(PALETTE.deskLeg), sx * (top.width / 2 - 0.7), 0.025, 0));
  }
  table.position.set(top.x, 0, top.z);
  group.add(table);
  colliders.push({ minX: top.x - top.width / 2, maxX: top.x + top.width / 2, minZ: top.z - top.depth / 2, maxZ: top.z + top.depth / 2, top: top.height });
  const talk: Interactable = { kind: 'meeting', x: top.x, z: top.z, radius: 2.9 };
  interactables.push(talk);
  table.userData.interact = talk;
  MEETING_SEATS.forEach((def, i) => {
    const view = buildMeetingSeat(def, i);
    group.add(view.group);
    desks.set(def.id, view);
    const at = deskSeat(def, 1.2);
    const it: Interactable = { kind: 'desk', deskId: def.id, x: at.x, z: at.z, radius: 1 };
    interactables.push(it);
    view.group.userData.interact = it;
  });

  // The board on the back wall: the meeting's output file as it's being written.
  const b = MEETING_BOARD;
  const { group: frame, face } = wallBoard(b.width, b.height, '#aab4be');
  frame.position.set(b.x, b.y, b.z);
  frame.rotation.y = Math.PI;
  group.add(frame);
  const read: Interactable = { kind: 'meeting', x: b.x, z: b.z - 1.4, radius: 2.4 };
  interactables.push(read);
  frame.userData.interact = read;

  // The panel on the glass beside the door, like a room-booking screen: what's on, the round, the
  // tokens, and the summary once it's over. Beside the door rather than past it, so the board shows.
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.96), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  // Inside the glass, facing out: the door's left leaf slides across outside it (out to R.minZ - 0.125)
  // and would cut through a panel on the outer face, its glints flickering with the screen.
  sign.position.set((R.minX + R.door.x0) / 2 + 0.01, 1.45, R.minZ + T / 2 + 0.03);
  sign.rotation.y = Math.PI;
  group.add(sign);
  const plate = mesh(roundedBox(0.66, 1.03, 0.03, 0.03), toon(PALETTE.ink), sign.position.x, sign.position.y, R.minZ + T / 2 + 0.05, false);
  group.add(plate);
  const door: Interactable = { kind: 'meeting', x: sign.position.x, z: R.minZ - 1.2, radius: 1.8 };
  interactables.push(door);
  sign.userData.interact = door;
  plate.userData.interact = door;

  // Flat lights set in the loft's floor over the table: a hanging lamp would be in front of the board.
  for (const dx of [-0.95, 0.95]) {
    group.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.04, 20), toon('#fff7d6', { emissive: '#ffe08a' }), top.x + dx, H - 0.02, top.z, false));
    night.halos.push({ at: new THREE.Vector3(top.x + dx, H - 0.08, top.z), size: 0.9, color: '#ffe08a' });
  }
  return { board: face, sign };
}

declare module '../types' {
  interface OfficeHandles {
    /** The meeting room's board, showing the meeting's output as it's written, and the sign by its door. */
    meetingBoard: THREE.Mesh;
    meetingSign: THREE.Mesh;
  }
}

/** Under the loft: the meeting room. */
export const meetingRoom: Fixture<'meetingBoard' | 'meetingSign'> = (site) => {
  const built = buildMeetingRoom(site.group, site.colliders, site.interactables, site.desks, site.doors, site.get('night'));
  site.wall('south', MEETING_BOARD.x, MEETING_BOARD.y, MEETING_BOARD.width + 0.4, MEETING_BOARD.height + 0.4);
  return { handle: { meetingBoard: built.board, meetingSign: built.sign } };
};
