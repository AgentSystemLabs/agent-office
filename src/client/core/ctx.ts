/**
 * Builds the context every part of the office plugs into (see context.ts), and the office's own state
 * it hands out: where you are, what you're holding, the hint bar, the view's shake.
 */
import type * as THREE from 'three';
import type { CarriedIssue } from '../../shared/protocol';
import type { Grip } from '../features/climbing/controller';
import { store } from '../state';
import type { Interactable } from '../world/types';
import type { Ctx, OfficeInteraction, StopWhy, Trip } from './context';
import type { Parts } from './parts';
import { Activities, Hooks, Interactions, Keys, Messages, Ticks, Usables, View } from './registry';

/** What you can be in the middle of, in the order it gets keys, has the hint bar and stops in (see Activities). */
const ACTIVITY_ORDER = ['hanger', 'climber', 'golf', 'thrower', 'driver'];

/** The office's own state: what the ctx hands out about where you are and what you hold, and what its own parts keep between frames. */
export interface CoreState {
  /** What the hint bar last drew (see renderHint in core/hintbar.ts): anything else has it draw again. */
  hintKey: string;
  /** How hard the view shakes (a landing off a pole, a bump in a car, a hiccup), easing off to 0. */
  thud: number;
  /** The issue card in your hands, taken off this floor's issues board (see features/carrying), or null. */
  carrying: CarriedIssue | null;
  /** Where you are now: up on the roof (true), or on a floor of the office. */
  upTop: boolean;
  /** A trip to another floor under way (see Trip, and core/travel.ts). */
  trip: Trip | null;
}

/**
 * The context, and the office's own state behind it. Built before the things it hands out, which are
 * in `parts` by the time anything asks for them (see main.ts).
 */
export function createCtx(parts: Parts): { ctx: Ctx; core: CoreState } {
  const core: CoreState = { hintKey: '', thud: 0, carrying: null, upTop: false, trip: null };
  const ctx: Ctx = {
    get scene() {
      return parts.stage.scene;
    },
    get camera() {
      return parts.stage.camera;
    },
    get renderer() {
      return parts.stage.renderer;
    },
    get canvas() {
      return parts.stage.canvas;
    },
    get office() {
      return parts.stage.office;
    },
    get sky() {
      return parts.stage.sky;
    },
    get player() {
      return parts.player;
    },
    get me() {
      return parts.me;
    },
    get hands() {
      return parts.hands;
    },
    get net() {
      return parts.net;
    },
    get voice() {
      return parts.voice;
    },
    get sound() {
      return parts.sound;
    },
    get settings() {
      return parts.settings;
    },
    get confetti() {
      return parts.confetti;
    },
    get smoke() {
      return parts.smoke;
    },
    get reduceMotion() {
      return parts.reduceMotion;
    },
    get hud() {
      return parts.hud.hud;
    },
    world: () => parts.worlds.world(),
    plan: () => parts.worlds.plan(),
    inOffice: () => parts.worlds.inOffice(),
    upTop: () => core.upTop,
    trip: () => core.trip,
    carrying: () => core.carrying,
    holdingBall: () => parts.hoops.holding(),
    hint: {
      // Not '': that reads as "no hint shown", and a hint still up (the golf one, say) would stay up.
      invalidate: () => void (core.hintKey = 'stale'),
      draw: (el, k, drawn) => {
        if (k === core.hintKey) return;
        core.hintKey = k;
        el.replaceChildren(...drawn());
        el.classList.remove('hidden');
      },
    },
    shake: (amount, replace = false) => {
      if (!parts.reduceMotion.matches) core.thud = replace ? amount : Math.max(core.thud, amount);
    },
    messages: new Messages((m) => store.apply(m)),
    keys: new Keys<KeyboardEvent>(),
    ticks: new Ticks(),
    activities: new Activities<StopWhy, KeyboardEvent, HTMLElement>(ACTIVITY_ORDER),
    interactions: new Interactions<OfficeInteraction>(),
    view: new View<Grip>(),
    usables: new Usables<Interactable, THREE.Object3D>(),
    windowOpened: new Hooks(),
  };
  return { ctx, core };
}
