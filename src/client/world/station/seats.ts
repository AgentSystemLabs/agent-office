import * as THREE from 'three';
import { KIOSK, STATION_AGENT, deskSeat, type DeskDef, type StationKind } from '../../../shared/layout';
import { BENCH_OUT, COUNCIL, THRONE_SIZE } from '../../../shared/maps';
import { boxFootprint } from '../../../shared/maps/props';
import { deskPoint } from '../../../shared/nav';
import { vacancyMarker } from '../office';
import type { DeskView, Interactable } from '../types';
import { mesh, roundedBox, textPlane } from '../toon';
import { BENCH_TOP, TABLE_TOP, box, collide, lit, xz, type Kit } from './kit';

// Where everyone sits and stands on the station: the long benches with a place at each for a worker,
// the board agents' consoles, the briefing table the meetings are held at, and the bridge, with the
// captain's chair on it. Everything is where the plan has it (see planMap), as in the castle.

/** The long benches the workers work at, as the plan has them: a white top with a line of light down it, a padded seat down each side. */
export function buildBenches(kit: Kit) {
  const { mats } = kit;
  for (const t of kit.plan.tables) {
    const g = new THREE.Group();
    g.position.set(t.x, 0, t.z);
    g.rotation.y = t.rotY;
    g.add(mesh(roundedBox(t.width, 0.08, t.length, 0.08), mats.white, 0, TABLE_TOP - 0.04, 0));
    g.add(mesh(box(t.width - 0.12, 0.05, t.length - 0.12), mats.metalDark, 0, TABLE_TOP - 0.105, 0, false));
    g.add(mesh(box(0.1, 0.03, t.length - 0.6), mats.accent, 0, TABLE_TOP + 0.012, 0, false));
    const legs = Math.max(2, Math.round(t.length / 3.4) + 1);
    for (let i = 0; i < legs; i++) {
      const lz = -t.length / 2 + 0.5 + (i * (t.length - 1)) / (legs - 1);
      g.add(mesh(box(t.width - 0.5, TABLE_TOP - 0.13, 0.22), mats.metalDark, 0, (TABLE_TOP - 0.13) / 2, lz));
      g.add(mesh(box(t.width - 0.2, 0.05, 0.5), mats.metal, 0, 0.025, lz, false));
    }
    for (const s of t.sides) {
      const bx = s * (t.width / 2 + BENCH_OUT);
      g.add(mesh(roundedBox(0.44, 0.09, t.length - 0.2, 0.05), mats.pad, bx, BENCH_TOP - 0.045, 0));
      g.add(mesh(box(0.26, BENCH_TOP - 0.09, t.length - 0.8), mats.metalDark, bx, (BENCH_TOP - 0.09) / 2, 0));
      collide(kit, t.x + Math.cos(t.rotY) * bx, t.z - Math.sin(t.rotY) * bx, 0.44, t.length - 0.2, t.rotY, BENCH_TOP);
    }
    kit.still.add(g);
    collide(kit, t.x, t.z, t.width, t.length, t.rotY, TABLE_TOP);
  }
}

/** A place at a bench: its laptop, the worker on the seat, a mug beside it, and the '+' while it's free. */
export function placeSetting(kit: Kit, def: DeskDef, overflow: boolean): { view: DeskView; it: Interactable } {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, TABLE_TOP, -0.02);
  laptopAnchor.scale.setScalar(1.2);
  g.add(laptopAnchor);
  // On the bench, facing the table.
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, BENCH_TOP - 0.08, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  g.add(seatAnchor);
  // Up on the table beside the laptop.
  const stage = new THREE.Object3D();
  stage.position.set(0.66, TABLE_TOP - 0.07, 0.12);
  g.add(stage);
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.045, 0.11, 12), kit.mats.white, -0.6, TABLE_TOP + 0.055, 0.1, false));
  g.add(mesh(box(0.2, 0.012, 0.28), kit.mats.black, -0.62, TABLE_TOP + 0.006, -0.2, false));
  const vacancy = vacancyMarker(1.35);
  g.add(vacancy);
  // An overflow seat is put away until they're all taken (see setBeanbags).
  g.visible = !overflow;
  const it: Interactable = { kind: 'desk', deskId: def.id, ...xz(deskSeat(def, 1.25)), radius: 1.3, off: overflow };
  kit.interactables.push(it);
  g.userData.interact = it;
  kit.group.add(g);
  return { view: { def, group: g, laptopAnchor, seatAnchor, stage, chair: new THREE.Group(), vacancy, vacancyY: 1.35 }, it };
}

