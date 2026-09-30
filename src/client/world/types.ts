import type * as THREE from 'three';
import type { BOARDS, DeskDef } from '../../shared/layout';
import type { WallRect } from '../../shared/decor';
import type { FloorPalette } from '../../shared/floors';
import type { NightParts } from './outside';
import type { Fleet } from './cars';
import type { Scenic } from './scenic';
import type { Elevator } from './elevator';
import type { Gong } from './gong';
import type { JukeboxView } from './jukebox';
import type { CabinetModel } from './cabinet';
import type { WhiteboardStand } from './whiteboard';
import type { Green, Tee } from './golf';
import type { Stack } from './stack';
import type { HoopView } from './hoop';
import type { DeskSigns } from './desksigns';

// The world's shared types: what you bump into and what you can use, the seats workers sit in, and the
// office floor as main.ts drives it (built in world/office/, which re-exports these).

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

export interface Office {
  group: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  /** Every seat by id: the desks, the bean bags and the board agents' kiosks. */
  desks: Map<string, DeskView>;
  /**
   * Brings out the bean bags in `out` and puts the rest away. Returns the colliders of the ones that
   * just came out, in case someone is standing there.
   */
  setBeanbags(out: Set<string>): Collider[];
  boardMeshes: Record<keyof typeof BOARDS, THREE.Mesh>;
  tvScreen: THREE.Mesh;
  /** The monitor on the boss's desk upstairs, where Minesweeper plays (ui/arcade.ts). */
  bossScreen: THREE.Mesh;
  /** The monitor on the west wall showing how busy the office's machine is (world/machine.ts). */
  machineScreen: THREE.Mesh;
  /** The meeting room's board, showing the meeting's output as it's written, and the sign by its door. */
  meetingBoard: THREE.Mesh;
  meetingSign: THREE.Mesh;
  /** What's already on the walls (boards, the TV, windows…), so pictures don't hang over it. */
  fixtures(): WallRect[];
  elevator: Elevator;
  /** The elevator's stop down in the garage, under the building. */
  garageLift: Elevator;
  /** The Lambos and Ferraris in the garage, which anyone can drive (see driving.ts). */
  cars: Fleet;
  /** The scenic loop off either end of the street, and everything along it. */
  scenic: Scenic;
  /** The merge gong by the PR board. */
  gong: Gong;
  jukebox: JukeboxView;
  /** The arcade cabinet in the lounge, where BLOCKFALL plays (ui/cabinet.ts). */
  cabinet: CabinetModel;
  /** The rolling whiteboard everyone draws on together. */
  whiteboard: WhiteboardStand;
  /** The golf tee on the balcony, and the hole across the street it's hit at. */
  tee: Tee;
  green: Green;
  /** The basketball hoop on the west wall (the ball is main.ts's: see world/hoop.ts). */
  hoop: HoopView;
  /** The ceiling, the floor, and the ladder and fire poles between the floors of the building. */
  stack: Stack;
  /** The back office through the north wall, as far as this floor's built out (see WING). */
  wing: WingView;
  /** Builds the back office out `level` rows, or walls it up: the plants in the way go too. */
  setWing(level: number): void;
  /** The signs hung over the desks (see shared/floorplan.ts). */
  signs: DeskSigns;
  /** The sign over the elevator doors: which floor you're on. */
  setProjectName(name: string): void;
  /** Paints the walls, their trim and the floor in a floor's colors, so each project looks like itself. */
  setLook(p: FloorPalette): void;
  /**
   * You're on floor `index` of a building `count` floors tall (0 is the bottom one): the rest of the
   * building goes up over you and down under you, the street that many storeys down, and only the
   * bottom floor has its exit door. `wings` is how far each floor's back office is built out, for
   * the building's outside.
   */
  setLevel(index: number, count: number, wings?: readonly number[]): void;
  /** Lights, windows and glass for the sky to change with the time of day and the weather. */
  night: NightParts;
  /** The potted plants round the room, in PLANTS' order. At Christmas world/holiday.ts hides their leaves (plantLeaves()) and stands a little tree in each pot. */
  plants: THREE.Group[];
  /** Animates the office; doors open for anyone in `people` who comes up to them. */
  update(t: number, dt: number, people: Iterable<{ x: number; y: number; z: number }>): void;
}

/** The back office, as far as it's built out (see WING). */
export interface WingView {
  /** How many rows it's built out. */
  level: number;
  /** Builds it out `level` rows (or walls it up): walls, floor, ceiling, desks and all. */
  set(level: number): void;
}
