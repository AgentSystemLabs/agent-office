import { helperSpot, type HelperState } from '../shared/helper.js';
import { DESK_BY_ID } from '../shared/layout.js';
import { nearestWalkable, route, walkable, type Pt } from '../shared/nav.js';
import type { WorkerInfo } from '../shared/protocol.js';

/*
 * The floor's helpers: a second agent someone walks over to a stuck worker's desk, which reports to
 * that worker and goes home (see docs/helper-plan.md).
 *
 * The office keeps only where each one is and what it's doing, the way it does for the dog: every
 * browser walks the helper along the same path from the same numbers, so nobody sees a different walk
 * from anybody else. A helper is an ordinary worker in every other respect — a real terminal, its own
 * reported status, openable and typeable by anyone — so all that is left to track here is the walk, and
 * which worker it belongs to.
 */

/** Metres a second a helper walks over, and hurries at on the way in. */
const HURRY = 2.2;

/** Where a helper comes in from: the doors, the same place a worker off the queue starts. */
const IN: Pt = [0, 0];

/** How long a helper stands at the desk having reported, before it goes home. Long enough to be seen. */
const REPORTED_PAUSE = 5_000;

export interface HelperEnv {
  /** Everyone at a desk on this floor. */
  workers(): WorkerInfo[];
  /** To everyone on this floor. */
  send(helpers: HelperState[]): void;
  /** How many rows the back office is built out, so a helper can get round its desks too. */
  wing?(): number;
  /** Sends a helper home for good, once it has reported and been seen to. */
  sendHome(workerId: string): void;
}

interface Leg {
  state: HelperState;
  /** When it reported, for the walk out; unset while it is still working. */
  reportedAt?: number;
  /** A timer taking it home once it has reported, rather than a sweep over all of them. */
  timer?: NodeJS.Timeout;
}

export class Helpers {
  private readonly legs = new Map<string, Leg>();

  constructor(private env: HelperEnv) {}

  private wing(): number {
    return this.env.wing?.() ?? 0;
  }

  /** Every helper on this floor, for the browsers. */
  states(): HelperState[] {
    return [...this.legs.values()].map((l) => ({ ...l.state }));
  }

  /** Whether `hostId`'s desk already has a helper standing at it. */
  has(hostId: string): boolean {
    return this.at(hostId) !== undefined;
  }

  private at(hostId: string): Leg | undefined {
    for (const leg of this.legs.values()) if (leg.state.hostId === hostId) return leg;
    return undefined;
  }

  /**
   * Sends a helper over to `host`'s desk: it starts at the doors and walks to where it stands beside
   * the desk, which is the last point on the path. The office works the path out; the browsers walk it.
   */
  send(host: WorkerInfo, helper: WorkerInfo): HelperState | undefined {
    const desk = DESK_BY_ID.get(host.deskId);
    if (!desk) return undefined;
    const spot = helperSpot(desk);
    // Where it stands, and where it comes in from, each pulled onto somewhere it can actually stand.
    const wing = this.wing();
    const at = walkable(spot.at[0], spot.at[1], wing) ? spot.at : nearestWalkable(spot.at, wing);
    const from = walkable(IN[0], IN[1], wing) ? IN : nearestWalkable(IN, wing);
    const state: HelperState = { hostId: host.id, workerId: helper.id, path: route(from, at, wing), speed: HURRY, face: spot.face, phase: 'walking' };
    this.legs.set(helper.id, { state });
    this.publish();
    return { ...state };
  }

  /** It's arrived and is reading over its host's shoulder. */
  reading(workerId: string): void {
    this.setPhase(workerId, 'reading');
  }

  /** It's telling its host what it found. */
  reporting(workerId: string): void {
    this.setPhase(workerId, 'reporting');
  }

  private setPhase(workerId: string, phase: 'reading' | 'reporting'): void {
    const leg = this.legs.get(workerId);
    if (!leg || leg.reportedAt !== undefined || leg.state.phase === phase) return;
    leg.state.phase = phase;
    this.publish();
  }

  /**
   * The helper has told its host what it found, so its visit is over: it stands there a moment so
   * you can see it did its job, then goes home on its own. That is the rule, and it is what keeps a
   * helper from being left standing at a desk holding an open terminal.
   */
  reported(workerId: string): void {
    const leg = this.legs.get(workerId);
    if (!leg || leg.reportedAt !== undefined) return;
    leg.reportedAt = Date.now();
    leg.state.phase = 'leaving';
    this.publish();
    leg.timer = setTimeout(() => {
      this.forget(workerId);
      this.env.sendHome(workerId);
    }, REPORTED_PAUSE);
    leg.timer.unref?.();
  }

  /**
   * A helper has reported but is being kept while you read its terminal: `X` on it still works, and
   * this stops the automatic walk-out from taking it before you've seen it.
   */
  hold(workerId: string): void {
    const leg = this.legs.get(workerId);
    if (leg?.timer) clearTimeout(leg.timer);
    if (leg) leg.timer = undefined;
  }

  /** A helper is gone, however it went: sent home, or its agent ended. */
  forget(workerId: string): void {
    const leg = this.legs.get(workerId);
    if (!leg) return;
    if (leg.timer) clearTimeout(leg.timer);
    this.legs.delete(workerId);
    this.publish();
  }

  private publish(): void {
    this.env.send(this.states());
  }
}
