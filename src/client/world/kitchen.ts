import * as THREE from 'three';
import { model, paintModel, palette } from './models';
import { toon } from './toon';
import type { Collider, Interactable } from './types';
import type { Fixture } from './office/fixture';

// The kitchen corner against the south wall, modelled in Blender (blender/scripts/build_kitchen.py): a
// counter with a wooden top and a sink under the window, a chunky espresso machine (E at it pours you
// a cup, see main.ts) and a round-shouldered retro fridge with notes stuck on it.

export interface Kitchen {
  group: THREE.Group;
  colliders: Collider[];
  /** The coffee machine: E at it for a minute of quicker feet and higher jumps. */
  interactable: Interactable;
}

/** Every material in kitchen.glb by name: the old code-built kitchen's colors, and the office's wood for the top. */
const COLORS: Record<string, string> = {
  Cabinet: '#8ecae6',
  Wood: '#c98b5a',
  Chrome: '#adb5bd',
  Dark: '#343a40',
  White: '#ffffff',
  Fridge: '#f8f9fa',
  Note: '#ffd166',
  Memo: '#bde0fe',
  Red: '#ef476f',
};

export function buildKitchen(): Kitchen {
  const group = new THREE.Group();
  const interactable: Interactable = { kind: 'coffee', x: -15.7, z: 10.9, radius: 1.4 };
  const kitchen = model('kitchen');
  if (kitchen) {
    const paint = palette(COLORS);
    // The machine's little light glows, as the old one did.
    paintModel(kitchen.scene, (name) => (name === 'Glow' ? toon('#ef476f', { emissive: '#ef476f' }) : paint(name)));
    group.add(kitchen.scene);
    // Only the machine pours a coffee: a look at the counter or the fridge doesn't.
    const machine = kitchen.scene.getObjectByName('coffee_machine');
    if (machine) machine.userData.interact = interactable;
  }
  // Modelled facing +z like everything else; against the south wall it turns round to face into the
  // room, which puts the machine at x -15.7 and the fridge at x -11.3.
  group.position.set(-14.5, 0, 12.2);
  group.rotation.y = Math.PI;
  const colliders: Collider[] = [
    { minX: -17, maxX: -12, minZ: 11.7, maxZ: 12.7, top: 1.03 },
    { minX: -11.85, maxX: -10.75, minZ: 11.7, maxZ: 12.7, top: 2.2 },
  ];
  return { group, colliders, interactable };
}

/** The kitchen corner: the counter, the coffee machine and the fridge. */
export const kitchen: Fixture = (site) => {
  const built = buildKitchen();
  // Counter, coffee machine and fridge, in front of the south wall.
  site.wall('south', -14.5, 0.55, 5.1, 1.1);
  site.wall('south', -15.7, 0.9, 0.6, 1.8);
  site.wall('south', -11.3, 1.1, 1.1, 2.2);
  return { group: built.group, colliders: built.colliders, interactables: [built.interactable] };
};
