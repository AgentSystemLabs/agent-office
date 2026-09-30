import type * as THREE from 'three';
import type { WorkerRig } from './rig';

/** Where a worker climbs up to dance, in the frame of the seat it sits in (see DeskView.stage). */
export interface Stage {
  pos: THREE.Vector3;
  /** Which way it faces up there, turned from the way it faces in its seat. */
  yaw: number;
}

/** Seconds a beat: a quick 140 to the minute. */
const BEAT = 60 / 140;
/** A dance's parts, in seconds: the hop up on to the desk, eight beats of moves, the hop back down. */
export const DANCE = { up: 0.5, moves: 8 * BEAT, down: 0.5 } as const;
/** How high a hop between the seat and the desk goes, over the straight line. */
const HOP = 0.5;

/** A dance under way (see the Worker's `dancing`). */
export interface Dancing {
  stage: Stage;
  t: number;
}

/**
 * The dance, `d.t` seconds in: hopping up from the seat, the moves up on the stage, and back down,
 * its light flashing like a disco ball. Returns how high it is off the stage, for what floats over it.
 */
export function groove(rig: WorkerRig, d: Dancing, dt: number, t: number): number {
  const { up, moves, down } = DANCE;
  // Between the seat (0) and the stage (1), with a hop's arc over the line between them.
  let on = 1;
  let arc = 0;
  if (d.t < up || d.t > up + moves) {
    const u = d.t < up ? d.t / up : 1 - (d.t - up - moves) / down;
    on = u;
    arc = 4 * HOP * u * (1 - u);
  }
  const { pos, yaw } = d.stage;
  const e = on * on * (3 - 2 * on);
  rig.root.position.set(pos.x * e, pos.y * on + arc, pos.z * e);
  rig.root.rotation.y = yaw * e;

  // Arms and the body's sway head for these, so one move runs into the next.
  let armX = [-2.6, -2.6];
  let armZ = [0, 0];
  let lift = 0;
  let sway = 0;
  let twist = 0;
  let step = 0;
  const beat = on < 1 ? -1 : (d.t - up) / BEAT;
  if (beat >= 0 && beat < 4) {
    // Groove: a bounce on every beat, swaying side to side, raising the roof one arm at a time.
    const s = Math.sin(beat * Math.PI);
    const c = Math.cos(beat * Math.PI);
    lift = Math.abs(s) * 0.12;
    sway = s * 0.22;
    twist = s * 0.3;
    step = s;
    armX = [-1.6 - c * 1.2, -1.6 + c * 1.2];
    armZ = [-0.35, 0.35];
  } else if (beat >= 4 && beat < 6) {
    // A twirl on the spot, arms out wide.
    const u = (beat - 4) / 2;
    twist = u * u * (3 - 2 * u) * Math.PI * 2;
    lift = Math.sin(u * Math.PI) * 0.18;
    armX = [-0.3, -0.3];
    armZ = [-1.35, 1.35];
  } else if (beat >= 6) {
    // Two big jumps, arms up.
    lift = Math.abs(Math.sin((beat - 6) * Math.PI)) * 0.45;
    armZ = [-0.3, 0.3];
  }
  // Whatever it was acting out waits: shoulders back in place, eyes ahead, the papers and globe put away.
  rig.armL.position.set(-0.3, 0.55, 0.05);
  rig.armR.position.set(0.3, 0.55, 0.05);
  for (const p of rig.pupils) p.position.y = 0.7;
  for (const prop of rig.props) prop.visible = false;
  const k = 1 - Math.exp(-dt * 18);
  [rig.armL, rig.armR].forEach((a, i) => {
    a.rotation.x += (armX[i] - a.rotation.x) * k;
    a.rotation.z += (armZ[i] - a.rotation.z) * k;
  });
  rig.body.position.set(sway * 0.3, lift, 0);
  rig.body.rotation.set(0, twist, sway);
  // Squashed a little as it lands.
  const squash = beat >= 0 && lift < 0.03 ? 1 - (0.03 - lift) * 3 : 1;
  rig.body.scale.set(2 - squash, squash, 2 - squash);
  rig.feet.forEach((f, i) => {
    f.position.y = 0.2 + Math.max(0, i ? -step : step) * 0.07;
    f.position.z = 0.05;
  });
  // Its light flashes through the colors like a disco ball.
  rig.bulb.color.setHSL((t * 1.3) % 1, 1, 0.5);
  rig.bulb.emissive.copy(rig.bulb.color).multiplyScalar(0.5);
  rig.bulbMesh.scale.setScalar(1 + Math.abs(Math.sin(t * 12)) * 0.3);
  return lift;
}
