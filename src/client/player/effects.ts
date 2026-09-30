// What's going on with you that changes how you move and what you see: a coffee's buzz and the jitters,
// a few drinks. Each is its own record, added once by whatever brings it on (see Effects.add) and
// written by it whenever it changes (each frame, say); the player reads them all together.

/** What one thing going on does to you. */
export interface Effect {
  /** Walking and running speed, as a multiple of normal. */
  speed: number;
  /** Jump speed, as a multiple of normal. */
  jump: number;
  /** 0 (steady) to 1: how hard the view trembles. */
  jitter: number;
  /** How drunk you are (see features/bar/booze.ts): the view rolls and sways, and you stagger as you walk. */
  sway: number;
}

/** Nothing going on: your normal speed and jumps, and a steady view. */
const STEADY: Readonly<Effect> = { speed: 1, jump: 1, jitter: 0, sway: 0 };

/**
 * Everything going on with you, in the order it was added, and what it all comes to: speeds and jumps
 * multiply, the view trembles as hard as the hardest tremble, and sways add up.
 */
export class Effects {
  private list: readonly Effect[] = [];

  /** A new effect on you, steady until whatever brought it on writes what it does. */
  add(): Effect {
    const e = { ...STEADY };
    this.list = [...this.list, e];
    return e;
  }

  /** Takes an effect back off you. */
  remove(e: Effect): void {
    this.list = this.list.filter((x) => x !== e);
  }

  /** Walking and running speed, as a multiple of normal. */
  get speed(): number {
    let speed = 1;
    for (const e of this.list) speed *= e.speed;
    return speed;
  }

  /** Jump speed, as a multiple of normal. */
  get jump(): number {
    let jump = 1;
    for (const e of this.list) jump *= e.jump;
    return jump;
  }

  /** 0 (steady) to 1: how hard the view trembles. */
  get jitter(): number {
    let jitter = 0;
    for (const e of this.list) jitter = Math.max(jitter, e.jitter);
    return jitter;
  }

  /** How drunk you are, all told: the view rolls and sways, and you stagger as you walk. */
  get sway(): number {
    let sway = 0;
    for (const e of this.list) sway += e.sway;
    return sway;
  }
}
