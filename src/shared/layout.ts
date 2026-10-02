// Static office layout shared by the server (validation) and client (rendering).
// Units are meters; +y is up. The office floor spans FLOOR.minX..maxX / minZ..maxZ at y = 0,
// upstairs over a garage whose floor is level with the street (STREET_Y).

export const FLOOR = { minX: -18, maxX: 18, minZ: -13, maxZ: 13 } as const;
/** How high the ceiling is: a meter over the loft's roof (LOFT.y + LOFT.height), all the way across the room. */
export const WALL_HEIGHT = 6.8;

export interface DeskDef {
  id: string;
  x: number;
  z: number;
  /** Rotation around Y. At 0 the worker sits on the desk's +z side, facing -z. */
  rotY: number;
  label: string;
  /** A bean bag on the floor instead of a desk; the worker sits on it at (x, z), facing -z at rotY 0. */
  beanbag?: boolean;
  /** A board agent's kiosk instead of a desk (see STATIONS): the worker stands behind it. */
  station?: StationKind;
  /** A chair at the meeting room's table (see MEETING_SEATS): only a meeting seats a worker here. */
  room?: boolean;
  /** A desk in the back office (see WING): there once the floor is built out this many rows. */
  wing?: number;
}

const DESK_WIDTH = 2.2;
const DESK_DEPTH = 1.1;
export const DESK_SIZE = { width: DESK_WIDTH, depth: DESK_DEPTH, height: 0.78 } as const;

function buildDesks(): DeskDef[] {
  const desks: DeskDef[] = [];
  const clusterX = [-10.5, -1.5];
  // Each pod is two back-to-back rows; the far row faces +z (rotY = PI).
  const pods = [
    { back: -4.55, front: -3.45 },
    { back: 3.45, front: 4.55 },
  ];
  let n = 1;
  for (const pod of pods) {
    for (const cx of clusterX) {
      for (const [z, rotY] of [
        [pod.back, Math.PI],
        [pod.front, 0],
      ] as const) {
        for (const dx of [-DESK_WIDTH / 2, DESK_WIDTH / 2]) {
          desks.push({ id: `desk-${n}`, x: cx + dx, z, rotY, label: `Desk ${n}` });
          n++;
        }
      }
    }
  }
  return desks;
}

export const DESKS: DeskDef[] = buildDesks();

/**
 * The back office: a bay knocked through the north wall between the gong and the east wall, for a
 * floor that needs more desks than the room has. Each time someone expands the floor (see
 * shared/floorplan.ts), its back wall goes another `row` meters north, with two more desks back to
 * back in the middle, up to `rows` times: any further and it would stand in the street behind the
 * building (world/city.ts). It runs from `minX` (the gong keeps its bit of wall) to the east wall,
 * and from the old north wall back to wingMinZ.
 */
export const WING = { minX: 13.4, maxX: FLOOR.maxX, row: 4.6, rows: 2 } as const;

/** A floor built out `level` rows, as a whole number from 0 (just the room) to WING.rows. */
export function wingLevel(level: unknown): number {
  return typeof level === 'number' && Number.isFinite(level) ? Math.max(0, Math.min(WING.rows, Math.floor(level))) : 0;
}

/** How far north the back office's back wall is, built out `level` rows: the north wall with none. */
export function wingMinZ(level: number): number {
  return FLOOR.minZ - wingLevel(level) * WING.row;
}

/** Whether (x, z) is in the back office, built out `level` rows. */
export function inWing(x: number, z: number, level: number): boolean {
  return level > 0 && x > WING.minX && x < WING.maxX && z <= FLOOR.minZ && z > wingMinZ(level);
}

/** The middle of the back office's row `row` (1 is the first, through the old north wall). */
export function wingRowZ(row: number): number {
  return FLOOR.minZ - (row - 0.5) * WING.row;
}

/**
 * The back office's desks: a back-to-back pair down the middle of each row, like half a pod, with
 * room to walk round either side. The far one's worker faces the room; the near one's faces the back.
 */
export const WING_DESKS: DeskDef[] = Array.from({ length: WING.rows }, (_, i) => {
  const z = wingRowZ(i + 1);
  const x = (WING.minX + WING.maxX) / 2;
  const n = DESKS.length + 2 * i + 1;
  return [
    { id: `desk-${n}`, x, z: z - DESK_DEPTH / 2, rotY: Math.PI, label: `Desk ${n}`, wing: i + 1 },
    { id: `desk-${n + 1}`, x, z: z + DESK_DEPTH / 2, rotY: 0, label: `Desk ${n + 1}`, wing: i + 1 },
  ];
}).flat();

