// Where visitors wait on a floor, and where their subagents stand round them.

/**
 * The lobby between the elevator and the lounge, in the order they come: x, z, and the way each
 * faces (into the room). Clear of the elevator's doors, the whiteboard (which would hide them from the
 * room), the gong and the couch.
 */
export const VISITOR_SPOTS: readonly (readonly [x: number, z: number, rotY: number])[] = [
  [11.6, -5.6, -0.35],
  [14.0, -5.6, -0.35],
  [9.4, -5.8, -0.35],
  [16.3, -5.6, -0.5],
  [12.8, -8.4, -0.25],
  [10.4, -8.6, -0.25],
  [15.2, -8.4, -0.35],
  [7.6, -3.2, -0.2],
];

/** Round a visitor, in its own frame (it faces +z): at its sides first, then further round. */
const RING: readonly number[] = [70, -70, 115, -115, 35, -35, 150, -150].map((d) => (d * Math.PI) / 180);
const RADIUS = 1.0;

export function subagentSpot(i: number): readonly [x: number, z: number, rotY: number] {
  const a = RING[i % RING.length];
  const r = RADIUS + Math.floor(i / RING.length) * 0.6;
  return [Math.sin(a) * r, Math.cos(a) * r, 0];
}
