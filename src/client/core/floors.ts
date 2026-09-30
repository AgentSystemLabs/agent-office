/**
 * The building's floors as the office and its parts see them: which are built, and how far each one's
 * back office goes.
 */
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
