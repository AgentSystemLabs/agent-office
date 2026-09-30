// The plumbing every sound is made with: filters, envelopes, placing a panner, measuring a level, and
// the random numbers the sounds vary by (Math.random, so no two keystrokes or barks are quite alike).

export const rand = (a: number, b: number) => a + Math.random() * (b - a);
export const randInt = (a: number, b: number) => Math.floor(rand(a, b + 1));
export const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

export function rms(a: AnalyserNode): number {
  const d = new Float32Array(a.fftSize);
  a.getFloatTimeDomainData(d);
  let s = 0;
  for (const v of d) s += v * v;
  return Math.sqrt(s / d.length);
}

export function place(pn: PannerNode, x: number, y: number, z: number) {
  if (pn.positionX) {
    pn.positionX.value = x;
    pn.positionY.value = y;
    pn.positionZ.value = z;
  } else pn.setPosition(x, y, z);
}

export function biquad(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q: number): BiquadFilterNode {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Ramps `param` from 0 through [seconds after t0, value] points. */
export function envelope(param: AudioParam, t0: number, points: [number, number][]) {
  param.setValueAtTime(0, t0);
  for (const [dt, v] of points) param.linearRampToValueAtTime(v, t0 + dt);
}