const CONSOLE_SIGN: Record<StationKind, string> = { issues: '📡 Ask me', pulls: '🔀 Ask me', queue: '📋 Ask me' };

/** A board agent's console: a slanted panel on a pedestal, lit in the agent's color; it stands behind it, as at the office's kiosk. */
export function agentConsole(kit: Kit, def: DeskDef): DeskView {
  const kind = def.station!;
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const { metalDark, metal, black } = kit.mats;
  const color = STATION_AGENT[kind].color;
  g.add(mesh(new THREE.CylinderGeometry(0.3, 0.36, 0.06, 20), metalDark, 0, 0.03, 0));
  g.add(mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.92, 12), metal, 0, 0.5, 0));
  const top = new THREE.Group();
  top.position.set(0, 1.0, 0);
  top.rotation.x = 0.35;
  top.add(mesh(roundedBox(KIOSK.width, 0.07, KIOSK.depth, 0.05), metalDark, 0, 0, 0));
  top.add(mesh(box(KIOSK.width - 0.12, 0.012, KIOSK.depth - 0.14), black, 0, 0.042, 0, false));
  top.add(mesh(box(KIOSK.width - 0.3, 0.014, 0.05), lit(color), 0, 0.045, -0.1, false));
  top.add(mesh(box(KIOSK.width - 0.4, 0.014, 0.05), lit(color), -0.05, 0.045, 0.02, false));
  g.add(top);
  // The agent's color round the pedestal, and a sign facing whoever walks up (-z, the room).
  g.add(mesh(new THREE.TorusGeometry(0.13, 0.03, 6, 20).rotateX(Math.PI / 2), lit(color), 0, 0.72, 0, false));
  const sign = textPlane(CONSOLE_SIGN[kind], { bg: '#0f1a26', color: '#e6f6ff', border: color, size: 56 });
  sign.scale.multiplyScalar(0.5);
  sign.position.set(0, 0.42, -0.14);
  sign.rotation.y = Math.PI;
  g.add(sign);
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.visible = false;
  g.add(laptopAnchor);
  // On its feet behind the console, facing it and the room beyond.
  const stand = new THREE.Object3D();
  stand.position.set(0, -0.07 * 1.1, KIOSK.stand);
  stand.rotation.y = Math.PI;
  stand.scale.setScalar(1.1);
  const seatAnchor = stand.clone();
  g.add(seatAnchor);
  const vacancy = new THREE.Group();
  vacancy.add(stand);
  g.add(vacancy);
  const stage = new THREE.Object3D();
  stage.position.set(0, 1.0, 0);
  stage.rotation.y = Math.PI;
  g.add(stage);
  kit.group.add(g);
  const corners = [-1, 1].flatMap((t) => [-0.25, KIOSK.stand + 0.35].map((s) => deskPoint(def, (t * KIOSK.width) / 2, s)));
  kit.colliders.push({ minX: Math.min(...corners.map((p) => p[0])), maxX: Math.max(...corners.map((p) => p[0])), minZ: Math.min(...corners.map((p) => p[1])), maxZ: Math.max(...corners.map((p) => p[1])), top: 1.5, fence: true });
  const [fx, fz] = deskPoint(def, 0, -1);
  const it: Interactable = { kind: 'station', deskId: def.id, x: fx, z: fz, radius: 1.3 };
  kit.interactables.push(it);
  g.userData.interact = it;
  return { def, group: g, laptopAnchor, seatAnchor, stage, chair: new THREE.Group(), vacancy, vacancyY: 0 };
}

