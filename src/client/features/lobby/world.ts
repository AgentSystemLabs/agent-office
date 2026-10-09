import * as THREE from 'three';
import { BOARDS, DESKS, deskSeat } from '../../../shared/layout';
import { LOBBY_SEATING } from '../../../shared/lobby';
import { textPlane } from '../../world/toon';
import type { Fixture, Site } from '../../world/office/fixture';
import type { OfficeHandles, Interactable } from '../../world/types';

/** Project fixtures stay built for upper floors, but have no collision or actions in the lobby. */
export function projectFixture<K extends keyof OfficeHandles>(fixture: Fixture<K>): Fixture<K> {
  return (site) => {
    const before = new Set(site.group.children);
    const ci = site.colliders.length;
    const ii = site.interactables.length;
    const built = fixture(site);
    const objects = site.group.children.filter((o) => !before.has(o));
    if (built.group) objects.push(built.group);
    const colliders = [...site.colliders.slice(ci), ...(built.colliders ?? [])];
    const actions = [...site.interactables.slice(ii), ...(built.interactables ?? [])];
    let shown = true;
    return { ...built, setLevel(index, count, wings) {
      built.setLevel?.(index, count, wings);
      const show = index > 0;
      if (show === shown) return;
      shown = show;
      for (const object of objects) object.visible = show;
      for (const action of actions) action.off = !show;
      for (const collider of colliders) {
        const at = site.colliders.indexOf(collider);
        if (show && at < 0) site.colliders.push(collider);
        else if (!show && at >= 0) site.colliders.splice(at, 1);
      }
    } };
  };
}

/** Welcoming wall signs and human seats at the existing coworking tables. */
export const lobby: Fixture = (site: Site) => {
  const group = new THREE.Group();
  const messages = ['WELCOME · PUBLIC LOBBY', 'COWORK · TAKE A SEAT', 'CONNECT · VOICE & SCREEN SHARE', 'PROJECTS · ELEVATOR UPSTAIRS'];
  Object.values(BOARDS).forEach((b, i) => {
    const sign = textPlane(messages[i], { bg: '#e3f6ec', color: '#235b46', size: 56 });
    sign.position.set(b.x + Math.sin(b.rotY) * 0.15, b.y, b.z + Math.cos(b.rotY) * 0.15);
    sign.rotation.y = b.rotY;
    sign.scale.setScalar(Math.min(1.5, b.width / sign.geometry.parameters.width));
    group.add(sign);
  });
  const actions: Interactable[] = [];
  const originals = new Map<THREE.Group, Interactable>();
  for (const [i, def] of DESKS.entries()) {
    const desk = site.desks.get(def.id)!;
    originals.set(desk.group, desk.group.userData.interact);
    const seat = LOBBY_SEATING[i];
    const at = deskSeat(def, 1.25);
    actions.push({ kind: 'seat', seatId: seat.id, ...at, radius: 1.8, off: true });
  }
  return { group, interactables: actions, setLevel(index) {
    const publicSpace = index === 0;
    group.visible = publicSpace;
    for (const [i, def] of DESKS.entries()) {
      const desk = site.desks.get(def.id)!;
      const original = originals.get(desk.group)!;
      original.off = publicSpace;
      actions[i].off = !publicSpace;
      desk.group.userData.interact = publicSpace ? actions[i] : original;
    }
  } };
};
