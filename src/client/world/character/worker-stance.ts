import type { WorkerAction } from '../../../shared/protocol';

/**
 * What a worker's body is doing: resting, arms up for joy, arms crossed waiting on you, typing, or
 * acting out its latest tool call.
 */
export type Act = 'rest' | 'up' | 'waiting' | 'type' | WorkerAction;

/** One way of holding itself, blended into the next over a moment (see Worker.update). */
export interface Stance {
  /** Arms swung forward (x below 0 reaches toward the desk, -2.6 is straight up) and in toward the middle (z). The left arm is the one on -x. */
  armLx: number;
  armRx: number;
  armLz: number;
  armRz: number;
  /** 0..1: shoulders brought forward and in, for arms that wrap round the front (crossed, or holding its head). */
  reach: number;
  /** Shoulders lowered, so crossed arms sit on its belly and not under its eyes. */
  drop: number;
  /** Leaning toward the desk (+) or back (-), turned, tipped to the side, bobbing up. */
  lean: number;
  turn: number;
  roll: number;
  lift: number;
  /** How far its right foot is lifted, tapping, and both feet stretched out in front. */
  tap: number;
  kick: number;
  /** Eyes open (1) or narrowed, and looking up (+) or down (-). */
  lid: number;
  look: number;
}

const STANCE_KEYS = ['armLx', 'armRx', 'armLz', 'armRz', 'reach', 'drop', 'lean', 'turn', 'roll', 'lift', 'tap', 'kick', 'lid', 'look'] as const;

export function stanceOf(act: Act, t: number, s: Stance): Stance {
  s.armLx = s.armRx = -0.3;
  s.armLz = s.armRz = s.reach = s.drop = s.lean = s.turn = s.roll = s.tap = s.kick = s.look = 0;
  s.lift = Math.sin(t * 2) * 0.015;
  s.lid = 1;
  switch (act) {
    case 'up':
      s.armLx = s.armRx = -2.6;
      s.lift = 0;
      break;
    case 'type':
      s.armLx = -1.2 + Math.sin(t * 22) * 0.25;
      s.armRx = -1.2 + Math.sin(t * 22 + 1.7) * 0.25;
      s.lift = Math.abs(Math.sin(t * 11)) * 0.02;
      break;
    case 'edit':
      // Hunched over the keys, typing flat out.
      s.armLx = -1.25 + Math.sin(t * 34) * 0.34;
      s.armRx = -1.25 + Math.sin(t * 34 + 1.9) * 0.34;
      s.lean = 0.16;
      s.lift = Math.abs(Math.sin(t * 17)) * 0.035;
      s.look = -0.02;
      break;
    case 'read':
      // The papers held up in front, eyes running down the page.
      s.armLx = s.armRx = -2.05;
      s.armLz = 0.3;
      s.armRz = -0.3;
      s.lean = -0.06;
      s.look = -0.01 - ((t * 0.9) % 1) * 0.03;
      break;
    case 'test':
      // Leaning back, hands behind its head, feet out: waiting on the run.
      s.armLx = s.armRx = -3.3;
      s.armLz = 0.55;
      s.armRz = -0.55;
      s.lean = -0.32;
      s.roll = Math.sin(t * 1.3) * 0.04;
      s.kick = 0.08;
      s.look = 0.025;
      s.lift = 0;
      break;
    case 'web':
      // Scrolling with one hand, looking up at the globe.
      s.armLx = -1.2 + Math.sin(t * 9) * 0.15;
      s.armRx = -0.8;
      s.lean = -0.1;
      s.look = 0.03;
      break;
    case 'failing':
      // Head in its hands, shaking it slowly.
      s.armLx = s.armRx = -2;
      s.armLz = 0.45;
      s.armRz = -0.45;
      s.reach = 1;
      s.lean = 0.38;
      s.turn = Math.sin(t * 2.4) * 0.16;
      s.lid = 0.55;
      s.look = -0.035;
      s.lift = 0;
      break;
    case 'waiting': {
      // Arms crossed, hip cocked, tapping a foot.
      const tap = Math.max(0, Math.sin(t * 16));
      s.armLx = -1.05;
      s.armRx = -1.2;
      s.armLz = 1;
      s.armRz = -1;
      s.reach = 1;
      s.drop = 0.11;
      s.roll = 0.07;
      s.tap = tap;
      s.lift = tap * 0.012;
      s.lid = 0.6;
      break;
    }
  }
  return s;
}

/** How long a worker keeps acting something out before the next thing, so quick tool calls don't flicker. */
export const ACT_MIN = 1.2;
/** Head in its hands lasts at least this long, so you catch it. */
export const DESPAIR_MIN = 4;
/** Waiting on you: it jumps this long (seconds), then taps its foot with its arms crossed until the cycle comes round. */
export const WAIT_HOPS = 2;
export const WAIT_CYCLE = 4.6;
/** A full spin when it finishes, this long. */
export const TWIRL_TIME = 0.9;

/**
 * Eases `acts` (how much of each act is in the stance) toward `act`, out of whatever it was doing
 * before, and blends their stances into `out`. Each one is worked out in `scratch` first.
 */
export function blendStance(acts: Map<Act, number>, act: Act, dt: number, t: number, scratch: Stance, out: Stance): Stance {
  const k = Math.min(1, dt * 8);
  if (!acts.has(act)) acts.set(act, 0);
  for (const key of STANCE_KEYS) out[key] = 0;
  let total = 0;
  for (const [a, w0] of acts) {
    const w = w0 + ((a === act ? 1 : 0) - w0) * k;
    if (a !== act && w < 0.01) {
      acts.delete(a);
      continue;
    }
    acts.set(a, w);
    const s = stanceOf(a, t, scratch);
    for (const key of STANCE_KEYS) out[key] += s[key] * w;
    total += w;
  }
  for (const key of STANCE_KEYS) out[key] /= total;
  return out;
}
