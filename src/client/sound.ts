/**
 * Office sounds, synthesized with Web Audio so there are no audio files to ship: the room's air and a
 * humming fridge, workers typing while they work, footsteps, the coffee machine, birds outside the
 * windows by day and crickets at night, rain and thunder, the odd rustle or phone, the gong, the dog
 * barking, and the dings when a worker needs you. And the lounge jukebox, whose tunes are in music.ts,
 * and up on the roof, the wind, the city far below and the DJ's drum and bass (dnb.ts).
 *
 * Everything goes through one master gain that Settings turns down or mutes. Voice chat doesn't, and
 * the jukebox has a volume of its own.
 */
import { CABINET, DESKS, DJ_BOOTH, FLOOR, GONG, JUKEBOX, WINDOWS as OPENINGS } from '../shared/layout';
import type { GongWhy } from '../shared/protocol';
import { STREAM } from '../shared/jukebox';
import { TunePlayer } from './music';
import { DjPlayer } from './dnb';

type Pos = { x: number; y: number; z: number };

/** What the jukebox on your floor plays: a tune or a stream, and when it started on performance.now()'s clock. */
export interface JukeboxPlay {
  track: string;
  url?: string;
  /** When it started on the office's clock, which tells one play of a track from the next. */
  startedAt: number;
  since: number;
}

/** How the jukebox fades with distance: the same curve for its tunes (a panner) and a stream (by hand). */
const MUSIC_REF = 2.5;
const MUSIC_ROLLOFF = 1.3;

/** Where you hear from: your head, facing where the camera looks. */
export interface Listener extends Pos {
  fx: number;
  fz: number;
}

// The kitchen props (office.ts puts the kitchen at x -14.5, z 12.2).
const COFFEE_MACHINE: Pos = { x: -15.7, y: 1.4, z: 12.2 };
const FRIDGE: Pos = { x: -11.3, y: 1.1, z: 12.2 };
/** Just outside the office's windows (not the loft's). */
const WINDOWS: Pos[] = OPENINGS.filter((o) => o.y0 < 2).map((o) =>
  o.wall === 'south' || o.wall === 'north'
    ? { x: o.u, y: 2.4, z: o.wall === 'south' ? FLOOR.maxZ + 1.5 : FLOOR.minZ - 1.5 }
    : { x: o.wall === 'west' ? FLOOR.minX - 1.5 : FLOOR.maxX + 1.5, y: 2.4, z: o.u },
);
/** The middle of the gong's disc. */
const GONG_AT: Pos = { x: GONG.x, y: GONG.height - 1.36, z: GONG.z };
/** The arcade cabinet's speaker, under its screen. */
const CABINET_AT: Pos = { x: CABINET.x - 0.2, y: 1.2, z: CABINET.z };
/** A gong's overtones don't line up like a string's: [ratio to the lowest, loudness, seconds to die away]. */
const GONG_PARTIALS: [number, number, number][] = [
  [1, 0.8, 7],
  [1.51, 0.75, 5.5],
  [2.13, 0.65, 4.6],
  [2.66, 0.55, 3.8],
  [3.19, 0.45, 3.1],
  [3.84, 0.38, 2.5],
  [4.48, 0.3, 2],
  [5.27, 0.22, 1.6],
  [6.35, 0.16, 1.2],
  [7.61, 0.1, 0.9],
  [9.08, 0.07, 0.6],
];

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

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

