import * as THREE from 'three';
import { EXIT_DOOR, STOREY, streetBelow } from '../../../shared/layout';
import { buildGarage } from '../outside';
import { mergeByMaterial } from '../toon';
import type { Collider } from '../types';
import { buildBalconyPosts, buildExitStairs } from './balcony';
import type { Fixture, Gives, StreetSite } from './fixture';
import { exitDoor, type Door } from './shell';

// Down to the street, which is the bottom floor's: its exit door and the steps down from it, the posts
// under its balcony, the garage under it and the street out front. On a floor above it, all of it is
// that many storeys further down (see Office.setLevel).

/**
 * The fixtures down on the street, in order: first the exit door, the steps and the garage, then each
 * of `parts`, built into the street (see StreetSite), and last the street goes in under the floor.
 */
export function downstairs<P extends Fixture<never, StreetSite>[]>(...parts: P): (Fixture | Fixture<Gives<P[number]>>)[] {
  let street: StreetSite;
  let exit: { group: THREE.Group; door: Door };
  /** The exit door and the steps down from it, the posts under the balcony, and the garage. */
  const down: Fixture = (site) => {
    const ground = new THREE.Group();
    const groundColliders: Collider[] = [];
    street = { ...site, ground, groundColliders };
    exit = exitDoor(site.get('night'));
    ground.add(exit.group);
    site.doors.push(exit.door);
    const stairs = new THREE.Group();
    buildExitStairs(stairs, groundColliders);
    buildBalconyPosts(stairs, groundColliders);
    ground.add(mergeByMaterial(stairs));
    // The door, its frame and the EXIT sign over it.
    site.wall(EXIT_DOOR.wall, EXIT_DOOR.u, (EXIT_DOOR.y1 + 0.7) / 2, EXIT_DOOR.width + 0.3, EXIT_DOOR.y1 + 0.7);
    buildGarage(ground, groundColliders);
    return {};
  };
  /** The street, with everything down there, in under the floor: that many storeys further down on a floor above the bottom one. */
  const under: Fixture = (site) => {
    const { ground, groundColliders } = street;
    const night = site.get('night');
    site.group.add(ground);
    site.colliders.push(...groundColliders);
    const base = groundColliders.map((c) => ({ c, top: c.top, bottom: c.bottom ?? 0 }));
    return {
      setLevel: (index) => {
        const drop = index * STOREY;
        ground.position.y = -drop;
        for (const g of base) {
          // Walls up into the sky stay that way.
          if (g.top <= 50) g.c.top = g.top - drop;
          g.c.bottom = g.bottom - drop;
        }
        night.street = streetBelow(index);
        exit.door.y = -drop;
        exit.door.locked = index > 0;
      },
    };
  };
  // Each part gives the office what it gives it.
  return [down, ...parts.map((part) => (() => part(street)) as Fixture<Gives<P[number]>>), under];
}
