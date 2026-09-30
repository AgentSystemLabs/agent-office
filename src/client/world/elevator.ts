import * as THREE from 'three';
import { ELEVATOR, ELEVATOR_CAR, ELEVATOR_FRONT, FLOOR, SLAB, STREET_Y, WALL_HEIGHT, streetBelow } from '../../shared/layout';
import { mesh, roundedBox, textPlane, toon } from './toon';
import type { Collider, Interactable } from './types';
import type { Fixture } from './office/fixture';

// The elevator: a steel shaft against the north wall, doors facing into the room. Every floor has
// it in the same place; riding it swaps the floor around you while the doors are shut. The shaft
// goes on down to the garage under the building, where it stops at the back wall too.

const STEEL = '#b8c1cc';
const STEEL_DARK = '#8d99ae';
const BRASS = '#e9b949';

export interface Elevator {
  group: THREE.Group;
  /** What stops you walking out through shut doors. Part of the office's colliders. */
  colliders: Collider[];
  /** Step in, or up to the call button, and press E. */
  interactable: Interactable;
  /** Opens or shuts the doors; they slide there over a moment. */
  setOpen(open: boolean): void;
  readonly open: boolean;
  /** Whether the doors have finished moving. */
  readonly settled: boolean;
  /** The sign over the doors, and the display inside: which floor this is. */
  setSign(text: string): void;
  /** Stands it on the floor at `y`: the garage's goes further down the higher your floor is. */
  setFloor(y: number): void;
  update(dt: number): void;
}

/**
 * An elevator `height` tall, the storey it stands in: the office's, or the garage's under it. The
 * office's walls go on up out of reach; a shorter one's stop at its ceiling.
 */
