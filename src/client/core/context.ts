/**
 * What every part of the office gets to work with: the scene and everyone's shared objects, where you
 * are and what you're holding, and the registries to plug into (see registry.ts). Types only: a feature
 * takes a `Ctx` (`import type { Ctx }`) and never imports main.ts; core/ctx.ts builds the one there is.
 */
import type * as THREE from 'three';
import type { MapPlan } from '../../shared/maps';
import type { CarriedIssue, GhIssue, ServerMsg } from '../../shared/protocol';
import type { Grip } from '../features/climbing/controller';
import type { DeskKey } from '../interaction';
import type { Net } from '../net';
import type { PlayerController } from '../player';
import type { OfficeSound } from '../sound';
import type { Settings } from '../state';
import type { Hud } from '../ui/menu';
import type { Voice } from '../voice';
import type { Person } from '../world/character';
import type { Confetti } from '../world/confetti';
import type { Hands } from '../world/hands';
import type { Interactable, Office } from '../world/types';
import type { Sky } from '../world/sky';
import type { Smoke } from '../world/smoke';
import type { World } from '../world/world';
import type { Activities, Hooks, Interactions, Keys, Messages, Ticks, Usables, View } from './registry';

/** What the hint bar says. */
export interface Hint {
  /** Changes whenever the hint needs redrawing. */
  k: string;
  parts: (HTMLElement | string)[];
}

/**
 * Why whatever you're in the middle of is being stopped (see Activities.stopAll); each activity decides
 * which of these stop it.
 *
 * - start: you're starting something else at a thing you used (the tee, the dart board, the ladder, a pole, a car)
 * - taken: the office put you on another floor (yours was taken off the building)
 * - trip: you're off to another floor (the elevator, the floor list)
 * - map: the building changed maps
 * - walk: you're walking over to someone
 * - errand: you're walking over to something to use it (Shift+Enter in the palette)
 * - desk: you're put in front of a desk (the PR board's "Go to desk", N), or placed anywhere else
 *   (only the car hears that: see placeAt in core/place.ts)
 */
export type StopWhy = 'start' | 'taken' | 'trip' | 'map' | 'walk' | 'errand' | 'desk';

/** How you're going to another floor: by elevator, straight there from the floor list, or by the ladder or a pole. */
export type TripKind = 'elevator' | 'switch' | Grip;

/**
 * A trip under way: the lights are down (and by elevator the doors are shut) until the next floor
 * arrives. `garage` is down to the garage under it.
 */
export interface Trip {
  floor: string;
  how: TripKind;
  timer: number;
  garage?: boolean;
}

/** The types the office's things-you-can-use are about (see Interactions). */
export interface OfficeInteraction {
  it: Interactable;
  hint: Hint;
  key: DeskKey;
  /** The issue note you're pointing at on the issues board, if any. */
  note: GhIssue | null;
}

export interface Ctx {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  /** What the office is drawn on (the renderer's canvas), where the mouse aims and clicks. */
  readonly canvas: HTMLCanvasElement;
  /** The office building, whichever map is up (see world()). */
  readonly office: Office;
  readonly sky: Sky;
  readonly player: PlayerController;
  /** Your own character. */
  readonly me: Person;
  /** Your hands, in first person. */
  readonly hands: Hands;
  readonly net: Net;
  readonly voice: Voice;
  readonly sound: OfficeSound;
  readonly settings: Settings;
  readonly confetti: Confetti;
  readonly smoke: Smoke;
  /** The system asks for less motion: no shaking the view, no swaying. */
  readonly reduceMotion: MediaQueryList;
  readonly hud: Hud;

  /** The world the building's map is built as: the office, or a map of its own (the castle). */
  world(): World;
  /** Where everything is on the building's map. */
  plan(): MapPlan;
  /** Whether the building's on the office's own map. */
  inOffice(): boolean;
  /** Up on the roof, rather than on a floor of the office. */
  upTop(): boolean;
  /** The trip to another floor under way, if any. */
  trip(): Trip | null;

  /** The issue card in your hands, if any. */
  carrying(): CarriedIssue | null;
  /** Whether the basketball's in your hands. */
  holdingBall(): boolean;

  readonly hint: {
    /** Asks the hint bar to draw itself again, next frame. */
    invalidate(): void;
    /**
     * Draws `parts()` in the hint bar `el` (an activity's own hint), unless what it last drew was `k`
     * already: `k` changes whenever the hint needs redrawing.
     */
    draw(el: HTMLElement, k: string, parts: () => (HTMLElement | string)[]): void;
  };
  /**
   * Shakes the view (a bump in a car, a hiccup), easing off by itself; a stronger shake going on
   * already stays. `replace`: this one's how hard it shakes now, whatever was going on (a landing).
   * Nothing, when the system asks for less motion.
   */
  shake(amount: number, replace?: boolean): void;

  readonly messages: Messages<ServerMsg>;
  readonly keys: Keys<KeyboardEvent>;
  readonly ticks: Ticks;
  readonly activities: Activities<StopWhy, KeyboardEvent, HTMLElement>;
  readonly interactions: Interactions<OfficeInteraction>;
  /** What what you're doing makes of you and your view each frame (see ViewEffect). */
  readonly view: View<Grip>;
  /**
   * What else there is to use on the office's own map, and to aim at: the pictures on the walls, the
   * dog, the ball (see usable and aimedAt in input/pointer.ts).
   */
  readonly usables: Usables<Interactable, THREE.Object3D>;
  /** What lets go when a window opens: the shot you were winding up, the emote wheel (see input/focus.ts). */
  readonly windowOpened: Hooks;
}