/** Whether `desk` is there on a floor built out `level` rows: every desk in the room is. */
export function deskBuilt(desk: DeskDef, level: number): boolean {
  return !desk.wing || desk.wing <= level;
}

/** Every desk on a floor built out `level` rows: the room's, then the back office's. */
export function builtDesks(level: number): DeskDef[] {
  return [...DESKS, ...WING_DESKS.filter((d) => deskBuilt(d, level))];
}

/**
 * Overflow seats: once every desk is taken, bean bags come out around the room, one at a time in
 * this order. Each faces a window or a wall, with open floor behind it to walk up to.
 */
export const BEANBAGS: DeskDef[] = (
  [
    // Out in the north-east corner past the gong, and between the PR board and the elevator, clear of
    // the gong's front and the elevator doors.
    [15, -9.8, 0],
    [5.4, -9.8, 0],
    [-16.1, -9, Math.PI / 2],
    [-16.1, -3, Math.PI / 2],
    [-8.8, 10.2, Math.PI],
    [0.8, 10.2, Math.PI],
    [12.2, -5.6, -Math.PI / 2],
    [12.2, 5.6, -Math.PI / 2],
    [-16.1, 3, Math.PI / 2],
    // Clear of the board agents' kiosks, and of the floor in front of them.
    [-13.2, -9.8, 0],
    [-12.6, 9.2, Math.PI / 2],
    [-5.4, -9.8, 0],
  ] as const
).map(([x, z, rotY], i) => ({ id: `beanbag-${i + 1}`, x, z, rotY, label: `Bean bag ${i + 1}`, beanbag: true }));

/** Everywhere a worker can sit: the desks, the back office's once it's built out (see deskBuilt), then the bean bags. */
export const SEATS: DeskDef[] = [...DESKS, ...WING_DESKS, ...BEANBAGS];

/** The boards with an agent standing by: the Issues board, the PR board and the task queue. */
export type StationKind = 'issues' | 'pulls' | 'queue';

/**
 * The board agents: a worker standing behind a little kiosk just west of each of those boards (see
 * BOARDS), there for anyone to prompt about it. (x, z) is the kiosk. They face into the room, so at
 * rotY PI the worker stands on the wall side of it. Nobody hires them from the desks or the queue.
 */
export const STATIONS: DeskDef[] = [
  // Between the plant in the north-west corner and the Issues board.
  { id: 'station-issues', station: 'issues', x: -15.6, z: FLOOR.minZ + 1.3, rotY: Math.PI, label: 'Issues board' },
  // Between the task queue and the PR board.
  { id: 'station-pulls', station: 'pulls', x: 0, z: FLOOR.minZ + 1.3, rotY: Math.PI, label: 'PR board' },
  // Between the Issues board and the task queue.
  { id: 'station-queue', station: 'queue', x: -7.8, z: FLOOR.minZ + 1.3, rotY: Math.PI, label: 'Task queue' },
];
/** A board agent's kiosk: its top, and how far behind its middle (toward the wall) the agent stands. */
export const KIOSK = { width: 0.8, depth: 0.5, height: 0.55, stand: 0.55 } as const;
/** Each board agent's name and its color, the same whenever it's hired. */
export const STATION_AGENT: Record<StationKind, { name: string; color: string }> = {
  issues: { name: 'Issues agent', color: '#ef476f' },
  pulls: { name: 'PR agent', color: '#118ab2' },
  queue: { name: 'Queue agent', color: '#06d6a0' },
};

/** The upstairs office: a glass-walled loft on posts in the south-east corner, looking down on the desks. */
export const LOFT = { minX: 9, maxX: FLOOR.maxX, minZ: 8, maxZ: FLOOR.maxZ, y: 3, height: 2.8 } as const;
/** Its stairs climb east along the south wall and arrive at the loft's west door. */
export const STAIRS = { fromX: 3, toX: LOFT.minX, minZ: 11.2, maxZ: FLOOR.maxZ, steps: 15 } as const;

