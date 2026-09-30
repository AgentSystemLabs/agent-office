import * as THREE from 'three';
import type { BarGame } from '../../../shared/bargames';
import { DOWN, type PersonRig } from './rig';

const hands = new THREE.Vector3();
const armDir = new THREE.Vector3();
const v1 = new THREE.Vector3();
const v2 = new THREE.Vector3();

/**
 * Throwing darts (with the right hand, the arm on -x) and axes (both hands, over the head). A dart is
 * held up by the eye, drawn back as far as the wind-up takes it, and pushed out at the board. An axe
 * goes round on an arc about AXE_TURN, from in front of the chest (`aim`) back over the head, and
 * over and down in front to throw, let go of on the way (`release`). Its handle points out along the
 * arc, tipped back AXE_WRIST from it. Seconds for each: the throw, and a whole one on its own
 * (someone else's) taking it back first. The next dart or axe is in hand `reload` after letting go.
 */
const DART_AIM = new THREE.Vector3(-0.2, 1.45, 0.36);
const DART_BACK = new THREE.Vector3(-0.21, 1.5, 0.12);
const DART_OUT = new THREE.Vector3(-0.24, 1.25, 0.6);
const AXE_TURN = new THREE.Vector3(0, 1.05, 0.02);
const AXE_ARC = { r: 0.36, aim: 0.25, back: 2.2, release: 0.55, end: -0.5 } as const;
const AXE_WRIST = 1.15;
const THROW = { darts: { time: 0.16, release: 0.5, auto: 0.25, reload: 0.55 }, axe: { time: 0.28, release: 0.62, auto: 0.35, reload: 1.2 } } as const;

/** The dart or axe in hand, and the throw it's in (see the Person's `oche`). */
export interface Oche {
  game: BarGame;
  prop: THREE.Group;
  back: number;
  want: number;
  top: number;
  throwT: number;
  autoT: number;
  reload: number;
  release: ((from: THREE.Vector3, turn: number) => void) | null;
}

/** Where the dart or axe in hand is, in the world. */
export function propPosition(rig: PersonRig, o: Oche, out: THREE.Vector3): THREE.Vector3 {
  rig.root.updateMatrixWorld(true);
  return o.prop.getWorldPosition(out);
}

/** Where the hands are round the axe's arc (see AXE_ARC) at elevation `phi`. */
function axeHands(phi: number): THREE.Vector3 {
  return hands.set(AXE_TURN.x, AXE_TURN.y + Math.sin(phi) * AXE_ARC.r, AXE_TURN.z + Math.cos(phi) * AXE_ARC.r);
}

/** The throwing arm (or arms), and the dart or axe in hand, over whatever they were doing. */
export function throwStep(rig: PersonRig, o: Oche, dt: number) {
  const t = THROW[o.game];
  if (o.autoT >= 0) {
    o.autoT += dt;
    o.want = Math.min(1, o.autoT / t.auto);
    o.back += (o.want - o.back) * Math.min(1, dt * 14);
    if (o.autoT >= t.auto) {
      o.autoT = -1;
      o.top = o.back;
      o.throwT = 0;
    }
  } else if (o.throwT < 0) o.back += (o.want - o.back) * Math.min(1, dt * 14);
  // How far through the throw: 0 drawn back, 1 all the way out, easing back to aiming after.
  let out = -1;
  if (o.throwT >= 0) {
    o.throwT += dt;
    const u = o.throwT / t.time;
    if (u < 1) out = u * u;
    else if (u < 2.5) out = 1;
    else {
      out = -1;
      o.throwT = -1;
      o.back = o.want = 0;
    }
  }
  if (o.reload > 0) {
    o.reload -= dt;
    if (o.reload <= 0) o.prop.visible = true;
  }
  const prop = o.prop;
  const rest = (arm: THREE.Object3D, sx: number, at: THREE.Vector3) => {
    armDir.set(at.x - sx, at.y - 0.9, at.z).normalize();
    arm.quaternion.setFromUnitVectors(DOWN, armDir);
  };
  if (o.game === 'darts') {
    const at = out >= 0 ? v1.copy(DART_AIM).lerp(DART_BACK, o.top).lerp(DART_OUT, out) : v1.copy(DART_AIM).lerp(DART_BACK, o.back);
    rest(rig.armL, -0.33, at);
    // The dart's held by the barrel in the fist, at the end of the arm, pointing out and a little up.
    armDir.set(at.x + 0.33, at.y - 0.9, at.z).normalize();
    prop.position.set(-0.33, 0.9, 0).addScaledVector(armDir, 0.38);
    prop.position.z += 0.09;
    prop.rotation.set(-0.12, 0, 0);
  } else {
    const phi = out >= 0 ? THREE.MathUtils.lerp(THREE.MathUtils.lerp(AXE_ARC.aim, AXE_ARC.back, o.top), AXE_ARC.end, out) : THREE.MathUtils.lerp(AXE_ARC.aim, AXE_ARC.back, o.back);
    const at = v1.copy(axeHands(phi));
    rest(rig.armL, -0.33, v2.set(at.x - 0.03, at.y + 0.03, at.z));
    rest(rig.armR, 0.33, v2.set(at.x + 0.03, at.y - 0.05, at.z));
    prop.position.copy(at);
    prop.rotation.set(Math.PI / 2 - phi - AXE_WRIST, 0, 0);
    // Leaning into it, down the lane.
    rig.body.rotation.x = out >= 0 ? Math.sin(Math.min(1, out) * Math.PI) * 0.18 : -o.back * 0.1;
  }
  const released = out >= 0 && out >= t.release * t.release;
  if (released && o.release) {
    const release = o.release;
    o.release = null;
    release(propPosition(rig, o, new THREE.Vector3()), prop.rotation.x);
    prop.visible = false;
    o.reload = t.reload;
  }
}
