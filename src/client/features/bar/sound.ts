import { DJ_BOOTH } from '../../../shared/layout';
import { DjPlayer } from '../../dnb';
import type { AudioCore } from '../../sound/core';
import { biquad, envelope, rand } from '../../sound/dsp';
import type { Pos } from '../../sound/places';

// The rooftop bar: the DJ's set, the air horn, drinks poured, and one too many.

/** The DJ on the roof, through the speakers by the booth, at your music volume. */
export class Dj {
  private djIn!: PannerNode;
  private dj: DjPlayer | null = null;
  /** How far into the DJ's set it is (see djTime), while you're up there. */
  private djClock: (() => number) | null = null;
  private djTimer = 0;

  constructor(private readonly a: AudioCore) {}

  /** The speakers by the booth, into the jukebox's bus (see Jukebox.connect). */
  connect(musicBus: GainNode) {
    // Loud enough to hear from anywhere on the roof, and loudest on the dance floor.
    this.djIn = this.a.panner({ x: DJ_BOOTH.x, y: 2.2, z: DJ_BOOTH.z }, 7, 0.8);
    this.djIn.connect(musicBus);
  }

  /** The DJ's set on the roof, `clock` saying how far into it it is (see djTime); null stops it. */
  setDj(clock: (() => number) | null) {
    const was = !!this.djClock;
    this.djClock = clock;
    if (was !== !!clock) this.applyDj();
  }

  applyDj() {
    const ctx = this.a.ctx;
    if (!ctx) return;
    if (!this.djClock) {
      this.dj?.stop();
      this.dj = null;
      clearInterval(this.djTimer);
      return;
    }
    if (this.dj) return;
    const dj = (this.dj = new DjPlayer(ctx, this.djIn));
    this.a.count('dj');
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
    this.a.count('horn');
  }

}

/** A drink poured at the bar: ice into the glass, a splash, and a clink. */
export function pour(a: AudioCore, at: Pos) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('pour');
  const out = a.panner(at, 1.2, 1);
  out.connect(a.ambience);
  const t0 = ctx.currentTime + 0.05;
  // Ice cubes knocking in.
  for (let i = 0; i < 3; i++) a.clink(out, t0 + i * rand(0.07, 0.12), rand(2200, 3200), 0.05);
  // The pour: filtered noise that rises in pitch as the glass fills.
  const pour = a.noise(a.buf.white);
  const tone = biquad(ctx, 'bandpass', 700, 1.4);
  tone.frequency.setValueAtTime(700, t0 + 0.35);
  tone.frequency.linearRampToValueAtTime(1500, t0 + 1.15);
  const g = ctx.createGain();
  envelope(g.gain, t0 + 0.35, [
    [0.06, 0.09],
    [0.7, 0.08],
    [0.85, 0],
  ]);
  const wobble = a.noise(a.buf.gurgle, true);
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
  a.clink(out, t0 + 1.45, 3900, 0.08);
}

/** Hic! One too many. */
export function hiccup(a: AudioCore) {
  const ctx = a.ctx;
  if (!ctx) return;
  a.count('hiccup');
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
  o.connect(biquad(ctx, 'bandpass', 1100, 2.5)).connect(g).connect(a.ambience);
  o.start(t0);
  o.stop(t0 + 0.14);
  // The catch in the throat, just before it.
  const n = a.noise(a.buf.white);
  const ng = ctx.createGain();
  envelope(ng.gain, t0 - 0.015, [
    [0.004, 0.08],
    [0.02, 0],
  ]);
  n.connect(biquad(ctx, 'bandpass', 1800, 1)).connect(ng).connect(a.ambience);
  n.start(t0 - 0.015);
  n.stop(t0 + 0.02);
}
