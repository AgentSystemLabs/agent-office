/**
 * The jukebox's own tunes: lo-fi beats synthesized with Web Audio, like the office's other sounds
 * (see sound.ts). A tune is four bars of chords played on a warm electric piano over swung drums
 * and a round bass, with a little melody, the crackle of an old record and a wobbly tape. It runs
 * in 32-bar rounds so it breathes: the keys alone at first, then the beat, a melody, a breakdown.
 *
 * Every note follows from the tune and how far into it you are, so everyone on the floor who starts
 * from the same moment hears exactly the same bar.
 */

interface Tune {
  bpm: number;
  /** How late every other 16th lands, as a fraction of a 16th. */
  swing: number;
  /** A bar each: the bass root, then the notes the keys play (MIDI numbers). */
  chords: number[][];
  /** A bar of 16ths each: x hits, o hits softly. */
  kick: string;
  snare: string;
  hat: string;
  /** [16th, length in 16ths, semitones above the root]. */
  bass: [number, number, number][];
  /** When the keys strike the chord: [16th, length in 16ths, how hard]. */
  comp: [number, number, number][];
  /** Picks the melody. */
  seed: number;
}

const TUNES: Record<string, Tune> = {
  'rainy-window': {
    bpm: 74,
    swing: 0.16,
    chords: [
      [41, 57, 60, 64, 67], // Fmaj9
      [40, 55, 59, 62, 64], // Em7
      [38, 53, 57, 60, 64], // Dm9
      [36, 55, 58, 62, 64], // C9
    ],
    kick: 'x.........x.....',
    snare: '....x.......x...',
    hat: 'x.o.x.o.x.o.x.oo',
    bass: [
      [0, 7, 0],
      [10, 4, 0],
      [14, 2, 7],
    ],
    comp: [
      [0, 10, 1],
      [11, 5, 0.6],
    ],
    seed: 7,
  },
  'coffee-break': {
    bpm: 88,
    swing: 0.22,
    chords: [
      [38, 53, 57, 60, 64], // Dm9
      [43, 53, 59, 64, 69], // G13
      [36, 52, 55, 59, 62], // Cmaj9
      [45, 55, 61, 65], // A7♭13
    ],
    kick: 'x......x..x.....',
    snare: '....x.......x..o',
    hat: 'x.oxx.o.x.oxx.o.',
    bass: [
      [0, 5, 0],
      [6, 2, 7],
      [8, 5, 0],
      [14, 2, 12],
    ],
    comp: [
      [0, 6, 1],
      [6, 3, 0.65],
      [10, 6, 0.85],
    ],
    seed: 21,
  },
  'late-commit': {
    bpm: 70,
    swing: 0.12,
    chords: [
      [45, 60, 64, 67, 71], // Am9
      [41, 57, 59, 64], // Fmaj7♯11
      [38, 53, 57, 60, 64], // Dm9
      [40, 56, 59, 62, 65], // E7♭9
    ],
    kick: 'x......ox.x.....',
    snare: '....x.......x...',
    hat: 'x.o.x.o.x.o.x.o.',
    bass: [
      [0, 6, 0],
      [8, 2, 0],
      [10, 5, 0],
    ],
    comp: [
      [0, 10, 1],
      [12, 4, 0.6],
    ],
    seed: 3,
  },
  'green-build': {
    bpm: 94,
    swing: 0.1,
    chords: [
      [43, 59, 62, 66, 69], // Gmaj9
      [42, 57, 61, 64], // F♯m7
      [40, 55, 59, 62, 66], // Em9
      [45, 55, 61, 66], // A13
    ],
    kick: 'x.....x...x.....',
    snare: '....x.......x...',
    hat: 'x.xox.xox.xox.xo',
    bass: [
      [0, 3, 0],
      [3, 2, 12],
      [6, 3, 0],
      [10, 3, 7],
      [14, 2, 0],
    ],
    comp: [
      [0, 3, 0.9],
      [4, 2, 0.6],
      [8, 3, 0.8],
      [11, 4, 0.7],
    ],
    seed: 11,
  },
};

/** Rhythms for a bar of melody: [16th, length in 16ths]. */
const CELLS: [number, number][][] = [
  [
    [0, 4],
    [6, 2],
    [8, 6],
  ],
  [
    [2, 2],
    [4, 4],
    [10, 4],
  ],
  [
    [0, 6],
    [8, 2],
    [10, 2],
    [12, 4],
  ],
  [
    [4, 2],
    [6, 2],
    [8, 8],
  ],
  [
    [0, 3],
    [3, 3],
    [6, 6],
  ],
];
/** The last bar of each half of a phrase just rests on a note or two. */
const ENDINGS: [number, number][][] = [
  [[0, 12]],
  [
    [2, 2],
    [4, 10],
  ],
];

