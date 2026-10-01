import * as THREE from 'three';
import { BOARDS, LOFT, MACHINE_MONITOR, PLANTS, SEATING_BY_ID, STAIRS, STREET_Y, TV, WALL_HEIGHT, plantByWing } from '../../../shared/layout';
import { wallFacing } from '../../../shared/decor';
import type { NightParts } from '../outside';
import { mesh, roundedBox, textPlane, toon, toonUnique } from '../toon';
import type { Collider, Interactable } from '../types';
import type { Fixture } from './fixture';
import { PALETTE } from './materials';
import { coffeeTable, floorPlant, loungeCouch, pendant, plant, pouf, wallBoard } from './props';
import { seatable } from './seats';

// The room itself, past its walls and its seats: the rugs, what the sky lights and darkens, the boards
// on the walls, the TV and the machine's monitor, the lounge, the plants and the lamps.

declare module '../types' {
  interface OfficeHandles {
    /** Lights, windows and glass for the sky to change with the time of day and the weather. */
    night: NightParts;
    boardMeshes: Record<keyof typeof BOARDS, THREE.Mesh>;
    tvScreen: THREE.Mesh;
    /** The monitor on the west wall showing how busy the office's machine is (features/boards/machine.ts). */
    machineScreen: THREE.Mesh;
    /** The potted plants round the room, in PLANTS' order. At Christmas world/holiday.ts hides their leaves (plantLeaves()) and stands a little tree in each pot. */
    plants: THREE.Group[];
    /** The rugs under the desk clusters, west to east and north to south, which the wardrobe recolors. */
    rugs: THREE.Mesh[];
    /** The lounge's couch (its sofa marked userData.sofa), its rug and its two poufs, which the wardrobe recolors. */
    lounge: { couch: THREE.Group; rug: THREE.Mesh; poufs: THREE.Object3D[] };
    /** The ceiling lamps: each hangs its pendant (see pendant()), which the wardrobe swaps for another. */
    lamps: THREE.Group[];
  }
}

/** Rugs under each desk cluster. */
export const rugs: Fixture<'rugs'> = (site) => {
  const rugs = (
    [
    [-10.5, -4],
    [-1.5, -4],
    [-10.5, 4],
    [-1.5, 4],
    ] as const
  ).map(([x, z], i) => {
    const rug = mesh(roundedBox(6.2, 0.02, 4.6, 0.6), toon(PALETTE.rugs[i]), x, 0.011, z, false);
    site.group.add(rug);
    return rug;
  });
  return { handle: { rugs } };
};

/** What the sky lights and darkens (see NightParts), which everything after it that has any adds to. */
export const nightLights: Fixture<'night'> = () => ({
  handle: {
    night: {
      bulbs: [],
      halos: [],
      lamps: [],
      windows: [],
      street: STREET_Y,
      clouds: toonUnique('#ffffff'),
      wetGlass: new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false, visible: false }),
      glows: [],
    },
  },
});

/** Cork boards on the walls. */
export const boards: Fixture<'boardMeshes'> = (site) => {
  const boardMeshes = {} as Record<keyof typeof BOARDS, THREE.Mesh>;
  for (const key of Object.keys(BOARDS) as (keyof typeof BOARDS)[]) {
    const b = BOARDS[key];
    // Out from the wall, the way the board faces.
    const nx = Math.sin(b.rotY);
    const nz = Math.cos(b.rotY);
    // The queue is a whiteboard in an aluminium frame; the others hang in wood.
    const { group: bg, face } = wallBoard(b.width, b.height, key === 'queue' ? '#aab4be' : PALETTE.wood);
    bg.position.set(b.x + nx * 0.08, b.y, b.z + nz * 0.08);
    bg.rotation.y = b.rotY;
    site.group.add(bg);
    boardMeshes[key] = face;
    const label = textPlane(b.label, { bg: '#fffaf3', size: 64 });
    label.scale.multiplyScalar(1.3);
    label.position.set(b.x + nx * 0.04, b.y + b.height / 2 + 0.5, b.z + nz * 0.04);
    label.rotation.y = b.rotY;
    site.group.add(label);
    const it: Interactable = { kind: key, x: b.x + nx * 1.6, z: b.z + nz * 1.6, radius: 2.4 };
    site.interactables.push(it);
    bg.userData.interact = it;
    // The board and its label above it, up to the ceiling.
    const wall = wallFacing(b.rotY);
    const bottom = b.y - (b.height + 0.3) / 2;
    site.wall(wall, wall === 'north' || wall === 'south' ? b.x : b.z, (bottom + WALL_HEIGHT) / 2, b.width + 0.3, WALL_HEIGHT - bottom);
  }
  return { handle: { boardMeshes } };
};

/** Lounge: the TV on the east wall. */
export const tv: Fixture<'tvScreen'> = (site) => {
  const tvGroup = new THREE.Group();
  tvGroup.add(mesh(roundedBox(TV.width + 0.3, 0.14, TV.height + 0.3, 0.12), toon(PALETTE.ink), 0, 0, 0));
  (tvGroup.children[0] as THREE.Mesh).rotation.x = Math.PI / 2;
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(TV.width, TV.height), new THREE.MeshBasicMaterial({ color: '#1b1d2e' }));
  tvScreen.position.z = 0.08;
  tvGroup.add(tvScreen);
  tvGroup.position.set(TV.x - 0.1, TV.y, TV.z);
  tvGroup.rotation.y = -Math.PI / 2;
  site.group.add(tvGroup);
  const it: Interactable = { kind: 'tv', x: TV.x - 4.5, z: TV.z, radius: 3.2 };
  site.interactables.push(it);
  tvGroup.userData.interact = it;
  site.wall('east', TV.z, TV.y, TV.width + 0.3, TV.height + 0.3);
  return { handle: { tvScreen } };
};