export class OfficeSound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  /** The room itself; it goes quiet while the tab is hidden. */
  private ambience!: GainNode;
  /** Worker dings, which you still want to hear from another tab. */
  private alerts!: GainNode;
  /** The office's own hum (the room and the fridge), left behind going up on the roof… */
  private indoors!: GainNode;
  /** …where there's wind, and the city far below. */
  private outside!: GainNode;
  private outdoors = false;
  private analyser!: AnalyserNode;
  private buf!: Buffers;
  private volume = 0.7;
  private muted = false;
  private typists = new Map<string, Typist>();
  private fridge: { gain: GainNode; on: boolean; next: number } | null = null;
  private nextBird = 0;
  private nextCricket = 0;
  private nextPhone = 0;
  private nextFidget = 0;
  /** Outside: how hard it's raining (0–1) and how dark it is (1 at night). */
  private weather = { rain: 0, night: 0 };
  private rainNodes: { gain: GainNode; tone: BiquadFilterNode } | null = null;
  private nextRain = 0;
  private nextDrip = 0;
  private listener: Listener = { x: 0, y: 1.4, z: 0, fx: 0, fz: -1 };
  // The jukebox: from the cabinet, through a filter that muffles it from across the room, to your own volume.
  private musicIn!: PannerNode;
  private musicTone!: BiquadFilterNode;
  private musicCutoff = 16000;
  private musicBus!: GainNode;
  private musicMeter!: AnalyserNode;
  private musicVolume = 0.5;
  private musicMuted = false;
  private jukebox: JukeboxPlay | null = null;
  private tune: TunePlayer | null = null;
  private stream: HTMLAudioElement | null = null;
  private musicTimer = 0;
  // The DJ on the roof, through the speakers by the booth, at your music volume.
  private djIn!: PannerNode;
  private dj: DjPlayer | null = null;
  /** How far into the DJ's set it is (see djTime), while you're up there. */
  private djClock: (() => number) | null = null;
  private djTimer = 0;
  /** A stream that won't play here. */
  onMusicError?: (text: string) => void;
  /** How many of each sound have played, for quick checks from the console. */
  readonly played: Record<string, number> = {};

  constructor() {
    // Browsers only allow audio after a click or key press.
    const unlock = () => this.unlock();
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    document.addEventListener('visibilitychange', () => this.applyVisibility());
  }

  /** Volume is 0–1; muted silences everything without losing the level. */
  setVolume(volume: number, muted: boolean) {
    this.volume = Math.max(0, Math.min(1, volume));
    this.muted = muted;
    this.applyVolume();
  }

  /** The weather outside (see world/sky.ts), every frame. */
  setWeather(rain: number, night: number) {
    this.weather.rain = rain;
    this.weather.night = night;
  }

  /** Output level (RMS) right now, for headless checks. */
  level(): number {
    return this.ctx ? rms(this.analyser) : 0;
  }

  /** The jukebox's level (RMS) where you stand, after your music volume. A stream doesn't show here. */
  musicLevel(): number {
    return this.ctx ? rms(this.musicMeter) : 0;
  }

  get state(): AudioContextState | 'locked' {
    return this.ctx?.state ?? 'locked';
  }

  private unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      // A ding can start audio before you've touched the page, when a stream isn't allowed to play yet.
      if (this.stream?.paused) void this.stream.play().catch(() => {});
      return;
    }
    let ctx: AudioContext;
    try {
      ctx = new AudioContext();
    } catch {
      return; // no audio here
    }
    this.ctx = ctx;
    this.buf = makeBuffers(ctx);
    // A gentle compressor, so a room full of typing never clips.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 12;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.25;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(comp).connect(ctx.destination);
    comp.connect(this.analyser);
    this.ambience = ctx.createGain();
    this.ambience.connect(this.master);
    this.alerts = ctx.createGain();
    this.alerts.connect(this.master);
    this.indoors = ctx.createGain();
    this.indoors.connect(this.ambience);
    this.outside = ctx.createGain();
    this.outside.gain.value = 0;
    this.outside.connect(this.ambience);
    // The jukebox skips the master (it has its own volume) and keeps playing while the tab is hidden.
    this.musicIn = this.panner(JUKEBOX, MUSIC_REF, MUSIC_ROLLOFF);
    this.musicTone = biquad(ctx, 'lowpass', 16000, 0.5);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicMeter = ctx.createAnalyser();
    this.musicMeter.fftSize = 2048;
    this.musicIn.connect(this.musicTone).connect(this.musicBus).connect(ctx.destination);
    this.musicBus.connect(this.musicMeter);
    // Loud enough to hear from anywhere on the roof, and loudest on the dance floor.
    this.djIn = this.panner({ x: DJ_BOOTH.x, y: 2.2, z: DJ_BOOTH.z }, 7, 0.8);
    this.djIn.connect(this.musicBus);
    this.applyVolume();
    this.applyMusicVolume();
    this.applyJukebox();
    this.applyVisibility();
    this.startRoomTone();
    this.startFridge();
    this.startWind();
    this.applyOutdoors();
    this.applyDj();
    const now = ctx.currentTime;
    this.nextBird = now + rand(5, 15);
    this.nextCricket = now + rand(2, 6);
    this.nextPhone = now + rand(60, 150);
    this.nextFidget = now + rand(8, 20);
    void ctx.resume();
  }

  private applyVolume() {
    if (!this.ctx) return;
    // Squared, so the slider feels even to the ear.
    const g = this.muted ? 0 : this.volume * this.volume;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.04);
  }

  private applyVisibility() {
    if (!this.ctx) return;
    if (!document.hidden && this.ctx.state === 'suspended') void this.ctx.resume();
    this.ambience.gain.setTargetAtTime(document.hidden ? 0 : 1, this.ctx.currentTime, 0.15);
  }

  private count(what: string) {
    this.played[what] = (this.played[what] ?? 0) + 1;
  }

  // ---- Every frame -------------------------------------------------------------------------------

  /** Moves your ears and schedules whatever the room does next. */
  update(l: Listener) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.listener = l;
    // Level the facing, so looking straight down never lines it up with "up".
    const len = Math.hypot(l.fx, l.fz) || 1;
    const L = ctx.listener;
    if (L.positionX) {
      L.positionX.value = l.x;
      L.positionY.value = l.y;
      L.positionZ.value = l.z;
      L.forwardX.value = l.fx / len;
      L.forwardY.value = 0;
      L.forwardZ.value = l.fz / len;
      L.upX.value = 0;
      L.upY.value = 1;
      L.upZ.value = 0;
    } else {
      L.setPosition(l.x, l.y, l.z);
      L.setOrientation(l.fx / len, 0, l.fz / len, 0, 1, 0);
    }
    const now = ctx.currentTime;
    this.hearJukebox(now);
    this.scheduleTyping(now);
    this.tickFridge(now);
    const { rain, night } = this.weather;
    if (now >= this.nextBird) {
      // Birds sing by day, and not in the rain.
      if (night < 0.5 && rain < 0.1) this.birds(now);
      // Sometimes another bird answers from a different window.
      this.nextBird = now + (Math.random() < 0.35 ? rand(1.5, 4) : rand(12, 35));
    }
    if (now >= this.nextCricket) {
      if (night > 0.6 && rain < 0.05) this.crickets(now);
      this.nextCricket = now + rand(3, 8);
    }
    this.tickRain(now);
    if (now >= this.nextPhone) {
      if (!this.outdoors) this.phone(now);
      this.nextPhone = now + rand(90, 240);
    }
    if (now >= this.nextFidget) {
      if (!this.outdoors) this.fidget(now);
      this.nextFidget = now + rand(10, 30);
    }
  }

  // ---- Workers typing ----------------------------------------------------------------------------

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

  private scheduleTyping(now: number) {
    // Schedule a little ahead on the audio clock so the rhythm doesn't wobble with the frame rate.
    const horizon = now + 0.12;
    for (const t of this.typists.values()) {
      if (!t.on) continue;
      if (!t.panner) {
        t.panner = this.panner({ x: t.x, y: 0.9, z: t.z }, 1.2, 1.3);
        t.panner.connect(this.ambience);
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
    const b = this.buf;
    const buf = kind === 'key' ? pick(b.keys) : kind === 'mouse' ? b.mouse : pick(b.spaces);
    const gain = kind === 'enter' ? 0.55 : kind === 'space' ? 0.4 : kind === 'mouse' ? 0.3 : rand(0.24, 0.34);
    this.play(buf, { gain, rate: rand(0.93, 1.07), when, dest: t.panner! });
    this.count(kind);
  }

  // ---- Footsteps --------------------------------------------------------------------------------

  /** One of your own footsteps, or the thump of landing a jump. */
  step(kind: 'walk' | 'land' = 'walk') {
    if (!this.ctx) return;
    if (kind === 'land') this.play(pick(this.buf.steps), { gain: 0.5, rate: 0.75 });
    else this.play(pick(this.buf.steps), { gain: rand(0.16, 0.21), rate: rand(0.9, 1.1) });
    this.count(kind === 'land' ? 'land' : 'step');
  }

  /** An issue card in your hands: taken off the board, or put down on a desk. */
  paper() {
    if (!this.ctx) return;
    this.play(this.buf.rustle, { gain: 0.5, rate: rand(1.1, 1.3) });
    this.count('paper');
  }

  /** Someone else's footstep, on the office floor unless `y` says where else. */
  stepAt(x: number, z: number, y = 0) {
    if (!this.ctx) return;
    this.play(pick(this.buf.steps), { at: { x, y: y + 0.1, z }, gain: rand(0.3, 0.38), rate: rand(0.9, 1.1), ref: 1.5, rolloff: 1.4 });
    this.count('peerStep');
  }

  // ---- The ladder and the fire poles -----------------------------------------------------------

  /** Your hand closing on a steel rung, or on the pole: a soft clank. */
  rung(soft = false) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count('rung');
    const t0 = ctx.currentTime + 0.005;
    const f = rand(820, 980) * (soft ? 0.7 : 1);
    this.blip(this.ambience, t0, f, 0.97, 0.12, soft ? 0.05 : 0.08);
    this.blip(this.ambience, t0, f * 2.71, 0.98, 0.06, 0.03);
    this.play(pick(this.buf.steps), { gain: 0.12, rate: rand(1.6, 1.9) });
  }

  /** A trapdoor at the ladder: creaking open, or banging shut. From where it is, so you hear it from across the room. */
  hatch(at: { x: number; y: number; z: number }, open: boolean) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count(open ? 'hatchOpen' : 'hatchShut');
    const out = this.panner(at, 2, 1.1);
    out.connect(this.ambience);
    const t0 = ctx.currentTime + 0.01;
    if (open) {
      // A creaky hinge: a rough, wavering squeak.
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(420, t0);
      o.frequency.linearRampToValueAtTime(640, t0 + 0.18);
      o.frequency.linearRampToValueAtTime(380, t0 + 0.36);
      const wobble = ctx.createOscillator();
      wobble.frequency.value = 23;
      const depth = ctx.createGain();
      depth.gain.value = 40;
      wobble.connect(depth).connect(o.frequency);
      const g = ctx.createGain();
      envelope(g.gain, t0, [
        [0.04, 0.05],
        [0.3, 0.04],
        [0.4, 0],
      ]);
      o.connect(biquad(ctx, 'bandpass', 1400, 2.5)).connect(g).connect(out);
      for (const n of [o, wobble]) {
        n.start(t0);
        n.stop(t0 + 0.45);
      }
    } else this.play(pick(this.buf.steps), { gain: 0.5, rate: 0.62, dest: out });
  }

  /** Your head on the ceiling: the ladder doesn't go any higher. */
  bonk() {
    if (!this.ctx) return;
    this.count('bonk');
    this.play(pick(this.buf.steps), { gain: 0.35, rate: 0.5 });
    this.blip(this.ambience, this.ctx.currentTime + 0.01, 180, 0.6, 0.18, 0.12);
  }

  // ---- Golf off the balcony ------------------------------------------------------------------------

  /**
   * A golf ball: the club through it (`hit`), coming down on grass or the road (`bounce`, `speed`
   * in m/s) or dying in sand or rough (`thud`), off the railing's glass (`rail`) or a wall, rattling
   * into the cup, and a fanfare for a hole in one. `at` is where, for someone else's ball; your own
   * you hear wherever it is, since the camera's following it.
   */
  golf(kind: 'hit' | 'bounce' | 'thud' | 'rail' | 'wall' | 'cup' | 'cheer', at?: Pos, speed = 5) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count(`golf-${kind}`);
    const out = at ? this.panner(at, 3, 1) : ctx.createGain();
    out.connect(this.ambience);
    const t0 = ctx.currentTime + 0.005;
    const hard = Math.min(1, speed / 15);
    switch (kind) {
      case 'hit':
        // A crisp tock, and the swish of the club on through.
        this.blip(out, t0, 1900, 0.55, 0.06, 0.3, 'triangle');
        this.play(pick(this.buf.steps), { gain: 0.45, rate: 2.6, dest: out });
        {
          const swish = this.noise(this.buf.white);
          const g = ctx.createGain();
          envelope(g.gain, t0, [
            [0.03, 0.06],
            [0.16, 0],
          ]);
          swish.connect(biquad(ctx, 'bandpass', 2400, 1.2)).connect(g).connect(out);
          swish.start(t0);
          swish.stop(t0 + 0.2);
        }
        break;
      case 'bounce':
        this.play(pick(this.buf.steps), { gain: 0.08 + hard * 0.3, rate: rand(1.7, 2), dest: out });
        this.blip(out, t0, rand(620, 700), 0.7, 0.05, 0.03 + hard * 0.06);
        break;
      case 'thud':
        this.play(pick(this.buf.steps), { gain: 0.08 + hard * 0.2, rate: rand(1.1, 1.3), dest: out });
        break;
      case 'rail':
        // A knock on the glass.
        this.clink(out, t0, rand(1250, 1400), 0.05 + hard * 0.08);
        this.play(pick(this.buf.steps), { gain: 0.25, rate: 2.2, dest: out });
        break;
      case 'wall':
        this.play(pick(this.buf.steps), { gain: 0.15 + hard * 0.3, rate: 1.9, dest: out });
        break;
      case 'cup':
        // Plunk, and a rattle round the bottom.
        this.blip(out, t0, 520, 0.6, 0.12, 0.14, 'triangle');
        for (let i = 1; i <= 3; i++) this.blip(out, t0 + 0.08 + i * 0.06, 900 - i * 90, 0.8, 0.04, 0.05 / i);
        break;
      case 'cheer':
        // Ta-da-da-DAAA.
        [523, 659, 784, 1047].forEach((f, i) => {
          const when = t0 + 0.25 + i * 0.13;
          const len = i === 3 ? 0.9 : 0.2;
          this.blip(out, when, f, 1, len, 0.1, 'triangle');
          this.blip(out, when, f * 2, 1, len * 0.7, 0.03);
        });
        break;
    }
  }

  /** Whoosh: the rush of air and the squeal of hands on brass, all the way down a fire pole. */
  slide(seconds = 1.6) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count('slide');
    const t0 = ctx.currentTime + 0.01;
    const end = t0 + seconds;
    const air = this.noise(this.buf.white, true);
    const tone = biquad(ctx, 'bandpass', 500, 0.9);
    tone.frequency.setValueAtTime(400, t0);
    tone.frequency.exponentialRampToValueAtTime(2200, end);
    const ag = ctx.createGain();
    envelope(ag.gain, t0, [
      [0.25, 0.22],
      [seconds * 0.85, 0.3],
      [seconds, 0],
    ]);
    air.connect(tone).connect(ag).connect(this.ambience);
    air.start(t0);
    air.stop(end + 0.05);
    // Palms squeaking on the brass, higher as you speed up.
    const squeal = ctx.createOscillator();
    squeal.type = 'triangle';
    squeal.frequency.setValueAtTime(1100, t0 + 0.1);
    squeal.frequency.exponentialRampToValueAtTime(1900, end);
    const vib = ctx.createOscillator();
    vib.frequency.value = 9;
    const vd = ctx.createGain();
    vd.gain.value = 35;
    vib.connect(vd).connect(squeal.frequency);
    const sg = ctx.createGain();
    envelope(sg.gain, t0, [
      [0.15, 0],
      [0.3, 0.035],
      [seconds * 0.8, 0.045],
      [seconds, 0],
    ]);
    squeal.connect(sg).connect(this.ambience);
    for (const n of [squeal, vib]) {
      n.start(t0);
      n.stop(end + 0.05);
    }
  }

  /** A little "wheee!" whistle, swinging round the pole. */
  twirl() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count('twirl');
    const t0 = ctx.currentTime + 0.01;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(600, t0);
    o.frequency.exponentialRampToValueAtTime(1500, t0 + 0.45);
    o.frequency.exponentialRampToValueAtTime(900, t0 + 1.0);
    const g = ctx.createGain();
    envelope(g.gain, t0, [
      [0.08, 0.09],
      [0.8, 0.07],
      [1.05, 0],
    ]);
    o.connect(g).connect(this.ambience);
    o.start(t0);
    o.stop(t0 + 1.1);
  }

  /**
   * Down the pole and onto the mat: a thump (harder the faster you came), and the firehouse bell,
   * ding-ding-ding. `at` is someone else landing; without it, it's you.
   */
  poleLanding(speed: number, at?: { x: number; y: number; z: number }) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count('poleLanding');
    const out = at ? this.panner(at, 2.5, 0.9) : ctx.createGain();
    out.connect(this.ambience);
    this.play(pick(this.buf.steps), { gain: Math.min(0.9, 0.35 + speed * 0.07), rate: 0.55, dest: out });
    const t0 = ctx.currentTime + 0.08;
    for (let i = 0; i < 3; i++) {
      const when = t0 + i * 0.16;
      // A bell: a bright strike, then partials that ring on.
      for (const [ratio, amp, len] of [
        [1, 0.16, 1.1],
        [2.76, 0.07, 0.6],
        [5.4, 0.035, 0.3],
      ] as const) {
        const o = ctx.createOscillator();
        o.frequency.value = 1320 * ratio;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, when);
        g.gain.exponentialRampToValueAtTime(amp, when + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, when + len);
        o.connect(g).connect(out);
        o.start(when);
        o.stop(when + len + 0.02);
      }
    }
  }

  // ---- The basketball -----------------------------------------------------------------------------

  /**
   * The ball, from where it is, `speed` m/s into what it hit: a hollow bounce off the floor (or a
   * desk, a wall), a clank off the rim, a thud off the backboard, or the swish of the net.
   */
  ball(kind: 'bounce' | 'rim' | 'board' | 'score', at: Pos, speed: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count(`ball-${kind}`);
    const loud = Math.min(1, speed / 7);
    const out = this.panner(at, 2, 1.1);
    out.connect(this.ambience);
    const t0 = ctx.currentTime + 0.005;
    if (kind === 'bounce') {
      // The pong of the air inside, over a slap on the floor.
      this.blip(out, t0, rand(150, 175), 0.7, 0.16, 0.05 + 0.3 * loud);
      this.play(pick(this.buf.steps), { gain: 0.15 + 0.5 * loud, rate: rand(1.25, 1.4), dest: out });
    } else if (kind === 'rim') {
      // Steel ringing, a little out of tune with itself.
      const f = rand(520, 600);
      for (const [ratio, amp, len] of [
        [1, 0.1, 0.5],
        [2.43, 0.06, 0.35],
        [4.1, 0.03, 0.2],
      ] as const) this.blip(out, t0, f * ratio, 0.99, len, amp * (0.3 + loud));
      this.play(pick(this.buf.steps), { gain: 0.2 * loud, rate: 1.9, dest: out });
    } else if (kind === 'board') {
      this.play(pick(this.buf.steps), { gain: 0.25 + 0.5 * loud, rate: 0.8, dest: out });
      this.blip(out, t0, 240, 0.8, 0.12, 0.05 + 0.1 * loud);
    } else {
      // Swish: a breath of noise through the net, brightening as it goes.
      const n = this.noise(this.buf.white);
      const tone = biquad(ctx, 'bandpass', 2400, 1.2);
      tone.frequency.setValueAtTime(1800, t0);
      tone.frequency.linearRampToValueAtTime(4200, t0 + 0.28);
      const g = ctx.createGain();
      envelope(g.gain, t0, [
        [0.03, 0.22],
        [0.18, 0.14],
        [0.34, 0],
      ]);
      n.connect(tone).connect(g).connect(out);
      n.start(t0);
      n.stop(t0 + 0.4);
    }
  }

  // ---- The coffee machine -------------------------------------------------------------------------

  /** Grind, gurgle and drip. */
  coffee() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count('coffee');
    const out = this.panner(COFFEE_MACHINE, 1.2, 1);
    out.connect(this.ambience);
    const t0 = ctx.currentTime + 0.05;

    // Grinder: a buzzing motor with beans crunching in it.
    const motor = ctx.createOscillator();
    motor.type = 'sawtooth';
    motor.frequency.setValueAtTime(70, t0);
    motor.frequency.linearRampToValueAtTime(118, t0 + 0.25);
    motor.frequency.setValueAtTime(118, t0 + 1.2);
    motor.frequency.linearRampToValueAtTime(60, t0 + 1.5);
    const motorTone = biquad(ctx, 'lowpass', 1100, 0.8);
    const crunch = this.noise(this.buf.white);
    const crunchTone = biquad(ctx, 'bandpass', 2600, 1.2);
    const grind = ctx.createGain();
    envelope(grind.gain, t0, [
      [0.08, 0.13],
      [1.25, 0.13],
      [1.5, 0],
    ]);
    const crunchAmp = ctx.createGain();
    crunchAmp.gain.value = 0.5;
    const rattle = this.noise(this.buf.gurgle, true);
    rattle.playbackRate.value = 3;
    rattle.connect(crunchAmp.gain);
    motor.connect(motorTone).connect(grind);
    crunch.connect(crunchTone).connect(crunchAmp).connect(grind);
    grind.connect(out);

    // Brewing: a hissing, gurgling pour with bubbles popping.
    const t1 = t0 + 1.8;
    const pour = this.noise(this.buf.white);
    const pourTone = biquad(ctx, 'bandpass', 850, 0.9);
    const gurgle = ctx.createGain();
    gurgle.gain.value = 0.25;
    const wobble = this.noise(this.buf.gurgle, true);
    wobble.connect(gurgle.gain);
    const brew = ctx.createGain();
    envelope(brew.gain, t1, [
      [0.2, 0.3],
      [2.4, 0.26],
      [3, 0],
    ]);
    pour.connect(pourTone).connect(gurgle).connect(brew).connect(out);
    for (let i = 0; i < 14; i++) this.blip(out, t1 + rand(0.2, 2.6), rand(350, 800), rand(1.6, 2.4), 0.05, 0.1);

    // The last few drips into the cup.
    for (const dt of [3.3, 3.9, 4.7]) this.blip(out, t1 + dt + rand(-0.1, 0.1), rand(1100, 1400), 0.55, 0.05, 0.11);

    const end = t1 + 3.2;
    for (const s of [motor, crunch, rattle]) {
      s.start(t0);
      s.stop(t0 + 1.6);
    }
    for (const s of [pour, wobble]) {
      s.start(t1);
      s.stop(end);
    }
  }

  // ---- The dog ----------------------------------------------------------------------------------

  /** A few gruff woofs from where the dog is. */
  bark(x: number, z: number, times: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count('bark');
    const out = this.panner({ x, y: 0.5, z }, 2, 1);
    out.connect(this.ambience);
    let t = ctx.currentTime + 0.03;
    const pitch = rand(0.95, 1.05);
    for (let i = 0; i < times; i++) {
      this.woof(out, t, 300 * pitch * rand(0.95, 1.05), 0.17, 0.55);
      t += rand(0.3, 0.42);
    }
  }

  /** A short, high, happy yip: someone petted the dog. */
  yip(x: number, z: number) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count('yip');
    const out = this.panner({ x, y: 0.5, z }, 1.5, 1);
    out.connect(this.ambience);
    this.woof(out, ctx.currentTime + 0.02, 620, 0.09, 0.3);
  }

  /** One bark: a buzzy voice that leaps up in pitch and falls away, shaped into a "wuh", with a breathy rasp. */
  private woof(out: AudioNode, t: number, f: number, len: number, gain: number) {
    const ctx = this.ctx!;
    const voice = ctx.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.setValueAtTime(f * 0.75, t);
    voice.frequency.exponentialRampToValueAtTime(f * 1.45, t + len * 0.22);
    voice.frequency.exponentialRampToValueAtTime(f * 0.6, t + len);
    const mouth = biquad(ctx, 'bandpass', 950, 1.1);
    mouth.frequency.setValueAtTime(700, t);
    mouth.frequency.linearRampToValueAtTime(1300, t + len * 0.3);
    mouth.frequency.linearRampToValueAtTime(600, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(gain * 0.45, t + len * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    voice.connect(mouth).connect(g).connect(out);
    const breath = this.noise(this.buf.white);
    const rasp = ctx.createGain();
    rasp.gain.value = 0.35;
    breath.connect(biquad(ctx, 'bandpass', 1800, 0.8)).connect(rasp).connect(g);
    voice.start(t);
    voice.stop(t + len + 0.02);
    breath.start(t, rand(0, 4));
    breath.stop(t + len + 0.02);
  }

  /** A short pitched blip: a bubble when `ratio` > 1, a drip when < 1. */
  private blip(dest: AudioNode, when: number, freq: number, ratio: number, len: number, gain: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, when);
    o.frequency.exponentialRampToValueAtTime(freq * ratio, when + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(gain, when + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, when + len);
    o.connect(g).connect(dest);
    o.start(when);
    o.stop(when + len + 0.02);
  }

  // ---- Around the room --------------------------------------------------------------------------

  private startRoomTone() {
    const ctx = this.ctx!;
    // A low rumble of building and traffic...
    const rumble = this.noise(this.buf.brown, true);
    const rumbleG = ctx.createGain();
    rumbleG.gain.value = 0.07;
    rumble.connect(biquad(ctx, 'lowpass', 300, 0.7)).connect(rumbleG).connect(this.indoors);
    // ...and the air vents, swelling slowly.
    const air = this.noise(this.buf.white, true);
    const airG = ctx.createGain();
    airG.gain.value = 0.009;
    const swell = ctx.createOscillator();
    swell.frequency.value = 0.06;
    const swellDepth = ctx.createGain();
    swellDepth.gain.value = 0.004;
    swell.connect(swellDepth).connect(airG.gain);
    air.connect(biquad(ctx, 'bandpass', 650, 0.5)).connect(airG).connect(this.indoors);
    rumble.start();
    air.start();
    swell.start();
  }

  private startFridge() {
    const ctx = this.ctx!;
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 50;
    const whine = ctx.createOscillator();
    whine.frequency.value = 120;
    const whineG = ctx.createGain();
    whineG.gain.value = 0.3;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const tone = biquad(ctx, 'lowpass', 220, 0.7);
    hum.connect(tone);
    whine.connect(whineG).connect(tone);
    const out = this.panner(FRIDGE, 1, 1.6);
    tone.connect(gain).connect(out).connect(this.indoors);
    hum.start();
    whine.start();
    this.fridge = { gain, on: false, next: ctx.currentTime + rand(3, 12) };
  }

  /** The compressor kicks on for a while, then clunks off. */
  private tickFridge(now: number) {
    const f = this.fridge;
    if (!f || now < f.next) return;
    f.on = !f.on;
    f.gain.gain.setTargetAtTime(f.on ? 0.06 : 0, now, f.on ? 0.6 : 0.3);
    f.next = now + (f.on ? rand(25, 50) : rand(20, 45));
    this.play(pick(this.buf.steps), { at: FRIDGE, gain: 0.25, rate: 0.6, ref: 1, rolloff: 1.6, dest: this.indoors });
    this.count(f.on ? 'fridgeOn' : 'fridgeOff');
  }

  /** A few chirps from outside one of the windows. */
  private birds(now: number) {
    const ctx = this.ctx!;
    this.count('birds');
    const out = this.panner(pick(WINDOWS), 2, 1.2);
    // Heard through the glass.
    out.connect(biquad(ctx, 'lowpass', 5000, 0.7)).connect(this.ambience);
    const base = rand(2400, 4200);
    const shape = Math.random();
    let t = now + 0.05;
    for (let i = randInt(2, 6); i > 0; i--) {
      const len = rand(0.06, 0.14);
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(base * rand(0.9, 1.05), t);
      if (shape < 0.5) {
        o.frequency.exponentialRampToValueAtTime(base * rand(1.25, 1.6), t + len * 0.6);
        o.frequency.exponentialRampToValueAtTime(base * rand(0.8, 1), t + len);
      } else o.frequency.exponentialRampToValueAtTime(base * rand(0.6, 0.75), t + len);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + len + 0.02);
      t += len + rand(0.04, 0.2);
    }
  }

  /** A cricket just outside a window, chirping away for a few seconds. */
  private crickets(now: number) {
    const ctx = this.ctx!;
    this.count('crickets');
    const out = this.panner(pick(WINDOWS), 2, 1.2);
    out.connect(biquad(ctx, 'lowpass', 6000, 0.7)).connect(this.ambience);
    const freq = rand(4200, 5200);
    let t = now + 0.05;
    for (let c = randInt(4, 9); c > 0; c--) {
      for (let p = 0; p < 3; p++) {
        const o = ctx.createOscillator();
        o.frequency.value = freq;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.022, t + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.022);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.03);
        t += 0.035;
      }
      t += rand(0.35, 0.6);
    }
  }

  /** Where your ears are: in the office, where rain is muffled by the glass, in the garage, or out in it. */
  private where(): 'office' | 'garage' | 'out' {
    const { x, y, z } = this.listener;
    const under = (m: number) => x > FLOOR.minX - m && x < FLOOR.maxX + m && z > FLOOR.minZ - m && z < FLOOR.maxZ + m;
    if (under(0) && y > -0.5) return 'office';
    return under(0.3) ? 'garage' : 'out';
  }

  /** Rain: a hiss that's muffled indoors, and drops pattering on the windows or all around you. */
  private tickRain(now: number) {
    const rain = this.weather.rain;
    if (rain < 0.01 && !this.rainNodes) return;
    const ctx = this.ctx!;
    const where = this.where();
    if (!this.rainNodes) {
      const src = this.noise(this.buf.white, true);
      const tone = biquad(ctx, 'lowpass', 1300, 0.5);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      src.connect(biquad(ctx, 'highpass', 450, 0.5)).connect(tone).connect(gain).connect(this.ambience);
      src.start();
      this.rainNodes = { gain, tone };
    }
    if (now >= this.nextRain) {
      // A few updates a second; its level eases anyway.
      this.nextRain = now + 0.25;
      const level = rain < 0.01 ? 0 : (where === 'out' ? 0.16 : where === 'garage' ? 0.11 : 0.06) * rain ** 0.8;
      this.rainNodes.gain.gain.setTargetAtTime(level, now, 0.6);
      this.rainNodes.tone.frequency.setTargetAtTime(where === 'out' ? 6500 : where === 'garage' ? 2600 : 1300, now, 0.3);
    }
    if (rain > 0.05 && now >= this.nextDrip) {
      this.nextDrip = now + rand(0.03, 0.2) / rain;
      const l = this.listener;
      const at = where === 'office' ? pick(WINDOWS) : { x: l.x + rand(-4, 4), y: l.y - 1.2, z: l.z + rand(-4, 4) };
      this.play(this.buf.drop, { at, gain: rand(0.05, 0.14), rate: rand(0.7, 1.4), ref: 1.5, rolloff: 1.3 });
      this.count('drip');
    }
  }

  /** Thunder, `delay` seconds after the flash: a crack when it's close, then a long low rumble. */
  thunder(delay: number, loud: number) {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    this.count('thunder');
    const t0 = ctx.currentTime + delay;
    const peak = 0.45 * loud * (this.where() === 'office' ? 0.6 : 1);
    const src = this.noise(this.buf.brown, true);
    const tone = biquad(ctx, 'lowpass', 700, 0.7);
    tone.frequency.setValueAtTime(700, t0);
    tone.frequency.exponentialRampToValueAtTime(110, t0 + 3.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.08 + (1 - loud) * 0.5);
    g.gain.exponentialRampToValueAtTime(peak * 0.35, t0 + 1.3);
    g.gain.exponentialRampToValueAtTime(peak * 0.6, t0 + 1.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 4 + loud * 2.5);
    src.connect(tone).connect(g).connect(this.ambience);
    src.start(t0, rand(0, 5));
    src.stop(t0 + 7);
    if (delay < 1) {
      const crack = this.noise(this.buf.white);
      const cg = ctx.createGain();
      envelope(cg.gain, t0, [
        [0.01, peak * 0.5],
        [0.25, 0],
      ]);
      crack.connect(biquad(ctx, 'bandpass', 1800, 0.6)).connect(cg).connect(this.ambience);
      crack.start(t0);
      crack.stop(t0 + 0.3);
    }
  }

  /** A desk phone rings a couple of times somewhere across the room, then someone picks up. */
  private phone(now: number) {
    const ctx = this.ctx!;
    const l = this.listener;
    const far = DESKS.filter((d) => Math.hypot(d.x - l.x, d.z - l.z) > 7);
    const desk = pick(far.length ? far : DESKS);
    this.count('phone');
    const out = this.panner({ x: desk.x, y: 0.9, z: desk.z }, 1.5, 1.2);
    out.connect(biquad(ctx, 'lowpass', 3000, 0.7)).connect(this.ambience);
    const rings = randInt(2, 3);
    for (let r = 0; r < rings; r++) {
      const t = now + 0.05 + r * 2.4;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      // A warbling trill, flipping between two notes.
      for (let k = 0; k < 18; k++) o.frequency.setValueAtTime(k % 2 ? 1450 : 1150, t + k / 18);
      const g = ctx.createGain();
      envelope(g.gain, t, [
        [0.02, 0.045],
        [0.95, 0.045],
        [1, 0],
      ]);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.05);
    }
  }

  /** Someone at a worker's desk shuffles papers or leans back in a creaky chair. */
  private fidget(now: number) {
    const desks = [...this.typists.values()];
    if (!desks.length) return;
    const d = pick(desks);
    if (Math.random() < 0.6) {
      this.play(this.buf.rustle, { at: { x: d.x, y: 0.8, z: d.z }, gain: 0.35, rate: rand(0.85, 1.15), ref: 1.2, rolloff: 1.3 });
      this.count('rustle');
      return;
    }
    const ctx = this.ctx!;
    const out = this.panner({ x: d.x, y: 0.5, z: d.z }, 1.2, 1.3);
    out.connect(this.ambience);
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
    this.count('creak');
  }

  // ---- The gong ----------------------------------------------------------------------------------

  /**
   * The gong by the PR board rings: someone hit it, a pull request merged (a harder stroke), or the
   * task queue emptied (three strokes, each bigger than the last). From where it hangs, so you hear
   * which way it is.
   */
  gong(why: GongWhy) {
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    this.count(`gong.${why}`);
    // Someone banging it is the room; a merge is news for the whole floor (and from another tab too,
    // like the dings), so it carries further.
    const out = why === 'hit' ? this.panner(GONG_AT, 4, 0.6) : this.panner(GONG_AT, 8, 0.45);
    out.connect(why === 'hit' ? this.ambience : this.alerts);
    const t0 = ctx.currentTime + 0.03;
    if (why === 'queue') [0.7, 0.85, 1.1].forEach((strength, i) => this.strike(out, t0 + i * 0.85, strength));
    else this.strike(out, t0, why === 'merged' ? 1 : rand(0.6, 0.8));
  }

  /** One stroke of the mallet: a felt thump, the metal ringing, and a bright wash that blooms after. */
  private strike(out: AudioNode, t0: number, strength: number) {
    const ctx = this.ctx!;
    const f0 = 118 * rand(0.98, 1.02);
    const ring = ctx.createGain();
    ring.gain.value = 0.3 * strength;
    ring.connect(out);
    const long = 0.6 + 0.4 * strength;
    for (const [ratio, amp, decay] of GONG_PARTIALS) {
      const f = f0 * ratio;
      const end = t0 + decay * long;
      // Two of each a few cents apart, so the tone shimmers as it rings.
      for (const cents of [-1, 1]) {
        const o = ctx.createOscillator();
        // Struck hard, a gong starts a touch sharp and settles.
        o.frequency.setValueAtTime(f * (1 + 0.012 * strength), t0);
        o.frequency.exponentialRampToValueAtTime(f, t0 + 1.2);
        o.detune.value = cents * rand(2, 5);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(amp * 0.5, t0 + 0.01 + ratio * 0.004);
        g.gain.exponentialRampToValueAtTime(0.0001, end);
        o.connect(g).connect(ring);
        o.start(t0);
        o.stop(end + 0.05);
      }
    }
    const thump = this.noise(this.buf.white);
    const thumpG = ctx.createGain();
    thumpG.gain.setValueAtTime(0.0001, t0);
    thumpG.gain.exponentialRampToValueAtTime(0.45 * strength, t0 + 0.005);
    thumpG.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
    thump.connect(biquad(ctx, 'lowpass', 420, 0.8)).connect(thumpG).connect(out);
    thump.start(t0);
    thump.stop(t0 + 0.15);
    const wash = this.noise(this.buf.white, true);
    const washG = ctx.createGain();
    washG.gain.setValueAtTime(0, t0);
    washG.gain.linearRampToValueAtTime(0.03 * strength, t0 + 0.45);
    washG.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.5 * long);
    wash.connect(biquad(ctx, 'bandpass', 3200, 1.2)).connect(washG).connect(out);
    wash.start(t0);
    wash.stop(t0 + 3.5 * long + 0.05);
  }

  // ---- The arcade -------------------------------------------------------------------------------

  /** The arcade cabinet's chip bleeps: a piece landing, lines clearing (a longer run up for more at once), the game ending. */
  arcade(kind: 'land' | 'clear' | 'over', lines = 1) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count(`arcade.${kind}`);
    const out = this.panner(CABINET_AT, 1.5, 1.2);
    out.connect(this.ambience);
    const t0 = ctx.currentTime + 0.02;
    if (kind === 'land') this.blip(out, t0, 160, 0.55, 0.07, 0.1, 'square');
    else if (kind === 'clear') [523, 659, 784, 1047, 1319].slice(0, lines + 1).forEach((f, i) => this.blip(out, t0 + i * 0.07, f, 1.02, 0.1, 0.09, 'square'));
    else [392, 330, 262, 196].forEach((f, i) => this.blip(out, t0 + i * 0.18, f, 0.97, 0.17, 0.14, 'triangle'));
  }

  // ---- Alerts ----------------------------------------------------------------------------------

  /** Two notes up when a worker is done, a three-note nudge when it needs input. */
  ding(kind: 'done' | 'needs_input') {
    this.unlock();
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'suspended') void ctx.resume();
    this.count(kind);
    const notes = kind === 'done' ? [660, 880] : [880, 660, 880];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      const t0 = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
      o.connect(g).connect(this.alerts);
      o.start(t0);
      o.stop(t0 + 0.3);
    });
  }

  // ---- The roof ---------------------------------------------------------------------------------

  /** Up on the roof (true), or inside on a floor: the office's hum gives way to the wind and the city. */
  setOutdoors(on: boolean) {
    this.outdoors = on;
    this.applyOutdoors();
  }

  private applyOutdoors() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.indoors.gain.setTargetAtTime(this.outdoors ? 0 : 1, now, 0.3);
    this.outside.gain.setTargetAtTime(this.outdoors ? 1 : 0, now, 0.3);
  }

  private startWind() {
    const ctx = this.ctx!;
    // Traffic, far below…
    const city = this.noise(this.buf.brown, true);
    const cityG = ctx.createGain();
    cityG.gain.value = 0.08;
    city.connect(biquad(ctx, 'lowpass', 420, 0.6)).connect(cityG).connect(this.outside);
    // …and the wind, gusting and dropping, whistling higher as it picks up.
    const wind = this.noise(this.buf.white, true);
    const tone = biquad(ctx, 'bandpass', 520, 0.8);
    const windG = ctx.createGain();
    windG.gain.value = 0.012;
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.08;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.009;
    gust.connect(gustDepth).connect(windG.gain);
    const pitch = ctx.createGain();
    pitch.gain.value = 220;
    gust.connect(pitch).connect(tone.frequency);
    wind.connect(tone).connect(windG).connect(this.outside);
    city.start();
    wind.start();
    gust.start();
  }

  /** The DJ's set on the roof, `clock` saying how far into it it is (see djTime); null stops it. */
  setDj(clock: (() => number) | null) {
    const was = !!this.djClock;
    this.djClock = clock;
    if (was !== !!clock) this.applyDj();
  }

  private applyDj() {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.djClock) {
      this.dj?.stop();
      this.dj = null;
      clearInterval(this.djTimer);
      return;
    }
    if (this.dj) return;
    const dj = (this.dj = new DjPlayer(ctx, this.djIn));
    this.count('dj');
    // On a timer rather than every frame, so it carries on in a background tab.
    const tick = () => {
      if (this.djClock) dj.tick(this.djClock());
    };
    tick();
    this.djTimer = window.setInterval(tick, 150);
  }

  /** Someone at the DJ booth blew the air horn. */
  horn() {
    if (!this.dj) return;
    this.dj.horn();
    this.count('horn');
  }

  /** A drink poured at the bar: ice into the glass, a splash, and a clink. */
  pour(at: Pos) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count('pour');
    const out = this.panner(at, 1.2, 1);
    out.connect(this.ambience);
    const t0 = ctx.currentTime + 0.05;
    // Ice cubes knocking in.
    for (let i = 0; i < 3; i++) this.clink(out, t0 + i * rand(0.07, 0.12), rand(2200, 3200), 0.05);
    // The pour: filtered noise that rises in pitch as the glass fills.
    const pour = this.noise(this.buf.white);
    const tone = biquad(ctx, 'bandpass', 700, 1.4);
    tone.frequency.setValueAtTime(700, t0 + 0.35);
    tone.frequency.linearRampToValueAtTime(1500, t0 + 1.15);
    const g = ctx.createGain();
    envelope(g.gain, t0 + 0.35, [
      [0.06, 0.09],
      [0.7, 0.08],
      [0.85, 0],
    ]);
    const wobble = this.noise(this.buf.gurgle, true);
    wobble.playbackRate.value = 4;
    const amp = ctx.createGain();
    amp.gain.value = 0.6;
    wobble.connect(amp.gain);
    pour.connect(tone).connect(amp).connect(g).connect(out);
    pour.start(t0 + 0.35);
    pour.stop(t0 + 1.3);
    wobble.start(t0 + 0.35);
    wobble.stop(t0 + 1.3);
    // Slid across the bar to you.
    this.clink(out, t0 + 1.45, 3900, 0.08);
  }

  /** A glass rings: a couple of high partials, gone in a moment. */
  private clink(out: AudioNode, when: number, f: number, level: number) {
    const ctx = this.ctx!;
    for (const [mul, lvl] of [
      [1, 1],
      [2.76, 0.4],
    ]) {
      const o = ctx.createOscillator();
      o.frequency.value = f * mul;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, when);
      g.gain.exponentialRampToValueAtTime(level * lvl, when + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.25);
      o.connect(g).connect(out);
      o.start(when);
      o.stop(when + 0.3);
    }
  }

  /** Hic! One too many. */
  hiccup() {
    const ctx = this.ctx;
    if (!ctx) return;
    this.count('hiccup');
    const t0 = ctx.currentTime + 0.02;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(260, t0);
    o.frequency.exponentialRampToValueAtTime(420, t0 + 0.06);
    const g = ctx.createGain();
    envelope(g.gain, t0, [
      [0.008, 0.12],
      [0.05, 0.08],
      [0.11, 0],
    ]);
    o.connect(biquad(ctx, 'bandpass', 1100, 2.5)).connect(g).connect(this.ambience);
    o.start(t0);
    o.stop(t0 + 0.14);
    // The catch in the throat, just before it.
    const n = this.noise(this.buf.white);
    const ng = ctx.createGain();
    envelope(ng.gain, t0 - 0.015, [
      [0.004, 0.08],
      [0.02, 0],
    ]);
    n.connect(biquad(ctx, 'bandpass', 1800, 1)).connect(ng).connect(this.ambience);
    n.start(t0 - 0.015);
    n.stop(t0 + 0.02);
  }

  // ---- The jukebox ------------------------------------------------------------------------------

  /** What the jukebox on your floor plays, or null for nothing. It starts once the browser allows audio. */
  setJukebox(play: JukeboxPlay | null) {
    const was = this.jukebox;
    this.jukebox = play;
    // The same play, sent again after a reconnect or timed better once the clocks are compared: carry on
    // (a tune lines itself up again as it goes; an audio file jumps to the right spot).
    if (was && play && was.startedAt === play.startedAt && was.track === play.track && was.url === play.url) {
      if (this.stream && Math.abs(was.since - play.since) > 250) this.seekStream(this.stream);
      return;
    }
    this.applyJukebox(true);
  }

  /** Your own jukebox volume, 0–1, apart from the office sounds'. */
  setMusicVolume(volume: number, muted: boolean) {
    this.musicVolume = Math.max(0, Math.min(1, volume));
    this.musicMuted = muted;
    this.applyMusicVolume();
  }

  /** 1 on each beat of the tune, falling to 0 before the next, for the jukebox's lights. */
  beat(): number {
    if (this.tune) return this.tune.beat(this.musicAt());
    if (this.stream && !this.stream.paused) return 0.35 + 0.25 * Math.sin(performance.now() / 320);
    return 0;
  }

  /** How far into the jukebox's track it is now, in seconds. */
  private musicAt(): number {
    return this.jukebox ? Math.max(0, (performance.now() - this.jukebox.since) / 1000) : 0;
  }

  private applyMusicVolume() {
    if (!this.ctx) return;
    this.musicBus.gain.setTargetAtTime(this.musicGain(), this.ctx.currentTime, 0.04);
    this.hearStream();
  }

  private musicGain(): number {
    return this.musicMuted ? 0 : this.musicVolume * this.musicVolume;
  }

  /** Starts what the jukebox plays now, once there's audio; `changed` puts it on again from the top. */
  private applyJukebox(changed = false) {
    const ctx = this.ctx;
    if (!ctx || (!changed && (this.tune || this.stream))) return;
    this.tune?.stop();
    this.tune = null;
    if (this.stream) {
      this.stream.pause();
      this.stream.removeAttribute('src');
      this.stream.load();
      this.stream = null;
    }
    clearInterval(this.musicTimer);
    const j = this.jukebox;
    if (!j) return;
    if (j.track === STREAM && j.url) return this.startStream(j.url);
    const tune = (this.tune = new TunePlayer(ctx, this.musicIn, j.track));
    this.count('tune');
    // On a timer rather than every frame, so it carries on in a background tab.
    const tick = () => tune.tick(this.musicAt());
    tick();
    this.musicTimer = window.setInterval(tick, 150);
  }

  private startStream(url: string) {
    const a = new Audio();
    a.preload = 'auto';
    a.loop = true;
    a.src = url;
    a.addEventListener('loadedmetadata', () => this.seekStream(a));
    a.addEventListener('error', () => {
      if (this.stream === a) this.onMusicError?.("📻 The jukebox can't play that stream in your browser");
    });
    this.stream = a;
    this.hearStream();
    void a.play().catch(() => {});
    this.count('stream');
  }

  /** An audio file (not live radio) picks up where everyone else is. */
  private seekStream(a: HTMLAudioElement) {
    if (Number.isFinite(a.duration) && a.duration > 0) a.currentTime = this.musicAt() % a.duration;
  }

  /** Muffles the jukebox the further you are from it. */
  private hearJukebox(now: number) {
    const d = this.jukeboxDistance();
    const cutoff = d < 5 ? 16000 : Math.max(1600, 16000 * (5 / d) ** 1.5);
    if (Math.abs(cutoff - this.musicCutoff) > this.musicCutoff * 0.02) {
      this.musicCutoff = cutoff;
      this.musicTone.frequency.setTargetAtTime(cutoff, now, 0.1);
    }
    this.hearStream();
  }

  /** A stream plays outside Web Audio (most don't allow that), so it gets quieter with distance by hand. */
  private hearStream() {
    if (!this.stream) return;
    const d = Math.max(MUSIC_REF, this.jukeboxDistance());
    this.stream.volume = Math.min(1, this.musicGain() * (MUSIC_REF / (MUSIC_REF + MUSIC_ROLLOFF * (d - MUSIC_REF))));
  }

  private jukeboxDistance(): number {
    const l = this.listener;
    return Math.hypot(l.x - JUKEBOX.x, l.y - JUKEBOX.y, l.z - JUKEBOX.z);
  }

  // ---- Plumbing --------------------------------------------------------------------------------

  private panner(p: Pos, ref = 1.5, rolloff = 1.2): PannerNode {
    const pn = this.ctx!.createPanner();
    pn.panningModel = 'equalpower';
    pn.distanceModel = 'inverse';
    pn.refDistance = ref;
    pn.rolloffFactor = rolloff;
    place(pn, p.x, p.y, p.z);
    return pn;
  }

  private noise(buffer: AudioBuffer, loop = false): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    return s;
  }

  private play(buffer: AudioBuffer, o: { at?: Pos; when?: number; gain?: number; rate?: number; dest?: AudioNode; ref?: number; rolloff?: number }) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = o.rate ?? 1;
    const g = ctx.createGain();
    g.gain.value = o.gain ?? 1;
    src.connect(g);
    let out: AudioNode = g;
    if (o.at) out = g.connect(this.panner(o.at, o.ref, o.rolloff));
    out.connect(o.dest ?? this.ambience);
    src.start(o.when ?? ctx.currentTime);
  }
}

