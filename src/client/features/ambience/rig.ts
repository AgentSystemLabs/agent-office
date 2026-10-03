import { mulberry32 } from '../../../shared/rng';
import { loopNoise, type NoiseKind } from './noise';

/** How far ahead (seconds) a scene schedules what it does next, so a throttled background tab still plays on. */
const LOOKAHEAD = 3;
const LOOP_SECONDS = 8;
const LOOP_FADE = 1;

const cache = new WeakMap<BaseAudioContext, Map<NoiseKind, AudioBuffer>>();

/** A stereo loop of noise (the two channels unrelated, for width), made once per context and shared. */
export function noiseBuffer(ctx: BaseAudioContext, kind: NoiseKind): AudioBuffer {
  let kinds = cache.get(ctx);
  if (!kinds) cache.set(ctx, (kinds = new Map()));
  let buf = kinds.get(kind);
  if (!buf) {
    const sr = ctx.sampleRate;
    buf = ctx.createBuffer(2, Math.floor(sr * LOOP_SECONDS), sr);
    const seed = 7919 * (['white', 'pink', 'brown'].indexOf(kind) + 1);
    for (let c = 0; c < 2; c++) buf.copyToChannel(loopNoise(kind, buf.length, Math.floor(sr * LOOP_FADE), mulberry32(seed + c * 104729)), c);
    kinds.set(kind, buf);
  }
  return buf;
}

/** Connects the nodes one after another, and gives back the last. */
export function chain<T extends AudioNode>(first: AudioNode, ...rest: [...AudioNode[], T]): T {
  let from = first;
  for (const n of rest) {
    from.connect(n);
    from = n;
  }
  return from as T;
}

/**
 * What a scene is built on: a bus that goes out through the scene's fader, the noise loops and oscillators
 * it runs (stopped with it) and the things it does now and then. `stop` takes all of it away.
 */
export class Rig {
  /** Everything the scene makes goes here. */
  readonly bus: GainNode;
  private readonly sources: AudioScheduledSourceNode[] = [];
  private readonly timers: number[] = [];

  constructor(readonly ctx: AudioContext, out: AudioNode) {
    this.bus = ctx.createGain();
    this.bus.connect(out);
  }

  /** A looping noise, started somewhere different in its loop each time so two of one kind aren't the same. */
  loop(kind: NoiseKind): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = noiseBuffer(this.ctx, kind);
    s.loop = true;
    s.start(0, Math.random() * LOOP_SECONDS);
    this.sources.push(s);
    return s;
  }

  osc(type: OscillatorType, freq: number): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.start();
    this.sources.push(o);
    return o;
  }

  /**
   * Calls `play(t)` for each moment `t` (context time) something should happen, `startIn` seconds from now and
   * then as far apart as `play` says it is (the seconds to the next), always scheduling a little ahead.
   */
  events(startIn: number, play: (t: number) => number) {
    let next = this.ctx.currentTime + startIn;
    const run = () => {
      const now = this.ctx.currentTime;
      while (next < now + LOOKAHEAD) {
        // From when it actually played, if a throttled tab ran late, so one wave's curve never overlaps the next.
        const t = Math.max(next, now);
        next = t + Math.max(0.01, play(t));
      }
    };
    run();
    this.timers.push(window.setInterval(run, 250));
  }

  stop() {
    for (const t of this.timers) clearInterval(t);
    for (const s of this.sources) {
      try {
        s.stop();
      } catch {
        // already stopped
      }
    }
    this.bus.disconnect();
  }
}
