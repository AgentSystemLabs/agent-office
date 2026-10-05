// Fugdi: the circle dance the office breaks into when someone bangs the gong. Every bot joins a
// ring, claps on the beat as the whole ring wheels round, takes turns whirling through the middle
// in pairs, and finishes with a turn together, hands up. The rings' sizes and the footwork are
// worked out here, so every browser dances the same steps to the same clock, and the tests can
// check the steps without a page.

/** The dhol's tempo, in beats a minute. */
export const FUGDI_BPM = 132;
/** Seconds to a beat. */
export const BEAT = 60 / FUGDI_BPM;

/**
 * The dance, in beats: setting off from the desks into the ring, the ring wheeling round clapping,
 * pairs taking turns through the middle, the finale (everyone turning together, hands up), and the
 * walk back to the desks.
 */
export const FUGDI = { gather: 3, circle: 16, centre: 24, finale: 8, leave: 3 } as const;

/** The moves on their own, in beats, and in seconds. */
export const FUGDI_BEATS = FUGDI.circle + FUGDI.centre + FUGDI.finale;
export const FUGDI_SECONDS = FUGDI_BEATS * BEAT;
/** The whole affair, from setting off to sitting back down. */
export const FUGDI_TOTAL = (FUGDI.gather + FUGDI_BEATS + FUGDI.leave) * BEAT;

/** How many bots dance in one ring before another opens, and how far apart the rings stand (m). */
export const RING_SIZE = 6;
export const RING_GAP = 3.9;
/** How far from the ring's middle the dancers stand (m), and how close in the centre pair whirl. */
export const RING_RADIUS = 1.4;
export const MIDDLE_RADIUS = 0.55;
/** The most rings: they line up along x either side of the middle of `home`. */
export const MAX_RINGS = 3;
/** Beats a centre pair takes: stepping in, whirling, and stepping back out. */
const SLOT_BEATS = 4;

const TAU = Math.PI * 2;
/** Smooth 0 → 1 over a clamped `x`. */
const ease = (x: number) => {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
};

/** One ring of the dance: its middle, and how many dance in it. */
export interface FugdiRing {
  x: number;
  z: number;
  count: number;
}

/** One dancer's place: which ring, and who they are in it. */
export interface FugdiSpot {
  ring: number;
  member: number;
  count: number;
}

export interface FugdiPlan {
  rings: FugdiRing[];
  spots: FugdiSpot[];
}

/**
 * The rings `n` dancers fill: balanced (no ring more than one fuller than another), in a row either
 * side of `home` along x, at most MAX_RINGS of them.
 */
export function fugdiRings(n: number, home: { x: number; z: number } = { x: 0, z: 0 }): FugdiRing[] {
  if (n <= 0) return [];
  const count = Math.min(MAX_RINGS, Math.max(1, Math.ceil(n / RING_SIZE)));
  const base = Math.floor(n / count);
  let extra = n - base * count;
  const mid = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) => {
    const size = base + (extra > 0 ? 1 : 0);
    extra -= 1;
    return { x: home.x + (i - mid) * RING_GAP, z: home.z, count: size };
  });
}

/** Every dancer's place, the rings filled one after another. */
export function fugdiPlan(n: number, home?: { x: number; z: number }): FugdiPlan {
  const rings = fugdiRings(n, home);
  const spots: FugdiSpot[] = [];
  rings.forEach((ring, r) => {
    for (let member = 0; member < ring.count; member++) spots.push({ ring: r, member, count: ring.count });
  });
  return { rings, spots };
}

/** What one dancer is doing at one moment. Offsets are in metres, in the ring's own frame. */
export interface FugdiPose {
  /** Offset from the ring's middle: right (dx) and forward (dz) in the ring's frame. */
  dx: number;
  dz: number;
  /** Facing within the ring (0 faces the ring's +z), and an extra spin on the spot, radians. */
  yaw: number;
  spin: number;
  /** How high the body bobs off the floor, metres. */
  lift: number;
  /** Hands: 0 apart, 1 palms together. */
  clap: number;
  /** Arms: 0 down clapping in front, 1 up over the head. */
  armsUp: number;
  /** A lean into the step, radians; and which foot is up (-1, 0 or +1). */
  sway: number;
  step: number;
  /** 0 in the ring, 1 out in the middle whirling. */
  centre: number;
}

/**
 * The pose of dancer `member` of `count` in ring `ring`, `t` seconds into the moves (0 is the first
 * clap). Every dancer shares the same beat, so the claps, bounces and steps are all in step.
 */
export function fugdiPose(t: number, member: number, count: number, ring = 0): FugdiPose {
  const p: FugdiPose = { dx: 0, dz: 0, yaw: 0, spin: 0, lift: 0, clap: 0, armsUp: 0, sway: 0, step: 0, centre: 0 };
  if (count <= 0) return p;
  const b = Math.min(Math.max(t, 0), FUGDI_SECONDS) / BEAT;
  const beat = Math.floor(b);
  const f = b - beat;
  // Hands meet on the beat and come apart in between; the body rises between claps and lands on them.
  p.clap = Math.max(0, Math.cos(TAU * f)) ** 0.6;
  p.lift = Math.sin(Math.PI * f) * 0.05;
  p.step = Math.sin(Math.PI * f) * (beat % 2 ? 1 : -1);
  p.sway = Math.sin(TAU * (b / 2)) * 0.09;
  const angle = (member / count) * TAU;
  // The ring wheels round twice while circling and twice more through the centre turns; the finale holds it still.
  const wheel = (Math.min(b, FUGDI.circle + FUGDI.centre) / (FUGDI.circle / 2)) * TAU;
  const a = angle + wheel;
  let radius = RING_RADIUS;
  if (b >= FUGDI.circle && b < FUGDI.circle + FUGDI.centre) {
    // A pair takes the middle for a slot each: they step in facing each other and whirl, then back out.
    const slot = Math.floor((b - FUGDI.circle) / SLOT_BEATS);
    const u = (b - FUGDI.circle - slot * SLOT_BEATS) / SLOT_BEATS;
    const chosen = (slot + ring) % count;
    const partner = (chosen + Math.floor(count / 2)) % count;
    if (member === chosen || member === partner) {
      p.centre = Math.sin(Math.PI * Math.min(1, Math.max(0, (u - 0.12) / 0.76)));
      radius = RING_RADIUS - (RING_RADIUS - MIDDLE_RADIUS) * p.centre;
      // Opposite ways round, so the pair pinwheels through the middle.
      p.spin = (member === chosen ? 1 : -1) * ease((u - 0.2) / 0.55) * TAU;
    }
  } else if (b >= FUGDI.circle + FUGDI.centre) {
    // Finale: everyone faces the middle, hands up, and turns together on the spot.
    const fb = b - FUGDI.circle - FUGDI.centre;
    p.armsUp = ease(fb / 1.2);
    p.spin = ease((fb - 4.5) / 3) * TAU;
  }
  p.dx = Math.sin(a) * radius;
  p.dz = Math.cos(a) * radius;
  p.yaw = a + Math.PI;
  return p;
}