/**
 * The meeting room: glass walls round the space under the boss office, from the loft's posts to the
 * outside walls, with a long table in the middle. Workers called to a meeting sit round it (see
 * MEETING_SEATS and server/meetings.ts). The glass stops under the loft's floor; the door is in the
 * north wall, facing the lounge.
 */
export const MEETING_ROOM = { minX: LOFT.minX + 0.15, maxX: FLOOR.maxX, minZ: LOFT.minZ + 0.15, maxZ: FLOOR.maxZ, height: LOFT.y - 0.25, door: { x0: 10, x1: 11.4 } } as const;
export const MEETING_TABLE = { x: 13.7, z: 10.5, width: 4.2, depth: 1.7, height: 0.76 } as const;
/**
 * A laptop at the meeting table: its size next to the model's, and how far toward its chair it lies
 * from the place (x, z) it's at. With the place this far in from the table's edge, two open laptops
 * facing each other across the table have room between the backs of their lids.
 */
export const MEETING_LAPTOP = { scale: 1, z: 0.07, in: 0.45 } as const;
/**
 * The chairs round the meeting table, in the order a meeting fills them: the head of the table at its
 * west end (whoever leads or writes the meeting up), then two down each side. (x, z) is its place at
 * the table, where its laptop goes (MEETING_LAPTOP); the chair is out from it the way a desk's is (deskSeat).
 */
export const MEETING_SEATS: DeskDef[] = (
  [
    [MEETING_TABLE.x - MEETING_TABLE.width / 2 + MEETING_LAPTOP.in, MEETING_TABLE.z, -Math.PI / 2],
    [MEETING_TABLE.x - 0.65, MEETING_TABLE.z - MEETING_TABLE.depth / 2 + MEETING_LAPTOP.in, Math.PI],
    [MEETING_TABLE.x - 0.65, MEETING_TABLE.z + MEETING_TABLE.depth / 2 - MEETING_LAPTOP.in, 0],
    [MEETING_TABLE.x + 1.15, MEETING_TABLE.z - MEETING_TABLE.depth / 2 + MEETING_LAPTOP.in, Math.PI],
    [MEETING_TABLE.x + 1.15, MEETING_TABLE.z + MEETING_TABLE.depth / 2 - MEETING_LAPTOP.in, 0],
  ] as const
).map(([x, z, rotY], i) => ({ id: `meeting-${i + 1}`, x, z, rotY, label: i === 0 ? 'Head of the table' : `Meeting chair ${i + 1}`, room: true }));
/** The board on the meeting room's back (south) wall that shows the meeting's output file as it's written. */
export const MEETING_BOARD = { x: MEETING_TABLE.x, y: 1.95, z: FLOOR.maxZ - 0.08, width: 3.6, height: 1.2 } as const;

/** Any place a worker can be by id: the seats (the back office's included), the board agents' kiosks and the meeting room's chairs. */
export const DESK_BY_ID = new Map([...SEATS, ...STATIONS, ...MEETING_SEATS].map((d) => [d.id, d]));

/**
 * The seat a new worker takes when nobody picks one: the first free desk (in the back office too, as
 * far as the floor is built out: `wing` rows), else the first free bean bag.
 */
export function nextFreeSeat(taken: (id: string) => boolean, wing = 0): DeskDef | undefined {
  return SEATS.find((d) => !taken(d.id) && deskBuilt(d, wing));
}

/**
 * The bean bags that are out: every one in use, and while every desk is taken (the back office's
 * too, built out `wing` rows), the next free one too, so there's always somewhere to hire the next worker.
 */
export function beanbagsOut(taken: (id: string) => boolean, wing = 0): Set<string> {
  const out = new Set(BEANBAGS.filter((b) => taken(b.id)).map((b) => b.id));
  if (builtDesks(wing).every((d) => taken(d.id))) {
    const spare = BEANBAGS.find((b) => !taken(b.id));
    if (spare) out.add(spare.id);
  }
  return out;
}

/**
 * The places nobody is at: every seat and board agent's kiosk with no worker there and nobody sent
 * home still packing up there (`packing`). Each shows that it's free, with a '+' over a seat and the
 * board agent waiting at a kiosk. It's worked out afresh from who's there rather than seat by seat as
 * workers come and go, so swapping one floor's workers for another's never leaves a place showing
 * free under someone (two floors can each have a Queue agent at the same kiosk).
 */
