import * as THREE from 'three';

// How people move over time: a reach, an emote, a drag on a cigarette, things popping in.

/** How long reaching out to use something takes, in seconds. */
export const REACH_TIME = 0.42;

/** 0 → 1 → 0 over a reach (p = 0..1): a quick jab out, a beat at full stretch, an easy return. */
export function reachCurve(p: number): number {
  if (p <= 0 || p >= 1) return 0;
  if (p < 0.28) return 1 - (1 - p / 0.28) ** 3;
  if (p < 0.5) return 1;
  const u = (p - 0.5) / 0.5;
  return 1 - u * u * (3 - 2 * u);
}

/** 0 → 1 → 0 over an emote `t` seconds into it: eased in quickly, out a little slower at the end. */
export function emoteEnvelope(t: number, seconds: number): number {
  const k = THREE.MathUtils.clamp(Math.min(t / 0.18, (seconds - t) / 0.3), 0, 1);
  return k * k * (3 - 2 * k);
}

/** Overshoots 1 a little on the way there (p = 0..1), for things that pop in. */
export function popCurve(p: number): number {
  const u = Math.min(1, p) - 1;
  return 1 + 2.7 * u * u * u + 1.7 * u * u;
}

/** On a smoke break, one drag every this many seconds. */
export const SMOKE_CYCLE = 6;
/** When, in a smoke cycle, the smoke is blown out. */
export const EXHALE_AT = 2.5;

/** How far the cigarette hand is up at the mouth (0..1), `c` seconds into a smoke cycle. */
export function dragCurve(c: number): number {
  const ease = (x: number) => x * x * (3 - 2 * x);
  if (c < 0.7) return ease(c / 0.7);
  if (c < 1.7) return 1;
  if (c < 2.3) return 1 - ease((c - 1.7) / 0.6);
  return 0;
}

export const ease = (x: number) => x * x * (3 - 2 * x);
/** 0 → 1 with a little overshoot, for props popping in. */
export const popIn = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : 1 + 2.7 * (x - 1) ** 3 + 1.7 * (x - 1) ** 2);
