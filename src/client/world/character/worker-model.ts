import * as THREE from 'three';
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES, lookFromSeed } from '../../../shared/avatar';
import { mesh } from '../toon';
import { voxelBox, voxelMaterial, voxelSolid } from '../voxel';
import { hairShapes, personShapes } from './person-model';
import { STATUS_BULB } from './worker-badges';

const SCALE = 0.6;
const HEAD = 0.885;

/**
 * A worker, built like the people (see person-model.ts) but smaller and snug at its desk: a blocky body in
 * its own colour, a big voxel head with hair, and a cube of light over it for how it's getting on.
 * +z is its face and its typing direction.
 */
export function workerModel(body: THREE.Group, skin: THREE.MeshStandardMaterial, bulb: THREE.MeshStandardMaterial) {
  const shape = personShapes();
  const baked = voxelSolid('#ffffff');
  const look = lookFromSeed(skin.color.getHexString());
  const face = voxelSolid(SKIN_TONES[look.skin]), hair = voxelSolid(HAIR_COLORS[look.hair]);
  const ink = voxelSolid('#2b2d42'), white = voxelSolid('#fff9ef'), shoe = voxelSolid('#2b2d42');
  voxelMaterial(skin); voxelMaterial(bulb);

  const torso = mesh(shape.torso, skin, 0, 0, 0);
  torso.add(mesh(shape.trim, baked, 0, 0, 0, false));
  torso.scale.setScalar(SCALE);
  body.add(torso);

  const head = new THREE.Group();
  head.position.y = 0.76;
  head.scale.setScalar(HEAD);
  head.add(mesh(shape.head, face));
  head.add(mesh(shape.smile, baked, 0, 0, 0, false));
  const style = hairShapes(HAIR_STYLES[look.style]);
  if (style) head.add(mesh(style, hair));
  body.add(head);

  const eyes: THREE.Mesh[] = [], pupils: THREE.Mesh[] = [], feet: THREE.Mesh[] = [];
  for (const sx of [-1, 1]) {
    const eye = mesh(voxelBox(0.1, 0.11, 0.03, 0.015), white, sx * 0.11, 0.7, 0.235, false);
    const pupil = mesh(voxelBox(0.05, 0.08, 0.025, 0.0125), ink, sx * 0.11, 0.7, 0.26, false);
    body.add(eye, pupil); eyes.push(eye, pupil); pupils.push(pupil);
    const foot = mesh(voxelBox(0.135, 0.15, 0.23), shoe, sx * 0.12, 0.2, 0.05);
    body.add(foot); feet.push(foot);
  }
  bulb.emissive = new THREE.Color(STATUS_BULB.starting).multiplyScalar(0.6);
  const bulbMesh = mesh(voxelBox(0.15, 0.15, 0.15, 0.025), bulb, 0, 1.22, 0, false);
  body.add(bulbMesh);
  const arm = (x: number) => {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.56, 0.05);
    pivot.scale.setScalar(SCALE);
    pivot.add(mesh(shape.sleeve, skin), mesh(shape.hand, face));
    body.add(pivot); return pivot;
  };
  return { eyes, pupils, feet, headset: [] as THREE.Object3D[], bulbMesh, armL: arm(-0.23), armR: arm(0.23) };
}
