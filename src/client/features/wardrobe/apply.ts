import * as THREE from 'three';
import { FURNISH_SLOTS, variantOf, type FurnishSlotId, type Furnishings } from '../../../shared/furnishings';
import { WALL_HEIGHT } from '../../../shared/layout';
import { mesh, toon } from '../../world/toon';
import type { Office } from '../../world/types';
import { FLOOR_PLANTS, pendant, plant, plantLeaves, sofa, type PlantSpecies } from '../../world/office';
import { PALETTE } from '../../world/office/materials';

// Puts a floor's furnishings (see shared/furnishings.ts) on the office: each slot swaps what's in the
// groups the room's fixtures hand over (Office.plants, rugs, lounge and lamps) for its variant, in place,
// so whatever holds on to those groups (the holidays, the back office) keeps working.

/** What a slot's variant `id` looks like: its colors, or the first variant's for one it doesn't have. */
function colorsOf(slot: FurnishSlotId, id: string): readonly string[] {
  return (variantOf(slot, id) ?? FURNISH_SLOTS[slot].variants[0]).colors;
}

function applyPlants(office: Office, id: string) {
  office.plants.forEach((pot, i) => {
    const species: PlantSpecies = id === 'mixed' || !(FLOOR_PLANTS as readonly string[]).includes(id) ? FLOOR_PLANTS[i % FLOOR_PLANTS.length] : (id as PlantSpecies);
    // Each pot is scaled to its spot; the new plant goes in at its own size and takes the pot's scale.
    const old = plantLeaves(pot);
    const hidden = old.length > 0 && old.every((l) => !l.visible);
    const fresh = plant(species).children[0];
    if (!fresh) return;
    // Whatever else is in the pot (the Christmas tree) stays.
    for (const c of [...pot.children]) if (c.userData.plant || plantLeaves(c).length) pot.remove(c);
    fresh.userData.plant = true;
    pot.add(fresh);
    // At Christmas the leaves are hidden under a little tree: keep it that way.
    if (hidden) for (const l of plantLeaves(fresh)) l.visible = false;
  });
}

function applyRugs(office: Office, id: string) {
  const colors = colorsOf('rugs', id);
  const rugs = [...office.rugs, office.lounge.rug];
  rugs.forEach((rug, i) => {
    rug.visible = colors.length > 0;
    if (colors.length) rug.material = toon(colors[i] ?? colors[0]);
  });
}

/** A lamp of style `id` hung on a cord `cord` long, its shade at 0, like pendant(). */
function lamp(id: string, cord: number): THREE.Object3D {
  const [shade, glow] = colorsOf('lamps', id);
  if (id === 'cone') return pendant(cord);
  const g = new THREE.Group();
  const c = cord / 0.8;
  g.add(mesh(new THREE.CylinderGeometry(0.01, 0.01, c, 4), toon(PALETTE.ink), 0, c / 2, 0, false));
  const bulb = toon('#fff7d6', { emissive: glow });
  if (id === 'globe') {
    g.add(mesh(new THREE.CylinderGeometry(0.06, 0.08, 0.1, 10), toon(PALETTE.ink), 0, 0.02, 0, false));
    g.add(mesh(new THREE.SphereGeometry(0.34, 18, 14), toon(shade, { emissive: glow }), 0, -0.3, 0, false));
  } else if (id === 'drum') {
    g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.36, 24, 1, true), toon(shade), 0, -0.05, 0, false));
    g.add(mesh(new THREE.SphereGeometry(0.15, 10, 8), bulb, 0, -0.12, 0, false));
  } else {
    // The disco ball: a faceted sphere, spun by update().
    const ball = mesh(new THREE.IcosahedronGeometry(0.32, 1), toon(shade, { emissive: glow }), 0, -0.3, 0, false);
    ball.userData.spin = true;
    g.add(ball);
  }
  g.scale.setScalar(0.8);
  return g;
}

function applyLamps(office: Office, id: string) {
  for (const holder of office.lamps) {
    holder.clear();
    holder.add(lamp(id, WALL_HEIGHT - holder.position.y));
  }
}

function applySofa(office: Office, id: string) {
  const [cloth, ...poufs] = colorsOf('sofa', id);
  const { couch, poufs: seats } = office.lounge;
  for (const c of [...couch.children]) if (c.userData.sofa) couch.remove(c);
  couch.add(sofa(cloth));
  seats.forEach((p, i) => {
    const m = toon(poufs[i % poufs.length]);
    p.traverse((o) => {
      if (o.userData.cloth) (o as THREE.Mesh).material = m;
    });
  });
}

/** Puts the furnishings `f` on `office`, only the slots that differ from `was`. */
export function applyFurnishings(office: Office, f: Furnishings, was?: Furnishings) {
  if (was?.plants !== f.plants) applyPlants(office, f.plants);
  if (was?.rugs !== f.rugs) applyRugs(office, f.rugs);
  if (was?.lamps !== f.lamps) applyLamps(office, f.lamps);
  if (was?.sofa !== f.sofa) applySofa(office, f.sofa);
}

/** Spins any disco balls hanging from the lamps. */
export function spinLamps(office: Office, dt: number) {
  for (const holder of office.lamps)
    holder.traverse((o) => {
      if (o.userData.spin) o.rotation.y += dt * 0.8;
    });
}