export function vacantSeats(workers: Iterable<{ deskId: string }>, packing: (id: string) => boolean = () => false): Set<string> {
  const taken = new Set<string>();
  for (const w of workers) taken.add(w.deskId);
  return new Set([...DESK_BY_ID.keys()].filter((id) => !taken.has(id) && !packing(id)));
}

/** Where the worker (and the interacting player) stands relative to the desk. */
export function deskSeat(desk: DeskDef, offset = 0.85): { x: number; z: number } {
  return {
    x: desk.x + Math.sin(desk.rotY) * offset,
    z: desk.z + Math.cos(desk.rotY) * offset,
  };
}

/** Wall boards. `rotY` is the way the board faces (0 = +z, like the north-wall boards). */
export const BOARDS = {
  // Side by side along the north wall, the way work goes: an issue goes on the task queue (the
  // whiteboard in the middle), and its worker's pull request comes out the other side. Each has its
  // board agent's kiosk just west of it (see STATIONS).
  issues: { x: -11.7, y: 2.1, z: FLOOR.minZ + 0.08, rotY: 0, width: 6, height: 3, label: 'Issues' },
  queue: { x: -3.9, y: 2.1, z: FLOOR.minZ + 0.08, rotY: 0, width: 6, height: 3, label: '📋 Task queue' },
  pulls: { x: 3.9, y: 2.1, z: FLOOR.minZ + 0.08, rotY: 0, width: 6, height: 3, label: 'Pull Requests' },
  // East wall, north of the lounge TV.
  services: { x: FLOOR.maxX - 0.08, y: 2.1, z: -8.2, rotY: -Math.PI / 2, width: 6, height: 3, label: '🌐 Services' },
} as const;

/** The big TV on the east wall that shows whoever is screen sharing. */
export const TV = { x: FLOOR.maxX - 0.1, y: 2.2, z: 0, width: 6.4, height: 3.6 } as const;
/**
 * The monitor on the west wall, between the first two windows from the north (the ladder has the
 * span between the middle two) and facing the desks: how busy the office's machine is, and how many
 * workers it runs of the most it takes.
 */
export const MACHINE_MONITOR = { x: FLOOR.minX, y: 2.2, z: -6, width: 2.3, height: 1.3 } as const;
/** The lounge jukebox, against the east wall south of the TV, facing into the room. `y` is its speaker. */
export const JUKEBOX = { x: FLOOR.maxX - 0.42, y: 0.75, z: 5.4, width: 1.3, depth: 0.72, height: 1.85 } as const;
/** The arcade cabinet, against the east wall between the jukebox and the loft, facing into the room. `width` runs along the wall. */
export const CABINET = { x: FLOOR.maxX - 0.42, z: 7.05, width: 0.8, depth: 0.8, height: 1.9 } as const;

/**
 * The bookshelf of the project's docs (every Markdown file in it, see shared/docs.ts): against the
 * south wall between the middle window and the balcony doors, facing into the room (-z). `width`
 * runs along the wall.
 */
export const BOOKSHELF = { x: -6.5, z: FLOOR.maxZ - 0.21, width: 1.7, depth: 0.42, height: 2.3 } as const;

export const SPAWN = { x: 8, z: 7 } as const;

/** The gong: on the north wall just past the elevator from the PR board, facing into the room. It rings when a PR merges. */
export const GONG = { x: 11.8, z: FLOOR.minZ + 0.75, width: 1.9, height: 2.45 } as const;

/** Potted plants around the room: where each stands, and how big it is. */
export const PLANTS: readonly (readonly [x: number, z: number, scale: number])[] = [
  [-17.2, -12.2, 1.4],
  [17.2, -12.2, 1.5],
  [17.2, 12.2, 1.3],
  [-17.2, 8.5, 1.2],
  [14.2, -12.2, 1.1],
  [-6, 0, 1],
  [3.5, 0, 0.9],
  [8.5, 5, 1.1],
];

/** A plant by the north wall east of the gong, in the way into the back office: put away once it's built. */
export function plantByWing([x, z]: readonly [number, number, number]): boolean {
  return x > WING.minX && z < FLOOR.minZ + 1.5;
}

/** The plants standing on a floor built out `level` rows (see WING). */
export function plantsAt(level: number): readonly (readonly [x: number, z: number, scale: number])[] {
  return level > 0 ? PLANTS.filter((p) => !plantByWing(p)) : PLANTS;
}

