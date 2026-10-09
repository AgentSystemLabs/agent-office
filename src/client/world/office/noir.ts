import * as THREE from 'three';
import { DESK_SIZE, FLOOR, WINDOWS } from '../../../shared/layout';
import { mesh, toon } from '../toon';
import { palette, piece } from '../models';
import type { Collider } from '../types';
import type { Fixture } from './fixture';
import { PALETTE, onWall } from './materials';

// The detective office: the furniture of a 1940s municipal squad room, modelled in Blender
// (blender/scripts/build_noir.py) and put round the floor here. A banker's lamp on every desk, a
// typewriter in whichever back corner the desk's own knick-knack leaves free, a stack of case files,
// filing cabinets along the walls with a telephone on some of them, a venetian blind in every window
// and a dark wood wainscot round the room.
//
// Nothing here changes a seat, a collider the workers walk round, an interactable or a desk id: the
// props go in the gaps the desks already leave (see the anchors in seats.ts's buildDesk), and the
// only new colliders are the filing cabinets, which stand against walls out of the walking. A model
// that didn't load leaves an empty group, so the office opens without any of it (see piece()).

// Preview colours only in Blender; these are the ones the office paints each name with. The
// WoodWarm rail takes the office's own wood, so the blinds match the frames and the stair.
const NOIR_COLORS = {
  Brass: '#a8823c',
  Shade: '#1f6b4a',
  Bakelite: '#1b1b1e',
  Steel: '#3f4a44',
  WoodWarm: PALETTE.wood,
  Paper: '#e8dfc8',
  Folder: '#b99b62',
  Leather: '#4a2f22',
  Slat: '#cfc4ad',
  Cord: '#8a7a5c',
  Ink: '#101418',
};
const paintNoir = palette(NOIR_COLORS);

/**
 * The green glass of a banker's lamp, lit from inside: the office's one warm point in a dark room,
 * and the only material here that isn't flat. Each lamp gets its own, so they can be lit one by one.
 */
function shadeMaterial(): THREE.Material {
  return toon(NOIR_COLORS.Shade, { emissive: '#2f7d52' });
}

/** A banker's lamp: a brass base and stem under a green glass shade, 0.28 m tall. */
export function deskLamp(): THREE.Object3D {
  return piece('noir', 'desk_lamp', (name) => (name === 'Shade' ? shadeMaterial() : paintNoir(name)));
}

/** A bakelite rotary telephone with a brass fingerwheel, 0.24 m wide. */
export function rotaryPhone(): THREE.Object3D {
  return piece('noir', 'rotary_phone', paintNoir);
}

/** A portable typewriter with a sheet of paper in its carriage, 0.42 m wide. */
export function typewriter(): THREE.Object3D {
  return piece('noir', 'typewriter', paintNoir);
}

/** A pile of manila case folders with paper in them, 0.34 by 0.26 m. */
export function fileStack(): THREE.Object3D {
  return piece('noir', 'file_stack', paintNoir);
}

/** A four-drawer steel filing cabinet, 0.47 by 0.62 m and 1.32 m tall, drawers facing +z. */
export function filingCabinet(): THREE.Object3D {
  return piece('noir', 'filing_cabinet', paintNoir);
}

/** A venetian blind hanging from its head rail: 3 m wide, falling 2.2 m from the origin. */
export function venetianBlind(): THREE.Object3D {
  return piece('noir', 'venetian_blind', paintNoir);
}

/** A leather desk blotter with brass corner rules and an inkwell, 1.0 by 0.62 m. */
export function deskBlotter(): THREE.Object3D {
  return piece('noir', 'desk_blotter', paintNoir);
}

/** How high a filing cabinet is, and how deep: its collider, and how far off the wall it stands. */
const CABINET = { width: 0.47, depth: 0.62, height: 1.32, off: 0.31 } as const;

/**
 * Where the cabinets stand: along the west and south walls, in the stretches that are free of
 * windows, the kitchen, the ladder, the machine monitor and the way out. Each entry is the
 * cabinet's middle on the floor, and the turn that faces it into the room (0 faces +z, as every
 * model does). A phone or a pile of files rides on top of the ones with one.
 */
