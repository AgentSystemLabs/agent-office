import * as THREE from 'three';
import { BEANBAGS, DESKS, DESK_SIZE, FLOOR, KIOSK, SEATING_BY_ID, STATIONS, STATION_AGENT, deskSeat, type DeskDef, type StationKind } from '../../../shared/layout';
import { deskPoint } from '../../../shared/nav';
import { mesh, roundedBox, textPlane, toon } from '../toon';
import type { Collider, DeskView, Interactable } from '../types';
import type { Fixture } from './fixture';
import { PALETTE, box } from './materials';
import { deskBooks, deskMug, plant } from './props';

// Where people sit: the seats you use (see SEATING), and the desks, bean bags and board agents' kiosks
// that workers sit (or stand) at, with the "+" over a free one.

/** Makes `obj` somewhere to sit (see SEATING): walk up to it, or look at it, and press E. */
export function seatable(obj: THREE.Object3D, seatId: string, radius: number, interactables: Interactable[]) {
  const seat = SEATING_BY_ID.get(seatId)!;
  const it: Interactable = { kind: 'seat', seatId, x: seat.x, y: seat.y, z: seat.z, radius };
  interactables.push(it);
  obj.userData.interact = it;
}

export function chair(color: string): THREE.Group {
  const g = new THREE.Group();
  const mat = toon(color);
  g.add(mesh(roundedBox(0.62, 0.1, 0.58, 0.12), mat, 0, 0.5, 0));
  const back = mesh(roundedBox(0.62, 0.1, 0.6, 0.12), mat, 0, 0.86, 0.27);
  back.rotation.x = Math.PI / 2 - 0.12;
  g.add(back);
  g.add(mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.42, 8), toon(PALETTE.deskLeg), 0, 0.26, 0));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const leg = mesh(box(0.05, 0.04, 0.32), toon(PALETTE.deskLeg), Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15);
    leg.rotation.y = a;
    g.add(leg);
  }
  return g;
}

/**
 * The `index`th desk (of DESKS) at `def`: its top, legs and modesty panel (in `trimMat`), its knick-knack,
 * its chair, and the anchors its worker and laptop go in.
 */
export function buildDesk(def: DeskDef, index: number, trimMat: THREE.Material): DeskView {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const { width, depth, height } = DESK_SIZE;
  group.add(mesh(roundedBox(width - 0.06, 0.08, depth - 0.04, 0.08), toon(PALETTE.desk), 0, height - 0.04, 0));
  const legMat = toon('#8d99ae');
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      group.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, height - 0.08, 8), legMat, sx * (width / 2 - 0.14), (height - 0.08) / 2, sz * (depth / 2 - 0.12)));
    }
  }
  // Modesty panel facing away from the worker
  group.add(mesh(box(width - 0.3, 0.32, 0.03), trimMat, 0, height - 0.26, -depth / 2 + 0.06));
  // Little desk decorations. Which desk gets which stays as it is: the holiday present goes in whichever
  // back corner it leaves free (DESK_SPOTS in holiday.ts).
  const deco = index % 3;
  if (deco === 0) {
    // In the chair's color.
    const mug = deskMug(PALETTE.chairs[index % 6]);
    mug.position.set(width / 2 - 0.25, height, -0.2);
    group.add(mug);
  } else if (deco === 1) {
    const p = plant('succulent');
    p.position.set(-width / 2 + 0.25, height, -0.25);
    group.add(p);
  } else {
    // Where the old three boxes stood, the desks with books taking turns with the arrangements.
    const books = deskBooks(Math.floor(index / 3));
    books.position.set(width / 2 - 0.26, height, -0.3);
    group.add(books);
  }

  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, height, -0.06);
  laptopAnchor.scale.setScalar(1.3);
  group.add(laptopAnchor);

  // On the chair, facing the desk.
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.4, 0.93);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  group.add(seatAnchor);

  // Up on the desk beside the laptop, clear of the mug or books at the back, facing the chair.
  const stage = new THREE.Object3D();
  stage.position.set(0.72, height - 0.07, 0.18);
  group.add(stage);

  const ch = chair(PALETTE.chairs[index % PALETTE.chairs.length]);
  ch.position.set(0, 0, 0.9);
  group.add(ch);

  const vacancyY = height + 0.55;
  const vacancy = vacancyMarker(vacancyY);
  group.add(vacancy);

  return { def, group, laptopAnchor, seatAnchor, stage, chair: ch, vacancy, vacancyY };
}