/**
 * The whiteboard on wheels everyone draws on together, out on the open floor between the desks and
 * the lounge, facing into the room (+z). `width` and `height` are its writing surface, whose bottom
 * edge is `bottom` above the floor.
 */
export const WHITEBOARD = { x: 5.4, z: -5.4, width: 4, height: 2.2, bottom: 0.5 } as const;

/**
 * The bottom floor of the building is its second storey: the street, and the open garage under the
 * office, are this far below its floor. Each floor stands one STOREY higher than the one below it,
 * so from floor `i` the street is `streetBelow(i)` down.
 */
export const STREET_Y = -3.6;
/** The street runs east–west in front of the building (south, +z), with a sidewalk along either side. */
export const ROAD = { minZ: 23, maxZ: 31 } as const;
/** The office's floor slab, which is the garage's ceiling: it runs from -SLAB up to 0. */
export const SLAB = 0.3;
/** From one floor of the building up to the next: the office's ceiling, and the slab over it. */
export const STOREY = WALL_HEIGHT + SLAB;
/** How thick the outside walls are. They stand just outside FLOOR. */
export const WALL_T = 0.3;

/** How far below floor `index` of the building (0 is the bottom one) the street is. */
export function streetBelow(index: number): number {
  return STREET_Y - Math.max(0, index) * STOREY;
}

export type Side = 'north' | 'south' | 'east' | 'west';

/**
 * A hole in an outside wall: `u` is its center along the wall (x on the north and south walls, z on
 * the east and west ones), `y0`..`y1` its sill and head above the office floor.
 */
export interface Opening {
  wall: Side;
  u: number;
  width: number;
  y0: number;
  y1: number;
}

/** Windows you can see out of, and the loft's two, which sit higher up. */
export const WINDOWS: Opening[] = [
  ...[-14, -9, 1].map((u) => ({ wall: 'south' as const, u, width: 3, y0: 1.1, y1: 3.3 })),
  ...[-9, -3, 3].map((u) => ({ wall: 'west' as const, u, width: 3, y0: 1.1, y1: 3.3 })),
  { wall: 'south', u: LOFT.minX + 2, width: 2.8, y0: LOFT.y + 0.9, y1: LOFT.y + 2.5 },
  { wall: 'east', u: (LOFT.minZ + LOFT.maxZ) / 2, width: 2.8, y0: LOFT.y + 0.9, y1: LOFT.y + 2.5 },
];

/**
 * The way out of the bottom floor: a door in the west wall onto a landing, with stairs down to the
 * street. The floors above have no door there; workers leave them off the balcony (see PARACHUTE).
 */
export const EXIT_DOOR: Opening = { wall: 'west', u: 6.5, width: 1.4, y0: 0, y1: 2.4 };
export const EXIT_STAIRS = {
  maxX: FLOOR.minX - WALL_T,
  minX: FLOOR.minX - WALL_T - 1.6,
  /** The landing outside the door, level with the office floor. */
  landingZ0: 5.6,
  landingZ1: 7.5,
  /** The steps run south from the landing down to the street. */
  steps: 15,
  run: 0.34,
} as const;

/** Glass doors out to the balcony, on the south wall. They slide apart into the wall on either side. */
export const BALCONY_DOOR: Opening = { wall: 'south', u: -4, width: 3, y0: 0, y1: 2.5 };
/** The smoking balcony, hanging over the garage entrance. */
export const BALCONY = { minX: -10.5, maxX: 2.5, minZ: FLOOR.maxZ + WALL_T, maxZ: FLOOR.maxZ + WALL_T + 3.4 } as const;
/** The ashtray on the balcony, where a smoke break starts. */
export const ASHTRAY = { x: -8.2, z: BALCONY.maxZ - 0.55 } as const;
/**
 * The golf tee on the balcony, between the ashtray and the doors: a square of turf `size` across,
 * with the ball teed up at `ball`, hit out over the railing at the hole across the street
 * (GOLF_HOLE). The golf bag leans on the wall behind it at `bag`, just short of the doors.
 */
export const GOLF_TEE = { x: -6.75, z: 14.75, size: 1.5, ball: { x: -6.95, z: 14.75 }, bag: { x: -5.8, z: BALCONY.minZ + 0.28 } } as const;
/**
 * The hole across the street, out past the far sidewalk where the neighbours leave a gap: its pin,
 * the green round it (`green` its radius) and the fairway leading up to it (x `fairway` wide, from
 * the sidewalk to the green). Down on the street, so it's further down the higher your floor is.
 */
