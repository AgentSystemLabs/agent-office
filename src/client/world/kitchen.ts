import * as THREE from 'three';
import { buildFridge, type Fridge } from './fridge';
import { model, paintModel, palette } from './models';
import { herbPot, tablePlant } from './plants';
import { toon } from './toon';
import type { Collider, Interactable } from './office';

// The kitchen corner against the south wall: a counter with a wooden top and a sink under the window,
// a chunky espresso machine (E at it pours you a cup, see main.ts) and a round-shouldered retro fridge
// with notes stuck on it.
//
// The counter and the machine are modelled in Blender (blender/scripts/build_kitchen.py). The fridge
// is built in code instead (world/fridge.ts): the .glb's fridge is one solid piece with its doors
// baked in, and the office's opens on E. Its part of the model is taken out here, and the code-built
// one stands at the same spot and footprint, so the collider below and everything placed by it stand.

export interface Kitchen {
  group: THREE.Group;
  colliders: Collider[];
  /** The coffee machine: E at it for a minute of quicker feet and higher jumps. */
  interactable: Interactable;
  /** The fridge beside it: E opens its doors, and the Diet Coke and ice creams inside. */
  fridge: Fridge;
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
    // The model's own fridge is left out: world/fridge.ts builds an interactive one in its place.
    kitchen.scene.getObjectByName('fridge')?.removeFromParent();
    const paint = palette(COLORS);
    // The machine's little light glows, as the old one did.
    paintModel(kitchen.scene, (name) => (name === 'Glow' ? toon('#ef476f', { emissive: '#ef476f' }) : paint(name)));
    // Modelled facing +z like everything else; against the south wall it turns round to face into the
    // room, which puts the machine at x -15.7 and the fridge at x -11.3.
    const glb = new THREE.Group();
    glb.position.set(-14.5, 0, 12.2);
    glb.rotation.y = Math.PI;
    glb.add(kitchen.scene);
    group.add(glb);
    // Only the machine pours a coffee: a look at the counter or the fridge doesn't.
    const machine = kitchen.scene.getObjectByName('coffee_machine');
    if (machine) machine.userData.interact = interactable;
    // Herbs on the counter either side of the sink, and a little green pot by the machine: clear of
    // the sink (model x 0) and the machine (model x 1.2), standing on the counter top at 1.03. In
    // the model's frame, so they stand and turn with the counter against the south wall.
    const counterTop = 1.03;
    for (const [i, x] of [-2.25, -1.25, 0.55].entries()) {
      const herb = i === 2 ? tablePlant() : herbPot(i === 0 ? 'rosemary' : 'basil');
      herb.position.set(x, counterTop, 0);
      herb.rotation.y = i * 1.4;
      glb.add(herb);
    }
  }
  const fridge = buildFridge({ x: -11.3, z: 12.2, rotY: Math.PI });
  group.add(fridge.group);
  const colliders: Collider[] = [
    { minX: -17, maxX: -12, minZ: 11.7, maxZ: 12.7, top: 1.03 },
    { minX: -11.85, maxX: -10.75, minZ: 11.7, maxZ: 12.7, top: 2.2 },
  ];
  return { group, colliders, interactable, fridge };
}
