import type * as THREE from 'three';
import type { SendHomePlace, SendHomeStep, Spot } from '../../../shared/maps';
import type { Pt } from '../../../shared/nav';
import type { Person, Worker } from '../../world/character';
import type { DeskView } from '../../world/types';
import type { World } from '../../world/world';
import type { Drifters } from './adrift';
import type { Jail } from './jail';
import type { Laptop } from './laptop';

/*
 * What a worker being seen off is, to the script that sees it off (sendhome.ts) and to the steps of
 * it that have files of their own (lockup.ts, eject.ts): the worker, its escort, and what a step is
 * handed to do its part.
 */

export const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** What a sendoff is heard by: footsteps, a cell's door, someone landing on the straw, and the airlock (its doors, its alarm, and the air going out of it). */
export interface SendoffSounds {
  step(x: number, y: number, z: number): void;
  door(at: THREE.Vector3, open: boolean): void;
  thud(at: THREE.Vector3): void;
  airlock(at: THREE.Vector3, what: 'door' | 'alarm' | 'blow'): void;
}

/** What a step with a file of its own is handed: the world it's in, what it's heard by, who keeps whoever's kept, and how to walk a worker somewhere first. */
export interface StepHost {
  world(): World;
  sounds: SendoffSounds;
  jail: Jail;
  adrift: Drifters;
  walkTo(s: Sendoff, to: SendHomePlace): void;
}

/** Someone walking a way: the worker, or its escort. */
export interface Walk {
  root: THREE.Object3D;
  way: Pt[];
  next: number;
  heading: number;
  stepIn: number;
}

export interface Guard extends Walk {
  person: Person;
  /** The map's own, on watch at its post; the others are called out while it's busy, and put away after. */
  posted: boolean;
  /** Fetching a worker, marching one along, or heading back to its post. */
  mode: 'idle' | 'go' | 'wait' | 'follow' | 'home';
  speed: number;
}

export interface Sendoff {
  id: string;
  model: Worker;
  desk: DeskView;
  laptop: { laptop: Laptop; gone: number; closing: boolean } | null;
  steps: SendHomeStep[];
  /** The step it's on, whether it's begun, and seconds into it. */
  i: number;
  begun: boolean;
  t: number;
  /** In its seat, getting down off it, on its feet, walking, being thrown into its cell (or out of the airlock), or done for. */
  state: 'seated' | 'hop' | 'stand' | 'walk' | 'fly' | 'done';
  walk: Walk;
  speed: number;
  hop: { from: THREE.Vector3; t: number };
  chair: THREE.Object3D | null;
  spin: number;
  scale: number;
  /** Where it's walked, for its escort to follow. */
  trail: Pt[];
  guard: Guard | null;
  /** Its seat in the dungeon, if it's to be locked up. */
  cell: { cell: number; spot: Spot } | null;
  jail: { phase: 'go' | 'open' | 'step' | 'fly' | 'shut'; t: number; from: THREE.Vector3; walked: boolean } | null;
  /** Being put out of the airlock (see eject.ts): how far through it is, where it was and which way up when the hatch blew. */
  eject: { phase: 'go' | 'open' | 'step' | 'seal' | 'wait' | 'blow' | 'shut'; t: number; from: THREE.Vector3; turn: THREE.Quaternion; walked: boolean } | null;
  /** 0 → 1 as it shrinks away. */
  gone: number;
  leaving: boolean;
  /** What it (or its escort) said last, for how long to give it. */
  said: string;
  /** Its script has run to the end. */
  over: boolean;
}

/** The point `dist` back along `trail` from its end (where it is now), or undefined while it hasn't gone that far. */
export function behind(trail: Pt[], dist: number): Pt | undefined {
  let left = dist;
  for (let i = trail.length - 1; i > 0; i--) {
    const [x1, z1] = trail[i];
    const [x0, z0] = trail[i - 1];
    const d = Math.hypot(x1 - x0, z1 - z0);
    if (d >= left) {
      const k = left / d;
      return [x1 + (x0 - x1) * k, z1 + (z0 - z1) * k];
    }
    left -= d;
  }
  return undefined;
}
