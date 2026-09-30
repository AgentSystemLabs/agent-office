import * as THREE from 'three';
import { mesh, toon } from '../toon';
import { boxOfStuff } from './props';
import type { WorkerRig } from './rig';

// A worker sent home (see Worker.leave): its things packed into a box, and waddling off with it.

/** Sent home: the box of its things in its arms, and how far into its waddle it is. */
export interface Leaving {
  box: THREE.Group;
  boxT: number;
  stride: number;
}

/** Its face falls and its things pop into a box in its arms: returns the box. */
export function packUp(rig: WorkerRig): THREE.Group {
  // Looking down, brows up in the middle.
  for (const p of rig.pupils) p.position.y -= 0.035;
  for (const sx of [-1, 1]) {
    const brow = mesh(new THREE.CapsuleGeometry(0.014, 0.08, 4, 6), toon('#1d1d1d'), sx * 0.11, 0.83, 0.228, false);
    brow.rotation.z = Math.PI / 2 - sx * 0.4;
    rig.body.add(brow);
  }
  // Hugged to its belly, the arms round the sides.
  const box = boxOfStuff();
  box.position.set(0, 0.22, 0.33);
  box.scale.setScalar(0.001);
  rig.body.add(box);
  return box;
}

/** Head hung, the box in its arms, waddling along while `walking`. */
export function waddle(rig: WorkerRig, l: Leaving, walking: boolean, dt: number) {
  // The box pops in, overshooting a little.
  l.boxT = Math.min(1, l.boxT + dt * 2.5);
  const u = l.boxT - 1;
  l.box.scale.setScalar(Math.max(0.001, 1 + 2.7 * u * u * u + 1.7 * u * u));
  const k = Math.min(1, dt * 10);
  rig.armL.rotation.x += (-1 - rig.armL.rotation.x) * k;
  rig.armR.rotation.x += (-1 - rig.armR.rotation.x) * k;
  rig.armL.rotation.z += (0.12 - rig.armL.rotation.z) * k;
  rig.armR.rotation.z += (-0.12 - rig.armR.rotation.z) * k;
  if (walking) l.stride += dt * 9;
  const s = walking ? Math.sin(l.stride) : 0;
  rig.feet.forEach((f, i) => {
    const step = i ? -s : s;
    f.position.z = 0.05 + step * 0.08;
    f.position.y = 0.2 + Math.max(0, step) * 0.05;
  });
  rig.body.position.y = Math.abs(s) * 0.05;
  rig.body.rotation.z = s * 0.1;
  rig.body.rotation.x += (0.15 - rig.body.rotation.x) * Math.min(1, dt * 4);
  rig.body.rotation.y += -rig.body.rotation.y * k;
  rig.body.scale.setScalar(1);
  rig.bulbMesh.scale.setScalar(1);
}
