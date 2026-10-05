import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

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

/** A softly bevelled block, so it reads as a Minecraft arm without hard razor corners. */
function box(w: number, h: number, d: number): THREE.BufferGeometry {
  const key = `${w}|${h}|${d}`;
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = new RoundedBoxGeometry(w, h, d, 3, Math.min(w, h, d) * 0.1)));
  return g;
}

/** A block that runs `d` along -z from the origin of its group. */
function block(mat: THREE.Material, w: number, h: number, d: number): THREE.Mesh {
  const m = new THREE.Mesh(box(w, h, d), mat);
  m.position.z = -d / 2;
  return m;
}

export function buildHand(side: 1 | -1, m: HandMaterials): HandRig {
  const hand = new THREE.Group();
  const skin = m.skin;

  // Plain voxel hand: one square block for the palm and fingers, and a small block for the thumb.
  hand.add(block(skin, 0.06, 0.05, 0.09));
  const fingers = new THREE.Group();
  fingers.position.z = -0.045;
  const thumb = new THREE.Group();
  thumb.position.set(-side * 0.036, -0.004, -0.02);
  thumb.add(block(skin, 0.022, 0.028, 0.04));
  hand.add(thumb);

  // The arm: skin up to a cuff, then the sleeve.
  const forearm = block(skin, 0.058, 0.048, 0.06);
  forearm.position.z = 0.05;
  const cuff = block(m.sleeve, 0.08, 0.07, 0.03);
  cuff.position.z = 0.1;
  const tube = block(m.sleeve, 0.092, 0.08, 0.3);
  tube.position.z = 0.37;

  const rig: HandRig = {
    hand,
    skinned: [forearm, hand],
    sleeve: [cuff, tube],
    apply(p) {
      const avg = (p.curl[0] + p.curl[1] + p.curl[2] + p.curl[3]) / 4;
      fingers.rotation.x = -Math.min(0.02 + 0.1 * avg + 0.12 * avg * avg, 1.5);
      const up = p.thumbUp;
      thumb.rotation.set(-0.05 + 0.2 * up, side * (0.05 + 0.15 * p.thumbOut + 0.9 * up), 0);
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