type Note = [step: number, len: number, midi: number];

/** Eight bars of melody, picked from each bar's chord tones by the tune's seed, then repeated. */
function melodyFor(t: Tune): Note[][] {
  const rand = mulberry(t.seed);
  let prev = 74;
  const bars: Note[][] = [];
  for (let b = 0; b < 8; b++) {
    const chord = t.chords[b % t.chords.length];
    const tones: number[] = [];
    for (let m = 67; m <= 83; m++) if (chord.some((c) => (c - m) % 12 === 0)) tones.push(m);
    const cells = b % 4 === 3 ? ENDINGS : CELLS;
    const cell = cells[Math.floor(rand() * cells.length)];
    bars.push(
      cell.map(([step, len]) => {
        // Mostly a step or two from the last note, now and then a leap.
        const near = tones.filter((m) => Math.abs(m - prev) <= (rand() < 0.2 ? 7 : 4) && m !== prev);
        const pool = near.length ? near : tones;
        prev = pool[Math.floor(rand() * pool.length)];
        return [step, len, prev];
      }),
    );
  }
  return bars;
}

/** How a 32-bar round goes: the keys alone, then everything, a breakdown, and everything again. */
function section(bar: number) {
  const b = bar % 32;
  return { drums: b >= 4 && !(b >= 24 && b < 28), bass: b >= 2, melody: (b >= 8 && b < 24) || b >= 28 };
}

const LOOKAHEAD = 1.1;
/** The tune's level after its compressor: at full volume, right at the jukebox, it peaks around 0.7. */
const LEVEL = 0.75;

export class TunePlayer {
  private tune: Tune;
  private melody: Note[][];
  private step: number;
  /** Audio-clock time minus tune time: where the tune's start falls on the audio clock. */
  private offset = NaN;
  /** The next 16th to schedule. */
  private next = -1;
  private fade: GainNode;
  private dry: GainNode;
  private keysBus: AudioNode;
  private melodyBus: AudioNode;
  private bassBus: AudioNode;
  private hatBus: AudioNode;
  private reverb: AudioNode;
  /** Slow pitch drift on everything tuned, like a stretched tape. */
  private wobble: GainNode;
  private vibrato: GainNode;
  private loops: AudioScheduledSourceNode[] = [];
  private stopped = false;
  /** Notes scheduled so far, for quick checks from the console. */
  notes = 0;

  constructor(
    private ctx: AudioContext,
    out: AudioNode,
    id: string,
  ) {
    this.tune = TUNES[id] ?? Object.values(TUNES)[0];
    this.melody = melodyFor(this.tune);
    this.step = 60 / this.tune.bpm / 4;
    const b = buffers(ctx);

    this.fade = ctx.createGain();
    this.fade.gain.setValueAtTime(0, ctx.currentTime);
    this.fade.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + 1.5);
    this.fade.connect(out);
    // Everything goes through a dull filter and a soft compressor, like an old sampler.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.2;
    this.dry = ctx.createGain();
    this.dry.gain.value = 0.8;
    this.dry.connect(biquad(ctx, 'lowpass', 5200, 0.5)).connect(comp).connect(this.fade);

    const conv = ctx.createConvolver();
    conv.buffer = b.room;
    const wet = ctx.createGain();
    wet.gain.value = 0.35;
    conv.connect(wet).connect(this.dry);
    this.reverb = conv;

    // The keys wobble in volume a little, like a Rhodes' tremolo.
    const trem = ctx.createGain();
    trem.gain.value = 0.85;
    const tremLfo = this.lfo(3.2, 0.15);
    tremLfo.connect(trem.gain);
    const keysTone = biquad(ctx, 'lowpass', 2400, 0.6);
    keysTone.connect(trem).connect(this.dry);
    trem.connect(this.reverb);
    this.keysBus = keysTone;
    const melodyTone = biquad(ctx, 'lowpass', 3000, 0.7);
    melodyTone.connect(this.dry);
    melodyTone.connect(this.reverb);
    this.melodyBus = melodyTone;
    this.bassBus = biquad(ctx, 'lowpass', 420, 0.8);
    this.bassBus.connect(this.dry);
    this.hatBus = biquad(ctx, 'highpass', 6500, 0.7);
    this.hatBus.connect(this.dry);

