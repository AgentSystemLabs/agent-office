import * as THREE from 'three';

/**
 * A procedural first-person hand: wrist, palm with thenar and hypothenar pads, four fingers of three
 * segments each (index longest after the middle, pinky shortest), and a thumb set off at an angle. Camera
 * space as everywhere in the hands scene: -z is forward (where the fingers point), +y is the back of the hand.
 * Built for the right hand and mirrored by `side` for the left: the thumb is on -x for the right hand.
 */

export interface HandMaterials {
  skin: THREE.MeshStandardMaterial;
  /** A touch redder than the skin, for the knuckles. */
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

interface Digit {
  base: THREE.Group;
  prox: THREE.Group;
  mid: THREE.Group;
  dist: THREE.Group;
}

export interface HandRig {
  /** The wrist, hand and fingers (turns for `roll`). */
  hand: THREE.Group;
  /** Forearm, wrist and hand in skin: hidden when a costume dresses the hand. */
  skinned: THREE.Object3D[];
  /** The rolled sleeve and the cloth above it. */
  sleeve: THREE.Object3D[];
  apply(p: HandPose): void;
}

const geoCache = new Map<string, THREE.BufferGeometry>();

function cached(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** A block hand, in the look of the voxel people (see ../vox.ts): every part is a square-edged box. */
function box(w: number, h: number, d: number): THREE.BufferGeometry {
  return cached(`box|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
}

function blob(mat: THREE.Material, hx: number, hy: number, hz: number, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(box(hx * 1.8, hy * 1.8, hz * 1.8), mat);
  m.position.set(x, y, z);
  return m;
}

/** A finger segment: a block of width 2r running L along -z from the origin. */
const FLAT = 0.86;

function seg(mat: THREE.Material, r0: number, r1: number, L: number): THREE.Mesh {
  const m = new THREE.Mesh(box(r0 * 2, r0 * 1.7, L), mat);
  m.position.z = -L / 2;
  return m;
}

// Finger lengths (proximal, middle, distal) and base radius: index, middle, ring, pinky.
const FINGERS = [
  { x: -0.0295, z: -0.092, len: [0.04, 0.024, 0.02], r: 0.0098, fan: 0.07 },
  { x: -0.0098, z: -0.097, len: [0.044, 0.027, 0.021], r: 0.0102, fan: 0.01 },
  { x: 0.0098, z: -0.093, len: [0.041, 0.025, 0.02], r: 0.0095, fan: -0.04 },
  { x: 0.0285, z: -0.085, len: [0.032, 0.018, 0.017], r: 0.0082, fan: -0.12 },
] as const;
// How far each joint folds per unit of curl (the pinky and ring curl most).
const PROX = [0.28, 0.32, 0.38, 0.45];
const MID = [0.45, 0.5, 0.55, 0.6];
const DIST = [0.28, 0.3, 0.32, 0.34];
const THUMB = { meta: 0.032, prox: 0.032, dist: 0.027 };

export function buildHand(side: 1 | -1, m: HandMaterials): HandRig {
  const hand = new THREE.Group();
  const skin = m.skin;
  const wrist = blob(skin, 0.031, 0.0185, 0.024, 0, 0, -0.004);
  const palm = blob(skin, 0.043, 0.0165, 0.047, 0, 0, -0.05);
  const thenar = blob(skin, 0.019, 0.013, 0.032, -side * 0.027, -0.007, -0.034);
  thenar.rotation.y = side * 0.35;
  const hypo = blob(skin, 0.013, 0.012, 0.033, side * 0.032, -0.003, -0.045);
  const ridge = blob(skin, 0.043, 0.011, 0.012, 0, 0.004, -0.093);
  hand.add(wrist, palm, thenar, hypo, ridge);

  const digits: Digit[] = [];
  FINGERS.forEach((f, i) => {
    const [l1, l2, l3] = f.len;
    const r = f.r;
    const base = new THREE.Group();
    base.position.set(side * f.x, 0.003, f.z);
    base.rotation.y = side * f.fan;
    const prox = new THREE.Group();
    prox.add(seg(skin, r, r * 0.9, l1));
    const mid = new THREE.Group();
    mid.position.z = -l1;
    mid.add(seg(skin, r * 0.9, r * 0.82, l2));
    const dist = new THREE.Group();
    dist.position.z = -l2;
    dist.add(seg(skin, r * 0.82, r * 0.64, l3));
    // A natural, short nail on the back of the tip.
    const s = r / 0.0098;
    const nail = blob(m.nail, 0.0054 * s, 0.0011, 0.0072 * s, 0, r * 0.74 * FLAT, -l3 * 0.62);
    nail.rotation.x = 0.06;
    dist.add(nail);
    // Knuckles: a faint tint over the big joint and the middle one.
    const k1 = blob(m.knuckle, r * 1.04, r * 0.9, r * 0.95, 0, r * 0.28, 0.001);
    base.add(k1);
    mid.add(blob(m.knuckle, r * 0.86, r * 0.74, r * 0.8, 0, r * 0.22, 0));
    mid.add(dist);
    prox.add(mid);
    base.add(prox);
    hand.add(base);
    digits.push({ base, prox, mid, dist });
  });

  // The thumb: set off at an angle from the palm, rolled a little so its nail faces up and out.
  const tRoot = new THREE.Group();
  tRoot.position.set(-side * 0.027, -0.006, -0.022);
  tRoot.rotation.order = 'YXZ';
  tRoot.add(seg(skin, 0.0135, 0.0118, THUMB.meta));
  const j1 = new THREE.Group();
  j1.position.z = -THUMB.meta;
  j1.add(seg(skin, 0.0118, 0.0108, THUMB.prox));
  const j2 = new THREE.Group();
  j2.position.z = -THUMB.prox;
  j2.add(seg(skin, 0.0108, 0.0086, THUMB.dist));
  const tNail = blob(m.nail, 0.0066, 0.0012, 0.0082, 0, 0.0086 * FLAT * 0.78, -THUMB.dist * 0.6);
  j2.add(tNail);
  j2.add(blob(m.knuckle, 0.0098, 0.0082, 0.009, 0, 0.002, 0));
  j1.add(j2);
  tRoot.add(j1);
  hand.add(tRoot);

  // The forearm, a block running back into the sleeve.
  const forearm = new THREE.Mesh(box(0.06, 0.05, 0.22), skin);
  forearm.position.z = 0.115;

  // Sleeve: two blocky cuffs, then a straight sleeve.
  const roll1 = new THREE.Mesh(box(0.115, 0.1, 0.04), m.sleeve);
  roll1.position.z = 0.12;
  const roll2 = new THREE.Mesh(box(0.125, 0.11, 0.04), m.sleeve);
  roll2.position.z = 0.16;
  const tube = new THREE.Mesh(box(0.135, 0.12, 0.36), m.sleeve);
  tube.position.z = 0.38;

  const rig: HandRig = {
    hand,
    skinned: [forearm, hand],
    sleeve: [roll1, roll2, tube],
    apply(p) {
      for (let i = 0; i < 4; i++) {
        const c = p.curl[i];
        const d = digits[i];
        d.prox.rotation.x = -Math.min(PROX[i] * c, 1.45);
        d.mid.rotation.x = -Math.min(MID[i] * c, 1.75);
        d.dist.rotation.x = -Math.min(DIST[i] * c, 1.3);
      }
      const up = p.thumbUp;
      tRoot.rotation.set(-0.12 + 0.22 * up, side * (0.2 + 0.4 * p.thumbOut + 0.85 * up), side * (0.45 - 0.35 * up));
      j1.rotation.x = -0.2 * p.thumbCurl * (1 - up * 0.8);
      j2.rotation.x = -0.28 * p.thumbCurl * (1 - up * 0.8);
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
