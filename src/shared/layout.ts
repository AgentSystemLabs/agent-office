// Static office layout shared by the server (validation) and client (rendering).
// Units are meters; +y is up. The office floor spans FLOOR.minX..maxX / minZ..maxZ.

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
} as const;

/** The big TV on the east wall that shows whoever is screen sharing. */
export const TV = { x: FLOOR.maxX - 0.1, y: 2.2, z: 0, width: 6.4, height: 3.6 } as const;

export const SPAWN = { x: 8, z: 7 } as const;