/** The floating green "+" over an empty seat. */
export function vacancyMarker(y: number): THREE.Group {
  const vacancy = new THREE.Group();
  const plusMat = toon('#7cf29a', { emissive: '#1f7a3a' });
  vacancy.add(mesh(box(0.28, 0.08, 0.08), plusMat, 0, 0, 0, false));
  vacancy.add(mesh(box(0.08, 0.28, 0.08), plusMat, 0, 0, 0, false));
  vacancy.position.set(0, y, 0);
  return vacancy;
}

const BEANBAG_COLORS = ['#ff6b6b', '#4ecdc4', '#9b5de5', '#ffd166', '#f15bb5', '#00bbf9', '#06d6a0', '#fb8500'];
/** A bean bag's footprint, with the lap desk in front of it (-z). */
export const BEANBAG_BOX = { minX: -0.62, maxX: 0.62, minZ: -1.1, maxZ: 0.64, top: 0.62 } as const;

/** An overflow seat: a squashy bean bag, and a low lap desk in front of it for the laptop. */
export function buildBeanbag(def: DeskDef, index: number): DeskView {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const bag = new THREE.Group();
  const cloth = toon(BEANBAG_COLORS[index % BEANBAG_COLORS.length]);
  const seat = mesh(new THREE.SphereGeometry(0.62, 20, 14), cloth, 0, 0.3, 0);
  seat.scale.set(1, 0.52, 1);
  bag.add(seat);
  // Slumped up behind the worker, like a back rest.
  const back = mesh(new THREE.SphereGeometry(0.5, 18, 12), cloth, 0, 0.6, 0.32);
  back.scale.set(1.05, 0.95, 0.7);
  bag.add(back);
  group.add(bag);

  const tray = new THREE.Group();
  const wood = toon(PALETTE.wood);
  tray.add(mesh(roundedBox(0.95, 0.05, 0.6, 0.05), wood, 0, 0.42, 0));
  for (const sx of [-1, 1]) tray.add(mesh(box(0.05, 0.4, 0.5), toon('#8a5a3b'), sx * 0.4, 0.2, 0));
  tray.position.z = -0.8;
  group.add(tray);

  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, 0.445, -0.8);
  laptopAnchor.scale.setScalar(1.05);
  group.add(laptopAnchor);

  // Sunk into the bag, facing the lap desk.
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.32, 0.04);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  group.add(seatAnchor);

  // Standing up on the bag, sunk in a little.
  const stage = new THREE.Object3D();
  stage.position.set(0, BEANBAG_BOX.top - 0.1, -0.05);
  stage.rotation.y = Math.PI;
  group.add(stage);

  const vacancyY = 1.25;
  const vacancy = vacancyMarker(vacancyY);
  group.add(vacancy);

  return { def, group, laptopAnchor, seatAnchor, stage, chair: bag, vacancy, vacancyY };
}

const KIOSK_SIGN: Record<StationKind, string> = { issues: '📌 Ask me', pulls: '🔀 Ask me', queue: '📋 Ask me' };

/**
 * A board agent's kiosk: a little counter in its color with a sign on the front, and the agent standing
 * behind it. Its `vacancy` is where the agent waits before anyone has asked it anything (main.ts puts
 * one there), in the same spot and pose as the one who gets hired.
 */
export function buildKiosk(def: DeskDef): DeskView {
  const kind = def.station!;
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const { width, depth, height } = KIOSK;
  const color = toon(STATION_AGENT[kind].color);
  // Narrower at the foot, like a lectern, with a lip round the top.
  group.add(mesh(roundedBox(width - 0.16, height - 0.1, depth - 0.12, 0.06), color, 0, (height - 0.1) / 2 + 0.04, 0));
  group.add(mesh(roundedBox(width - 0.02, 0.06, depth + 0.02, 0.05), toon(PALETTE.ink), 0, 0.03, 0));
  group.add(mesh(roundedBox(width, 0.06, depth, 0.05), toon(PALETTE.desk), 0, height - 0.03, 0));
  const sign = textPlane(KIOSK_SIGN[kind], { bg: '#fffaf3', size: 56 });
  sign.scale.multiplyScalar(0.62);
  sign.position.set(0, height * 0.55, -(depth - 0.12) / 2 - 0.012);
  sign.rotation.y = Math.PI;
  group.add(sign);

  // No laptop: its lid would hide the agent's face from whoever walks up, and its screen would face
  // the wall. The agent's terminal is a key press away (O).
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.visible = false;
  group.add(laptopAnchor);

  // On its feet behind the kiosk, facing it and the room beyond.
  const stand = new THREE.Object3D();
  stand.position.set(0, -0.07 * 1.1, KIOSK.stand);
  stand.rotation.y = Math.PI;
  stand.scale.setScalar(1.1);
  const seatAnchor = stand.clone();
  group.add(seatAnchor);
  const vacancy = new THREE.Group();
  vacancy.add(stand);
  group.add(vacancy);
  // Up on the counter, facing the room.
  const stage = new THREE.Object3D();
  stage.position.set(0, height - 0.1, 0);
  stage.rotation.y = Math.PI;
  group.add(stage);

  return { def, group, laptopAnchor, seatAnchor, stage, chair: new THREE.Group(), vacancy, vacancyY: 0 };
}