export const GOLF_HOLE = { x: -5, z: 58, green: 5.5, fairway: [-11, 0] } as const;
/**
 * Leaving a floor above the bottom one, with no exit door: out through the balcony doors to the
 * railing straight ahead (`jump`), up onto its top (`railTop` high), and over it by parachute. The
 * chute circles down onto the lot in front of the garage: `out` further from the building than it
 * opened, and `east` (a random bit of it) along, clear of the balconies below and the street lamp by
 * the balcony doors.
 */
export const PARACHUTE = { jump: { x: BALCONY_DOOR.u, z: BALCONY.maxZ - 0.45 }, railTop: 1.09, out: 1.2, east: [0.6, 1.8] } as const;

// ---- The rooftop bar (see shared/rooftop.ts) ------------------------------------------------------
// The roof of the building, level with the office floor's y = 0 and the same size, so the elevator
// comes up in its usual spot. A glass railing runs round the edge, and the city is far below.

/**
 * How far below the roof the street is, with `floors` floors under it: the building is this tall.
 * The roof stands a STOREY over the top floor, where a floor above it would be.
 */
export function roofDrop(floors: number): number {
  return -streetBelow(Math.max(1, floors));
}
/** The DJ's stage, against the north edge west of the elevator, with the dance floor in front of it. */
export const STAGE = { minX: -8, maxX: 2, minZ: FLOOR.minZ, maxZ: -9.2, height: 0.6 } as const;
/** Where the DJ stands behind the decks, facing the dance floor (+z). */
export const DJ_BOOTH = { x: -3, z: -11.3 } as const;
/** LED tiles, a meter each, lighting up with the music. */
export const DANCE_FLOOR = { minX: -8, maxX: 2, minZ: -9.2, maxZ: -2.2 } as const;
/** The bar along the east side: its counter (x is its middle), with the bartender and the bottles behind it. */
export const ROOF_BAR = { x: 12.95, minZ: -6, maxZ: 4, depth: 0.7, height: 1.1 } as const;
/** The fire pit in the lounge, in the south-west corner, with sofas round three sides of it. */
export const FIRE_PIT = { x: -12, z: 8.2, r: 0.9 } as const;
/** Tall tables to stand at, between the elevator and the bar. */
export const ROOF_TABLES: readonly { x: number; z: number }[] = [
  { x: 6.6, z: 5.2 },
  { x: 9.6, z: 8.8 },
  { x: 6, z: 10.8 },
];
/** Sun loungers along the south edge, looking out over the street. */
const LOUNGERS = [-2.2, 0.6, 3.4];

/**
 * Something to sit on, standing at x, z on the floor at `y` (the loft's, for what's up there). You
 * sit facing `rotY` (0 = +z). A couch or a bench has a few places side by side; a chair, a stool or a beanbag has one.
 */
export interface SeatDef {
  id: string;
  /** What the hint calls it. */
  label: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  /** Where each place is along it, sideways from its middle. */
  places: readonly number[];
  /** How high above its floor your hips go: on the cushion, sunk in a little. */
  hips: number;
  /** How far in front of its middle you sit (negative: further back, against the backrest). */
  depth: number;
  /** Getting up, you step off this far in front of where you sat (negative: behind, away from a desk or a table). */
  out: number;
  /** It faces the lounge TV: sitting down there puts whatever's being shared up on your screen. */
  tv?: boolean;
  /** It faces the boss's monitor: E there, sitting down, plays Minesweeper on it. */
  game?: boolean;
  /** Up on the rooftop bar, not in the office. */
  roof?: boolean;
  /** At the bar: E there, sitting down, orders a drink. */
  bar?: boolean;
}

/**
 * Where people can sit: the office's couches, beanbags, chairs and the balcony bench (buildOffice puts
 * them there). Workers have their own seats, the desks and bean bags in SEATS.
 */