/** The machine monitor between the west windows, facing the desks. */
export const machineMonitor: Fixture<'machineScreen'> = (site) => {
  const monitor = new THREE.Group();
  const bezel = mesh(roundedBox(MACHINE_MONITOR.width + 0.16, 0.1, MACHINE_MONITOR.height + 0.16, 0.06), toon(PALETTE.ink), 0, 0, 0);
  bezel.rotation.x = Math.PI / 2;
  monitor.add(bezel);
  const machineScreen = new THREE.Mesh(new THREE.PlaneGeometry(MACHINE_MONITOR.width, MACHINE_MONITOR.height), new THREE.MeshBasicMaterial({ color: '#ffffff' }));
  machineScreen.position.z = 0.06;
  monitor.add(machineScreen);
  monitor.position.set(MACHINE_MONITOR.x + 0.07, MACHINE_MONITOR.y, MACHINE_MONITOR.z);
  monitor.rotation.y = Math.PI / 2;
  site.group.add(monitor);
  site.wall('west', MACHINE_MONITOR.z, MACHINE_MONITOR.y, MACHINE_MONITOR.width + 0.2, MACHINE_MONITOR.height + 0.2);
  return { handle: { machineScreen } };
};

/** The rest of the lounge: the couch, the coffee table, its rug, and a pouf either side. */
export const lounge: Fixture<'lounge'> = (site) => {
  // The couch, its back to the room, turned from the model's +z to face the TV on the east wall (+x).
  const couch = loungeCouch();
  couch.position.set(10.5, 0, 0);
  couch.rotation.y = Math.PI / 2;
  site.group.add(couch);
  // Its top on the seat cushions, so someone standing on the couch stands on them.
  site.colliders.push({ minX: 10, maxX: 11, minZ: -2.2, maxZ: 2.2, top: 0.47 });
  seatable(couch, 'couch', 2.6, site.interactables);

  const table = coffeeTable();
  table.position.set(13, 0, 0);
  site.group.add(table);
  site.colliders.push({ minX: 12.2, maxX: 13.8, minZ: -0.8, maxZ: 0.8, top: 0.46 });
  const rug = mesh(roundedBox(7, 0.02, 7, 1.2), toon('#ffc6ff'), 13.4, 0.011, 0, false);
  site.group.add(rug);
  const poufs: THREE.Object3D[] = [];

  // A pouf either side of the lounge (the seats still called beanbags), turned to the TV like whoever sits on it.
  for (const [i, [color, x, z]] of (
    [
      ['#06d6a0', 12.5, 3.5],
      ['#ffd166', 14.5, -3.4],
    ] as const
  ).entries()) {
    const id = `lounge-beanbag-${i + 1}`;
    const seat = pouf(color);
    seat.position.set(x, 0, z);
    seat.rotation.y = SEATING_BY_ID.get(id)!.rotY;
    site.group.add(seat);
    poufs.push(seat);
    // Its top on the pouf's, the button in the middle of it.
    site.colliders.push({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.5, maxZ: z + 0.5, top: 0.42 });
    seatable(seat, id, 1.4, site.interactables);
  }
  return { handle: { lounge: { couch, rug, poufs } } };
};

/** Plants around the room: the ones in the way into the back office go while it's built out (see the wing). */
export const plants: Fixture<'plants'> = (site) => {
  const pots: THREE.Group[] = [];
  for (const [i, spot] of PLANTS.entries()) {
    const [x, z, s] = spot;
    const p = plant(floorPlant(i), s);
    p.position.set(x, 0, z);
    site.group.add(p);
    pots.push(p);
    const r = 0.3 * s;
    const collider: Collider = { minX: x - r, maxX: x + r, minZ: z - r, maxZ: z + r, top: 0.5 * s };
    site.colliders.push(collider);
    if (plantByWing(spot)) site.inTheWay.push({ group: p, collider });
  }
  return { handle: { plants: pots } };
};

/** Ceiling lamps (cartoon pendants), hung on long cords down from the high ceiling. */
export const lamps: Fixture<'lamps'> = (site) => {
  const night = site.get('night');
  const lampY = 4.05;
  const lamps: THREE.Group[] = [];
  for (const [x, z] of [
    [-10.5, -4],
    [-1.5, -4],
    [-10.5, 4],
    [-1.5, 4],
    [13, 0],
  ]) {
    const lamp = new THREE.Group();
    lamp.add(pendant(WALL_HEIGHT - lampY));
    lamp.position.set(x, lampY, z);
    site.group.add(lamp);
    lamps.push(lamp);
    night.halos.push({ at: new THREE.Vector3(x, lampY - 0.12, z), size: 1.3, color: '#ffe08a' });
  }
  return { handle: { lamps } };
};

/**
 * Pictures stay clear of the stairs (step by step, so they can hang above them) and of what's on the
 * loft's walls upstairs, as buildLoft places it: the couch and the sign.
 */
export const clearOfStairs: Fixture = (site) => {
  const run = (STAIRS.toX - STAIRS.fromX) / STAIRS.steps;
  const rise = LOFT.y / STAIRS.steps;
  for (let i = 1; i <= STAIRS.steps; i++) site.wall('south', STAIRS.fromX + (i - 0.5) * run, (i * rise) / 2, run, i * rise);
  const loftZ = (LOFT.minZ + LOFT.maxZ) / 2;
  site.wall('east', loftZ, LOFT.y + 0.5, 2.4, 1);
  site.wall('south', LOFT.maxX - 3, LOFT.y + 1.9, 2.6, 0.6);
  return {};
};
