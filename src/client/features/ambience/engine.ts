/**
 * The thinking spot's sounds: ocean waves, rain or a forest, made with Web Audio (see water.ts and
 * forest.ts), one at a time with a slow crossfade between them. It goes out through the office's own
 * sound (so Settings' volume and mute still apply) and only while you're up on the roof.
 */
import { forest } from './forest';
import { Rig } from './rig';
import { ocean, rain } from './water';

export type AmbienceKind = 'ocean' | 'rain' | 'forest';

export const KINDS: readonly AmbienceKind[] = ['ocean', 'rain', 'forest'];

/** Where the sound goes: the office's audio context and the bus to join it on. Null until the page has been touched. */
export interface AudioBus {
  ctx: AudioContext;
  out: AudioNode;
}

const SCENES: Record<AmbienceKind, (rig: Rig) => void> = { ocean, rain, forest };
/** Seconds to crossfade between scenes, and to fade out on leaving the roof. */
const CROSSFADE = 2;
const FADE_OUT = 1.5;
const KEY = 'ambience';

interface Layer {
  kind: AmbienceKind;
  rig: Rig;
  fader: GainNode;
}

interface Saved {
  kind: AmbienceKind | null;
  volume: number;
}

function load(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>;
    return { kind: KINDS.find((k) => k === v.kind) ?? null, volume: typeof v.volume === 'number' ? Math.max(0, Math.min(1, v.volume)) : 0.6 };
  } catch {
    return { kind: null, volume: 0.6 };
  }
}

export class Ambience {
  private kind: AmbienceKind | null;
  private vol: number;
  private here = false;
  private top: Layer | null = null;
  private master: GainNode | null = null;

  constructor(private readonly bus: () => AudioBus | null) {
    ({ kind: this.kind, volume: this.vol } = load());
  }

  /** What's chosen (it keeps going off the roof only in the sense that it comes back when you do). */
  current(): AmbienceKind | null {
    return this.kind;
  }

  volume(): number {
    return this.vol;
  }

  /** Switches to `kind` (null: off), crossfading from what's playing. */
  play(kind: AmbienceKind | null) {
    this.kind = kind;
    this.save();
    this.sync();
  }

  /** 0 to 1. */
  setVolume(v: number) {
    this.vol = Math.max(0, Math.min(1, v));
    this.save();
    this.applyVolume();
  }

  /** On the roof or not: leaving fades it out and stops it, coming back starts it again. Cheap enough to call every frame. */
  setHere(here: boolean) {
    this.here = here;
    this.sync();
  }

  /** Fades out whatever's playing and stops it for good. */
  dispose() {
    this.here = false;
    this.sync();
  }

  /** Brings what's playing in line with what's wanted: the chosen scene while you're on the roof, once there's audio to play on. */
  private sync() {
    const want = this.here ? this.kind : null;
    if ((this.top?.kind ?? null) === want) return;
    const bus = want ? this.bus() : null;
    if (want && !bus) return;
    const old = this.top;
    this.top = null;
    if (old) this.release(old, want ? CROSSFADE : FADE_OUT);
    if (want && bus) this.top = this.start(want, bus);
  }

  private start(kind: AmbienceKind, bus: AudioBus): Layer {
    const { ctx } = bus;
    if (!this.master || this.master.context !== ctx) {
      this.master = ctx.createGain();
      this.master.connect(bus.out);
      this.applyVolume();
    }
    const fader = ctx.createGain();
    fader.gain.setValueAtTime(0, ctx.currentTime);
    fader.gain.setTargetAtTime(1, ctx.currentTime, CROSSFADE / 3.3);
    fader.connect(this.master);
    const rig = new Rig(ctx, fader);
    SCENES[kind](rig);
    return { kind, rig, fader };
  }

  /** Fades a scene out over `secs`, then takes it apart. */
  private release(layer: Layer, secs: number) {
    const ctx = layer.rig.ctx;
    layer.fader.gain.setTargetAtTime(0, ctx.currentTime, secs / 3.3);
    setTimeout(() => {
      layer.rig.stop();
      layer.fader.disconnect();
    }, (secs + 0.6) * 1000);
  }

  private applyVolume() {
    // Squared, as the office's own volume is, so the slider feels even to the ear.
    if (this.master) this.master.gain.setTargetAtTime(this.vol * this.vol, this.master.context.currentTime, 0.05);
  }

  private save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ kind: this.kind, volume: this.vol } satisfies Saved));
    } catch {
      // storage is blocked: the choice just doesn't outlast the page
    }
  }
}