export const SEATING: SeatDef[] = [
  // The lounge couch, its back to the room, facing the TV.
  { id: 'couch', label: '🛋️ Couch', x: 10.5, y: 0, z: 0, rotY: Math.PI / 2, places: [-1.2, 0, 1.2], hips: 0.5, depth: -0.05, out: 0.9, tv: true },
  // Beanbags either side of the lounge, turned to the TV.
  { id: 'lounge-beanbag-1', label: '🫘 Beanbag', x: 12.5, y: 0, z: 3.5, rotY: Math.atan2(TV.x - 12.5, TV.z - 3.5), places: [0], hips: 0.42, depth: -0.1, out: 1.2 },
  { id: 'lounge-beanbag-2', label: '🫘 Beanbag', x: 14.5, y: 0, z: -3.4, rotY: Math.atan2(TV.x - 14.5, TV.z + 3.4), places: [0], hips: 0.42, depth: -0.1, out: 1.2 },
  // Up in the boss office: the couch against the east wall, and the chair at the big desk, facing the glass.
  { id: 'loft-couch', label: '🛋️ Couch', x: LOFT.maxX - 0.65, y: LOFT.y, z: (LOFT.minZ + LOFT.maxZ) / 2, rotY: -Math.PI / 2, places: [-0.5, 0.5], hips: 0.5, depth: -0.05, out: 0.9 },
  { id: 'boss-chair', label: "🪑 Boss's chair", x: (LOFT.minX + LOFT.maxX) / 2 + 0.5, y: LOFT.y, z: (LOFT.minZ + LOFT.maxZ) / 2 + 0.7, rotY: Math.PI, places: [0], hips: 0.62, depth: -0.05, out: -0.8, game: true },
  // Out on the balcony: the bench under the window, looking out over the street, and a stool either side of the bistro table.
  { id: 'bench', label: '🪑 Bench', x: -9, y: 0, z: BALCONY.minZ + 0.3, rotY: 0, places: [-0.5, 0.5], hips: 0.47, depth: 0, out: 0.8 },
  { id: 'stool-1', label: '🪑 Stool', x: -0.6, y: 0, z: (BALCONY.minZ + BALCONY.maxZ) / 2 + 0.2, rotY: Math.PI / 2, places: [0], hips: 0.5, depth: 0, out: -0.7 },
  { id: 'stool-2', label: '🪑 Stool', x: 1, y: 0, z: (BALCONY.minZ + BALCONY.maxZ) / 2 + 0.2, rotY: -Math.PI / 2, places: [0], hips: 0.5, depth: 0, out: -0.7 },
  // On the roof: bar stools along the counter, facing the bar…
  ...[0, 1, 2, 3, 4, 5].map((i) => ({ id: `roof-stool-${i + 1}`, label: '🪑 Bar stool', x: ROOF_BAR.x - ROOF_BAR.depth / 2 - 0.45, y: 0, z: ROOF_BAR.minZ + 0.9 + i * 1.64, rotY: Math.PI / 2, places: [0], hips: 0.78, depth: 0, out: -0.75, roof: true, bar: true })),
  // …sofas round the fire pit, open to the view on the south…
  { id: 'roof-sofa-1', label: '🛋️ Sofa', x: FIRE_PIT.x, y: 0, z: FIRE_PIT.z - 2.3, rotY: 0, places: [-1.1, 0, 1.1], hips: 0.5, depth: -0.05, out: 0.8, roof: true },
  { id: 'roof-sofa-2', label: '🛋️ Sofa', x: FIRE_PIT.x - 2.9, y: 0, z: FIRE_PIT.z + 0.4, rotY: Math.PI / 2, places: [-0.6, 0.6], hips: 0.5, depth: -0.05, out: 0.8, roof: true },
  { id: 'roof-sofa-3', label: '🛋️ Sofa', x: FIRE_PIT.x + 2.9, y: 0, z: FIRE_PIT.z + 0.4, rotY: -Math.PI / 2, places: [-0.6, 0.6], hips: 0.5, depth: -0.05, out: 0.8, roof: true },
  // …and sun loungers facing out over the city.
  ...LOUNGERS.map((x, i) => ({ id: `roof-lounger-${i + 1}`, label: '🏖️ Lounger', x, y: 0, z: FLOOR.maxZ - 1.5, rotY: 0, places: [0], hips: 0.42, depth: -0.2, out: -1, roof: true })),
];
export const SEATING_BY_ID = new Map(SEATING.map((s) => [s.id, s]));

/** One place on a seat: where your feet go on its floor, the way you face, and the rest of what sitting there takes. */
export interface SeatPlace {
  /** What a peer's `seat` says while they sit here: the seat's id and which place, like "couch:1". */
  key: string;
  seatId: string;
  x: number;
  y: number;
  z: number;
  rotY: number;
  hips: number;
  out: number;
}