    this.wobble = this.lfo(0.37, 9);
    this.vibrato = this.lfo(5.2, 7);

    // The needle in the groove: crackle and a faint hiss, the whole time.
    const crackle = ctx.createBufferSource();
    crackle.buffer = b.crackle;
    crackle.loop = true;
    const crackleG = ctx.createGain();
    crackleG.gain.value = 0.05;
    crackle.connect(biquad(ctx, 'highpass', 900, 0.7)).connect(crackleG).connect(this.fade);
    crackle.start();
    this.loops.push(crackle);
  }

  /** Schedules what's coming up. `at` is how far into the tune it is now, in seconds. */
  tick(at: number) {
    const ctx = this.ctx;
    // A suspended context's clock stands still: notes scheduled on it would all come out at once.
    if (this.stopped || ctx.state !== 'running') return;
    // Line the tune up with the audio clock, and again whenever the two drift apart.
    const offset = ctx.currentTime - at;
    const drift = Math.abs(offset - this.offset);
    if (!(drift < 0.03)) {
      this.offset = offset;
      // A jump (a suspended context, a computer waking up): pick up from now rather than catch up.
      if (!(drift < 0.5)) this.next = -1;
    }
    if (this.next < 0) this.next = Math.max(0, Math.ceil(at / this.step));
    const until = at + LOOKAHEAD;
    for (; this.stepTime(this.next) < until; this.next++) {
      const t = this.stepTime(this.next);
      if (t >= at - 0.02) this.play(this.next, Math.max(ctx.currentTime, t + this.offset));
    }
  }

  /** 1 on each beat, falling to 0 before the next, for the jukebox's lights. */
  beat(at: number): number {
    const beats = at / (this.step * 4);
    const pulse = (1 - (beats - Math.floor(beats))) ** 2;
    return section(Math.floor(beats / 4)).drums ? pulse : pulse * 0.35;
  }

  /** Fades out and lets go of everything. */
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    const now = this.ctx.currentTime;
    this.fade.gain.cancelScheduledValues(now);
    this.fade.gain.setValueAtTime(this.fade.gain.value, now);
    this.fade.gain.linearRampToValueAtTime(0, now + 0.4);
    setTimeout(() => {
      for (const s of this.loops) s.stop();
      this.fade.disconnect();
    }, 1500);
  }

  private stepTime(k: number): number {
    return (k + (k % 2 ? this.tune.swing : 0)) * this.step;
  }

  private play(k: number, when: number) {
    const t = this.tune;
    const bar = Math.floor(k / 16);
    const s = k % 16;
    const on = section(bar);
    const chord = t.chords[bar % t.chords.length];
    const len = (n: number) => n * this.step;
    if (on.drums) {
      const hit = (p: string) => (p[s] === 'x' ? 1 : p[s] === 'o' ? 0.55 : 0);
      if (hit(t.kick)) this.kick(when, hit(t.kick));
      if (hit(t.snare)) this.snare(when, hit(t.snare));
      if (hit(t.hat)) this.hat(when, hit(t.hat) * (0.7 + 0.3 * hash(k, t.seed)));
    }
    if (on.bass) for (const [at, n, up] of t.bass) if (at === s) this.bass(when, chord[0] + up, len(n));
    for (const [at, n, vel] of t.comp) if (at === s) for (const m of chord.slice(1)) this.key(when + hash(k, m) * 0.012, m, len(n), vel);
    if (on.melody) for (const [at, n, m] of this.melody[bar % 8]) if (at === s) this.lead(when, m, len(n));
  }

  // ---- Instruments ------------------------------------------------------------------------------

  private kick(when: number, vel: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(115, when);
    o.frequency.exponentialRampToValueAtTime(44, when + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.85 * vel, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.42);
    o.connect(g).connect(this.dry);
    o.start(when);
    o.stop(when + 0.45);
    this.notes++;
  }

  private snare(when: number, vel: number) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = buffers(ctx).noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.32 * vel, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.22);
    n.connect(biquad(ctx, 'bandpass', 1900, 0.9)).connect(g);
    // A little body under the rattle.
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(190, when);
    o.frequency.exponentialRampToValueAtTime(140, when + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, when);
    og.gain.exponentialRampToValueAtTime(0.25 * vel, when + 0.003);
    og.gain.exponentialRampToValueAtTime(0.0001, when + 0.1);
    o.connect(og).connect(g);
    g.connect(this.dry);
    g.connect(this.reverb);
    n.start(when, Math.random() * 2);
    n.stop(when + 0.25);
    o.start(when);
    o.stop(when + 0.12);
    this.notes++;
  }

  private hat(when: number, vel: number) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = buffers(ctx).noise;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(0.13 * vel, when + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.045);
    n.connect(g).connect(this.hatBus);
    n.start(when, Math.random() * 2);
    n.stop(when + 0.06);
    this.notes++;
  }

  private bass(when: number, midi: number, len: number) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.34, when + 0.012);
    g.gain.setTargetAtTime(0.24, when + 0.012, 0.3);
    g.gain.setTargetAtTime(0, when + len, 0.05);
    for (const [type, mul, lvl] of [
      ['sine', 1, 1],
      ['triangle', 2, 0.18],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mul;
      const og = ctx.createGain();
      og.gain.value = lvl;
      o.connect(og).connect(g);
      o.start(when);
      o.stop(when + len + 0.4);
    }
    g.connect(this.bassBus);
    this.notes++;
  }

  /** An electric piano note: a sine, brightened for a moment by another at the same pitch. */
  private key(when: number, midi: number, len: number, vel: number) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const car = ctx.createOscillator();
    car.frequency.value = f;
    car.detune.value = (hash(midi, 5) - 0.5) * 8;
    const mod = ctx.createOscillator();
    mod.frequency.value = f;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(f * 1.4 * vel, when);
    depth.gain.exponentialRampToValueAtTime(f * 0.12, when + 0.5);
    mod.connect(depth).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.085 * vel, when + 0.006);
    g.gain.setTargetAtTime(0.035 * vel, when + 0.006, 0.5);
    g.gain.setTargetAtTime(0, when + len, 0.12);
    car.connect(g).connect(this.keysBus);
    this.tape(car, this.wobble);
    const end = when + len + 0.8;
    car.start(when);
    mod.start(when);
    car.stop(end);
    mod.stop(end);
    this.notes++;
  }

  private lead(when: number, midi: number, len: number) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = mtof(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.075, when + 0.03);
    g.gain.setTargetAtTime(0.05, when + 0.03, 0.4);
    g.gain.setTargetAtTime(0, when + len, 0.1);
    o.connect(g).connect(this.melodyBus);
    this.tape(o, this.wobble);
    this.tape(o, this.vibrato);
    o.start(when);
    o.stop(when + len + 0.6);
    this.notes++;
  }

  /** Detunes `o` along with an LFO while it plays, then lets go of it. */
  private tape(o: OscillatorNode, lfo: GainNode) {
    lfo.connect(o.detune);
    o.addEventListener('ended', () => lfo.disconnect(o.detune), { once: true });
  }

  /** A sine LFO, `depth` either side of zero. */
  private lfo(freq: number, depth: number): GainNode {
    const o = this.ctx.createOscillator();
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    o.start();
    this.loops.push(o);
    return g;
  }
}

