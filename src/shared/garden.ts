import type { SeatDef } from './layout.js';

// The thinking garden: a quiet corner of the roof, in the south-west, for sitting and thinking among
// plants (client/features/rooftop/garden.ts builds it). Its seats join SEATING (shared/layout.ts).

/** Where it lies on the roof: open along its east side (x = maxX), with a bed of plants along each of the others. */
export const GARDEN = { minX: -17.5, maxX: -4.5, minZ: 3.5, maxZ: 12.5 } as const;

/** The little pond the seats look onto. */
export const GARDEN_POND = { x: -10.5, z: 8, r: 0.75 } as const;

/** The sound stone, where the ambient sound is turned on and off: stand here to use it. */
export const THINK_SPOT = { x: -6.6, z: 6.8 } as const;

/** Two low benches either side of the pond, and two lounge chairs, all turned towards it (one of the chairs from the side). */
export const GARDEN_SEATS: SeatDef[] = [
  { id: 'roof-garden-bench-1', label: '🪑 Garden bench', x: GARDEN_POND.x, y: 0, z: 5.6, rotY: 0, places: [-0.45, 0.45], hips: 0.52, depth: 0, out: 0.85, roof: true },
  { id: 'roof-garden-bench-2', label: '🪑 Garden bench', x: GARDEN_POND.x, y: 0, z: 10.4, rotY: Math.PI, places: [-0.45, 0.45], hips: 0.52, depth: 0, out: 0.85, roof: true },
  { id: 'roof-garden-lounge-1', label: '🌿 Lounge chair', x: -13.4, y: 0, z: GARDEN_POND.z, rotY: Math.PI / 2, places: [0], hips: 0.38, depth: -0.05, out: 0.9, roof: true },
  { id: 'roof-garden-lounge-2', label: '🌿 Lounge chair', x: -8.2, y: 0, z: 6.7, rotY: -Math.PI / 2, places: [0], hips: 0.38, depth: -0.05, out: 0.9, roof: true },
];
