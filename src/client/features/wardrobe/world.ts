import * as THREE from 'three';
import { WARDROBE } from '../../../shared/layout';
import { mesh, roundedBox, toon } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { PALETTE } from '../../world/office/materials';

// The wardrobe by the balcony doors: a tall wooden cupboard, its doors a little ajar, with a coat on a
// hook down one side and a hat on top. E at it opens the wardrobe (ui.ts), where the floor's
// plants, rugs, lamps and sofa are swapped for others.

declare module '../../world/types' {
  interface OfficeHandles {
    /** The wardrobe by the balcony doors. */
    wardrobe: THREE.Group;
  }
}

/** The wardrobe, built facing +z with its origin on the floor under the middle of its back. */
function buildWardrobe(): THREE.Group {
  const { width: W, depth: D, height: H } = WARDROBE;
  const g = new THREE.Group();
  const wood = toon(PALETTE.wood);
  const dark = toon('#8a5a3b');
  // The carcass, a plinth under it and a crown on top.
  g.add(mesh(roundedBox(W, H - 0.12, D - 0.04, 0.05), wood, 0, 0.06 + (H - 0.12) / 2, D / 2 - 0.02));
  g.add(mesh(new THREE.BoxGeometry(W - 0.06, 0.08, D - 0.1), dark, 0, 0.04, D / 2 - 0.02));
  g.add(mesh(roundedBox(W + 0.1, 0.08, D + 0.04, 0.03), dark, 0, H - 0.02, D / 2));
  // Two doors, each a panel with a raised middle and a brass knob by the gap between them.
  const brass = toon('#e9c46a');
  for (const side of [-1, 1]) {
    const door = new THREE.Group();
    door.position.set(side * (W / 2 - 0.02), 0, D - 0.02);
    const dw = W / 2 - 0.04;
    const dx = -side * (dw / 2);
    door.add(mesh(roundedBox(dw, H - 0.3, 0.04, 0.02), toon('#d9a066'), dx, H / 2, 0.02));
    door.add(mesh(roundedBox(dw - 0.16, H - 0.62, 0.03, 0.02), wood, dx, H / 2 + 0.02, 0.045, false));
    door.add(mesh(new THREE.SphereGeometry(0.035, 12, 8), brass, -side * (dw - 0.07), H / 2, 0.07, false));
    // The right one stands a little open, so it reads as a cupboard you can look into.
    door.rotation.y = side > 0 ? 0.32 : 0;
    g.add(door);
  }
  // A coat on a hook on the left side, and a hat on top.
  const hook = mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6), brass, -W / 2 - 0.05, H - 0.45, D / 2, false);
  hook.rotation.z = Math.PI / 2;
  g.add(hook);
  const coat = new THREE.Group();
  coat.add(mesh(roundedBox(0.08, 0.95, 0.42, 0.04), toon('#4f86f7'), 0, -0.48, 0));
  coat.add(mesh(roundedBox(0.09, 0.18, 0.18, 0.04), toon('#3a6bd1'), 0, -0.05, 0, false));
  coat.position.set(-W / 2 - 0.1, H - 0.42, D / 2);
  g.add(coat);
  const hat = new THREE.Group();
  hat.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20), toon('#2b2d42'), 0, 0.01, 0));
  hat.add(mesh(new THREE.CylinderGeometry(0.12, 0.13, 0.16, 20), toon('#2b2d42'), 0, 0.09, 0));
  hat.add(mesh(new THREE.CylinderGeometry(0.132, 0.132, 0.035, 20), toon('#ef476f'), 0, 0.04, 0, false));
  hat.position.set(0.25, H + 0.02, D / 2);
  hat.rotation.z = -0.12;
  g.add(hat);
  return g;
}

/** The wardrobe, against the south wall facing into the room. */
export const wardrobe: Fixture<'wardrobe'> = (site) => {
  const { x, z, width: W, depth: D, height: H } = WARDROBE;
  const g = buildWardrobe();
  // Built facing +z; against the south wall it turns round to face -z, its back to the wall.
  g.position.set(x, 0, z + D / 2);
  g.rotation.y = Math.PI;
  const it: Interactable = { kind: 'wardrobe', x, z: z - 1.1, radius: 1.2 };
  g.userData.interact = it;
  site.wall('south', x, H / 2, W + 0.4, H + 0.2);
  // The coat hangs off its east side (the model's left), so that side reaches a little further.
  const collider: Collider = { minX: x - W / 2 - 0.05, maxX: x + W / 2 + 0.15, minZ: z - D / 2 - 0.05, maxZ: z + D / 2, top: H };
  return { group: g, colliders: [collider], interactables: [it], handle: { wardrobe: g } };
};
