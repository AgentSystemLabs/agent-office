import * as THREE from 'three';
import { Vox } from '../vox';

// The people, built like the look prototype's: blocky, big-headed, a collar, a badge on a lanyard, hair
// in real voxels. Shirt, skin and hair are drawn grey here and tinted by their material, so one set of
// shapes serves every look; trousers, shoes and the face are baked in colour. Forward is +z; the head's
// own origin is its middle, and an arm's is the shoulder, a leg's the hip (see rig.ts).

const INK = '#2b2d42', PANTS = '#35425c', CREAM = '#f4ece0';
const FINE = 0.02, BODY = 0.03;

export interface PersonShapes {
  /** Shirt: torso and shoulders, with the belt, collar and badge as `trim`. */
  torso: THREE.BufferGeometry;
  trim: THREE.BufferGeometry;
  /** Skin: head, ears, nose and neck; the face's eyes, brows, cheeks and mouth in colour. */
  head: THREE.BufferGeometry;
  face: THREE.BufferGeometry;
  smile: THREE.BufferGeometry;
  /** An arm from the shoulder down: sleeve (shirt) and hand (skin). */
  sleeve: THREE.BufferGeometry;
  hand: THREE.BufferGeometry;
  /** A leg from the hip down, trousers and shoe in colour. */
  leg: THREE.BufferGeometry;
}

let shapes: PersonShapes | null = null;

export function personShapes(): PersonShapes {
  if (shapes) return shapes;
  const T = new Vox(BODY, 0.05);
  T.box(-0.25, 0.5, -0.15, 0.25, 0.98, 0.15);
  T.box(-0.28, 0.82, -0.14, 0.28, 0.98, 0.14);
  const R = new Vox(BODY, 0.03);
  R.box(-0.255, 0.42, -0.155, 0.255, 0.54, 0.155, PANTS);                 // trousers' waist
  R.box(-0.26, 0.48, -0.16, 0.26, 0.54, 0.16, INK, 0.02);                  // belt
  R.box(-0.04, 0.48, 0.15, 0.04, 0.54, 0.17, '#d9b44a', 0.02);             // buckle
  R.box(-0.1, 0.96, 0.1, 0.1, 1.0, 0.16, CREAM, 0.02);                     // collar
  R.box(0.06, 0.64, 0.15, 0.18, 0.82, 0.17, '#ffffff', 0.01);              // id badge
  R.box(0.06, 0.76, 0.17, 0.18, 0.82, 0.18, '#e8836a', 0.02);
  R.box(0.1, 0.82, 0.145, 0.13, 0.97, 0.16, INK, 0.02);                    // lanyard
  const H = new Vox(BODY, 0.04);
  H.box(-0.26, -0.27, -0.25, 0.26, 0.25, 0.25);
  H.box(-0.29, -0.06, -0.06, -0.26, 0.06, 0.06, 0.88);                     // ears
  H.box(0.26, -0.06, -0.06, 0.29, 0.06, 0.06, 0.88);
  H.box(-0.06, -0.36, -0.06, 0.06, -0.27, 0.06, 0.9);                      // neck
  H.box(-0.03, -0.12, 0.25, 0.03, 0, 0.29, 0.9);                           // nose
  const F = new Vox(FINE, 0);
  for (const sx of [-1, 1]) {
    const x = sx * 0.11;
    F.box(x - 0.05, 0.0, 0.25, x + 0.05, 0.1, 0.27, '#ffffff');            // eye white
    F.box(x - 0.025, 0.0, 0.27, x + 0.025, 0.09, 0.285, INK);              // pupil
    F.box(x - 0.07, 0.14, 0.25, x + 0.07, 0.17, 0.265, '#3a3330', 0.05);   // brow
    F.box(sx * 0.19 - 0.04, -0.1, 0.25, sx * 0.19 + 0.04, -0.05, 0.262, '#f29b8b', 0.03); // cheek
  }
  const M = new Vox(FINE, 0.02);
  M.box(-0.06, -0.16, 0.25, 0.06, -0.13, 0.265, '#b8453f');
  M.box(-0.08, -0.14, 0.25, -0.06, -0.12, 0.265, '#b8453f');
  M.box(0.06, -0.14, 0.25, 0.08, -0.12, 0.265, '#b8453f');
  const S = new Vox(BODY, 0.05);
  S.box(-0.075, -0.27, -0.075, 0.075, 0.08, 0.075);
  const Hd = new Vox(BODY, 0.04);
  Hd.box(-0.07, -0.45, -0.07, 0.07, -0.27, 0.07);
  const L = new Vox(BODY, 0.03);
  L.box(-0.095, -0.35, -0.1, 0.095, 0.04, 0.1, PANTS);
  L.box(-0.1, -0.42, -0.1, 0.1, -0.33, 0.21, INK, 0.02);
  L.box(-0.1, -0.42, -0.1, 0.1, -0.4, 0.21, CREAM, 0.02);
  return (shapes = { torso: T.build(), trim: R.build(), head: H.build(), face: F.build(), smile: M.build(), sleeve: S.build(), hand: Hd.build(), leg: L.build() });
}

const hairCache = new Map<string, THREE.BufferGeometry>();

/** Hair in voxels on the head (origin its middle, face down +z), in a style of HAIR_STYLES; null for bald. */
export function hairShapes(style: string): THREE.BufferGeometry | null {
  if (style === 'Bald') return null;
  const hit = hairCache.get(style);
  if (hit) return hit;
  const V = new Vox(BODY, 0.08);
  V.box(-0.29, 0.19, -0.29, 0.29, 0.34, 0.27);                  // cap
  V.box(-0.29, -0.16, -0.29, 0.29, 0.25, -0.2);                 // back
  V.box(-0.29, 0.0, -0.27, -0.26, 0.25, 0.14);                  // sideburns
  V.box(0.26, 0.0, -0.27, 0.29, 0.25, 0.14);
  V.box(-0.28, 0.14, 0.24, 0.28, 0.24, 0.29);                   // fringe
  if (style === 'Long') {
    V.box(-0.32, -0.4, -0.31, 0.32, 0.2, -0.16);
    V.box(-0.32, -0.32, -0.27, -0.26, 0.2, 0.1);
    V.box(0.26, -0.32, -0.27, 0.32, 0.2, 0.1);
  } else if (style === 'Bun') {
    V.ell(0, 0.42, -0.14, 0.14, 0.14, 0.14);
  } else if (style === 'Spiky') {
    [-0.21, -0.105, 0, 0.105, 0.21].forEach((x, n) => V.box(x - 0.045, 0.34, -0.12, x + 0.045, 0.43 + (n % 2) * 0.07, 0.12));
  } else if (style === 'Curly') {
    V.ell(0, 0.26, -0.04, 0.33, 0.15, 0.3);
    V.ell(-0.26, 0.08, -0.08, 0.1, 0.2, 0.2);
    V.ell(0.26, 0.08, -0.08, 0.1, 0.2, 0.2);
    V.ell(0, 0.0, -0.26, 0.3, 0.24, 0.1);
  } else if (style === 'Ponytail') {
    V.box(-0.05, -0.28, -0.4, 0.05, 0.1, -0.29);
    V.box(-0.06, 0.04, -0.34, 0.06, 0.1, -0.27, INK, 0.02);
  }
  const geo = V.build();
  hairCache.set(style, geo);
  return geo;
}
