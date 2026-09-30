// The balcony and the roof: golf, darts and axes, the gong and the air horn.

import type { BarGame } from '../bargames.js';

/** Why the gong rang. */
export type GongWhy = 'hit' | 'merged' | 'queue';

export type RooftopClientMsg =
  /**
   * You hit a golf ball off the tee: its heading (0 is south, toward +x from there), loft (radians)
   * and power (0–1). Everyone on your floor works out where it goes the same way (features/golf/world.ts fly).
   */
  | { t: 'golf'; yaw: number; loft: number; power: number }
  /**
   * You threw a dart or an axe at the rooftop bar: where it lands on the target (u right, v up, in
   * meters from its middle), whether an axe sticks, and which throw of the round it is (from 1).
   */
  | { t: 'toss'; game: BarGame; u: number; v: number; stick: boolean; n: number }
  /** Hit the office gong (E at the gong); everyone on the floor hears it. */
  | { t: 'gong' }
  /** Blow the DJ's air horn on the roof; everyone up there hears it. */
  | { t: 'horn' };

export type RooftopServerMsg =
  /** Someone on your floor hit a golf ball off the tee (see the client's 'golf'). */
  | { t: 'golf'; id: string; yaw: number; loft: number; power: number }
  /** Someone up on the roof threw a dart or an axe (see the client's 'toss'). */
  | { t: 'toss'; id: string; game: BarGame; u: number; v: number; stick: boolean; n: number }
  /**
   * The gong rings, for everyone on the floor: someone hit it, pull request `pr` merged (confetti
   * over the desk it came from), or the last task on the queue just finished (a bigger party).
   */
  | { t: 'gong'; why: GongWhy; by?: string; pr?: number }
  /** Someone on the roof blew the DJ's air horn (sent to everyone up there, them too). */
  | { t: 'horn'; by: string };
