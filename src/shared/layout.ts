// Static office layout shared by the server (validation) and client (rendering).
// Units are meters; +y is up. The office floor spans FLOOR.minX..maxX / minZ..maxZ at y = 0,
// upstairs over a garage whose floor is level with the street (STREET_Y).

export const FLOOR = { minX: -18, maxX: 18, minZ: -13, maxZ: 13 } as const;
export const WALL_HEIGHT = 4.2;

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

/** Everywhere a worker can sit: the desks, then the bean bags. */
export const SEATS: DeskDef[] = [...DESKS, ...BEANBAGS];

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

/** Any place a worker can be by id: the seats, and the board agents' kiosks. */
export const DESK_BY_ID = new Map([...SEATS, ...STATIONS].map((d) => [d.id, d]));

/** The seat a new worker takes when nobody picks one: the first free desk, else the first free bean bag. */
export function nextFreeSeat(taken: (id: string) => boolean): DeskDef | undefined {
  return SEATS.find((d) => !taken(d.id));
}

/**
 * The bean bags that are out: every one in use, and while every desk is taken, the next free one
 * too, so there's always somewhere to hire the next worker.
 */
export function beanbagsOut(taken: (id: string) => boolean): Set<string> {
  const out = new Set(BEANBAGS.filter((b) => taken(b.id)).map((b) => b.id));
  if (DESKS.every((d) => taken(d.id))) {
    const spare = BEANBAGS.find((b) => !taken(b.id));
    if (spare) out.add(spare.id);
  }
  return out;
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
/** The lounge jukebox, against the east wall south of the TV, facing into the room. `y` is its speaker. */
export const JUKEBOX = { x: FLOOR.maxX - 0.42, y: 0.75, z: 5.4, width: 1.3, depth: 0.72, height: 1.85 } as const;

/** The upstairs office: a glass-walled loft on posts in the south-east corner, looking down on the desks. */
export const LOFT = { minX: 9, maxX: FLOOR.maxX, minZ: 8, maxZ: FLOOR.maxZ, y: 3, height: 2.8 } as const;
/** Its stairs climb east along the south wall and arrive at the loft's west door. */
export const STAIRS = { fromX: 3, toX: LOFT.minX, minZ: 11.2, maxZ: FLOOR.maxZ, steps: 15 } as const;

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

/**
 * The whiteboard on wheels everyone draws on together, out on the open floor between the desks and
 * the lounge, facing into the room (+z). `width` and `height` are its writing surface, whose bottom
 * edge is `bottom` above the floor.
 */
export const WHITEBOARD = { x: 5.4, z: -5.4, width: 4, height: 2.2, bottom: 0.5 } as const;

/** The office is the second floor. The street, and the open garage under the office, are this far below its floor. */
export const STREET_Y = -3.6;
/** The street runs east–west in front of the building (south, +z), with a sidewalk along either side. */
export const ROAD = { minZ: 23, maxZ: 31 } as const;
/** The office's floor slab, which is the garage's ceiling: it runs from -SLAB up to 0. */
export const SLAB = 0.3;
/** How thick the outside walls are. They stand just outside FLOOR. */
export const WALL_T = 0.3;

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

/** The way out: a door in the west wall onto a landing, with stairs down to the street. */
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
