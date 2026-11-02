// Merging the floors a plugin provides into the building's own.
//
// A plugin that provides floors (an OpenFox project per floor, say) says "these are mine" — never
// "these are all there are". The floors the office was started with, and the ones people added from
// the elevator, stay exactly where they are. Doing it any other way wipes the building the moment a
// plugin reports its list, and the boards those floors had go with them.
import path from 'node:path';
import type { FloorDef } from './building.js';

/** Who added a floor for themselves, rather than it arriving from a plugin's list. */
const OWN = new Set(['the office', 'the elevator']);

/** The same floor, either side: the same checkout, or the id its plugin keeps for it. */
const sameAs = (a: FloorDef, b: FloorDef): boolean =>
  path.resolve(a.dir) === path.resolve(b.dir) || (!!b.externalId && a.externalId === b.externalId);

/**
 * The building's floors once `defs` are merged into them: what was there and is still the plugin's
 * stays (so it keeps its identity), what the plugin has added arrives, and what it no longer lists
 * goes. Nothing anybody but a plugin added is taken off.
 */
export function mergeFloors(current: FloorDef[], defs: FloorDef[]): FloorDef[] {
  const kept = current.filter((own) => OWN.has(own.addedBy) || defs.some((d) => sameAs(own, d)));
  const fresh = defs.filter((d) => !kept.some((own) => sameAs(own, d)));
  return [...kept, ...fresh];
}
