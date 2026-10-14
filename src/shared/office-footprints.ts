import { SCRANTON, CORRIDORS } from './scranton.js';
import type { Rect } from './nav.js';

/** Feature extensions reserve their ground projection so scenery cannot grow through the rooms. */
export const OFFICE_FOOTPRINTS: readonly Rect[] = [
  [SCRANTON.minX, SCRANTON.maxX, SCRANTON.minZ, SCRANTON.maxZ], ...CORRIDORS,
];
export function reservedOfficeSpace(x: number, z: number, radius = 0): boolean {
  return OFFICE_FOOTPRINTS.some(([x0, x1, z0, z1]) => x + radius > x0 && x - radius < x1 && z + radius > z0 && z - radius < z1);
}
