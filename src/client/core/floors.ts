/**
 * The building's floors as the office and its parts see them: which are built, how far each one's
 * back office goes, and which seats are there to sit at.
 */
import { DESK_BY_ID, FLOOR, WING, deskBuilt, inWing } from '../../shared/layout';
import type { FloorInfo } from '../../shared/protocol';
import { store } from '../state';

/** The floors of the building from the bottom up (not the ones still being cloned: nobody can go there yet). */
export function builtFloors(): FloorInfo[] {
  return store.floors.filter((f) => !f.cloning);
}

/** How far each floor's back office goes, for the building's outside (the one you're on as you see it). */
export function floorWings(floors: FloorInfo[]): number[] {
  return floors.map((f) => (f.id === store.floor ? store.floorPlan.wing : (f.wing ?? 0)));
}

/**
 * Whether seat `id` is there to sit at on this floor: a back office desk only once the floor's built
 * out that far, on whichever map (the castle names seats for them too, so a worker hired there has
 * one on every map).
 */
export function seatBuilt(id: string): boolean {
  const d = DESK_BY_ID.get(id);
  return !d || deskBuilt(d, store.floorPlan.wing);
}

/**
 * Standing where a back office would be, further back than this floor's goes (`level` rows): a row
 * walled up round you, or a floor you switched to that isn't built out as far as the one you left.
 */
export function pastTheWing(p: { x: number; y: number; z: number }, level: number): boolean {
  return p.y > -1 && p.y < 3 && p.x > WING.minX - 0.3 && p.x < WING.maxX + 0.3 && p.z < FLOOR.minZ && !inWing(p.x, p.z, level);
}