declare module '../types' {
  interface OfficeHandles {
    /**
     * Brings out the bean bags in `out` and puts the rest away. Returns the colliders of the ones that
     * just came out, in case someone is standing there.
     */
    setBeanbags(out: Set<string>): Collider[];
  }
}

/** The desks, each with its chair, and what's on it. */
export const desks: Fixture = (site) => {
  DESKS.forEach((def, i) => {
    const view = buildDesk(def, i, site.looks.trim);
    site.group.add(view.group);
    site.desks.set(def.id, view);
    const hw = DESK_SIZE.width / 2 - 0.05;
    const hd = DESK_SIZE.depth / 2 - 0.02;
    site.colliders.push({ minX: def.x - hw, maxX: def.x + hw, minZ: def.z - hd, maxZ: def.z + hd, top: DESK_SIZE.height });
    const seat = deskSeat(def, 1.25);
    const it: Interactable = { kind: 'desk', deskId: def.id, x: seat.x, z: seat.z, radius: 1.3 };
    site.interactables.push(it);
    view.group.userData.interact = it;
  });
  return {};
};

/** Bean bags, put away until every desk is taken. */
export const beanbags: Fixture<'setBeanbags'> = (site) => {
  const bags = new Map<string, { view: DeskView; it: Interactable; collider: Collider }>();
  BEANBAGS.forEach((def, i) => {
    const view = buildBeanbag(def, i);
    view.group.visible = false;
    site.group.add(view.group);
    site.desks.set(def.id, view);
    const it: Interactable = { kind: 'desk', deskId: def.id, x: def.x, z: def.z, radius: 1.8, off: true };
    site.interactables.push(it);
    view.group.userData.interact = it;
    // Its footprint turned the way it faces (a quarter turn at a time).
    const c = Math.round(Math.cos(def.rotY));
    const s = Math.round(Math.sin(def.rotY));
    const xs = [BEANBAG_BOX.minX, BEANBAG_BOX.maxX].flatMap((lx) => [BEANBAG_BOX.minZ, BEANBAG_BOX.maxZ].map((lz) => def.x + lx * c + lz * s));
    const zs = [BEANBAG_BOX.minX, BEANBAG_BOX.maxX].flatMap((lx) => [BEANBAG_BOX.minZ, BEANBAG_BOX.maxZ].map((lz) => def.z - lx * s + lz * c));
    const collider = { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs), top: BEANBAG_BOX.top };
    bags.set(def.id, { view, it, collider });
  });
  const setBeanbags = (out: Set<string>) => {
    const appeared: Collider[] = [];
    for (const [id, b] of bags) {
      const show = out.has(id);
      if (show === b.view.group.visible) continue;
      b.view.group.visible = show;
      b.it.off = !show;
      if (show) {
        site.colliders.push(b.collider);
        appeared.push(b.collider);
      } else site.colliders.splice(site.colliders.indexOf(b.collider), 1);
    }
    return appeared;
  };
  return { handle: { setBeanbags } };
};

/** The board agents' kiosks, each just west of its board. */
export const kiosks: Fixture = (site) => {
  for (const def of STATIONS) {
    const view = buildKiosk(def);
    site.group.add(view.group);
    site.desks.set(def.id, view);
    // The kiosk and the agent behind it, back to the wall (they all stand by the north wall) so
    // nobody squeezes in behind, and up over the agent's head so nobody hops on it.
    const corners = [-1, 1].flatMap((t) => [-KIOSK.depth / 2, KIOSK.stand + 0.35].map((sz) => deskPoint(def, (t * KIOSK.width) / 2, sz)));
    const xs = corners.map(([x]) => x);
    const zs = corners.map(([, z]) => z);
    site.colliders.push({ minX: Math.min(...xs), maxX: Math.max(...xs), minZ: FLOOR.minZ, maxZ: Math.max(...zs), top: 1.5, fence: true });
    // Walk up to its front.
    const [fx, fz] = deskPoint(def, 0, -1);
    const it: Interactable = { kind: 'station', deskId: def.id, x: fx, z: fz, radius: 1.3 };
    site.interactables.push(it);
    view.group.userData.interact = it;
    // The agent, its name tag and the card over its head, up against the wall.
    site.wall('north', def.x, 1.45, 1.4, 2.9);
  }
  return {};
};
