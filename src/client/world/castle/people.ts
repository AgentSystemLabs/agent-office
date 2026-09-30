import * as THREE from 'three';
import type { MapPlan } from '../../../shared/maps';
import { Person } from '../character';
import type { Interactable } from '../types';
import { mesh, toon } from '../toon';
import type { World } from '../world';
import type { Kit, Mats } from './kit';
import { box } from './shapes';

// The castle's people who aren't workers: the herald who sends workers out, and the Kingsguard who
// takes them down to the dungeon when they're sent home.

/** The herald (the Hand of the King), in a robe of office with a gold chain, where the plan has him. */
export function buildHerald(kit: Kit, plan: MapPlan): World['herald'] {
  const hd = plan.herald;
  if (!hd) return undefined;
  const person = new Person(hd.name, '#1f4d3a', { skin: 2, hair: 5, style: 0 });
  const y = kit.floorAt(hd.x, hd.z);
  person.root.position.set(hd.x, y, hd.z);
  person.root.rotation.y = hd.rotY;
  person.setLabel(hd.name, null);
  person.setDoing(hd.says);
  const robe = mesh(
    new THREE.LatheGeometry(
      [
        [0.36, 0.02],
        [0.3, 0.5],
        [0.27, 0.95],
      ].map(([r, yy]) => new THREE.Vector2(r, yy)),
      20,
    ),
    toon('#1f4d3a'),
  );
  person.root.add(robe);
  const chain = mesh(new THREE.TorusGeometry(0.24, 0.025, 6, 20), kit.mats.gold, 0, 0.98, 0.04, false);
  chain.rotation.x = Math.PI / 2 - 0.35;
  person.root.add(chain);
  // The pin of his office.
  person.root.add(mesh(box(0.1, 0.12, 0.03), kit.mats.gold, 0.1, 0.86, 0.27, false));
  kit.group.add(person.root);
  const interactable: Interactable = { kind: 'herald', x: hd.x + Math.sin(hd.rotY) * 0.9, y, z: hd.z + Math.cos(hd.rotY) * 0.9, radius: 1.9 };
  person.root.userData.interact = interactable;
  kit.interactables.push(interactable);
  kit.colliders.push({ minX: hd.x - 0.35, maxX: hd.x + 0.35, minZ: hd.z - 0.35, maxZ: hd.z + 0.35, top: 99 });
  return { person, interactable };
}

/**
 * One of the Kingsguard (the map's escort, see MapPlan.sendHome): a kettle helm, a surcoat in `color`
 * over mail, and a halberd in the left hand, so the right's free to take a worker by the shoulder.
 */
function guard(mats: Mats, name: string, color: string): Person {
  const person = new Person(name, color, { skin: 3, hair: 1, style: 6 });
  person.setLabel(name, null);
  const helm = new THREE.Group();
  helm.add(mesh(new THREE.SphereGeometry(0.37, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), mats.steel, 0, 0.04, 0));
  const brim = mesh(new THREE.CylinderGeometry(0.5, 0.52, 0.04, 20), mats.steel, 0, 0.06, 0);
  helm.add(brim);
  helm.add(mesh(new THREE.SphereGeometry(0.05, 8, 6), mats.steel, 0, 0.41, 0, false));
  person.wear(helm, 'head');
  const surcoat = mesh(
    new THREE.LatheGeometry(
      [
        [0.33, 0.36],
        [0.3, 0.7],
        [0.28, 1.0],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      18,
    ),
    toon(color),
  );
  person.wear(surcoat, 'body');
  person.wear(mesh(new THREE.TorusGeometry(0.29, 0.05, 6, 18).rotateX(Math.PI / 2), mats.gold, 0, 0.66, 0, false), 'body');
  // The realm's crown on the chest.
  person.wear(mesh(box(0.14, 0.1, 0.03), mats.gold, 0, 0.84, 0.29, false), 'body');
  const halberd = new THREE.Group();
  halberd.add(mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.1, 6), mats.woodDark, 0, 0.35, 0));
  halberd.add(mesh(new THREE.ConeGeometry(0.035, 0.28, 6), mats.steel, 0, 1.54, 0));
  const blade = mesh(box(0.03, 0.26, 0.22), mats.steel, 0, 1.22, 0.12);
  halberd.add(blade);
  halberd.add(mesh(box(0.025, 0.08, 0.1), mats.steel, 0, 1.22, -0.08, false));
  halberd.position.set(0, -0.38, 0.02);
  halberd.rotation.x = 0.08;
  person.wear(halberd, 'offhand');
  return person;
}

/** The map's escort (MapPlan.sendHome), on watch at its post, and how to call out another when it's busy. */
export function buildEscort(kit: Kit, plan: MapPlan): World['escort'] {
  const e = plan.sendHome?.escort;
  if (!e) return undefined;
  const make = () => guard(kit.mats, e.name, e.color);
  const person = make();
  person.root.position.set(e.post.x, e.post.y, e.post.z);
  person.root.rotation.y = e.post.rotY;
  kit.group.add(person.root);
  return { post: e.post, guard: person, make };
}