function rms(a: AnalyserNode): number {
  const d = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(d);
  let s = 0;
  for (const v of d) s += v * v;
  return Math.sqrt(s / d.length);
}

function place(pn: PannerNode, x: number, y: number, z: number) {
  if (pn.positionX) {
    pn.positionX.value = x;
    pn.positionY.value = y;
    pn.positionZ.value = z;
  } else pn.setPosition(x, y, z);
}

function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Ramps `param` from 0 through [seconds after t0, value] points. */
function envelope(param: AudioParam, t0: number, points: [number, number][]) {
  param.setValueAtTime(0, t0);
  for (const [dt, v] of points) param.linearRampToValueAtTime(v, t0 + dt);
}

// ---- Sound samples, made once when audio starts -----------------------------------------------------

interface Buffers {
  keys: AudioBuffer[];
  spaces: AudioBuffer[];
  mouse: AudioBuffer;
  steps: AudioBuffer[];
  rustle: AudioBuffer;
  /** A raindrop hitting the glass. */
  drop: AudioBuffer;
  brown: AudioBuffer;
  white: AudioBuffer;
  /** A slow, lumpy 0–1 signal for wobbling other sounds' volume. */
  gurgle: AudioBuffer;
}

function makeBuffers(ctx: BaseAudioContext): Buffers {
  return {
    keys: [0, 1, 2, 3, 4, 5].map(() => keyClick(ctx, { body: rand(190, 300), bright: rand(0.7, 1), release: rand(0.06, 0.09), decay: 95, len: 0.12 })),
    spaces: [0, 1].map(() => keyClick(ctx, { body: rand(105, 130), bright: 0.55, release: rand(0.09, 0.12), decay: 55, len: 0.2 })),
    mouse: keyClick(ctx, { body: 900, bright: 1, release: 0.07, decay: 400, len: 0.1 }),
    steps: [0, 1, 2].map(() => footstep(ctx)),
    rustle: rustle(ctx),
    drop: sample(ctx, 0.06, (t) => (Math.sin(2 * Math.PI * 2400 * t * (1 - t * 5)) * 0.6 + (Math.random() * 2 - 1) * 0.4) * Math.exp(-t * 110), 0.9),
    brown: loopable(ctx, 6, brownNoise()),
    white: sample(ctx, 5, () => Math.random() * 2 - 1),
    gurgle: loopable(ctx, 4, lumpy(ctx.sampleRate, 0.03, 0.11)),
  };
}

