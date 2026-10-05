// The Fugdi lab, for checking the circle dance by eye (Vite dev only, it isn't built:
// http://localhost:5173/lab/fugdi.html). A row of real Worker bots dances the office's own Fugdi
// (shared/fugdi.ts drives both it and the office), lit and outlined like the office. Query params:
//   bots=<n>     how many bots dance (1..15), in rings of six
//   t=<seconds>  steps the dance to t at 60 fps and draws one frame, for screenshots (0 is the
//                moment the bots set off from their seats)
// Once it has drawn, window.__ready says how many rings and dancers there are, where each dancer
// stands, and the closest any two come (the spacing check).
import * as THREE from 'three';
import { FUGDI_TOTAL, fugdiPlan } from '../../shared/fugdi';
import { Worker } from '../world/character';
import { ready, stage } from './stage';

const q = new URLSearchParams(location.search);
const bots = Math.max(1, Math.min(15, Number(q.get('bots') ?? 9)));
const stepTo = q.has('t') ? Number(q.get('t')) : null;

const { scene, camera, render } = stage(document.getElementById('c') as HTMLCanvasElement);
const plan = fugdiPlan(bots);
const COLORS = ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f', '#118ab2', '#ef476f', '#06d6a0', '#ffd166'];

/** A ring's middle, and the way to face, in a seat's own frame (as main.ts's ringSpot does). */
function stageIn(parent: THREE.Object3D, at: { x: number; z: number }): { pos: THREE.Vector3; yaw: number } {
  parent.updateWorldMatrix(true, false);
  const pos = new THREE.Vector3(at.x, 0, at.z);
  parent.worldToLocal(pos);
  const turn = new THREE.Quaternion();
  parent.getWorldQuaternion(turn);
  const seatYaw = Math.atan2(2 * (turn.w * turn.y + turn.x * turn.z), 1 - 2 * (turn.y * turn.y + turn.z * turn.z));
  return { pos, yaw: -seatYaw };
}

// Each bot starts at a desk of its own (two rows south of the rings), as it does in the office, so
// the gathering and the walk back read the way they will there.
const dancers = plan.spots.map((spot, i) => {
  const model = new Worker(`Bot ${i + 1}`, COLORS[i % COLORS.length]);
  model.setStatus('done', false);
  const seat = new THREE.Group();
  seat.position.set(-3 + (i % 6) * 1.4, 0, 4 + Math.floor(i / 6) * 1.4);
  scene.add(seat);
  seat.add(model.root);
  const ring = plan.rings[spot.ring];
  model.fugdi(stageIn(seat, ring), spot.ring, spot.member, spot.count);
  return model;
});

// The camera looks over the whole row from three-quarters, a little above the dancers.
const across = Math.max(4, plan.rings.length * 3.9);
camera.position.set(across * 0.42, 3.1, across * 0.95 + 2.5);
camera.lookAt(0, 0.85, 0);

let t = 0;
const step = (dt: number) => {
  t += dt;
  for (const model of dancers) model.update(dt, t);
};

/** Where everyone is, in world metres, and the closest any two come (the spacing check). */
const facts = () => {
  const at = dancers.map((model) => new THREE.Vector3().setFromMatrixPosition(model.root.matrixWorld));
  let gap = Infinity;
  for (let i = 0; i < at.length; i++) {
    for (let j = i + 1; j < at.length; j++) gap = Math.min(gap, at[i].distanceTo(at[j]));
  }
  return {
    rings: plan.rings.length,
    dancers: dancers.length,
    t: +t.toFixed(2),
    total: +FUGDI_TOTAL.toFixed(2),
    at: at.map((p) => [+p.x.toFixed(2), +p.y.toFixed(2), +p.z.toFixed(2)]),
    gap: +gap.toFixed(2),
  };
};

if (stepTo !== null) {
  for (let i = 0; i < Math.round(stepTo * 60); i++) step(1 / 60);
  render();
  ready(facts());
} else {
  let last = performance.now();
  const frame = (now: number) => {
    step(Math.min((now - last) / 1000, 0.1));
    last = now;
    render();
    requestAnimationFrame(frame);
  };
  frame(last);
  ready(facts());
}
