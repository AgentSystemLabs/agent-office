import type * as THREE from 'three';
import { SEATING_BY_ID } from '../../../shared/layout';
import type { Collider, Interactable } from '../../world/types';
import type { NightParts } from '../../world/outside';

// What the roof's pieces (world.ts, cafe.ts, cafe-seating.ts) are built with and into.

/** Where a piece of the roof is built into: `statics` is merged into a few meshes once everything's in. */
export interface RoofSite {
  group: THREE.Group;
  statics: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  night: NightParts;
}

/** Warm timber, plaster and brass: the café's palette. */
export const TIMBER = '#c89a63';
export const TIMBER_DARK = '#8a5a3b';
export const PLASTER = '#efe8dc';
export const BRASS = '#d9a441';

/**
 * Leaves light out of looking and clicking, so the crosshair goes through it (a line of glow would
 * otherwise be in the way of whatever's behind).
 */
export function unpickable<T extends THREE.Object3D>(obj: T): T {
  obj.raycast = () => {};
  return obj;
}

/** Makes `obj` somewhere to sit (see SEATING): walk up to it, or look at it, and press E. */
export function seatable(obj: THREE.Object3D, seatId: string, radius: number, interactables: Interactable[]) {
  const seat = SEATING_BY_ID.get(seatId)!;
  const it: Interactable = { kind: 'seat', seatId, x: seat.x, y: seat.y, z: seat.z, radius };
  interactables.push(it);
  obj.userData.interact = it;
}

/** Sets `g`'s font to `px` pixels, or smaller so `text` fits in `width`. */
export function fitFont(g: CanvasRenderingContext2D, text: string, px: number, width: number) {
  const font = (n: number) => `900 ${n}px Nunito, ui-rounded, system-ui, sans-serif`;
  g.font = font(px);
  const w = g.measureText(text).width;
  if (w > width) g.font = font(Math.floor((px * width) / w));
}