const CABINET_SPOTS: readonly { x: number; z: number; rotY: number; on: 'phone' | 'files' | null }[] = [
  // West wall: north of the first window, then south of the last one and clear of the exit door.
  { x: FLOOR.minX + CABINET.off, z: -11.8, rotY: Math.PI / 2, on: 'phone' },
  { x: FLOOR.minX + CABINET.off, z: 8.2, rotY: Math.PI / 2, on: null },
  { x: FLOOR.minX + CABINET.off, z: 10.2, rotY: Math.PI / 2, on: 'files' },
  // South wall: the stretches between the kitchen, the windows and the balcony doors.
  { x: -11.5, z: FLOOR.maxZ - CABINET.off, rotY: Math.PI, on: 'phone' },
  { x: -7.1, z: FLOOR.maxZ - CABINET.off, rotY: Math.PI, on: null },
  { x: -6.3, z: FLOOR.maxZ - CABINET.off, rotY: Math.PI, on: 'files' },
];

/** Where the case files stand that don't go on a desk: on a cabinet top, and on the floor beside one. */
const FLOOR_STACKS: readonly { x: number; z: number; rotY: number }[] = [
  { x: -17.69, z: -11.95, rotY: 0.2 },
  { x: -17.69, z: 10.45, rotY: -0.3 },
];

/** How high the wood panelling round the room comes, and how thick it stands off the wall. */
const WAINSCOT = { height: 1.05, thick: 0.05 } as const;

/**
 * The dark wood panelling round the room: a boarded dado to chair-rail height, with a rail along the
 * top of it. It stands against the inside of the four walls, so it is never walked into and takes no
 * collider. It goes up as far as the panelling only: above it the cream wall carries on, and the
 * boards and windows sit on that.
 */
function wainscot(): THREE.Group {
  const g = new THREE.Group();
  const wood = toon(PALETTE.desk);
  const rail = toon(PALETTE.wood);
  const { minX, maxX, minZ, maxZ } = FLOOR;
  const w = maxX - minX;
  const d = maxZ - minZ;
  const t = WAINSCOT.thick;
  const h = WAINSCOT.height;
  for (const [len, x, z, ry] of [
    [w, 0, minZ + t / 2, 0],
    [w, 0, maxZ - t / 2, 0],
    [d, minX + t / 2, 0, Math.PI / 2],
    [d, maxX - t / 2, 0, Math.PI / 2],
  ] as const) {
    const panel = mesh(new THREE.BoxGeometry(len, h, t), wood, x, h / 2, z, false);
    panel.rotation.y = ry;
    g.add(panel);
    // The chair rail along the top, standing a little proud of the panelling.
    const cap = mesh(new THREE.BoxGeometry(len, 0.06, t + 0.03), rail, x, h + 0.03, z, false);
    cap.rotation.y = ry;
    g.add(cap);
  }
  return g;
}

/**
 * A venetian blind in the office window `o`, hanging from its head just inside the glass and falling
 * to the sill. Built along x with the window's outside toward +z, the way windowIn() does it, then
 * turned onto its wall (see onWall).
 */
function blindIn(o: (typeof WINDOWS)[number]): THREE.Group {
  const blind = venetianBlind();
  blind.position.set(0, o.y1, 0.04);
  blind.rotation.y = Math.PI;
  const at = onWall(o.wall, o.u);
  const g = new THREE.Group();
  g.add(blind);
  g.position.set(at.x, 0, at.z);
  g.rotation.y = at.rotY;
  return g;
}

/**
 * A file stack's footprint, for its collider on the floor.
 */
const STACK = { width: 0.36, depth: 0.28, height: 0.12 } as const;

