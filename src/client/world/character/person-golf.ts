import * as THREE from 'three';
import { mesh, toon } from '../toon';
import { DOWN, type PersonRig } from './rig';

/** How far round the club goes, from pointing down at the ball: back over the right shoulder, and on through to the finish. */
const BACKSWING = 2.4;
const FOLLOW = 2.5;
/** The swing's plane leans out from upright this far, down to the ball in front of the feet (features/golf/world.ts STANCE). */
const SWING_LEAN = 0.5;
/** Where the swing turns, high in the chest; the club's head is CLUB down from it. */
const SWING_AT = new THREE.Vector3(0, 0.95, 0.06);
const CLUB = 1.04;
/** Down through the ball, holding the finish, and back to the ball again, in seconds. */
const DOWNSWING = 0.14;
const FINISH = 1;
const SETTLE = 0.5;
/** A swing all on its own (someone else's) takes the club back for this long first. */
export const BACKSWING_TIME = 0.45;
/** How long after the downswing starts the club meets the ball. */
export const IMPACT = 0.08;

const hands = new THREE.Vector3();
const armDir = new THREE.Vector3();

/** A golf club, hanging down from the hands (its grip at 0): a wrapped grip, a steel shaft and the head at the bottom, its face toward +x. */
export function golfClub(): THREE.Group {
  const club = new THREE.Group();
  club.add(mesh(new THREE.CylinderGeometry(0.02, 0.017, 0.2, 8), toon('#2b2d42'), 0, -0.04, 0, false));
  club.add(mesh(new THREE.CylinderGeometry(0.011, 0.009, CLUB - 0.36 - 0.05, 6), toon('#ced4da'), 0, -(CLUB - 0.36) / 2 - 0.05, 0, false));
  club.add(mesh(new THREE.BoxGeometry(0.05, 0.05, 0.12), toon('#8d99ae'), 0.005, -(CLUB - 0.36), 0.03, false));
  return club;
}

/** The club in hand at the golf tee, and the swing it's in (see the Person's `golf`). */
export interface Golf {
  swing: THREE.Group;
  back: number;
  want: number;
  top: number;
  swingT: number;
  autoT: number;
  power: number;
}

/** The club's swing, turning high in the chest, with the club hanging down from the hands on it. */
export function clubSwing(): THREE.Group {
  const swing = new THREE.Group();
  swing.position.copy(SWING_AT);
  const club = golfClub();
  club.position.y = -0.36;
  swing.add(club);
  return swing;
}

/** Down through the ball from wherever it was taken back to, up into the finish, and back to the ball. */
export function strike(g: Golf) {
  g.top = g.back;
  g.swingT = 0;
  g.autoT = -1;
}

/** The golf swing, over whatever the arms and legs were doing. */
export function swingStep(rig: PersonRig, g: Golf, dt: number) {
  if (g.autoT >= 0) {
    g.autoT += dt;
    g.want = g.power * Math.min(1, g.autoT / BACKSWING_TIME);
    if (g.autoT >= BACKSWING_TIME) strike(g);
  }
  let phi: number;
  let finish = 0;
  if (g.swingT >= 0) {
    const s = (g.swingT += dt);
    if (s < DOWNSWING) {
      // Faster and faster down through the ball.
      const u = (s / DOWNSWING) ** 2;
      phi = THREE.MathUtils.lerp(-g.top * BACKSWING, FOLLOW, u);
      finish = Math.max(0, phi / FOLLOW);
    } else if (s < DOWNSWING + FINISH) {
      phi = FOLLOW;
      finish = 1;
    } else if (s < DOWNSWING + FINISH + SETTLE) {
      const u = (s - DOWNSWING - FINISH) / SETTLE;
      finish = 1 - u * u * (3 - 2 * u);
      phi = FOLLOW * finish;
    } else {
      g.swingT = -1;
      g.back = g.want = 0;
      phi = 0;
    }
    if (g.swingT >= 0) g.back = 0;
  } else {
    g.back += (g.want - g.back) * Math.min(1, dt * 12);
    phi = -g.back * BACKSWING;
  }
  g.swing.rotation.set(-SWING_LEAN, 0, phi);
  // Both hands on the grip, wherever the swing has it.
  const r = 0.36;
  const down = -Math.cos(phi) * r;
  hands.set(SWING_AT.x + Math.sin(phi) * r, SWING_AT.y + down * Math.cos(SWING_LEAN), SWING_AT.z - down * Math.sin(SWING_LEAN));
  for (const [arm, sx] of [
    [rig.armL, -0.33],
    [rig.armR, 0.33],
  ] as const) {
    armDir.set(hands.x - sx, hands.y - 0.9, hands.z).normalize();
    arm.quaternion.setFromUnitVectors(DOWN, armDir);
  }
  // Shoulders turned away on the way back, round to the hole at the finish; eyes on the ball until it's gone.
  const coil = Math.min(0, phi) / BACKSWING;
  rig.body.rotation.y = coil * 0.45 + finish * 0.5;
  rig.head.rotation.x = 0.4 * (1 - finish) + 0.05;
  rig.head.rotation.y = -coil * 0.35 + finish * 0.6;
  rig.legL.rotation.set(0, 0, -0.1);
  rig.legR.rotation.set(0, 0, 0.1);
}