export function seatPlace(seat: SeatDef, i: number): SeatPlace {
  const fx = Math.sin(seat.rotY);
  const fz = Math.cos(seat.rotY);
  const along = seat.places[i] ?? 0;
  return {
    key: `${seat.id}:${i}`,
    seatId: seat.id,
    x: seat.x + fx * seat.depth + fz * along,
    y: seat.y,
    z: seat.z + fz * seat.depth - fx * along,
    rotY: seat.rotY,
    hips: seat.hips,
    out: seat.out,
  };
}

/** The place a peer's `seat` names, or undefined if there's no such place. */
export function seatAt(key: string): SeatPlace | undefined {
  const m = /^([\w-]+):(\d+)$/.exec(key);
  const seat = m ? SEATING_BY_ID.get(m[1]) : undefined;
  const i = Number(m?.[2]);
  return seat && i < seat.places.length ? seatPlace(seat, i) : undefined;
}

/** The place `key` names, if it's somewhere you can sit from where you are: up on the roof, or down on a floor. */
export function seatHere(key: string, onRoof: boolean): SeatPlace | undefined {
  const place = seatAt(key);
  return place && !!SEATING_BY_ID.get(place.seatId)!.roof === onRoof ? place : undefined;
}

/**
 * The elevator: a shaft against the north wall, between the PR board and the gong, with its
 * doors facing into the room. Every floor has it in the same spot, so you step out where you got in.
 */
export const ELEVATOR = { x: 8.5, width: 2.6, depth: 2.4, wall: 0.14, doorWidth: 1.4, doorHeight: 2.4 } as const;
/** Where the doors are: the front of the shaft. */
export const ELEVATOR_FRONT = FLOOR.minZ + ELEVATOR.depth;
/** The inside of the car, where you stand to ride. */
export const ELEVATOR_CAR = {
  minX: ELEVATOR.x - ELEVATOR.width / 2 + ELEVATOR.wall,
  maxX: ELEVATOR.x + ELEVATOR.width / 2 - ELEVATOR.wall,
  minZ: FLOOR.minZ,
  maxZ: ELEVATOR_FRONT - ELEVATOR.wall,
} as const;

/** Somewhere inside the car, facing the doors (+z), a little apart from anyone else arriving. */
export function elevatorSpot(): { x: number; z: number } {
  return {
    x: ELEVATOR.x + (Math.random() - 0.5) * 0.7,
    z: (ELEVATOR_CAR.minZ + ELEVATOR_CAR.maxZ) / 2 + (Math.random() - 0.5) * 0.6,
  };
}

export function inElevator(x: number, z: number): boolean {
  return x > ELEVATOR_CAR.minX && x < ELEVATOR_CAR.maxX && z > ELEVATOR_CAR.minZ && z < ELEVATOR_CAR.maxZ;
}

/**
 * The ladder to the floors above and below: against the west wall at `z`, up through a hatch in the
 * ceiling and down through one in the floor (every floor has it in the same spot, one long shaft).
 * You climb it at `x`, facing the wall; `hatch` is the hole in the floor and the ceiling.
 */
export const LADDER = {
  z: 0,
  width: 0.62,
  x: FLOOR.minX + 0.62,
  hatch: { minX: FLOOR.minX, maxX: FLOOR.minX + 1, minZ: -0.5, maxZ: 0.5 },
  /** How far in from the wall the trapdoor starts: the ladder goes through a slot along the wall. */
  slot: 0.24,
} as const;

/** Where a fire pole can be. `open` is the way into its hole, where its railing has a gap (0 = +z, like rotY). */
export interface PoleSpot {
  x: number;
  z: number;
  open: number;
}

/**
 * The fire pole, slid down to the floor below. It goes the whole way down the building, through a hole
 * in every floor but the bottom one (where there's a mat to land on): it takes you down one floor, and
 * on a floor with another below you swing off it through the railing, ready to go again.
 */
export const POLES: readonly PoleSpot[] = [
  // Out in the open between the desks and the lounge, where you step out of the elevator.
  { x: 6.8, z: 1.6, open: Math.PI },
];
/** A pole's hole in the floor, the railing round it, and how far from the pole you hang on. */
export const POLE = { hole: 0.68, rail: 0.9, grip: 0.4, radius: 0.055 } as const;
