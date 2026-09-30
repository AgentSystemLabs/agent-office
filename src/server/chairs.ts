import { randomInt } from 'node:crypto';
import { MIN_PLAYERS, NO_CHAIRS, RING, TIMING, musicMs, type ChairsPlayer, type ChairsState, type ChairsTiming } from '../shared/chairs.js';

/** One worker on the floor the game can put in the ring. */
export interface Cast {
  id: string;
  name: string;
  color: string;
}

/**
 * Musical chairs, played out on a floor for the workers at its desks.
 *
 * The office is the one that decides who gets a chair: the music, the ring and the walking about are
 * each page's own work (see client/chairstune.ts and client/world/chairs.ts), and every page is told
 * the same rounds at the same moments, so the music stops in everyone's ears together. One worker
 * less every round until one is left, who wins.
 */
export class MusicalChairs {
  private s: ChairsState = NO_CHAIRS;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly t: ChairsTiming;

  constructor(
    /** Everyone on the floor who can play: the workers at their seats, board agents and all. */
    private readonly cast: () => Cast[],
    /** The game changed, so everyone on the floor is told (see toFloor in server.ts). */
    private readonly changed: (state: ChairsState) => void,
    /** How long each part runs; a test plays a whole game out with them turned down. */
    timing: Partial<ChairsTiming> = {},
  ) {
    this.t = { ...TIMING, ...timing };
  }

  state(): ChairsState {
    return this.s;
  }

  playing(): boolean {
    return this.s.phase !== 'idle';
  }

  /** Calls a game: everyone on the floor, and one chair fewer. Says why it can't, if it can't. */
  start(by: string): { ok: true } | { error: string } {
    if (this.playing()) return { error: 'Musical chairs is already on' };
    const players = this.cast().slice(0, RING.most);
    if (players.length < MIN_PLAYERS) return { error: `Musical chairs needs ${MIN_PLAYERS} workers on this floor` };
    const now = Date.now();
    this.s = { phase: 'gathering', round: 0, chairs: 0, players: players.map((p) => ({ ...p, chair: null })), by, startedAt: now, phaseAt: now };
    this.publish();
    this.after(this.t.gather, () => this.round());
    return { ok: true };
  }

  /** Calls the game off: the chairs go back against the wall and everyone to their desks. */
  stop() {
    if (!this.playing()) return;
    this.clear();
    this.s = NO_CHAIRS;
    this.publish();
  }

  /** The next round of music: who's still in, and which chair each of them is after. */
  private round() {
    // A worker sent home or killed mid-game is out of it, and doesn't hold a chair back.
    const here = new Set(this.cast().map((c) => c.id));
    const players = this.s.players.filter((p) => here.has(p.id) && p.outIn === undefined);
    if (players.length <= 1) return this.finish(players[0]?.id);
    this.s = { ...this.s, phase: 'music', round: this.s.round + 1, chairs: players.length - 1, players: this.s.players.filter((p) => here.has(p.id)) };
    this.deal(players);
    this.publish();
    this.after(musicMs(this.s.round, this.t), () => this.scramble());
  }

  /** Hands the chairs out at random: one worker in the ring misses out. */
  private deal(players: ChairsPlayer[]) {
    const order = shuffle(players.map((p) => p.id));
    const seatOf = new Map(order.slice(0, this.s.chairs).map((id, i) => [id, i]));
    this.s.players = this.s.players.map((p) => {
      if (p.outIn !== undefined) return p;
      const chair = seatOf.get(p.id);
      return { ...p, chair: chair ?? null, ...(chair === undefined ? { outIn: this.s.round } : {}) };
    });
  }

  /** The music has stopped: everyone makes for a chair. */
  private scramble() {
    this.s = { ...this.s, phase: 'scramble' };
    this.publish();
    this.after(this.t.scramble, () => this.react());
  }

  /** The one without a chair finds out about it, and the others settle down. */
  private react() {
    this.s = { ...this.s, phase: 'react' };
    this.publish();
    this.after(this.t.react, () => this.round());
  }

  /** One worker left on the last chair: they have won, and everyone comes back to their desks. */
  private finish(winner?: string) {
    // The one chair left is wheeled to the front of the ring and stays out for the winner's lap.
    this.s = {
      ...this.s,
      phase: 'over',
      chairs: winner ? 1 : 0,
      winner,
      players: this.s.players.map((p) => (winner && p.id === winner ? { ...p, chair: 0 } : p)),
    };
    this.publish();
    this.after(this.t.over, () => this.stop());
  }

  private after(ms: number, then: () => void) {
    this.clear();
    this.timer = setTimeout(then, ms);
    this.timer.unref?.();
  }

  private clear() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private publish() {
    this.changed(this.s);
  }
}

/** A copy of `ids` in a new order, from the system's own coin. */
function shuffle<T>(ids: T[]): T[] {
  const out = [...ids];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
