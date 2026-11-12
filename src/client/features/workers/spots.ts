import { BOOKSHELF, CABINET, DJ_BOOTH, ELEVATOR, ELEVATOR_FRONT, FLOOR, JUKEBOX, SEATING, TV, WHITEBOARD, seatPlace } from '../../../shared/layout';
import type { SpotKind, Tone } from '../../../shared/traits';

/*
 * Where wanderers hang out (see features/workers/wander.ts): the lounge seats — one spot per place
 * on each couch and beanbag, so a couch really seats three — and standing spots at the office's
 * things. A spot with `seat` is furniture: the worker walks to it and sits down.
 */

export interface Spot {
  x: number;
  z: number;
  /** The way it faces while it's there (0 = +z). */
  rotY: number;
  /** What kind of haunt it is (absent for a chat rendezvous). */
  kind?: SpotKind;
  /** Sitting furniture: how high the seat is (the SeatDef's hips), absent for standing spots. */
  seat?: number;
}

/** Where it hangs out: the lounge seats, and standing spots at the office's things. */
export const SPOTS: Spot[] = [
  // The couch and the beanbags either side of the lounge: a spot per place, facing the TV.
  ...SEATING.filter((s) => s.y === 0 && !s.roof && !s.bar).flatMap((s) =>
    s.places.map((_, i) => {
      const p = seatPlace(s, i);
      return { x: p.x, z: p.z, rotY: p.rotY, kind: 'couch' as const, seat: p.hips };
    }),
  ),
  // In front of the TV, the jukebox and the arcade cabinet, on the east wall.
  { x: FLOOR.maxX - 1.5, z: TV.z, rotY: Math.PI / 2, kind: 'tv' },
  { x: FLOOR.maxX - 1.7, z: JUKEBOX.z, rotY: Math.PI / 2, kind: 'jukebox' },
  { x: FLOOR.maxX - 1.7, z: CABINET.z, rotY: Math.PI / 2, kind: 'arcade' },
  // At the whiteboard, the bookshelf, the elevator and the DJ booth.
  { x: WHITEBOARD.x, z: WHITEBOARD.z + 1.2, rotY: Math.PI, kind: 'board' },
  { x: BOOKSHELF.x, z: BOOKSHELF.z - 1.3, rotY: 0, kind: 'shelf' },
  { x: ELEVATOR.x, z: ELEVATOR_FRONT + 1.0, rotY: Math.PI, kind: 'elevator' },
  { x: DJ_BOOTH.x, z: DJ_BOOTH.z + 1.4, rotY: Math.PI, kind: 'dj' },
];

/** Bubble colour per tone of voice, so you can tell who's talking at a glance. */
export const TONE_BG: Record<Tone, string> = {
  dry: '#2b2d42', warm: '#7a3e2f', hyper: '#b5179e', gloomy: '#3a4a5a', formal: '#1d3557', chaotic: '#386641',
};
