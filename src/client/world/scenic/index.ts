import * as THREE from 'three';
import { FARM, LIGHTHOUSE } from '../../../shared/scenic';
import type { Collider } from '../types';
import type { Fixture, StreetSite } from '../office/fixture';
import type { NightParts } from '../outside';
import { hazeReach } from '../sky';
import { mergeByColor } from '../toon';
import { buildCoast } from './coast';
import { buildFarm } from './farm';
import { G, makeKit } from './kit';
import { buildMountains } from './mountains';
import { buildRoad, buildSigns } from './road';
import { plantTrees } from './trees';
import { buildTunnel } from './tunnel';
import { buildWater } from './water';

// The scenic loop (see shared/scenic.ts), down on the street: the country road itself, and what you
// drive past on it. A farm on the way out of town to the east, then the pines, with a creek under a
// bridge; the mountains to the south, snow on their tops, a lake under them and a tunnel through a
// spur of them; up the coast, the beach, the sea and a pier, a lighthouse out on a rocky point; and
// back into town from the west. It's all made once and merged by material, a square of the map at
// a time so what's lost in the haze isn't drawn (see cull), and it drops with the street (see setLevel).
//
// Each stretch is built by a file of its own beside this one (the road and its signs, the farm, the
// water, the mountains, the tunnel, the coast, then the trees round all of it), into the kit that
// kit.ts makes; each hands back what it has that moves, for update.

export interface Scenic {
  /** The road and everything along it (the text on the signs isn't merged). */
  group: THREE.Group;
  /** The sails of the windmill, the lighthouse's beam, boats bobbing and the water moving: `t` in seconds. */
  update(t: number): void;
  /**
   * Only what's near enough to see from `eye` through the haze (the fog's far edge down on the street
   * at `far`, and the street `street` down): the rest isn't drawn.
   */
  cull(eye: THREE.Vector3, street: number, far: number): void;
}

/** Builds the scenic loop into `group` (the office's `ground` group), its colliders into `colliders`, its lights into `night`. */
export function buildScenic(group: THREE.Group, colliders: Collider[], night: NightParts): Scenic {
  const { kit, seen } = makeKit(group, colliders, night);
  const { root, labels, parts, silo, mill, light, cullable, around } = kit;
  // A part at a time, each taking its numbers from kit.rand in turn: in this order, or the trees move.
  const road = buildRoad(kit);
  buildSigns(kit);
  const { sails } = buildFarm(kit);
  const { waters, surf } = buildWater(kit, road);
  buildMountains(kit);
  buildTunnel(kit, road);
  const { boats, beam } = buildCoast(kit);
  plantTrees(kit);

  // Merged by material a square of the map at a time, so what's lost in the haze needn't be drawn.
  const TILE = 120;
  const byTile = new Map<string, THREE.Group>();
  for (const g of Object.values(parts)) {
    for (const child of [...g.children]) {
      const key = `${Math.floor(child.position.x / TILE)},${Math.floor(child.position.z / TILE)}`;
      let t = byTile.get(key);
      if (!t) byTile.set(key, (t = new THREE.Group()));
      t.add(child);
    }
  }
  for (const [key, g] of byTile) {
    const [tx, tz] = key.split(',').map(Number);
    const merged = mergeByColor(g);
    root.add(merged);
    // A tree on the edge of a square reaches a little way out of it.
    cullable(merged, tx * TILE - 10, (tx + 1) * TILE + 10, tz * TILE - 10, (tz + 1) * TILE + 10);
  }
  for (const [g, x, z, r, above] of [
    [silo, FARM.silo.x, FARM.silo.z, 4, 16],
    [mill, FARM.windmill.x, FARM.windmill.z, 6, 17],
    [light, LIGHTHOUSE.x, LIGHTHOUSE.z, 12, 26],
  ] as const) {
    const merged = mergeByColor(g);
    root.add(merged);
    around(merged, x, z, r, above);
  }
  for (const label of [...labels.children]) around(label, label.position.x, label.position.z, 4);

  return {
    group: root,
    cull(eye: THREE.Vector3, street: number, far: number) {
      const up = eye.y - street;
      for (const t of seen) {
        const reach = hazeReach(Math.max(up, t.above), far) + 10;
        const dx = Math.max(t.minX - eye.x, 0, eye.x - t.maxX);
        const dz = Math.max(t.minZ - eye.z, 0, eye.z - t.maxZ);
        t.obj.visible = dx * dx + dz * dz < reach * reach;
      }
    },
    update(t: number) {
      sails.rotation.z = -t * 0.7;
      beam.rotation.y = t * 0.8;
      for (const b of boats) {
        b.g.position.y = G - 0.3 + Math.sin(t * 1.3 + b.phase) * 0.12;
        b.g.rotation.z = Math.sin(t * 0.9 + b.phase) * 0.06;
      }
      for (const w of waters) w.offset.set((t * 0.015) % 1, (t * 0.006) % 1);
      for (const m of surf) m.opacity = 0.45 + 0.3 * Math.sin(t * 0.9);
    },
  };
}

declare module '../types' {
  interface OfficeHandles {
    /** The scenic loop off either end of the street, and everything along it. */
    scenic: Scenic;
  }
}

/** Off either end of the street, the scenic loop: the farm, the pines, the mountains and the beach. */
export const scenic: Fixture<'scenic', StreetSite> = (site) => {
  const built = buildScenic(site.ground, site.groundColliders, site.get('night'));
  return { handle: { scenic: built }, update: (t) => built.update(t) };
};
