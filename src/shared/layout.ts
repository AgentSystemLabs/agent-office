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
export const DESK_BY_ID = new Map(DESKS.map((d) => [d.id, d]));

/** Where the worker (and the interacting player) stands relative to the desk. */
export function deskSeat(desk: DeskDef, offset = 0.85): { x: number; z: number } {
  return {
    x: desk.x + Math.sin(desk.rotY) * offset,
    z: desk.z + Math.cos(desk.rotY) * offset,
  };
}

/** Wall boards. `rotY` is the way the board faces (0 = +z, like the north-wall boards). */
export const BOARDS = {
  issues: { x: -10.5, y: 2.1, z: FLOOR.minZ + 0.08, rotY: 0, width: 6, height: 3, label: 'Issues' },
  pulls: { x: -1.5, y: 2.1, z: FLOOR.minZ + 0.08, rotY: 0, width: 6, height: 3, label: 'Pull Requests' },
  // East wall, north of the lounge TV.
  services: { x: FLOOR.maxX - 0.08, y: 2.1, z: -8.2, rotY: -Math.PI / 2, width: 6, height: 3, label: '🌐 Services' },
  // The task queue whiteboard, north wall, in the corner by the services board.
  queue: { x: 14.5, y: 2.1, z: FLOOR.minZ + 0.08, rotY: 0, width: 6, height: 3, label: '📋 Task queue' },
} as const;

/** The big TV on the east wall that shows whoever is screen sharing. */
export const TV = { x: FLOOR.maxX - 0.1, y: 2.2, z: 0, width: 6.4, height: 3.6 } as const;

/** The upstairs office: a glass-walled loft on posts in the south-east corner, looking down on the desks. */
export const LOFT = { minX: 9, maxX: FLOOR.maxX, minZ: 8, maxZ: FLOOR.maxZ, y: 3, height: 2.8 } as const;
/** Its stairs climb east along the south wall and arrive at the loft's west door. */
export const STAIRS = { fromX: 3, toX: LOFT.minX, minZ: 11.2, maxZ: FLOOR.maxZ, steps: 15 } as const;

export const SPAWN = { x: 8, z: 7 } as const;

/** The office is the second floor. The street, and the open garage under the office, are this far below its floor. */
export const STREET_Y = -3.6;
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

/** Sliding glass doors out to the balcony, on the south wall. */
export const BALCONY_DOOR: Opening = { wall: 'south', u: -4, width: 2.4, y0: 0, y1: 2.5 };
/** The smoking balcony, hanging over the garage entrance. */
export const BALCONY = { minX: -10.5, maxX: 2.5, minZ: FLOOR.maxZ + WALL_T, maxZ: FLOOR.maxZ + WALL_T + 3.4 } as const;
/** The ashtray on the balcony, where a smoke break starts. */
export const ASHTRAY = { x: -8.2, z: BALCONY.maxZ - 0.55 } as const;
