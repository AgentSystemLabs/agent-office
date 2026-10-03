import * as THREE from 'three';
import { voxelBox, voxelMaterial } from '../voxel';

/**
 * A short, chunky block hand in the look of the voxel people: a square palm, four stubby two-block
 * fingers, a stubby thumb, and a short forearm into a boxy sleeve. Camera space as everywhere in the
 * hands scene: -z is forward (where the fingers point), +y is the back of the hand. Built for the
 * right hand and mirrored by `side` for the left: the thumb is on -x for the right hand.
 */

export interface HandMaterials {
  skin: THREE.MeshStandardMaterial;
  knuckle: THREE.MeshStandardMaterial;
  nail: THREE.MeshStandardMaterial;
  sleeve: THREE.MeshStandardMaterial;
}

/** How the hand is held: how curled each finger is (1 = relaxed, 0 = straight, ~3.4 = fist) and the thumb. */
export interface HandPose {
  curl: [number, number, number, number];
  /** 0 tucked in against the palm, 1 relaxed out to the side. */
  thumbOut: number;
  /** 0 → 1: the thumb sticks right out (with `roll` turning the hand on its side, a thumbs up). */
  thumbUp: number;
  /** How bent the thumb is (1 = relaxed). */
  thumbCurl: number;
  /** 0 → 1: the hand turns on the wrist, thumb side up. */
  roll: number;
}

export function relaxedPose(): HandPose {
  return { curl: [1, 1, 1, 1], thumbOut: 1, thumbUp: 0, thumbCurl: 1, roll: 0 };
}

export interface HandRig {
  /** The wrist, hand and fingers (turns for `roll`). */
  hand: THREE.Group;
  /** Forearm and hand in skin: hidden when a costume dresses the hand. */
  skinned: THREE.Object3D[];
  /** The cuff and the sleeve above it. */
  sleeve: THREE.Object3D[];
  apply(p: HandPose): void;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function box(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `${w}|${h}|${d}`;
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = voxelBox(w, h, d, 0.007)));
  return g;
}

/** A block that runs `d` along -z from the origin of its group. */
function block(mat: THREE.Material, w: number, h: number, d: number): THREE.Mesh {
  const m = new THREE.Mesh(box(w, h, d), mat);
  m.position.z = -d / 2;
  return m;
}

const FINGER_W = 0.017;
const FINGER_H = 0.027;
/** Index to pinky: where each sits across the palm, and how long its two blocks are. */
const FINGERS = [
  { x: -0.0285, near: 0.025, far: 0.019 },
  { x: -0.0095, near: 0.027, far: 0.02 },
  { x: 0.0095, near: 0.025, far: 0.019 },
  { x: 0.0285, near: 0.021, far: 0.016 },
] as const;
const PALM = { w: 0.076, h: 0.034, d: 0.058 };

export function buildHand(side: 1 | -1, m: HandMaterials): HandRig {
  const hand = new THREE.Group();
  // Fine blocks with baked shading and a little colour jitter, like the people's, so the skin isn't one flat tone.
  const skin = voxelMaterial(m.skin);
  voxelMaterial(m.knuckle), voxelMaterial(m.nail), voxelMaterial(m.sleeve);

  const palm = block(skin, PALM.w, PALM.h, PALM.d);
  palm.position.z = 0;
  hand.add(palm);
  // A flush over the knuckles.
  const flush = block(m.knuckle, PALM.w - 0.012, 0.004, 0.014);
  flush.position.set(0, PALM.h / 2 + 0.0005, -PALM.d + 0.01);
  hand.add(flush);

  const knuckles: { prox: THREE.Group; dist: THREE.Group }[] = [];
  for (const f of FINGERS) {
    const prox = new THREE.Group();
    prox.position.set(f.x, 0.002, -PALM.d);
    prox.add(block(skin, FINGER_W, FINGER_H, f.near));
    const dist = new THREE.Group();
    dist.position.z = -f.near;
    dist.add(block(skin, FINGER_W - 0.0008, FINGER_H - 0.002, f.far));
    // A pale nail on the back of the tip.
    const nail = block(m.nail, FINGER_W - 0.006, 0.004, 0.009);
    nail.position.set(0, (FINGER_H - 0.002) / 2 + 0.0005, -f.far + 0.0055);
    dist.add(nail);
    prox.add(dist);
    hand.add(prox);
    knuckles.push({ prox, dist });
  }

  // The thumb: a stubby two-block digit off the palm's side.
  const thumb = new THREE.Group();
  thumb.position.set(-side * (PALM.w / 2 + 0.004), -0.002, -0.018);
  thumb.add(block(skin, 0.02, 0.026, 0.026));
  const tip = new THREE.Group();
  tip.position.z = -0.026;
  tip.add(block(skin, 0.019, 0.025, 0.02));
  thumb.add(tip);
  hand.add(thumb);

  // A short forearm into a boxy cuff and sleeve.
  const forearm = block(skin, 0.056, 0.042, 0.05);
  forearm.position.z = 0.05 + PALM.d / 2 - 0.004;
  const cuff = block(m.sleeve, 0.086, 0.07, 0.04);
  cuff.position.z = 0.115;
  const tube = block(m.sleeve, 0.098, 0.082, 0.22);
  tube.position.z = 0.3;

  const rig: HandRig = {
    hand,
    skinned: [forearm, hand],
    sleeve: [cuff, tube],
    apply(p) {
      for (let i = 0; i < 4; i++) {
        // Relaxed fingers are nearly straight; a fist closes them right over.
        const c = 0.22 * p.curl[i] + 0.2 * p.curl[i] * p.curl[i];
        knuckles[i].prox.rotation.x = -Math.min(c * 0.5, 1.45);
        knuckles[i].dist.rotation.x = -Math.min(c * 0.55, 1.5);
      }
      const up = p.thumbUp;
      thumb.rotation.set(-0.1 + 0.2 * up, side * (0.12 + 0.2 * p.thumbOut + 0.8 * up), side * (0.2 - 0.15 * up));
      tip.rotation.x = -0.3 * p.thumbCurl * (1 - up * 0.8);
      hand.rotation.z = -side * 1.2 * p.roll;
    },
  };
  rig.apply(relaxedPose());
  return rig;
}

/** Wipes the shared geometry cache (never needed in play: the geometry is tiny and shared by every hand). */
export function disposeHandGeometry() {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}
