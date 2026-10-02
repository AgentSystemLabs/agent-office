import * as THREE from 'three';
import { KIOSK, STATION_AGENT, deskSeat, type DeskDef, type StationKind } from '../../../shared/layout';
import { BENCH_OUT, COUNCIL, type MapPlan } from '../../../shared/maps';
import { boxFootprint } from '../../../shared/maps/props';
import { deskPoint } from '../../../shared/nav';
import { vacancyMarker } from '../office';
import type { DeskView, Interactable } from '../types';
import { mesh, roundedBox, textPlane, toon } from '../toon';
import { flame } from './fire';
import { BENCH_TOP, TABLE_TOP, collide, xz, type Kit } from './kit';
import { box } from './shapes';

// Where everyone sits and stands: the long tables and their benches with a place at each for a
// worker, the board agents' lecterns, and the round table the meetings are held at.

/** The long tables and their benches, as the plan has them, with candles down the middle. */
export function buildTables(kit: Kit, plan: MapPlan) {
  const { mats } = kit;
  for (const t of plan.tables) {
    const g = new THREE.Group();
    g.position.set(t.x, 0, t.z);
    g.rotation.y = t.rotY;
    // Along local z; the benches along its sides.
    g.add(mesh(roundedBox(t.width, 0.1, t.length, 0.05), mats.wood, 0, TABLE_TOP - 0.05, 0));
    g.add(mesh(box(0.16, 0.12, t.length - 0.8), mats.woodDark, 0, 0.22, 0));
    const legs = Math.max(2, Math.round(t.length / 3.2) + 1);
    for (let i = 0; i < legs; i++) {
      const lz = -t.length / 2 + 0.35 + (i * (t.length - 0.7)) / (legs - 1);
      g.add(mesh(box(t.width - 0.3, TABLE_TOP - 0.1, 0.12), mats.woodDark, 0, (TABLE_TOP - 0.1) / 2, lz));
    }
    // Candles down the middle, between the places.
    for (let i = 0; i < t.seats - 1; i++) {
      const lz = (i + 1 - t.seats / 2) * (t.length / t.seats);
      g.add(mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 8), mats.iron, 0, TABLE_TOP + 0.025, lz, false));
      g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.22, 6), mats.candle, 0, TABLE_TOP + 0.16, lz, false));
      flame(kit, g, 0, TABLE_TOP + 0.28, lz, 0.08);
    }
    for (const s of t.sides) {
      const bx = s * (t.width / 2 + BENCH_OUT);
      g.add(mesh(roundedBox(0.44, 0.08, t.length - 0.2, 0.03), mats.wood, bx, BENCH_TOP - 0.04, 0));
      for (let i = 0; i < legs; i++) {
        const lz = -t.length / 2 + 0.4 + (i * (t.length - 0.8)) / (legs - 1);
        g.add(mesh(box(0.34, BENCH_TOP - 0.08, 0.08), mats.woodDark, bx, (BENCH_TOP - 0.08) / 2, lz));
      }
      collide(kit, t.x + Math.cos(t.rotY) * bx, t.z - Math.sin(t.rotY) * bx, 0.44, t.length - 0.2, t.rotY, BENCH_TOP);
    }
    kit.group.add(g);
    collide(kit, t.x, t.z, t.width, t.length, t.rotY, TABLE_TOP);
  }
}

/** A place at a table: its tome, the worker on the bench, a plate and a goblet, and the '+' while it's free. */
export function placeSetting(kit: Kit, def: DeskDef, overflow: boolean): { view: DeskView; it: Interactable } {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, TABLE_TOP, -0.02);
  laptopAnchor.scale.setScalar(1.1);
  g.add(laptopAnchor);
  // On the bench, facing the table.
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, BENCH_TOP - 0.08, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  g.add(seatAnchor);
  // Up on the table beside the tome.
  const stage = new THREE.Object3D();
  stage.position.set(0.66, TABLE_TOP - 0.07, 0.12);
  g.add(stage);
  g.add(mesh(new THREE.CylinderGeometry(0.16, 0.13, 0.02, 14), toon('#8d939c'), -0.62, TABLE_TOP + 0.01, 0.12, false));
  g.add(mesh(new THREE.CylinderGeometry(0.045, 0.03, 0.14, 8), kit.mats.gold, -0.62, TABLE_TOP + 0.08, -0.12, false));
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

