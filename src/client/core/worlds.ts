import { LOBBY, LOBBY_PLAN } from '../../shared/lobby';
/**
 * The building's map as it's built (see shared/maps and world/world.ts): the office, or a map of its
 * own (the castle). Only one is in the scene at a time, like the office and the rooftop; core/maps.ts
 * puts up the one the building's on.
 */
import type { MapPlan } from '../../shared/maps';
import { ROOF } from '../../shared/rooftop';
import { groundAt } from '../player';
import { store } from '../state';
import { Court } from '../world/court';
import { BUILDERS } from '../world/styles';
import { officeWorld, type World } from '../world/world';
import type { Ctx } from './context';
import { noOutline } from './outline';
import { idleAgentsIn, type IdleAgent } from './stations';

/** A map's world, with its court (on a castle-style map) and the board agents waiting in it. */
export interface MapWorld {
  world: World;
  court: Court | null;
  idle: IdleAgent[];
}

/** How far down there's anything to stand on, on a map of its own: its dungeon's floor, or the hall's. */
export const streetOf = (w: World) => w.dungeon?.plan.floor ?? 0;

/** The office's own map and the maps of their own, and which one the building's on. Needs ctx.office (and ctx.scene) made. */
export function createWorlds(ctx: Ctx) {
  const { office, scene } = ctx;
  const theOffice = officeWorld(office, () => office.stack.state.index > 0, () => officeWing());
  let world: World = theOffice;
  /** Whether the building's on the office's own map, with everything that has (the elevator, the balcony, the lounge…). */
  const inOffice = () => world === theOffice;
  /** Where everything is on the building's map: its seats by id, and places to sit. */
  const plan = (): MapPlan => store.floor === LOBBY ? LOBBY_PLAN : world.plan;
  /** On a castle-style map: its workers walking between their seats and the line for the throne. */
  let court: Court | null = null;
  /** The ones in the world you're in. */
  let idleAgents = idleAgentsIn(world);
  /** The board agents waiting at the office's kiosks (the ones made at the start). */
  const officeIdle = idleAgents;
  /** The worlds built for maps of their own, by map id, with the plan each was built from (a custom map can change). */
  const built = new Map<string, { plan: MapPlan; world: World; court: Court; idle: IdleAgent[] }>();

  /** The world for `p`: the office, or the one its style's builder puts up for it, the first time it's wanted. */
  function worldFor(p: MapPlan): MapWorld {
    if (p.style === 'office') return { world: theOffice, court: null, idle: officeIdle };
    let b = built.get(p.id);
    // A map of your own was edited since: it's built again.
    if (b && b.plan !== p) {
      scene.remove(b.world.group);
      b.world.dispose?.();
      for (const a of b.idle) a.model.dispose();
      built.delete(p.id);
      b = undefined;
    }
    if (!b) {
      const w = BUILDERS[p.style](p);
      w.group.visible = false;
      scene.add(w.group);
      noOutline(w.group);
      const ground = (x: number, z: number, y: number) => Math.max(groundAt(w.colliders, x, z, y), w.dungeon?.plan.floor ?? 0);
      b = { plan: p, world: w, court: new Court(w.group, p, w.nav, ground, (x, y, z) => ctx.sound.stepAt(x, z, y)), idle: idleAgentsIn(w) };
      built.set(p.id, b);
    }
    return b;
  }

  /**
   * How many rows the office's back office is built out where you are: the floor's plan in the office,
   * none on the roof or on a map of its own (its hall is its own shape).
   */
  function officeWing(): number {
    return inOffice() && store.floor !== ROOF ? store.floorPlan.wing : 0;
  }

  /** The top of whatever's underfoot at (x, z) for feet at `y`, in the world you're in: its floor, a step, the street. */
  const groundHere = (x: number, z: number, y: number) => Math.max(groundAt(world.colliders, x, z, y), ctx.player.street);

  return {
    /** The world the building's map is built as. */
    world: () => world,
    court: () => court,
    /** The board agents waiting by their boards in the world you're in. */
    idleAgents: () => idleAgents,
    inOffice,
    plan,
    officeWing,
    groundHere,
    worldFor,
    /** The building's on `next`'s map now (see applyMap in core/maps.ts, which takes the old one down). */
    enter(next: MapWorld) {
      world = next.world;
      court = next.court;
      idleAgents = next.idle;
    },
  };
}