/** The round briefing table, its chairs, and the display on a stand with the meeting's board and sign. */
export function buildBriefing(kit: Kit): { board?: THREE.Mesh; sign?: THREE.Mesh } {
  const cp = kit.plan.council;
  if (!cp) return {};
  const { mats } = kit;
  const t = new THREE.Group();
  t.position.set(cp.x, 0, cp.z);
  t.add(mesh(new THREE.CylinderGeometry(COUNCIL.radius, COUNCIL.radius, 0.08, 36), mats.white, 0, COUNCIL.height - 0.04, 0));
  t.add(mesh(new THREE.TorusGeometry(COUNCIL.radius, 0.03, 6, 40).rotateX(Math.PI / 2), mats.accent, 0, COUNCIL.height - 0.04, 0, false));
  t.add(mesh(new THREE.CylinderGeometry(0.2, 0.34, COUNCIL.height - 0.08, 16), mats.metalDark, 0, (COUNCIL.height - 0.08) / 2, 0));
  t.add(mesh(new THREE.CylinderGeometry(0.6, 0.66, 0.06, 20), mats.metal, 0, 0.03, 0));
  // A projector let into the middle of it.
  t.add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.012, 24), mats.black, 0, COUNCIL.height + 0.006, 0, false));
  t.add(mesh(new THREE.TorusGeometry(0.3, 0.018, 6, 28).rotateX(Math.PI / 2), mats.glow, 0, COUNCIL.height + 0.012, 0, false));
  kit.group.add(t);
  // A square inside the round top, so its corners don't stick out past the edge.
  const r = COUNCIL.radius * Math.SQRT1_2;
  kit.colliders.push({ minX: cp.x - r, maxX: cp.x + r, minZ: cp.z - r, maxZ: cp.z + r, top: COUNCIL.height });
  const meeting: Interactable = { kind: 'meeting', x: cp.x, z: cp.z, radius: 2.5 };
  t.userData.interact = meeting;
  kit.interactables.push(meeting);
  for (const def of kit.plan.meeting) kit.desks.set(def.id, briefingChair(kit, def));
  // A display on a stand behind the table, away from its head, with the meeting's board and how it's going.
  const stand = new THREE.Group();
  stand.position.set(cp.x - Math.sin(cp.rotY) * COUNCIL.easel, 0, cp.z - Math.cos(cp.rotY) * COUNCIL.easel);
  stand.rotation.y = cp.rotY;
  for (const sx of [-1, 1]) {
    stand.add(mesh(box(0.1, 2.3, 0.1), mats.metalDark, sx * 1.05, 1.15, -0.04));
    stand.add(mesh(box(0.14, 0.06, 0.7), mats.metalDark, sx * 1.05, 0.03, -0.04, false));
  }
  stand.add(mesh(box(2.52, 1.62, 0.08), mats.black, 0, 1.95, 0.02));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  board.position.set(0, 1.95, 0.07);
  stand.add(board);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.34), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  sign.position.set(0, 0.92, 0.07);
  stand.add(mesh(box(1.3, 0.42, 0.06), mats.black, 0, 0.92, 0.02));
  stand.add(sign);
  const title = textPlane('🤝 Briefing room', { bg: '#0f1a26', color: '#cfeeff', border: '#3a5a78', size: 56 });
  title.scale.multiplyScalar(0.62);
  title.position.set(0, 2.98, 0.06);
  stand.add(title);
  stand.userData.interact = meeting;
  kit.group.add(stand);
  const [minX, maxX, minZ, maxZ] = boxFootprint(stand.position.x, stand.position.z, 2.6, 0.5, cp.rotY);
  kit.colliders.push({ minX, maxX, minZ, maxZ, top: 99 });
  return { board, sign };
}