// ---- Plumbing --------------------------------------------------------------------------------------

export const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);

export function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** The same 0–1 for the same numbers, on everyone's machine. */
export function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Buffers {
  noise: AudioBuffer;
  crackle: AudioBuffer;
  /** A small, dark room to put the keys and snare in. */
  room: AudioBuffer;
}
const made = new WeakMap<BaseAudioContext, Buffers>();

export function buffers(ctx: BaseAudioContext): Buffers {
  let b = made.get(ctx);
  if (b) return b;
  const sr = ctx.sampleRate;
  const noise = ctx.createBuffer(1, sr * 3, sr);
  const nd = noise.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  // Pops of every size, a few dozen a second, over a whisper of hiss.
  const crackle = ctx.createBuffer(1, sr * 5, sr);
  const cd = crackle.getChannelData(0);
  for (let i = 0; i < cd.length; i++) cd[i] = (Math.random() * 2 - 1) * 0.04;
  for (let n = 0; n < 5 * 28; n++) {
    const at = Math.floor(Math.random() * (cd.length - 200));
    const amp = Math.random() ** 3 * (Math.random() < 0.5 ? -1 : 1);
    const width = 2 + Math.floor(Math.random() * 30);
    for (let i = 0; i < width * 4; i++) cd[at + i] += amp * Math.exp(-i / width) * (i % 2 ? -0.6 : 1);
  }

  const room = ctx.createBuffer(2, Math.floor(sr * 1.6), sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = room.getChannelData(ch);
    let low = 0;
    for (let i = 0; i < d.length; i++) {
      low += (Math.random() * 2 - 1 - low) * 0.25;
      d[i] = low * Math.exp((-i / sr) * 3.4);
    }
  }
  b = { noise, crackle, room };
  made.set(ctx, b);
  return b;
}