function sample(ctx: BaseAudioContext, seconds: number, next: (t: number) => number, peak?: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const b = ctx.createBuffer(1, Math.ceil(sr * seconds), sr);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = next(i / sr);
  if (peak) {
    let max = 0;
    for (const v of d) max = Math.max(max, Math.abs(v));
    if (max > 0) for (let i = 0; i < d.length; i++) d[i] *= peak / max;
  }
  return b;
}

/** A buffer whose end runs smoothly into its start, so it loops without a click. */
function loopable(ctx: BaseAudioContext, seconds: number, next: () => number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.ceil(sr * seconds);
  const fade = Math.floor(sr * 0.25);
  const raw = new Float32Array(n + fade);
  for (let i = 0; i < raw.length; i++) raw[i] = next();
  const b = ctx.createBuffer(1, n, sr);
  const d = b.getChannelData(0);
  d.set(raw.subarray(0, n));
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    d[i] = raw[i] * Math.sqrt(k) + raw[n + i] * Math.sqrt(1 - k);
  }
  return b;
}

function brownNoise(): () => number {
  let last = 0;
  return () => {
    last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    return last * 3.5;
  };
}

/** Wanders between random levels, holding each for `min`–`max` seconds. */
function lumpy(sr: number, min: number, max: number): () => number {
  let level = 0;
  let target = 0;
  let hold = 0;
  return () => {
    if (--hold <= 0) {
      target = Math.random() ** 2;
      hold = Math.floor(rand(min, max) * sr);
    }
    level += (target - level) * (100 / sr);
    return level;
  };
}

