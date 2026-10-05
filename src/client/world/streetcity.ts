import * as THREE from 'three';
import { STREET_Y, roofDrop } from '../../shared/layout';
import type { Fixture, StreetSite } from './office/fixture';
import { buildStreet } from './outside';
import { buildCity } from './city';

/**
 * The street out front, seen from the floors: the same downtown Vancouver you see from the roof
 * (see city.ts), laid out round the office, with its blocks to stop you and the clouds over it all.
 */
export const street: Fixture<never, StreetSite> = (site) => {
  const night = site.get('night');
  const world = buildStreet(site.ground, site.groundColliders, night, site.group);
  const city = buildCity(night, false);
  site.ground.add(city.group);
  // The blocks are solid: you (and a car) stop at their walls. Walls up into the sky stay that way.
  for (const f of city.footprints) site.groundColliders.push({ ...f, bottom: STREET_Y, top: 99 });
  return {
    setLevel: (_index, count) => {
      const floors = Math.max(1, count);
      city.setFloors(floors);
      // The city puts its street as far under the roof as the building is tall; here the street is where it is.
      city.group.position.y = STREET_Y + roofDrop(floors);
    },
    update: (t, dt) => {
      world.update(t);
      // How dark it is: the windows' glow (see Sky.update) is 1.1 at the darkest.
      city.update(t, dt, Math.min(1, (night.windows[0]?.emissiveIntensity ?? 0) / 1.1));
    },
  };
};
