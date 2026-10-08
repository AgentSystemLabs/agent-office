// Where the Vancouver landmarks stand, in street coordinates. Ordinary blocks, lamps, cars and walkers
// keep out of them; the water and park zones are also where nothing may drive.
export type Zone = { x: number; z: number; r: number; kind: 'land' | 'water' | 'park' };

export const DOWNTOWN: Zone = { x: 110, z: -160, r: 55, kind: 'land' };
export const HARBOUR: Zone = { x: 190, z: -180, r: 62, kind: 'water' };
export const STANLEY: Zone = { x: -190, z: -120, r: 75, kind: 'park' };
export const INLET: Zone = { x: -330, z: -120, r: 100, kind: 'water' };
export const SCIENCE: Zone = { x: 120, z: 175, r: 35, kind: 'land' };
export const BCPLACE: Zone = { x: 190, z: 130, r: 45, kind: 'land' };
export const CREEK: Zone = { x: 130, z: 215, r: 40, kind: 'water' };

export const ZONES: readonly Zone[] = [DOWNTOWN, HARBOUR, STANLEY, INLET, SCIENCE, BCPLACE, CREEK];

/** True inside any landmark zone (pad makes them bigger). */
export const inZone = (x: number, z: number, pad = 0): boolean => ZONES.some((q) => Math.hypot(x - q.x, z - q.z) < q.r + pad);

/** Where cars and street walkers can't go: the landmarks, the water and the park. */
export const offRoad = (x: number, z: number): boolean => inZone(x, z, 0);


/** True out on the open water (pad widens the sea): ordinary blocks keep back from the shore so the harbour opens to the mountains. */
export const inSea = (x: number, z: number, pad = 0): boolean => ZONES.some((q) => q.kind === 'water' && Math.hypot(x - q.x, z - q.z) < q.r + pad);