/** The round meeting table, its chairs, and the easel with the meeting's board and sign. */
export function buildCouncil(kit: Kit, plan: MapPlan): { board?: THREE.Mesh; sign?: THREE.Mesh } {
  const cp = plan.council;
  if (!cp) return {};
  const { mats } = kit;
  const t = new THREE.Group();
  t.position.set(cp.x, 0, cp.z);
  t.add(mesh(new THREE.CylinderGeometry(COUNCIL.radius, COUNCIL.radius, 0.1, 32), mats.wood, 0, COUNCIL.height - 0.05, 0));
  t.add(mesh(new THREE.TorusGeometry(COUNCIL.radius, 0.04, 6, 32).rotateX(Math.PI / 2), mats.gold, 0, COUNCIL.height - 0.05, 0, false));
  t.add(mesh(new THREE.CylinderGeometry(0.18, 0.28, COUNCIL.height - 0.1, 10), mats.woodDark, 0, (COUNCIL.height - 0.1) / 2, 0));
  t.add(mesh(new THREE.CylinderGeometry(0.55, 0.6, 0.08, 14), mats.woodDark, 0, 0.04, 0));
  // A map of the realm on the table.
  const chart = mesh(new THREE.CircleGeometry(0.55, 24), mats.parchment, 0, COUNCIL.height + 0.006, 0, false);
  chart.rotation.x = -Math.PI / 2;
  t.add(chart);
  kit.group.add(t);
  // A square inside the round top, so its corners don't stick out past the edge.
  const r = COUNCIL.radius * Math.SQRT1_2;
  kit.colliders.push({ minX: cp.x - r, maxX: cp.x + r, minZ: cp.z - r, maxZ: cp.z + r, top: COUNCIL.height });
  const meeting: Interactable = { kind: 'meeting', x: cp.x, z: cp.z, radius: 2.5 };
  t.userData.interact = meeting;
  kit.interactables.push(meeting);
  for (const def of plan.meeting) kit.desks.set(def.id, councilChair(kit, def));
  // An easel behind the table, away from its head, with the meeting's board and how it's going.
  const easel = new THREE.Group();
  easel.position.set(cp.x - Math.sin(cp.rotY) * COUNCIL.easel, 0, cp.z - Math.cos(cp.rotY) * COUNCIL.easel);
  easel.rotation.y = cp.rotY;
  for (const sx of [-1, 1]) {
    const leg = mesh(box(0.1, 2.9, 0.1), mats.woodDark, sx * 1.05, 1.42, 0);
    leg.rotation.z = sx * -0.05;
    easel.add(leg);
  }
  easel.add(mesh(box(0.1, 2.5, 0.1), mats.woodDark, 0, 1.2, -0.45));
  easel.add(mesh(box(2.5, 1.6, 0.08), mats.woodDark, 0, 1.95, 0.02));
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.4), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  board.position.set(0, 1.95, 0.07);
  easel.add(board);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.34), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  sign.position.set(0, 0.92, 0.07);
  easel.add(mesh(box(1.3, 0.42, 0.06), mats.woodDark, 0, 0.92, 0.02));
  easel.add(sign);
  const title = textPlane('🤝 The small council', { bg: '#efe3c2', size: 56 });
  title.scale.multiplyScalar(0.62);
  title.position.set(0, 2.98, 0.06);
  easel.add(title);
  easel.userData.interact = meeting;
  kit.group.add(easel);
  const [minX, maxX, minZ, maxZ] = boxFootprint(easel.position.x, easel.position.z, 2.6, 0.5, cp.rotY);
  kit.colliders.push({ minX, maxX, minZ, maxZ, top: 99 });
  return { board, sign };
}

const LECTERN_SIGN: Record<StationKind, string> = { issues: '📜 Ask me', pulls: '🔀 Ask me', queue: '📋 Ask me' };

/** A board agent's lectern (a scribe's desk): the agent stands behind it, as at the office's kiosk. */
export function lectern(kit: Kit, def: DeskDef): DeskView {
  const kind = def.station!;
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const { woodDark, wood, parchment } = kit.mats;
  g.add(mesh(box(0.5, 0.06, 0.4), woodDark, 0, 0.03, 0));
  g.add(mesh(box(0.14, 0.95, 0.14), woodDark, 0, 0.5, 0));
  const top = new THREE.Group();
  top.position.set(0, 1.0, 0);
  top.rotation.x = 0.35;
  top.add(mesh(box(KIOSK.width, 0.06, KIOSK.depth), wood, 0, 0, 0));
  // An open book on it, its pages facing whoever walks up (-z, the room).
  for (const sx of [-1, 1]) {
    const pg = mesh(box(0.28, 0.03, 0.36), parchment, sx * 0.15, 0.045, 0, false);
    pg.rotation.z = sx * 0.08;
    top.add(pg);
  }
  top.add(mesh(box(0.02, 0.2, 0.02), toon('#f3ead2'), 0.3, 0.1, 0.15, false));
  g.add(top);
  // The agent's color on a cloth over the front, and a sign.
  g.add(mesh(box(0.42, 0.55, 0.02), toon(STATION_AGENT[kind].color), 0, 0.62, -0.09, false));
  const sign = textPlane(LECTERN_SIGN[kind], { bg: '#efe3c2', size: 56 });
  sign.scale.multiplyScalar(0.55);
  sign.position.set(0, 0.62, -0.11);
  sign.rotation.y = Math.PI;
  g.add(sign);
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.visible = false;
  g.add(laptopAnchor);
  // On its feet behind the lectern, facing it and the room beyond.
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

/** A high-backed chair at the meeting table, with its tome on the table in front of it. */
function councilChair(kit: Kit, def: DeskDef): DeskView {
  const g = new THREE.Group();
  g.position.set(def.x, 0, def.z);
  g.rotation.y = def.rotY;
  const chair = new THREE.Group();
  chair.position.set(0, 0, 0.85);
  const { woodDark, velvet, gold } = kit.mats;
  chair.add(mesh(box(0.6, 0.08, 0.56), woodDark, 0, 0.46, 0));
  chair.add(mesh(roundedBox(0.52, 0.06, 0.48, 0.04), velvet, 0, 0.52, 0, false));
  chair.add(mesh(box(0.6, 1.25, 0.08), woodDark, 0, 1.1, 0.26));
  chair.add(mesh(roundedBox(0.44, 0.7, 0.04, 0.04), velvet, 0, 1.05, 0.21, false));
  chair.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), gold, -0.28, 1.76, 0.26, false));
  chair.add(mesh(new THREE.SphereGeometry(0.06, 8, 6), gold, 0.28, 1.76, 0.26, false));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) chair.add(mesh(box(0.07, 0.46, 0.07), woodDark, sx * 0.25, 0.23, sz * 0.22));
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
  // A merge's dance party: up on its chair rather than the table, which the five tomes fill.
  const stage = new THREE.Object3D();
  stage.position.set(0, 0.48, 0.85);
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
