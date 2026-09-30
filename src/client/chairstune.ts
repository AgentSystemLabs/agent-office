/**
 * The musical chairs theme: a bouncy little tune synthesized with Web Audio, like the jukebox's own
 * (see music.ts) and the DJ's set on the roof (see dnb.ts). Eight bars of a bright major progression
 * over a disco kick, a hand clap on two and four, a skipping bass, a marimba arpeggio and a stab on
 * the off-beat, with a roll through the last bar of every eight so the ring keeps bouncing.
 *
 * Every note follows from how far into the tune you are, and the page works that out from the moment
 * the office said the music started (see ChairsState.phaseAt), so everyone on the floor hears the same
 * bar — and the music stops in the same instant for all of them, which is the whole point of the game.
 */

import { biquad, buffers, hash, mtof } from './music';

export const CHAIR_BPM = 124;
/** A 16th, in seconds: the tune's whole clock. */
const STEP = 60 / CHAIR_BPM / 4;
/** How many bars the tune runs before it comes round again. */
const BARS = 8;
/** How far ahead notes are scheduled (s). */
const LOOKAHEAD = 1.1;
/** The tune's level after its compressor: loud enough for a party, and no louder. */
const LEVEL = 0.85;

/** The major scale the tune is in. */
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** I · vi · IV · V, twice: the walk from a big bright chord round to another one, in scale degrees. */
const PROG = [0, 5, 3, 4, 0, 5, 3, 4];

/** A bar of 16ths each: x hits, o hits softly. */
const KICK = 'x.....x.x.......';
const CLAP = '....x.......x...';
const HAT = '..x...x...x...x.';
/** The bass skips along under it, up and down the chord. */
const BASS = [0, 0, 2, 0, 1, 1, 2, 1];
/** The marimba's arpeggio, in eighths round the chord. */
const ARP = [0, 2, 1, 3, 2, 4, 3, 2];

/** A note of the scale: `degree` steps up from `root` (MIDI). */
function note(root: number, degree: number): number {
  const d = ((degree % 7) + 7) % 7;
  return root + MAJOR[d] + 12 * Math.floor(degree / 7);
}

/** What the lights and the dancers go by: where the tune is, and what just hit. */
export interface ChairFrame {
  /** 1 on each beat, falling to 0 before the next. */
  beat: number;
  /** 1 as a kick lands, falling off fast. */
  kick: number;
  /** 1 as the claps land, falling off a little slower. */
  clap: number;
  /** Which of the eight bars, 0–7. */
  bar: number;
  /** 0–1, round the colour wheel: the ring's lights and the note sprites go round with it. */
  hue: number;
  /** How loud the bar is: the last bar of every eight builds up to the top of the next. */
  rise: number;
}

/** How long ago, in 16ths of a bar, the last hit of a bar's pattern was; -1 if it hasn't hit yet. */
function sinceHit(pattern: string, s: number): number {
  for (let i = s; i >= 0; i--) if (pattern[i] === 'x' || pattern[i] === 'o') return (s - i) / 16;
  return -1;
}

/** What the tune is doing at `at` seconds into it. */
export function chairFrame(at: number): ChairFrame {
  const step = Math.max(0, at) / STEP;
  const bar = Math.floor(step / 16) % BARS;
  const s = Math.floor(step) % 16;
  // Off the same patterns the tune plays, so the lights are on the kick and the claps as they land.
  const kick = sinceHit(KICK, s);
  const clap = sinceHit(CLAP, s);
  return {
    beat: (1 - ((step / 4) % 1)) ** 2,
    kick: kick < 0 ? 0 : (1 - kick) ** 3,
    clap: clap < 0 ? 0 : (1 - clap) ** 2,
    bar,
    hue: ((bar / BARS + s * 0.006) % 1 + 1) % 1,
    rise: bar === BARS - 1 ? (s + 1) / 16 : 0,
  };
}

