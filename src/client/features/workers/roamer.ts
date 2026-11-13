// What a wanderer is (see features/workers/wander.ts): its character, its needs, where it is in
// its little life. Its own file so ambient.ts, crowd.ts and the rest can name it without a cycle.
import * as THREE from 'three';
import type { Pt } from '../../../shared/nav';
import type { Needs, Rng, SpotKind, Traits } from '../../../shared/traits';
import type { WorkerInfo } from '../../../shared/protocol';
import type { Spot } from './spots';
import type { Worker } from '../../world/character';
import type { DeskView } from '../../world/types';

export type State = 'seated' | 'down' | 'walk' | 'linger' | 'chat' | 'up';

export interface Roamer {
  id: string;
  model: Worker;
  desk: DeskView;
  /** Who it is: dealt from a seed when it's hired, and its own generator from then on. */
  traits: Traits;
  rng: Rng;
  needs: Needs;
  state: State;
  /** Where it's off to: a spot in SPOTS, a chat rendezvous, or its seat. */
  spot: Spot | null;
  /** Walking to a chat rendezvous: who it's meeting (cleared on arrival). */
  chatWith?: string;
  /** Mid-chat: who it's with, when it started (synced with the partner's), the last turn shown, how many turns, how long it's waited for the partner, and what it said. */
  chat?: { partner: string; start: number; seen: number; turns: number; wait: number; said: string[] };
  /** A line over its head right now, and when it comes down. */
  bubble?: { sprite: THREE.Sprite; until: number };
  /** Seconds until its next aside (a mutter, a hum) while it's standing about. */
  asideIn: number;
  /** The kind of haunt it was at last, so it doesn't just go back. */
  lastKind: SpotKind | null;
  /** How seated it is, 0 standing to 1 sunk into the furniture (see the end of step). */
  sit: number;
  way: Pt[];
  next: number;
  hop: number;
  from: THREE.Vector3;
  heading: number;
  stepIn: number;
  /** Seconds it has left before it goes (seated) or comes home (lingering). */
  timer: number;
  /** Its status last tick, so a finished task can be told to the mind. */
  lastStatus?: string;
  /** When it last said hi to someone it passed (so passers-by don't greet every frame). */
  lastGreet: number;
}