/** A chair at the briefing table: a padded seat and back on a pedestal, its laptop on the table in front of it. */
function briefingChair(kit: Kit, def: DeskDef): DeskView {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const chair = new THREE.Group();
  chair.position.set(0, 0, 0.85);
  const { metalDark, metal, pad } = kit.mats;
  chair.add(mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.05, 16), metalDark, 0, 0.025, 0));
  chair.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8), metal, 0, 0.24, 0));
  chair.add(mesh(roundedBox(0.54, 0.1, 0.52, 0.08), pad, 0, 0.47, 0));
  chair.add(mesh(roundedBox(0.5, 0.78, 0.09, 0.04), pad, 0, 0.95, 0.24));
  chair.add(mesh(box(0.3, 0.05, 0.02), kit.mats.accent, 0, 1.22, 0.29, false));
  g.add(chair);
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, COUNCIL.height, COUNCIL.tome.z);
  laptopAnchor.scale.setScalar(COUNCIL.tome.scale);
  g.add(laptopAnchor);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.46, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  g.add(seatAnchor);
  // A merge's dance party: up on its chair rather than the table, which the five laptops fill.
  const stage = new THREE.Object3D();
  stage.position.set(0, 0.52, 0.85);
  g.add(stage);
  const vacancy = vacancyMarker(1.45);
  g.add(vacancy);
  kit.group.add(g);
  kit.colliders.push({ minX: def.x + Math.sin(def.rotY) * 0.85 - 0.3, maxX: def.x + Math.sin(def.rotY) * 0.85 + 0.3, minZ: def.z + Math.cos(def.rotY) * 0.85 - 0.3, maxZ: def.z + Math.cos(def.rotY) * 0.85 + 0.3, top: 0.5 });
  const it: Interactable = { kind: 'desk', deskId: def.id, ...xz(deskSeat(def, 1.5)), radius: 1.1 };
  kit.interactables.push(it);
  g.userData.interact = it;
  return { def, group: g, laptopAnchor, seatAnchor, stage, chair, vacancy, vacancyY: 1.45 };
}

/**
 * The bridge: the raised deck at the forward end with its steps down, lit along their edges, the
 * captain's chair on it, and a helm console either side of the chair. Returns somewhere to sit.
 */
