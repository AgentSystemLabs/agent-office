import * as THREE from 'three';
import { mesh, toon } from '../toon';
import { voxelBall, voxelBox, voxelCapsule, voxelMaterial } from '../voxel';
import { STATUS_BULB } from './worker-badges';

/** A fine voxel office worker on the existing rig: +z is its face and its typing direction. */
export function workerModel(body: THREE.Group, skin: THREE.MeshToonMaterial | THREE.MeshStandardMaterial, bulb: THREE.MeshToonMaterial | THREE.MeshStandardMaterial) {
  const face = voxelMaterial(toon('#f3caa4')), ink = voxelMaterial(toon('#293348'));
  const white = voxelMaterial(toon('#fff9ef')), pants = voxelMaterial(toon('#35475e'));
  voxelMaterial(skin); voxelMaterial(bulb);
  body.add(mesh(voxelCapsule(0.24, 0.12), skin, 0, 0.48, 0));
  body.add(mesh(voxelGeometryHead(), face, 0, 0.76, 0));
  // Collar, tiny nose and a lanyard badge make the small silhouette readable at a desk.
  body.add(mesh(voxelBox(0.22, 0.035, 0.055, 0.015), white, 0, 0.6, 0.22));
  body.add(mesh(voxelBox(0.055, 0.065, 0.04, 0.0125), face, 0, 0.65, 0.245));
  body.add(mesh(voxelBox(0.11, 0.1, 0.025, 0.0125), white, 0.11, 0.43, 0.23));
  body.add(mesh(voxelBox(0.06, 0.015, 0.03, 0.0125), ink, 0.11, 0.445, 0.245));
  const eyes: THREE.Mesh[] = [], pupils: THREE.Mesh[] = [], feet: THREE.Mesh[] = [], headset: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const eye = mesh(voxelBox(0.13, 0.115, 0.035, 0.0125), white, sx * 0.11, 0.7, 0.23, false);
    const pupil = mesh(voxelBox(0.05, 0.07, 0.025, 0.0125), ink, sx * 0.11, 0.7, 0.26, false);
    body.add(eye, pupil); eyes.push(eye, pupil); pupils.push(pupil);
    const foot = mesh(voxelBox(0.135, 0.15, 0.23), pants, sx * 0.12, 0.2, 0.05);
    body.add(foot); feet.push(foot);
    const cup = mesh(voxelBox(0.075, 0.14, 0.13), ink, sx * 0.255, 0.74, 0, false);
    body.add(cup); headset.push(cup);
  }
  for (let i = -5; i <= 5; i++) {
    const x = i * 0.05, y = 0.73 + Math.sqrt(Math.max(0, 0.27 ** 2 - x ** 2));
    const band = mesh(voxelBox(0.055, 0.035, 0.05, 0.015), ink, x, y, 0, false);
    body.add(band); headset.push(band);
  }
  const mic = mesh(voxelBox(0.14, 0.025, 0.025, 0.0125), ink, -0.2, 0.63, 0.19, false);
  body.add(mic); headset.push(mic);
  body.add(mesh(voxelBox(0.025, 0.22, 0.025, 0.0125), ink, 0, 1.07, 0, false));
  bulb.emissive = new THREE.Color(STATUS_BULB.starting).multiplyScalar(0.6);
  const bulbMesh = mesh(voxelBall(0.075, 0.015), bulb, 0, 1.2, 0, false);
  body.add(bulbMesh);
  const arm = (x: number) => {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.55, 0.05);
    pivot.add(mesh(voxelCapsule(0.055, 0.12, 0.02), skin, 0, -0.09, 0));
    pivot.add(mesh(voxelBox(0.105, 0.08, 0.105, 0.015), face, 0, -0.205, 0));
    body.add(pivot); return pivot;
  };
  return { eyes, pupils, feet, headset, bulbMesh, armL: arm(-0.3), armR: arm(0.3) };
}

function voxelGeometryHead() { return voxelCapsule(0.225, 0.025, 0.025); }
