import * as THREE from 'three';
import type { Interactable } from './office';
import { mesh, roundedBox, toon } from './toon';

/** The machine on the kitchen counter. Desktop and hand touches share its interactable. */
export function buildCoffeeMachine(interactable: Interactable): THREE.Group {
  const coffee = new THREE.Group();
  coffee.add(mesh(roundedBox(0.6, 0.7, 0.5, 0.08), toon('#343a40'), 0, 0.35, 0));
  coffee.add(mesh(new THREE.CylinderGeometry(0.08, 0.07, 0.14, 10), toon('#ffffff'), 0, 0.1, 0.12));
  coffee.add(mesh(new THREE.SphereGeometry(0.05, 8, 8), toon('#ef476f', { emissive: '#ef476f' }), 0.18, 0.55, 0.26));
  // Three centimeters around the casing, including its protruding brew button.
  const bounds = new THREE.Box3(new THREE.Vector3(-0.33, 0, -0.28), new THREE.Vector3(0.33, 0.73, 0.28));
  const button = new THREE.Sphere(new THREE.Vector3(0.18, 0.55, 0.26), 0.08);
  interactable.touch = [{ object: coffee, containsPoint: (point) => bounds.containsPoint(point) || button.containsPoint(point) }];
  coffee.userData.interact = interactable;
  return coffee;
}