export function buildElevator(height = WALL_HEIGHT): Elevator {
  const { x, width, depth, wall, doorWidth, doorHeight } = ELEVATOR;
  const group = new THREE.Group();
  const colliders: Collider[] = [];
  const tall = height >= WALL_HEIGHT;
  const topOf = (floorY: number) => (tall ? 99 : floorY + height);
  const minX = x - width / 2;
  const maxX = x + width / 2;
  const back = FLOOR.minZ;
  const front = ELEVATOR_FRONT;
  const midZ = (back + front) / 2;
  const steel = toon(STEEL);
  const steelDark = toon(STEEL_DARK);
  const brass = toon(BRASS);

  // Side walls, the whole height of the room.
  for (const sx of [minX + wall / 2, maxX - wall / 2]) {
    group.add(mesh(new THREE.BoxGeometry(wall, height, depth), steel, sx, height / 2, midZ));
    colliders.push({ minX: sx - wall / 2, maxX: sx + wall / 2, minZ: back, maxZ: front, bottom: 0, top: topOf(0) });
  }
  // The front: a pillar either side of the doorway, and a header over it up to the ceiling line.
  const pillar = (width - doorWidth) / 2;
  for (const [x0, x1] of [
    [minX, x - doorWidth / 2],
    [x + doorWidth / 2, maxX],
  ]) {
    group.add(mesh(new THREE.BoxGeometry(pillar, height, wall), steel, (x0 + x1) / 2, height / 2, front - wall / 2));
    colliders.push({ minX: x0, maxX: x1, minZ: front - wall, maxZ: front, bottom: 0, top: topOf(0) });
  }
  const header = height - doorHeight;
  group.add(mesh(new THREE.BoxGeometry(doorWidth, header, wall), steel, x, doorHeight + header / 2, front - wall / 2));
  // A brass frame round the doorway, and a kick plate along the bottom of the shaft.
  const frameT = 0.08;
  group.add(mesh(new THREE.BoxGeometry(doorWidth + frameT * 2, frameT, 0.05), brass, x, doorHeight + frameT / 2, front + 0.02, false));
  for (const sx of [-1, 1]) group.add(mesh(new THREE.BoxGeometry(frameT, doorHeight, 0.05), brass, x + sx * (doorWidth / 2 + frameT / 2), doorHeight / 2, front + 0.02, false));
  group.add(mesh(new THREE.BoxGeometry(width + 0.02, 0.25, wall + 0.04), steelDark, x, 0.125, front - wall / 2, false));

  // Inside: a dark floor, a mirror on the back wall, handrails, a strip light over the doors.
  const inW = ELEVATOR_CAR.maxX - ELEVATOR_CAR.minX;
  const inD = ELEVATOR_CAR.maxZ - ELEVATOR_CAR.minZ;
  const carFloor = mesh(new THREE.BoxGeometry(inW, 0.02, inD), toon('#3d405b'), x, 0.012, (ELEVATOR_CAR.minZ + ELEVATOR_CAR.maxZ) / 2, false);
  group.add(carFloor);
  for (let i = 1; i < 4; i++) group.add(mesh(new THREE.BoxGeometry(inW, 0.024, 0.03), toon('#565a75'), x, 0.013, ELEVATOR_CAR.minZ + (i * inD) / 4, false));
  const mirror = mesh(new THREE.PlaneGeometry(inW - 0.3, 1.5), new THREE.MeshBasicMaterial({ color: '#cfe8f5' }), x, 1.55, back + 0.02, false);
  group.add(mirror);
  for (const [gx, gw] of [
    [-0.4, 0.14],
    [-0.15, 0.06],
  ]) {
    const glint = mesh(new THREE.PlaneGeometry(gw, 1.1), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.5 }), x + gx, 1.6, back + 0.03, false);
    glint.rotation.z = -0.45;
    group.add(glint);
  }
  const rail = (len: number, px: number, pz: number, alongX: boolean) => {
    const r = mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 8), brass, px, 0.95, pz, false);
    r.rotation.z = alongX ? Math.PI / 2 : 0;
    r.rotation.x = alongX ? 0 : Math.PI / 2;
    group.add(r);
  };
  rail(inW - 0.2, x, back + 0.08, true);
  rail(inD - 0.5, ELEVATOR_CAR.minX + 0.06, midZ - 0.1, false);
  rail(inD - 0.5, ELEVATOR_CAR.maxX - 0.06, midZ - 0.1, false);
  group.add(mesh(new THREE.BoxGeometry(inW - 0.2, 0.06, 0.16), toon('#fff7d6', { emissive: '#ffe08a' }), x, doorHeight + 0.35, front - wall - 0.1, false));

  // The button panel inside, by the doors on the right as you face out (the west wall).
  const panelIn = new THREE.Group();
  panelIn.add(mesh(roundedBox(0.04, 0.7, 0.32, 0.02), steelDark, 0, 0, 0, false));
  for (let row = 0; row < 4; row++) {
    for (const col of [-1, 1]) {
      const b = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 12), toon('#fff7d6', { emissive: row === 0 && col === 1 ? '#ffb400' : '#6c7288' }), -0.03, 0.22 - row * 0.15, col * 0.07, false);
      b.rotation.z = Math.PI / 2;
      panelIn.add(b);
    }
  }
  panelIn.position.set(ELEVATOR_CAR.minX + 0.03, 1.25, front - wall - 0.35);
  panelIn.rotation.y = Math.PI;
  group.add(panelIn);

  // The call button outside, on the right-hand pillar.
  const call = new THREE.Group();
  call.add(mesh(roundedBox(0.2, 0.36, 0.04, 0.02), brass, 0, 0, 0, false));
  const arrow = (up: boolean) => {
    const a = mesh(new THREE.ConeGeometry(0.045, 0.06, 3), toon('#fff7d6', { emissive: up ? '#7cf29a' : '#6c7288' }), 0, up ? 0.07 : -0.07, 0.03, false);
    if (!up) a.rotation.z = Math.PI;
    call.add(a);
  };
  arrow(true);
  arrow(false);
  call.position.set(x + doorWidth / 2 + pillar / 2, 1.2, front + 0.02);
  group.add(call);

  // The doors: two steel panels that slide apart behind the pillars.
  const half = doorWidth / 2 + 0.02;
  const doorZ = front - wall - 0.03;
  const doorMat = toon('#d9dee4');
  const doors = [-1, 1].map((side) => {
    const d = new THREE.Group();
    d.add(mesh(new THREE.BoxGeometry(half, doorHeight - 0.02, 0.05), doorMat, 0, 0, 0));
    // A seam line and a porthole of light, so they read as elevator doors from across the room.
    d.add(mesh(new THREE.BoxGeometry(0.02, doorHeight - 0.1, 0.055), steelDark, (-side * half) / 2 + side * 0.01, 0, 0, false));
    d.add(mesh(new THREE.BoxGeometry(half - 0.2, 0.05, 0.055), steelDark, 0, 0.35, 0, false));
    d.position.set(x + (side * half) / 2, doorHeight / 2, doorZ);
    group.add(d);
    return { group: d, side };
  });
  const doorCollider: Collider = { minX: x - doorWidth / 2, maxX: x + doorWidth / 2, minZ: front - wall - 0.06, maxZ: front, bottom: 0, top: topOf(0) };
  colliders.push(doorCollider);
  /** The floor it stands on: open doors drop their collider under it. */
  let floorY = 0;

  // What floor this is: a sign over the doors, facing the room.
  let sign: ReturnType<typeof textPlane> | null = null;
  const setSign = (text: string) => {
    if (sign) {
      group.remove(sign);
      sign.material.map?.dispose();
      sign.material.dispose();
      sign.geometry.dispose();
    }
    sign = textPlane(text, { bg: '#2b2d42', color: '#fffaf3', size: 64, border: '#fffaf3' });
    const { width: sw, height: sh } = sign.geometry.parameters;
    // As big as fits over the doors (in the garage, under its low ceiling too).
    sign.scale.multiplyScalar(Math.min(1.6, (width + 0.6) / sw, (header - 0.2) / sh));
    sign.position.set(x, doorHeight + Math.min(0.75, header / 2), front + 0.03);
    group.add(sign);
  };

  let open = false;
  let openness = 0; // 0 shut, 1 open
  const setOpen = (v: boolean) => {
    open = v;
    // Shut means shut at once for walking, so nobody slips out while they close.
    if (!v) doorCollider.top = topOf(floorY);
  };
  const update = (dt: number) => {
    const target = open ? 1 : 0;
    if (openness !== target) {
      openness = target > openness ? Math.min(1, openness + dt / 0.7) : Math.max(0, openness - dt / 0.6);
      // Eased, like a real one: slow to start, slow to stop.
      const e = openness * openness * (3 - 2 * openness);
      // As far as the pillars hide them; a sliver still shows at the edge of the doorway.
      for (const d of doors) d.group.position.x = x + (d.side * half) / 2 + d.side * e * (pillar - 0.03);
    }
    if (open && openness > 0.85) doorCollider.top = floorY - 1;
  };

  const interactable: Interactable = { kind: 'elevator', x, z: front - 0.4, radius: 1.9 };
  group.userData.interact = interactable;
  const setFloor = (y: number) => {
    floorY = y;
    group.position.y = y;
    interactable.y = y;
    for (const c of colliders) {
      c.bottom = y;
      c.top = topOf(y);
    }
    if (open && openness > 0.85) doorCollider.top = y - 1;
  };
  return {
    group,
    colliders,
    interactable,
    setOpen,
    get open() {
      return open;
    },
    get settled() {
      return openness === (open ? 1 : 0);
    },
    setSign,
    setFloor,
    update,
  };
}

