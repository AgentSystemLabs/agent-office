import type * as THREE from 'three';
import type { DeskDef } from '../../shared/layout';
import type { WallRect } from '../../shared/decor';
import type { FloorPalette } from '../../shared/floors';

// The world's shared types: what you bump into and what you can use, the seats workers sit in, and the
// office floor as main.ts drives it (built in world/office/ from fixtures that each add what they give it).

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  top: number;
  /** Underside, for things you walk beneath (the loft). Defaults to the floor. */
  bottom?: number;
  /** Only there to keep people out: its top isn't anything to land on, so confetti falls through it. */
  fence?: boolean;
}

/**
 * The kinds of thing you can use, a key each (always `true`). None are listed here: each kind is added
 * where it's defined (its `ctx.interactions.define`), by augmenting this interface in that file:
 *
 *   declare module '../../world/types' {
 *     interface InteractKinds {
 *       gong: true;
 *     }
 *   }
 *
 * tests/client-registry.test.ts checks that every kind added is defined once, in the file that adds it.
 */
export interface InteractKinds {}

export type InteractKind = keyof InteractKinds;

/** Something you can use. Its scene object carries it as `userData.interact`, for clicking. */
export interface Interactable {
  kind: InteractKind;
  x: number;
  z: number;
  /** The floor it's on, when that's not the office floor (the loft's). */
  y?: number;
  radius: number;
  deskId?: string;
  decorId?: string;
  seatId?: string;
  /** Which of POLES, for a fire pole. */
  pole?: number;
  /** Which of CARS (shared/garage.ts), for a car. */
  car?: number;
  /** Put away for now (a bean bag nobody needs yet): can't be used. */
  off?: boolean;
  /** What the hint calls it, where a map's own looks differ from the office's (the castle's ale for the coffee machine). */
  label?: string;
}

/** A desk, a bean bag, a board agent's kiosk or a chair at the meeting table: somewhere a worker sits (or stands). */
export interface DeskView {
  def: DeskDef;
  group: THREE.Group;
  /** The laptop goes in here: placed, turned and sized for this seat. */
  laptopAnchor: THREE.Object3D;
  /** The worker goes in here, the same way. */
  seatAnchor: THREE.Object3D;
  /** Where the worker gets up to dance when a pull request merges: its feet, and the way it faces. */
  stage: THREE.Object3D;
  chair: THREE.Group;
  /** Shown while nobody is there: the "+" over a free seat, or the board agent waiting to be asked. */
  vacancy: THREE.Group;
  /** How high the vacancy marker floats. */
  vacancyY: number;
}

/**
 * What the office floor's fixtures give it to reach them by, a field of Office each (see
 * world/office/fixture.ts). None are listed here: each fixture adds its own where it's built, by
 * augmenting this interface in that file:
 *
 *   declare module './types' {
 *     interface OfficeHandles {
 *       gong: Gong;
 *     }
 *   }
 *
 * world/office/build.ts won't typecheck while one of them has no fixture on its list to give it.
 */
export interface OfficeHandles {}

export interface Office extends OfficeHandles {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  /** Every seat by id: the desks, the bean bags and the board agents' kiosks. */
  desks: Map<string, DeskView>;
  /** What's already on the walls (boards, the TV, windows…), so pictures don't hang over it (see Site.wall). */
  fixtures(): WallRect[];
  /** Paints the walls, their trim and the floor in a floor's colors, so each project looks like itself. */
  setLook(p: FloorPalette): void;
  /**
   * You're on floor `index` of a building `count` floors tall (0 is the bottom one): the rest of the
   * building goes up over you and down under you, the street that many storeys down, and only the
   * bottom floor has its exit door. `wings` is how far each floor's back office is built out, for
   * the building's outside.
   */
  setLevel(index: number, count: number, wings?: readonly number[]): void;
  /** Animates the office; doors open for anyone in `people` who comes up to them. */
  update(t: number, dt: number, people: Iterable<{ x: number; y: number; z: number }>): void;
}
