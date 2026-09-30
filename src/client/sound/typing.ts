import { NowAndThen, type AudioCore } from './core';
import { biquad, envelope, pick, place, rand, randInt } from './dsp';

// ---- Workers typing ----------------------------------------------------------------------------

interface Typist {
  x: number;
  z: number;
  on: boolean;
  panner: PannerNode | null;
  /** When (audio clock) the next key lands. */
  next: number;
  /** Keys left in this burst; 0 means a pause is running and the next key starts a new burst. */
  left: number;
  /** Keys left in this word. */
  word: number;
}

/** Workers typing at their desks while they work, and now and then fidgeting there. */
export class Typing {
  private typists = new Map<string, Typist>();

  constructor(private readonly a: AudioCore) {}

  /** The worker at desk (x, z) types while `on`. */
  setTyping(id: string, x: number, z: number, on: boolean) {
    let t = this.typists.get(id);
    if (!t) this.typists.set(id, (t = { x, z, on: false, panner: null, next: 0, left: 0, word: 0 }));
    if (t.panner && (t.x !== x || t.z !== z)) place(t.panner, x, 0.9, z);
    t.x = x;
    t.z = z;
    if (on && !t.on) t.next = 0;
    t.on = on;
  }

  removeTypist(id: string) {
    this.typists.get(id)?.panner?.disconnect();
    this.typists.delete(id);
  }

  scheduleTyping(now: number) {
    // Schedule a little ahead on the audio clock so the rhythm doesn't wobble with the frame rate.
    const horizon = now + 0.12;
    for (const t of this.typists.values()) {
      if (!t.on) continue;
      if (!t.panner) {
        t.panner = this.a.panner({ x: t.x, y: 0.9, z: t.z }, 1.2, 1.3);
        t.panner.connect(this.a.ambience);
      }
      // Just started, or fell behind while the tab was hidden: begin again shortly.
      if (t.next < now - 0.25) {
        t.next = now + rand(0.05, 0.8);
        t.left = 0;
      }
      while (t.next < horizon) {
        const when = t.next;
        if (t.left === 0) {
          t.left = randInt(6, 36);
          t.word = randInt(2, 8);
          // Now and then they click around before typing again.
          if (Math.random() < 0.3) {
            this.key(t, when, 'mouse');
            if (Math.random() < 0.5) this.key(t, when + rand(0.1, 0.16), 'mouse');
            t.next = when + rand(0.4, 1.2);
            continue;
          }
        }
        t.left--;
        if (t.left === 0) {
          // End of a burst: often Enter, then a pause to read or think.
          this.key(t, when, Math.random() < 0.4 ? 'enter' : 'key');
          t.next = when + (Math.random() < 0.15 ? rand(4, 9) : rand(0.6, 3));
        } else if (--t.word <= 0) {
          this.key(t, when, 'space');
          t.word = randInt(2, 8);
          t.next = when + rand(0.1, 0.22);
        } else {
          this.key(t, when, 'key');
          t.next = when + rand(0.065, 0.16);
        }
      }
    }
  }

  private key(t: Typist, when: number, kind: 'key' | 'space' | 'enter' | 'mouse') {
    const b = this.a.buf;
    const buf = kind === 'key' ? pick(b.keys) : kind === 'mouse' ? b.mouse : pick(b.spaces);
    const gain = kind === 'enter' ? 0.55 : kind === 'space' ? 0.4 : kind === 'mouse' ? 0.3 : rand(0.24, 0.34);
    this.a.play(buf, { gain, rate: rand(0.93, 1.07), when, dest: t.panner! });
    this.a.count(kind);
  }

  /** Someone at a worker's desk shuffles papers or leans back in a creaky chair. */
  fidget(now: number) {
    const desks = [...this.typists.values()];
    if (!desks.length) return;
    const d = pick(desks);
    if (Math.random() < 0.6) {
      this.a.play(this.a.buf.rustle, { at: { x: d.x, y: 0.8, z: d.z }, gain: 0.35, rate: rand(0.85, 1.15), ref: 1.2, rolloff: 1.3 });
      this.a.count('rustle');
      return;
    }
    const ctx = this.a.ctx!;
    const out = this.a.panner({ x: d.x, y: 0.5, z: d.z }, 1.2, 1.3);
    out.connect(this.a.ambience);
    const len = rand(0.25, 0.45);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f = rand(150, 200);
    o.frequency.setValueAtTime(f, now);
    o.frequency.linearRampToValueAtTime(f * rand(1.2, 1.5), now + len);
    const g = ctx.createGain();
    envelope(g.gain, now, [
      [0.05, 0.05],
      [len - 0.05, 0.04],
      [len, 0],
    ]);
    o.connect(biquad(ctx, 'bandpass', rand(900, 1300), 7)).connect(g).connect(out);
    o.start(now);
    o.stop(now + len + 0.02);
    this.a.count('creak');
  }

}

/** Someone at a worker's desk fidgets every so often (not up on the roof). */
export function fidgeting(a: AudioCore, typing: Typing): NowAndThen {
  return new NowAndThen(
    () => rand(8, 20),
    () => rand(10, 30),
    (now) => {
      if (!a.outdoors) typing.fidget(now);
    },
  );
}
