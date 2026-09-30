/**
 * The drunk vision (world/drunk.ts) again, for a picture that isn't on the canvas. The world is
 * drawn through a shader; the TV's picture is an ordinary `<iframe>` or `<video>` in a layer over
 * the canvas, which WebGL never sees — so the same wobble, smear, doubling, colour bleed, warmth
 * and dark corners are rebuilt here as an SVG filter. `filter: url(#…)` needs no pixels: the
 * browser runs the filter over whatever the element has already painted, a cross-origin player
 * included, and it runs on the compositor, so the office's frame loop never waits for it.
 *
 * The numbers are world/drunk.ts's own, so the two read alike and swim together — `drunkStyle`
 * says which line of the shader each one comes from. Sober, the picture carries no filter at all
 * and this costs nothing, the same bargain world/drunk.ts strikes drawing straight to the screen.
 */

const NS = 'http://www.w3.org/2000/svg';
/** The picture's own width, and so what the shader's UV is measured in (see .tv-frame in style.css). */
const WIDTH = 1280;
/** world/drunk.ts clamps here too, and so does this: past properly wasted there's nothing more to see. */
const LIMIT = 1.6;
/** Below this you're straight, and neither the world's shader nor this is switched on (see main.ts). */
const OFF = 0.01;

/** How many pictures have been made, so each filter's id is its own. */
let made = 0;

/**
 * Everything the filter is set to for so much drink, worked out on its own so it can be checked
 * without a browser. Each number is world/drunk.ts's, read off the shader there.
 */
export interface DrunkStyle {
  /** `feDisplacementMap` scale: the ripple, `0.005 * a` in UV either way, doubled for being centred. */
  wobble: number;
  /** `feGaussianBlur` stdDeviation: the smear, `texel * (1 + 3.5 * a)` in the picture's own pixels. */
  smear: number;
  /** `feOffset` on the second copy — where the second of everything has drifted to, in pixels. */
  dx: number;
  dy: number;
  /** That copy's alpha: the shader's `mix(smear(uv), smear(uv + off), 0.45 * k)`. */
  doubled: number;
  /** How far red slips one way and blue the other, in pixels: the bleed at the corners of a drunk eye. */
  split: number;
  /** How much of that bleed shows — a screen, so fainter than the shader's `0.6 * k` mix. */
  fringe: number;
  /** The colour matrix: `mix(vec3(lum), col, 1 + 0.4 * k)`, then `col *= vec3(1.08, 0.98, 0.9)`. */
  grade: string;
  /** How far the picture's corners are darkened, off `1 - smoothstep(0.12, 0.62, edge) * 0.6 * k`. */
  corners: number;
}

/**
 * The shader's colour grade in one matrix: saturation about the brightness, then the warm
 * multiply. A diagonal matrix on its own would saturate about black instead, so the luminance is
 * folded into every row — `r * sat + lum * (1 - sat)`, which is what `mix(vec3(lum), col, sat)` is.
 */
function gradeMatrix(sat: number): string {
  const back = 1 - sat;
  const lum = [0.299, 0.587, 0.114];
  // One row per output channel, five values each: r g b, then an offset and an alpha weight.
  const row = (keep: number, warm: number) =>
    [...lum.map((w, j) => ((j === keep ? sat : 0) + w * back) * warm), 0, 0].map((v) => v.toFixed(4)).join(' ');
  return [row(0, 1.08), row(1, 0.98), row(2, 0.9), '0 0 0 1 0'].join(' ');
}