declare module './types' {
  interface OfficeHandles {
    elevator: Elevator;
    /** The elevator's stop down in the garage, under the building. */
    garageLift: Elevator;
    /** The sign over the elevator doors: which floor you're on. */
    setProjectName(name: string): void;
  }
}

/** The elevator to the other floors, against the north wall between the PR board and the gong. */
export const elevator: Fixture<'elevator' | 'setProjectName'> = (site) => {
  const built = buildElevator();
  site.wall('north', ELEVATOR.x, WALL_HEIGHT / 2, ELEVATOR.width + 0.1, WALL_HEIGHT);
  return {
    group: built.group,
    colliders: built.colliders,
    interactables: [built.interactable],
    update: (_t, dt) => built.update(dt),
    handle: { elevator: built, setProjectName: (name) => built.setSign(`🛗 ${name}`) },
  };
};

/**
 * Its stop in the garage, at the bottom of the same shaft: as tall as the garage, and as far down
 * as the street is (see Office.setLevel).
 */
export const garageLift: Fixture<'garageLift'> = () => {
  const built = buildElevator(-SLAB - STREET_Y);
  built.setSign('🛗 Garage');
  return {
    group: built.group,
    colliders: built.colliders,
    interactables: [built.interactable],
    update: (_t, dt) => built.update(dt),
    setLevel: (index) => built.setFloor(streetBelow(index)),
    handle: { garageLift: built },
  };
};
