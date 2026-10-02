import * as THREE from 'three';
import { Person } from '../character';
import type { Interactable } from '../types';
import { mesh, toon } from '../toon';
import type { World } from '../world';
import { box, lit, type Kit, type Mats } from './kit';

// The station's people who aren't workers: the First Officer, who brings new ones aboard, and
// Security, who sees them to the airlock when they're sent home.

const GOLD = toon('#e0b33a');

/** The herald (the First Officer), in a uniform jacket with gold on its shoulders and a peaked cap, where the plan has them. */
export function buildHerald(kit: Kit): World['herald'] {
  const hd = kit.plan.herald;
  if (!hd) return undefined;
  const navy = '#1d3557';
  const person = new Person(hd.name, navy, { skin: 1, hair: 2, style: 1 });
  const y = kit.floorAt(hd.x, hd.z);
  person.root.position.set(hd.x, y, hd.z);
  person.root.rotation.y = hd.rotY;
  person.setLabel(hd.name, null);
  person.setDoing(hd.says);
  const jacket = mesh(
    new THREE.LatheGeometry(
      [
        [0.31, 0.34],
        [0.3, 0.7],
        [0.28, 1.0],
      ].map(([r, yy]) => new THREE.Vector2(r, yy)),
      20,
    ),
    toon(navy),
  );
  person.wear(jacket, 'body');
  for (const sx of [-1, 1]) person.wear(mesh(box(0.16, 0.035, 0.12), GOLD, sx * 0.24, 1.0, 0, false), 'body');
  // A delta on the chest, and a stripe down the front.
  person.wear(mesh(new THREE.ConeGeometry(0.05, 0.11, 3), GOLD, 0.1, 0.84, 0.285, false), 'body');
  person.wear(mesh(box(0.03, 0.5, 0.02), GOLD, 0, 0.62, 0.3, false), 'body');
  const cap = new THREE.Group();
  cap.add(mesh(new THREE.CylinderGeometry(0.33, 0.31, 0.14, 20), toon(navy), 0, 0.3, 0));
  cap.add(mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.03, 20), kit.mats.white, 0, 0.385, 0, false));
  const peak = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.025, 16, 1, false, -0.9, 1.8), kit.mats.black, 0, 0.235, 0.12, false);
  cap.add(peak);
  cap.add(mesh(box(0.1, 0.06, 0.02), GOLD, 0, 0.31, 0.325, false));
  person.wear(cap, 'head');
  kit.group.add(person.root);
  const interactable: Interactable = { kind: 'herald', x: hd.x + Math.sin(hd.rotY) * 0.9, y, z: hd.z + Math.cos(hd.rotY) * 0.9, radius: 1.9 };
  person.root.userData.interact = interactable;
  kit.interactables.push(interactable);
  kit.colliders.push({ minX: hd.x - 0.35, maxX: hd.x + 0.35, minZ: hd.z - 0.35, maxZ: hd.z + 0.35, top: 99 });
  return { person, interactable };
}

/**
 * One of Security (the map's escort, see MapPlan.sendHome): a helmet with a lit visor, armour in
 * `color` over the shoulders and chest, and a stun baton in the left hand, so the right's free to
 * take a worker by the shoulder.
 */
function guard(mats: Mats, name: string, color: string): Person {
  const person = new Person(name, color, { skin: 3, hair: 1, style: 6 });
  person.setLabel(name, null);
  const plate = toon(color);
  const helm = new THREE.Group();
  helm.add(mesh(new THREE.SphereGeometry(0.38, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.62), plate, 0, 0.02, 0));
  // The visor: a band of light across where its eyes are.
  helm.add(mesh(new THREE.CylinderGeometry(0.385, 0.385, 0.1, 20, 1, true, -1.0, 2.0), lit('#ff4d4d', { side: THREE.DoubleSide }), 0, 0.04, 0, false));
  helm.add(mesh(box(0.05, 0.14, 0.3), mats.metalDark, 0, 0.38, -0.05, false));
  person.wear(helm, 'head');
  const vest = mesh(
    new THREE.LatheGeometry(
      [
        [0.33, 0.42],
        [0.32, 0.7],
        [0.3, 1.0],
      ].map(([r, y]) => new THREE.Vector2(r, y)),
      18,
    ),
    plate,
  );
  person.wear(vest, 'body');
  for (const sx of [-1, 1]) person.wear(mesh(new THREE.SphereGeometry(0.14, 10, 8), mats.metalDark, sx * 0.3, 0.98, 0), 'body');
  person.wear(mesh(new THREE.TorusGeometry(0.3, 0.045, 6, 18).rotateX(Math.PI / 2), mats.black, 0, 0.5, 0, false), 'body');
  person.wear(mesh(box(0.2, 0.07, 0.03), lit('#ffd24d'), 0, 0.82, 0.3, false), 'body');
  const baton = new THREE.Group();
  baton.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), mats.black, 0, 0.1, 0));
  baton.add(mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.22, 8), lit('#7fd8ff'), 0, 0.42, 0, false));
  baton.position.set(0, -0.36, 0.04);
  baton.rotation.x = 0.5;
  person.wear(baton, 'offhand');
  return person;
}

/** The map's escort (MapPlan.sendHome), on watch at its post, and how to call out another when it's busy. */
export function buildEscort(kit: Kit): World['escort'] {
  const e = kit.plan.sendHome?.escort;
  if (!e) return undefined;
  const make = () => guard(kit.mats, e.name, e.color);
  const person = make();
  person.root.position.set(e.post.x, e.post.y, e.post.z);
  person.root.rotation.y = e.post.rotY;
  kit.group.add(person.root);
  return { post: e.post, guard: person, make };
}