export class ChairTune {
  /** Audio-clock time minus tune time. */
  private offset = NaN;
  /** The next 16th to schedule. */
  private next = -1;
  private fade: GainNode;
  private master: DynamicsCompressorNode;
  private room: ConvolverNode;
  private stopped = false;
  /** Notes scheduled so far, for quick checks from the console. */
  notes = 0;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
  ) {
    this.fade = ctx.createGain();
    this.fade.gain.setValueAtTime(0, ctx.currentTime);
    // The tune starts the moment the office says it does, so it comes straight in at full level.
    this.fade.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + 0.05);
    this.fade.connect(out);
    this.master = ctx.createDynamicsCompressor();
    this.master.threshold.value = -14;
    this.master.knee.value = 10;
    this.master.ratio.value = 4;
    this.master.attack.value = 0.004;
    this.master.release.value = 0.15;
    this.master.connect(this.fade);
    // A little of the room in it, so it sounds like it's in the office.
    const room = ctx.createConvolver();
    room.buffer = buffers(ctx).room;
    const wet = ctx.createGain();
    wet.gain.value = 0.22;
    room.connect(wet).connect(this.master);
    this.room = room;
  }

  /** Schedules what's coming up. `at` is how far into the tune it is now. */
  tick(at: number) {
    const ctx = this.ctx;
    // A suspended context's clock stands still: notes scheduled on it would all come out at once.
    if (this.stopped || ctx.state !== 'running') return;
    const offset = ctx.currentTime - at;
    const drift = Math.abs(offset - this.offset);
    if (!(drift < 0.03)) {
      this.offset = offset;
      // A jump (a suspended context, a computer waking up): pick up from now rather than catch up.
      if (!(drift < 0.5)) this.next = -1;
    }
    if (this.next < 0) this.next = Math.ceil(at / STEP);
    const until = at + LOOKAHEAD;
    for (; this.next * STEP < until; this.next++) {
      const t = this.next * STEP;
      if (t >= at - 0.02) this.play(this.next, Math.max(ctx.currentTime, t + this.offset));
    }
  }

  /** Stops dead, the way the game does. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(this.fade.gain.value, now);
    this.fade.gain.linearRampToValueAtTime(0, now + 0.06);
    setTimeout(() => this.fade.disconnect(), 900);
  }

  /**
   * The music being yanked off the record: the needle dragging back down the run-out groove, with a
   * comic squeal on top. It goes to the same bus as the tune, so it stops where the music was.
   */
  yank() {
    const ctx = this.ctx;
    if (this.stopped) return;
    const t0 = ctx.currentTime + 0.01;
    // The groove: noise through a filter that falls away a long way over a second.
    const noise = ctx.createBufferSource();
    noise.buffer = buffers(ctx).noise;
    noise.loop = true;
    const sweep = biquad(ctx, 'bandpass', 2600, 3);
    sweep.frequency.setValueAtTime(2600, t0);
    sweep.frequency.exponentialRampToValueAtTime(180, t0 + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.95);
    noise.connect(sweep).connect(g).connect(this.master);
    noise.start(t0);
    noise.stop(t0 + 1);
    // The squeal: two saws sliding down a fifth and a half, wobbling.
    for (const [f, det] of [
      [760, 0],
      [757, 9],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = det;
      o.frequency.setValueAtTime(f, t0);
      o.frequency.exponentialRampToValueAtTime(f * 0.34, t0 + 0.55);
      const wob = ctx.createOscillator();
      wob.frequency.value = 11;
      const depth = ctx.createGain();
      depth.gain.value = 26;
      wob.connect(depth).connect(o.frequency);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.exponentialRampToValueAtTime(0.09, t0 + 0.03);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o.connect(biquad(ctx, 'bandpass', 1500, 1.4)).connect(og).connect(this.master);
      og.connect(this.room);
      o.start(t0);
      o.stop(t0 + 0.65);
      wob.start(t0);
      wob.stop(t0 + 0.65);
    }
    this.notes++;
  }

  /** The 16th `k` of the tune, at `when` on the audio clock. */
  private play(k: number, when: number) {
    const bar = Math.floor(k / 16) % BARS;
    const s = k % 16;
    const chord = PROG[bar];
    const build = bar === BARS - 1;
    const len = (n: number) => n * STEP;
    const hit = (p: string) => (p[s] === 'x' ? 1 : p[s] === 'o' ? 0.4 : 0);

    if (hit(KICK)) this.kick(when, hit(KICK));
    if (hit(CLAP)) this.clap(when, hit(CLAP));
    if (hit(HAT)) this.hat(when, hit(HAT) * (0.8 + 0.2 * hash(k, 5)));
    // The roll through the last bar of the eight, a sixteenth at a time, up into the top of the next.
    if (build && s >= 8) this.clap(when, 0.25 + (s - 8) * 0.07);
    if (s === 0 && build) this.stab(when, [note(64, chord), note(64, chord + 2), note(64, chord + 4), note(64, chord + 6)], 0.22, 0.5);

    // The bass: an octave down, skipping about under the arpeggio.
    if (s % 2 === 0) {
      const n = note(40, chord + BASS[(s / 2) % BASS.length]);
      this.bass(when, n, len(2), 0.28 + (build ? (s / 16) * 0.1 : 0));
    }
    // The marimba: the chord's notes, up and down, one an eighth.
    if (s % 2 === 0) this.pluck(when, note(72, chord + ARP[(s / 2) % ARP.length]), len(2), 0.2, true);
    // The stab on the off-beat, every other bar, and a little answer on the last beat of the eight.
    if (s === 7 && bar % 2 === 1) this.stab(when, [note(64, chord + 2), note(64, chord + 4)], 0.12, 0.18);
  }

  // ---- Instruments ------------------------------------------------------------------------------

  private noiseAt(when: number, until: number): AudioBufferSourceNode {
    const n = this.ctx.createBufferSource();
    n.buffer = buffers(this.ctx).noise;
    n.start(when, hash(Math.round(when * 100), 7) * 2);
    n.stop(until);
    return n;
  }

  private env(when: number, peak: number, attack: number, decay: number): GainNode {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(peak, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + attack + decay);
    return g;
  }

  /** The disco kick: a thump that falls away under the beater's click. */
  private kick(when: number, vel: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(150, when);
    o.frequency.exponentialRampToValueAtTime(48, when + 0.1);
    o.connect(this.env(when, 0.9 * vel, 0.003, 0.24)).connect(this.master);
    o.start(when);
    o.stop(when + 0.3);
    this.noiseAt(when, when + 0.02).connect(biquad(ctx, 'highpass', 3000, 0.7)).connect(this.env(when, 0.18 * vel, 0.001, 0.01)).connect(this.master);
    this.notes++;
  }

  /** A hand clap: a burst of noise with a little snap on the front of it. */
  private clap(when: number, vel: number) {
    const ctx = this.ctx;
    const g = this.env(when, 0.34 * vel, 0.002, 0.11);
    this.noiseAt(when, when + 0.18).connect(biquad(ctx, 'bandpass', 1700, 1.1)).connect(g);
    g.connect(this.master);
    g.connect(this.room);
    this.notes++;
  }

  /** The shaker on the off-beat. */
  private hat(when: number, vel: number) {
    this.noiseAt(when, when + 0.05)
      .connect(biquad(this.ctx, 'highpass', 8000, 0.7))
      .connect(this.env(when, 0.09 * vel, 0.001, 0.03))
      .connect(this.master);
    this.notes++;
  }

  /** The skipping bass: a filtered square, short and rubbery. */
  private bass(when: number, midi: number, len: number, vel: number) {
    const ctx = this.ctx;
    const lp = biquad(ctx, 'lowpass', 900, 3);
    lp.frequency.setValueAtTime(1500, when);
    lp.frequency.exponentialRampToValueAtTime(420, when + len);
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = mtof(midi);
    o.connect(lp).connect(this.env(when, vel, 0.004, len)).connect(this.master);
    o.start(when);
    o.stop(when + len + 0.02);
    this.notes++;
  }

  /** The marimba: a sine and a triangle an octave up, gone in a moment, with the room on it. */
  private pluck(when: number, midi: number, len: number, vel: number, echo: boolean) {
    const ctx = this.ctx;
    for (const [mul, lvl, type] of [
      [1, 1, 'sine'],
      [2.01, 0.3, 'triangle'],
      [3.02, 0.12, 'sine'],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(midi) * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(vel * lvl, when + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, when + len * 1.6);
      o.connect(g).connect(this.master);
      if (echo) g.connect(this.room);
      o.start(when);
      o.stop(when + len * 1.7);
    }
    this.notes++;
  }

  /** Two or four notes together on a bell: the off-beat stab. */
  private stab(when: number, notes: number[], vel: number, len: number) {
    for (const midi of notes) this.pluck(when, midi, len, vel, false);
  }
}