export function buildBridge(kit: Kit): Interactable | undefined {
  const t = kit.plan.throne;
  const dais = kit.plan.dais;
  if (!t || !dais) return undefined;
  const { mats } = kit;
  const g = new THREE.Group();
  g.position.set(t.x, 0, t.z);
  g.rotation.y = t.rotY;
  // It runs 2.4 m in front of the chair (the rest behind), with its steps down from there.
  const front = 2.4;
  const stepD = 0.7;
  const top = dais.height;
  const at = (lx: number, lz: number) => [t.x + Math.cos(t.rotY) * lx + Math.sin(t.rotY) * lz, t.z - Math.sin(t.rotY) * lx + Math.cos(t.rotY) * lz] as const;
  if (top > 0) {
    g.add(mesh(box(dais.width, top, dais.depth), mats.metal, 0, top / 2, front - dais.depth / 2));
    g.add(mesh(box(dais.width - 0.3, 0.012, dais.depth - 0.3), mats.metalDark, 0, top + 0.006, front - dais.depth / 2, false));
    g.add(mesh(box(dais.width, 0.05, 0.05), mats.accent, 0, top - 0.02, front + 0.005, false));
    const [cx, cz] = at(0, front - dais.depth / 2);
    collide(kit, cx, cz, dais.width, dais.depth, t.rotY, top);
    for (let k = 1; k <= dais.steps; k++) {
      const y = (top * (dais.steps + 1 - k)) / (dais.steps + 1);
      const lz = front + (k - 0.5) * stepD;
      g.add(mesh(box(dais.width - k * 0.4, y, stepD), mats.metal, 0, y / 2, lz));
      g.add(mesh(box(dais.width - k * 0.4, 0.04, 0.04), mats.accent, 0, y - 0.015, lz + stepD / 2 + 0.005, false));
      const [sx, sz] = at(0, lz);
      collide(kit, sx, sz, dais.width - k * 0.4, stepD, t.rotY, y);
    }
  }
  // The captain's chair: a wide padded seat on a pedestal, a high back with a headrest, a little panel on each arm.
  const chair = new THREE.Group();
  chair.position.y = top;
  chair.add(mesh(new THREE.CylinderGeometry(0.62, 0.78, 0.16, 24), mats.metalDark, 0, 0.08, -0.05));
  chair.add(mesh(new THREE.CylinderGeometry(0.2, 0.24, 0.38, 14), mats.metal, 0, 0.35, -0.05));
  chair.add(mesh(roundedBox(1.1, 0.16, 1.0, 0.12), mats.pad, 0, 0.66, 0.02));
  chair.add(mesh(roundedBox(1.0, 1.35, 0.2, 0.08), mats.pad, 0, 1.35, -0.46));
  chair.add(mesh(roundedBox(0.62, 0.34, 0.24, 0.08), mats.white, 0, 2.02, -0.45, false));
  chair.add(mesh(box(1.14, 1.5, 0.12), mats.metalDark, 0, 1.3, -0.6));
  chair.add(mesh(box(0.7, 0.05, 0.03), mats.accent, 0, 1.75, -0.35, false));
  for (const sx of [-1, 1]) {
    chair.add(mesh(roundedBox(0.24, 0.3, 0.95, 0.08), mats.metalDark, sx * 0.7, 0.86, 0));
    chair.add(mesh(box(0.2, 0.012, 0.34), mats.black, sx * 0.7, 1.017, 0.24, false));
    chair.add(mesh(box(0.12, 0.014, 0.05), mats.glow, sx * 0.7, 1.02, 0.3, false));
    chair.add(mesh(box(0.12, 0.014, 0.05), mats.accent, sx * 0.7, 1.02, 0.2, false));
  }
  g.add(chair);
  // The helm: a console either side of the chair, by the windows.
  for (const sx of [-1, 1]) {
    const lx = sx * Math.min(dais.width / 2 - 1.4, 5.6);
    const lz = front - dais.depth + 3.2;
    const helm = new THREE.Group();
    helm.position.set(lx, top, lz);
    helm.rotation.y = sx * -0.5;
    helm.add(mesh(box(1.9, 0.86, 0.5), mats.metalDark, 0, 0.43, 0));
    const panel = mesh(box(1.9, 0.07, 0.72), mats.black, 0, 0.94, 0.06, false);
    panel.rotation.x = 0.35;
    helm.add(panel);
    for (const [px, c] of [
      [-0.55, mats.glow],
      [0, mats.accent],
      [0.55, mats.glow],
    ] as const) {
      const key = mesh(box(0.4, 0.02, 0.4), c, px, 0.985, 0.08, false);
      key.rotation.x = 0.35;
      helm.add(key);
    }
    g.add(helm);
    const [hx, hz] = at(lx, lz);
    collide(kit, hx, hz, 1.9, 0.9, t.rotY + sx * -0.5, 99);
  }
  kit.group.add(g);
  collide(kit, t.x - Math.sin(t.rotY) * 0.2, t.z - Math.cos(t.rotY) * 0.2, THRONE_SIZE.width, THRONE_SIZE.depth, t.rotY, 99);
  const seat: Interactable = { kind: 'seat', seatId: t.id, x: t.x, y: t.y, z: t.z, radius: 1.7 };
  chair.userData.interact = seat;
  kit.interactables.push(seat);
  return seat;
}
