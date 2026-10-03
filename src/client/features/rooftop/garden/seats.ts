import * as THREE from 'three';
import { Solids } from './leaves';
import { box } from './structures';

// The garden's seats. Each is a group of its own (its seat's interactable hangs on it), local +z the way
// you face, with its few meshes merged by material.

/** A low wooden bench with a slatted back and a linen cushion, 1.6 m long. */
export function bench(): THREE.Group {
  const s = new Solids();
  const wood = '#8f6038';
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) box(s, 'wood', '#6e4528', 0.07, 0.4, 0.07, sx * 0.7, 0.2, sz * 0.17);
    box(s, 'wood', '#6e4528', 0.06, 0.5, 0.06, sx * 0.7, 0.62, -0.23, 0, -0.1);
    box(s, 'wood', '#6e4528', 0.05, 0.05, 0.42, sx * 0.7, 0.3, 0);
  }
  for (const z of [-0.18, -0.06, 0.06, 0.18]) box(s, 'wood', wood, 1.62, 0.035, 0.105, 0, 0.42, z);
  for (const y of [0.58, 0.7, 0.82]) box(s, 'wood', wood, 1.62, 0.1, 0.025, 0, y, -0.24 - (y - 0.58) * 0.12, 0, -0.1);
  box(s, 'cloth', '#c9b99a', 1.3, 0.05, 0.4, 0, 0.465, 0.03, 0, 0, 0.05, 0);
  box(s, 'cloth', '#7f9a6b', 0.36, 0.3, 0.09, -0.42, 0.65, -0.16, 0, -0.5, 0.06, 0);
  return finish(s);
}

/** A reclined timber lounge chair with arms and cushions. */
export function lounge(): THREE.Group {
  const s = new Solids();
  const wood = '#946440';
  for (const sx of [-1, 1]) {
    box(s, 'wood', '#6e4528', 0.05, 0.05, 0.9, sx * 0.31, 0.22, 0.02, 0, -0.14);
    box(s, 'wood', '#6e4528', 0.05, 0.3, 0.05, sx * 0.31, 0.15, 0.32);
    box(s, 'wood', '#6e4528', 0.05, 0.28, 0.05, sx * 0.31, 0.14, -0.28);
    // The back posts reach up and back, the arm rests on a post at the front.
    box(s, 'wood', '#6e4528', 0.05, 0.85, 0.04, sx * 0.31, 0.62, -0.52, 0, -0.52);
    box(s, 'wood', '#6e4528', 0.045, 0.28, 0.045, sx * 0.34, 0.34, 0.3);
    box(s, 'wood', wood, 0.09, 0.03, 0.85, sx * 0.34, 0.49, -0.02);
  }
  for (let i = 0; i < 6; i++) box(s, 'wood', wood, 0.62, 0.03, 0.09, 0, 0.25 + i * 0.012, -0.22 + i * 0.1, 0, -0.14);
  for (let i = 0; i < 5; i++) {
    const d = 0.18 + i * 0.16;
    box(s, 'wood', wood, 0.62, 0.1, 0.025, 0, 0.27 + d * 0.87, -0.3 - d * 0.5, 0, -0.52);
  }
  box(s, 'cloth', '#c4683f', 0.54, 0.07, 0.56, 0, 0.3, 0.02, 0, -0.14, 0.05, 0);
  box(s, 'cloth', '#c4683f', 0.54, 0.62, 0.07, 0, 0.65, -0.47, 0, -0.52, 0.05, 0);
  return finish(s);
}

function finish(s: Solids): THREE.Group {
  const g = new THREE.Group();
  g.add(s.build());
  return g;
}
