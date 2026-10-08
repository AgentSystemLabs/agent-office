import { relaxedPose, type HandPose } from './rig';

/** What a hand is doing, from the hands' state (see Hands.fingers in world/hands.ts). */
export interface HandState {
  /** How far it grips a card, book or ball, 0–1. */
  grip: number;
  /** Round a mug or glass. */
  glass: boolean;
  /** Holding a cigarette. */
  smoking: boolean;
  /** How far it grips a ladder rung or the pole, 0–1. */
  hold: number;
  emote?: string;
}

/** The pose the hand on `side` (1 right, -1 left) wants right now, at time `t`. */
export function wantedPose(side: 1 | -1, t: number, s: HandState): HandPose {
  const want = relaxedPose();
  const idle = (i: number) => 0.09 * Math.sin(t * 1.1 + i * 0.9 + side) + 0.04 * Math.sin(t * 2.3 + i * 1.7);
  for (let i = 0; i < 4; i++) want.curl[i] = 1 + idle(i);
  // Round the card, book or ball.
  const grip = s.grip;
  for (let i = 0; i < 4; i++) want.curl[i] += 1.3 * grip;
  want.thumbCurl += 0.8 * grip;
  // Round a mug or glass in the left hand.
  if (s.glass) {
    for (let i = 0; i < 4; i++) want.curl[i] = 1.9 + idle(i) * 0.3;
    want.thumbCurl = 1.4;
  }
  // Holding the cigarette between the first two fingers.
  if (s.smoking) {
    want.curl = [0.55, 0.65, 2.4, 2.8];
    want.thumbCurl = 1.6;
  }
  // Gripping a ladder rung or the pole.
  const hold = s.hold;
  for (let i = 0; i < 4; i++) want.curl[i] += (2.8 - want.curl[i]) * hold;
  want.thumbCurl += (2 - want.thumbCurl) * hold;
  want.thumbOut -= 0.7 * hold;
  const id = s.emote;
  if (id === 'wave' || id === 'facepalm') {
    want.curl = [0.25, 0.25, 0.3, 0.35];
    want.thumbOut = 1.1;
  } else if (id === 'clap') {
    want.curl = [0.15, 0.15, 0.2, 0.25];
    want.thumbOut = 0.5;
  } else if (side > 0 && id === 'thumbs') {
    // A fist with the thumb straight up.
    want.curl = [3.4, 3.4, 3.4, 3.4];
    want.thumbUp = 1;
    want.thumbCurl = 0.1;
    want.roll = 1;
  } else if (side > 0 && id === 'point') {
    // Three fingers curled, the index out straight, the thumb tucked.
    want.curl = [0.05, 3.2, 3.3, 3.4];
    want.thumbOut = 0.4;
    want.thumbCurl = 1.8;
  }
  return want;
}
