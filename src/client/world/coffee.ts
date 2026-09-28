import * as THREE from 'three';
import type { Interactable } from './office';
import { mesh, roundedBox, toon } from './toon';

/**
 * The machine on the kitchen counter. Desktop uses its interactable; VR has no touch volume
 * here, since a hand reaching for the cup would press the machine first. VR grabs the cup.
 */
export function buildCoffeeMachine(interactable: Interactable): { machine: THREE.Group; cup: THREE.Mesh } {
  const machine = new THREE.Group();
  machine.add(mesh(roundedBox(0.6, 0.7, 0.5, 0.08), toon('#343a40'), 0, 0.35, 0));
  const cup = mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.14, 10), toon('#ffffff'), 0, 0.1, 0.12);
  cup.userData.grabbable = 'coffee';
  machine.add(cup);
  machine.add(mesh(new THREE.SphereGeometry(0.05, 8, 8), toon('#ef476f', { emissive: '#ef476f' }), 0.18, 0.55, 0.26));
  machine.userData.interact = interactable;
  return { machine, cup };
}
