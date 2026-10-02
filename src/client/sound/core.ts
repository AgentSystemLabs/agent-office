import { FLOOR, inWing } from '../../shared/layout';
import { makeBuffers, type Buffers } from './buffers';
import { place, rms } from './dsp';
import { WINDOWS, type Pos } from './places';

/** Where you hear from: your head, facing where the camera looks. */
export interface Listener extends Pos {
  fx: number;
  fz: number;
}

/**
 * On a map of its own (the castle): the room it is, where its gong hangs and where its windows are,
 * with nothing of the office's in it (no fridge). `vacuum`: there's nothing outside it to hear at
 * all (the space station): no rain, no thunder, no birds.
 */
export interface Hall {
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  gong: Pos | null;
  windows: Pos[];
  vacuum?: boolean;
}

/** What AudioCore asks of the rest of the sound: see unlock. */
export interface AudioHooks {
  /** Audio just started: the rest of the graph goes up, and whatever plays all the time starts. */
  start(ctx: AudioContext): void;
  /** Audio was already going and the page was touched (or a ding came) again. */
  touched(): void;
}

/**
 * The audio every sound shares: the context (started on the first click or key, as browsers want),
 * the buses a sound goes out on, your volume, the tab hiding, where your ears are and what's round
 * them, the samples, and what runs every frame. The recipes (weather.ts, features/golf/sound.ts and the rest) are
 * functions of one of these; OfficeSound (index.ts) puts them together.
 */
export class AudioCore {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  /** The room itself; it goes quiet while the tab is hidden. */
  ambience!: GainNode;
  /** Worker dings, which you still want to hear from another tab. */
  alerts!: GainNode;
  /** The office's own hum (the room and the fridge), left behind going up on the roof… */
  indoors!: GainNode;
  /** …where there's wind, and the city far below. */
  outside!: GainNode;
  outdoors = false;
  /** On a map of its own (the castle), the room it is (see Hall). Null in the office. */
  hall: Hall | null = null;
  /** How many rows the floor's back office is built out: in there you're indoors too. */
  wing = 0;
  private analyser!: AnalyserNode;
  buf!: Buffers;
  private volume = 0.7;
  private muted = false;
  /** Outside: how hard it's raining (0–1) and how dark it is (1 at night). */
  weather = { rain: 0, night: 0 };
  listener: Listener = { x: 0, y: 1.4, z: 0, fx: 0, fz: -1 };
  /** How many of each sound have played, for quick checks from the console. */
  readonly played: Record<string, number> = {};
  /** What runs every frame (see every). */
  private readonly tickers: ((now: number) => void)[] = [];

  constructor(private readonly hooks: AudioHooks) {
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
    this.weather.rain = this.hall?.vacuum ? 0 : rain;
    this.weather.night = night;
  }

  /** Output level (RMS) right now, for headless checks. */
  level(): number {
    return this.ctx ? rms(this.analyser) : 0;
  }

  get state(): AudioContextState | 'locked' {
    return this.ctx?.state ?? 'locked';
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      // A ding can start audio before you've touched the page, when a stream isn't allowed to play yet.
      this.hooks.touched();
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
    // The rest of the sound graph, and what plays all the time.
    this.hooks.start(ctx);
    void ctx.resume();
  }

  applyVolume() {
    if (!this.ctx) return;
    // Squared, so the slider feels even to the ear.
    const g = this.muted ? 0 : this.volume * this.volume;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.04);
  }

  applyVisibility() {
    if (!this.ctx) return;
    if (!document.hidden && this.ctx.state === 'suspended') void this.ctx.resume();
    this.ambience.gain.setTargetAtTime(document.hidden ? 0 : 1, this.ctx.currentTime, 0.15);
  }

  count(what: string) {
    this.played[what] = (this.played[what] ?? 0) + 1;
  }

  /** Runs `tick` every frame while audio's running, after everything added before it. */
  every(tick: (now: number) => void) {
    this.tickers.push(tick);
  }

  /** Moves your ears and runs everything added with every(), in the order it was added. */
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
    for (const tick of this.tickers) tick(now);
  }

  /** Where your ears are: in the office, where rain is muffled by the glass, in the garage, or out in it. */
  where(): 'office' | 'garage' | 'out' {
    const { x, y, z } = this.listener;
    if (this.hall) {
      const b = this.hall.bounds;
      return x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ ? 'office' : 'out';
    }
    const under = (m: number) => x > FLOOR.minX - m && x < FLOOR.maxX + m && z > FLOOR.minZ - m && z < FLOOR.maxZ + m;
    if ((under(0) || inWing(x, z, this.wing)) && y > -0.5) return 'office';
    return under(0.3) ? 'garage' : 'out';
  }

  /** Where the sounds from outside come in: the hall's windows, or the office's. */
  windows(): Pos[] {
    return this.hall?.windows.length ? this.hall.windows : WINDOWS;
  }

  /** Up on the roof (true), or inside on a floor: the office's hum gives way to the wind and the city. */
  setOutdoors(on: boolean) {
    this.outdoors = on;
    this.applyOutdoors();
  }

  applyOutdoors() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    this.indoors.gain.setTargetAtTime(this.outdoors ? 0 : 1, now, 0.3);
    this.outside.gain.setTargetAtTime(this.outdoors ? 1 : 0, now, 0.3);
  }

  // ---- Plumbing --------------------------------------------------------------------------------

  panner(p: Pos, ref = 1.5, rolloff = 1.2): PannerNode {
    const pn = this.ctx!.createPanner();
    pn.panningModel = 'equalpower';
    pn.distanceModel = 'inverse';
    pn.refDistance = ref;
    pn.rolloffFactor = rolloff;
    place(pn, p.x, p.y, p.z);
    return pn;
  }

  noise(buffer: AudioBuffer, loop = false): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    return s;
  }

  play(buffer: AudioBuffer, o: { at?: Pos; when?: number; gain?: number; rate?: number; dest?: AudioNode; ref?: number; rolloff?: number }) {
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

  /** A short pitched blip: a bubble when `ratio` > 1, a drip when < 1. */
  blip(dest: AudioNode, when: number, freq: number, ratio: number, len: number, gain: number, type: OscillatorType = 'sine') {
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

  /** A glass rings: a couple of high partials, gone in a moment. */
  clink(out: AudioNode, when: number, f: number, level: number) {
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
}

/**
 * Something the room does now and then: `first()` seconds after audio starts, then `gap()` seconds
 * after each time. Its tick goes in AudioCore.every.
 */
export class NowAndThen {
  private next = 0;

  constructor(
    private readonly first: () => number,
    private readonly gap: () => number,
    private readonly play: (now: number) => void,
  ) {}

  start(now: number) {
    this.next = now + this.first();
  }

  tick(now: number) {
    if (now < this.next) return;
    this.play(now);
    this.next = now + this.gap();
  }
}