/** The office floor's detective furniture: the props on the desks, the cabinets, the blinds and the panelling. */
export const noir: Fixture = (site) => {
  // On every desk: a blotter covering the surface, a banker's lamp at the front left (where a typist's
  // lamp goes), and a typewriter in whichever back corner the desk's own knick-knack has left free.
  // The laptop (0.78 m × 1.3 = 1.01 m wide) lands on top of the blotter in the centre; the blotter's
  // edges poke out on both sides, the way a detective's desk pad does. The case files go on the cabinets
  // and on the floor instead of on the desk, since the laptop takes the middle of the top and whoever
  // dances when a pull request merges stands at (0.72, 0.18).
  for (const def of site.desks.keys()) {
    const view = site.desks.get(def);
    if (!view || view.def.beanbag || view.def.station) continue;
    const { height } = DESK_SIZE;
    const index = Number(def.replace('desk-', '')) - 1;
    const blotter = deskBlotter();
    blotter.position.set(0, height, 0);
    view.group.add(blotter);
    const lamp = deskLamp();
    lamp.position.set(-0.88, height, 0.3);
    view.group.add(lamp);
    // A mug or books stand at the back right (index % 3 of 0 or 2) and a plant at the back left (1),
    // so the typewriter takes the other back corner.
    const right = index % 3 === 1;
    const writer = typewriter();
    writer.position.set(right ? 0.84 : -0.84, height, -0.32);
    writer.rotation.y = right ? -0.22 : 0.22;
    view.group.add(writer);
  }

  // The filing cabinets against the walls, each with its collider so nobody walks into it, and a
  // telephone or a pile of files on the ones that have one.
  const cabinets = new THREE.Group();
  const colliders: Collider[] = [];
  for (const spot of CABINET_SPOTS) {
    const cabinet = filingCabinet();
    cabinet.position.set(spot.x, 0, spot.z);
    cabinet.rotation.y = spot.rotY;
    cabinets.add(cabinet);
    if (spot.on === 'phone') {
      const phone = rotaryPhone();
      phone.position.set(spot.x, CABINET.height, spot.z);
      phone.rotation.y = spot.rotY + Math.PI;
      cabinets.add(phone);
    } else if (spot.on === 'files') {
      const files = fileStack();
      files.position.set(spot.x, CABINET.height, spot.z);
      files.rotation.y = spot.rotY;
      cabinets.add(files);
    }
    // Its footprint, turned the way it faces: a quarter turn at a time.
    const along = Math.abs(Math.sin(spot.rotY)) > 0.5;
    const hw = (along ? CABINET.depth : CABINET.width) / 2;
    const hd = (along ? CABINET.width : CABINET.depth) / 2;
    colliders.push({ minX: spot.x - hw, maxX: spot.x + hw, minZ: spot.z - hd, maxZ: spot.z + hd, top: CABINET.height });
    // The stretch of wall it stands against, so a picture never hangs over it.
    // The cabinet faces into the room (its drawers toward the room centre), so the wall it backs
    // against is the opposite direction from where it faces: π/2 faces east → back to west wall,
    // π faces north → back to south wall, 3π/2 (or -π/2) faces west → back to east wall, 0 → north.
    const wall: 'north' | 'south' | 'east' | 'west' =
      spot.rotY === Math.PI / 2 ? 'west'
      : spot.rotY === Math.PI ? 'south'
      : spot.rotY === -Math.PI / 2 || spot.rotY === (3 * Math.PI) / 2 ? 'east'
      : 'north';
    site.wall(wall, wall === 'east' || wall === 'west' ? spot.z : spot.x, CABINET.height / 2, CABINET.width + 0.1, CABINET.height);
  }

  const group = new THREE.Group();
  group.add(cabinets, wainscot());
  // The case files on the floor beside two of the cabinets, where they were set down.
  for (const spot of FLOOR_STACKS) {
    const files = fileStack();
    files.position.set(spot.x, 0, spot.z);
    files.rotation.y = spot.rotY;
    cabinets.add(files);
    colliders.push({ minX: spot.x - STACK.width / 2, maxX: spot.x + STACK.width / 2, minZ: spot.z - STACK.depth / 2, maxZ: spot.z + STACK.depth / 2, top: STACK.height });
  }
  // A blind in every window at floor level: the loft's two are up in the loft, out of this room.
  for (const o of WINDOWS) if (o.y1 <= 4) group.add(blindIn(o));
  return { group, colliders };
};