/** A key bottoming out, a bright tick over a short woody thock, then a softer tick as it springs back. */
function keyClick(ctx: BaseAudioContext, o: { body: number; bright: number; release: number; decay: number; len: number }): AudioBuffer {
  let prev = 0;
  let hiss = 0;
  let low = 0;
  return sample(
    ctx,
    o.len,
    (t) => {
      const w = Math.random() * 2 - 1;
      hiss += (w - prev - hiss) * 0.5; // high-passed, then the harshest top taken off
      prev = w;
      low += (w - low) * 0.15;
      let v = hiss * Math.exp(-t * 700) * o.bright + (Math.sin(2 * Math.PI * o.body * t) * 0.5 + low) * Math.exp(-t * o.decay);
      const r = t - o.release;
      if (r > 0) v += hiss * Math.exp(-r * 900) * o.bright * 0.45;
      return v;
    },
    0.9,
  );
}

/** A soft shoe on carpet: a muffled thud and a little scuff. */
function footstep(ctx: BaseAudioContext): AudioBuffer {
  let low = 0;
  let prev = 0;
  const scuffAt = rand(0.025, 0.045);
  return sample(
    ctx,
    0.25,
    (t) => {
      const w = Math.random() * 2 - 1;
      low += (w - low) * 0.03;
      const attack = Math.min(1, t / 0.004);
      let v = (low * 3 + Math.sin(2 * Math.PI * 62 * t) * 0.5) * attack * Math.exp(-t * 30);
      const s = t - scuffAt;
      if (s > 0) v += (w - prev) * 0.06 * Math.exp(-s * 50);
      prev = w;
      return v;
    },
    0.9,
  );
}

/** Paper being shuffled: crackly mid-range noise in uneven bursts. */
function rustle(ctx: BaseAudioContext): AudioBuffer {
  const len = 0.8;
  let a = 0;
  let b = 0;
  let amp = 0;
  let target = 0;
  let hold = 0;
  const sr = ctx.sampleRate;
  return sample(
    ctx,
    len,
    (t) => {
      const w = Math.random() * 2 - 1;
      a += (w - a) * 0.5;
      b += (w - b) * 0.05;
      if (--hold <= 0) {
        target = Math.random() ** 3;
        hold = Math.floor(rand(0.008, 0.03) * sr);
      }
      amp += (target - amp) * 0.02;
      return (a - b) * amp * Math.sin((Math.PI * t) / len);
    },
    0.8,
  );
}
