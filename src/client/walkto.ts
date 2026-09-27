// The way over to a teammate you clicked in the sidebar: round the furniture downstairs (see
// shared/nav.ts), and up the stairs to the boss's office or out through the balcony doors when that's
// where they are.

import { BALCONY, BALCONY_DOOR, FLOOR, LOFT, STAIRS, WALL_T } from '../shared/layout';
import { route } from '../shared/nav';

export interface Spot {
  x: number;
  y: number;
  z: number;
}

type Zone = 'floor' | 'stairs' | 'loft' | 'balcony' | 'outside';

const STAIRS_Z = (STAIRS.minZ + STAIRS.maxZ) / 2;
/** Just inside the boss's office door at the top of the stairs, and just off the bottom step. */
const STAIRS_TOP = { x: LOFT.minX + 0.6, z: STAIRS_Z };
const STAIRS_FOOT = { x: STAIRS.fromX - 0.6, z: STAIRS_Z };
/**
 * The points on the way from each part of the building out onto the office floor: down the stairs
 * from the boss's office (out through its door at the top), in through the balcony doors.
 */
const WAY_DOWN: Record<Zone, { x: number; z: number }[]> = {
  floor: [],
  stairs: [STAIRS_FOOT],
  loft: [STAIRS_TOP, STAIRS_FOOT],
  balcony: [
    { x: BALCONY_DOOR.u, z: FLOOR.maxZ + WALL_T + 0.6 },
    { x: BALCONY_DOOR.u, z: FLOOR.maxZ - 0.7 },
  ],
  outside: [],
};

function zoneOf(p: Spot): Zone {
  if (p.y < -1 || p.x < FLOOR.minX || p.x > FLOOR.maxX || p.z < FLOOR.minZ) return 'outside';
  if (p.z > FLOOR.maxZ) return p.x >= BALCONY.minX && p.x <= BALCONY.maxX ? 'balcony' : 'outside';
  if (p.x > LOFT.minX && p.z > LOFT.minZ && p.y > LOFT.y - 0.5) return 'loft';
  // Off the office floor's map, which has the stairs down as a wall.
  if (p.x > STAIRS.fromX - 0.1 && p.x < STAIRS.toX + 0.1 && p.z > STAIRS.minZ - 0.1 && p.y > 0.05) return 'stairs';
  return 'floor';
}

/** The corners of a walk from `from` to `to`, `to` included when it's somewhere you can stand. */
export function wayTo(from: Spot, to: Spot): { x: number; z: number }[] {
  const a = zoneOf(from);
  const b = zoneOf(to);
  // Across the same room upstairs or on the balcony, or somewhere the office has no map of: straight there.
  if ((a === b && a !== 'floor') || a === 'outside' || b === 'outside') return [{ x: to.x, z: to.z }];
  // Between the stairs and the boss's office at the top of them: through its door.
  if ((a === 'stairs' && b === 'loft') || (a === 'loft' && b === 'stairs')) return [STAIRS_TOP, { x: to.x, z: to.z }];
  const out = WAY_DOWN[a];
  const into = [...WAY_DOWN[b]].reverse();
  const start = out[out.length - 1] ?? from;
  const end = into[0] ?? to;
  // Across the office floor; route stops at the nearest place to stand if they're in a chair or on the couch.
  const across = route([start.x, start.z], [end.x, end.z])
    .slice(1)
    .map(([x, z]) => ({ x, z }));
  return [...out, ...across, ...into.slice(1), ...(b === 'floor' ? [] : [{ x: to.x, z: to.z }])];
}