/** How drunk `amount` puts the picture, at `time` — the same clock world/drunk.ts is given. */
export function drunkStyle(amount: number, time: number, motion: boolean): DrunkStyle | null {
  // Not a number is as sober as no drink at all, rather than a filter set to NaN.
  if (!Number.isFinite(amount)) return null;
  const a = Math.max(0, Math.min(LIMIT, amount));
  if (a <= OFF) return null;
  const k = Math.min(a, 1);
  // world/drunk.ts multiplies its clock by `motion`, so holding still just holds `t` at zero.
  const t = motion ? time : 0;
  // The second of everything, drifting: `vec2(sin(t * 0.7 + 1.0), 0.45 * cos(t * 0.53))`, reaching
  // `(0.008 + 0.014 * a) * k` of the picture's width. The shader's 0.008 is a fraction of a whole
  // screen and the TV is a picture in a corner of one, so the floor comes off and the slope goes
  // up a touch: at one drink the two copies have to be far enough apart to read as two.
  const drift = (0.004 + 0.016 * a) * k * WIDTH;
  return {
    wobble: 2 * 0.005 * a * WIDTH,
    smear: 1 + 3.5 * a,
    dx: Math.sin(t * 0.7 + 1) * drift,
    dy: 0.45 * Math.cos(t * 0.53) * drift,
    // The shader's `0.45 * k`, and past it a shade more, so the two really are two. Capped well
    // short of one: past that the ghost isn't a second picture any more, it's the only one.
    doubled: 0.55 * k,
    // `ca = c * 0.02 * a * (0.25 + edge * 2.5)` is 0.015 of the width across at the corner and less
    // along the sides. One distance has to serve for both, so this sits between the two.
    split: 0.01 * a * WIDTH * k,
    fringe: 0.4 * k,
    grade: gradeMatrix(1 + 0.4 * k),
    corners: 0.6 * k,
  };
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** Puts world/drunk.ts's effect on an ordinary HTML element. See the note at the top. */
export class DrunkPicture {
  /** Unique in the page, so a second one (another TV, another floor) doesn't fight over the first. */
  private readonly id = `office-drunk-${made++}`;
  private readonly wobble: SVGElement;
  private readonly smear: SVGElement;
  private readonly drift: SVGElement;
  private readonly ghost: SVGElement;
  private readonly redApart: SVGElement;
  private readonly blueApart: SVGElement;
  private readonly redOnly: SVGElement;
  private readonly blueOnly: SVGElement;
  private readonly warm: SVGElement;
  /** Whether the filter is on the picture: put on and taken off as drink wears off, not every frame. */
  private on = false;

  constructor(private readonly target: HTMLElement) {
    const filter = svg('filter', {
      id: this.id,
      // Room for the smear and the drift to run off the edges. The frame's own `overflow: hidden`
      // takes the spill back off again, so none of it creeps out over the bezel.
      x: '-10%',
      y: '-10%',
      width: '120%',
      height: '120%',
      'color-interpolation-filters': 'sRGB',
    });
    // The picture drifts about like it's under water, along a noise field.
    const wave = svg('feTurbulence', { type: 'fractalNoise', baseFrequency: '0.006 0.012', numOctaves: 1, seed: 7, result: 'wave' });
    this.wobble = svg('feDisplacementMap', {
      in: 'SourceGraphic',
      in2: 'wave',
      scale: 0,
      xChannelSelector: 'R',
      yChannelSelector: 'G',
      result: 'wobbled',
    });
    // Then it smears.
    this.smear = svg('feGaussianBlur', { in: 'wobbled', stdDeviation: 0, result: 'smeared' });
    // A second copy of that, drifted off to one side: two of everything.
    this.drift = svg('feOffset', { in: 'smeared', dx: 0, dy: 0, result: 'drifted' });
    // Faded to the shader's `0.45 * k`, so blending it back in is the shader's `mix`.
    this.ghost = svg('feColorMatrix', {
      in: 'drifted',
      type: 'matrix',
      values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.45 0',
      result: 'faded',
    });
    const doubled = svg('feBlend', { in: 'smeared', in2: 'faded', mode: 'normal', result: 'doubled' });
    // Red slips one way and blue the other, the way they do at the corners of a drunk eye.
    this.redApart = svg('feOffset', { in: 'doubled', dx: 0, dy: 0, result: 'apart' });
    this.blueApart = svg('feOffset', { in: 'doubled', dx: 0, dy: 0, result: 'apart2' });
    this.redOnly = svg('feColorMatrix', {
      in: 'apart',
      type: 'matrix',
      values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.3 0',
      result: 'red',
    });
    this.blueOnly = svg('feColorMatrix', {
      in: 'apart2',
      type: 'matrix',
      values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0.3 0',
      result: 'blue',
    });
    const fringed = svg('feBlend', { in: 'redOnly', in2: 'blueOnly', mode: 'screen', result: 'fringed' });
    const lit = svg('feBlend', { in: 'doubled', in2: 'fringed', mode: 'screen', result: 'lit' });
    this.warm = svg('feColorMatrix', { in: 'lit', type: 'matrix', values: '1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0' });
    filter.append(
      wave,
      this.wobble,
      this.smear,
      this.drift,
      this.ghost,
      doubled,
      this.redApart,
      this.redOnly,
      this.blueApart,
      this.blueOnly,
      fringed,
      lit,
      this.warm,
    );
    // Filtered, never shown: it has to be in the document for `url(#…)` to find it.
    const holder = svg('svg', { width: 0, height: 0, 'aria-hidden': 'true' });
    holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none';
    const defs = svg('defs');
    defs.append(filter);
    holder.append(defs);
    (target.ownerDocument.body as unknown as HTMLElement).append(holder);
  }

  /** So much drink, on the same clock world/drunk.ts is given so the two drift together. */
  apply(amount: number, time: number, motion: boolean) {
    const style = drunkStyle(amount, time, motion);
    if (!style) return this.release();
    if (!this.on) {
      this.on = true;
      this.target.style.filter = `url(#${this.id})`;
    }
    const n = (v: number) => v.toFixed(3);
    this.wobble.setAttribute('scale', n(style.wobble));
    this.smear.setAttribute('stdDeviation', n(style.smear));
    this.drift.setAttribute('dx', n(style.dx));
    this.drift.setAttribute('dy', n(style.dy));
    // Keeping the colours and only fading the alpha is what makes the blend a `mix` and not a wash.
    const fade = (alpha: string) => `1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 ${alpha} 0`;
    this.ghost.setAttribute('values', fade(n(style.doubled)));
    this.redApart.setAttribute('dx', n(style.split));
    this.blueApart.setAttribute('dx', n(-style.split));
    this.redOnly.setAttribute('values', `1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 ${n(style.fringe)} 0`);
    this.blueOnly.setAttribute('values', `0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 ${n(style.fringe)} 0`);
    this.warm.setAttribute('values', style.grade);
    // The corners go dark off .tv-frame::after, which lies over the picture rather than under it.
    this.target.style.setProperty('--drunk', n(style.corners));
  }

  /** Straight again: no filter, no darkened corners, nothing left running. */
  release() {
    if (!this.on) return;
    this.on = false;
    this.target.style.filter = '';
    this.target.style.removeProperty('--drunk');
  }
}
