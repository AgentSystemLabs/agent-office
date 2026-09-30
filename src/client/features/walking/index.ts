/**
 * Walking over to someone (clicked in the sidebar, or in the palette), riding the elevator first if
 * they're on another floor; and walking over to something to use it (Shift+Enter in the palette).
 * A key of yours takes over.
 */
import { seatOn } from '../../../shared/maps';
import type { PeerInfo } from '../../../shared/protocol';
import type { Ctx } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { closeAllModals, toast } from '../../ui/dom';
import { wayTo } from './walkto';

/** Near enough to talk: where a walk over to someone ends. */
const NEAR_ENOUGH = 1.6;

/** Registers the walk's own tick ('steer'), and takes the player's path ends. */
export function installWalking(ctx: Ctx, core: CoreState, parts: Pick<Parts, 'worlds' | 'travel' | 'cars' | 'seating' | 'climbing'>) {
  const { player } = ctx;
  const { plan, inOffice, officeWing } = parts.worlds;
  /** Who you're on your way to (clicked in the sidebar), and when to look again at where they've got to. */
  let walkingTo: { id: string; replanAt: number } | null = null;

  /** Walks you over to a teammate, riding the elevator first if they're on another floor. A key of yours takes over. */
  function walkTo(id: string) {
    const p = store.peers.get(id);
    if (!p || id === store.you) return;
    if (p.lite) return void toast(`📱 ${p.name} is on the 2D view, not anywhere in the office itself`);
    if (!store.onMyFloor(p) && !p.floor) return;
    if (!parts.cars.getOut()) return;
    if (player.seat) parts.seating.standUp();
    ctx.activities.stopAll('walk');
    errand = null;
    walkingTo = { id, replanAt: 0 };
    if (store.onMyFloor(p)) toast(`🚶 Walking over to ${p.name}`);
    else {
      toast(`🛗 Taking the elevator to ${p.name}, on the ${store.floors.find((f) => f.id === p.floor)?.name ?? 'other'} floor`);
      parts.travel.ride(p.floor!, true);
    }
  }

  function stopWalking() {
    walkingTo = null;
    player.stopWalking();
  }

  /** Stops the walk over to someone, if you're on one: what starting anything else does first. */
  function stopWalkingTo() {
    if (walkingTo) stopWalking();
  }

  /** Where they are, sitting or standing. */
  function whereIs(p: PeerInfo): { x: number; y: number; z: number } {
    return parts.cars.rideOf(p.id) ?? ((p.seat && seatOn(plan(), p.seat)) || p);
  }

  /** There: stop, and turn to them. */
  function arrivedAt(at: { x: number; z: number }) {
    stopWalking();
    const yaw = Math.atan2(at.x - player.pos.x, at.z - player.pos.z);
    player.facing = yaw;
    player.camYaw = yaw - Math.PI;
  }

  /** Each frame: keep heading for them, looking again every so often in case they've moved on. */
  function walkTick(now: number) {
    if (!walkingTo || core.trip || parts.climbing.climber.active || parts.cars.driver.active || !player.enabled) return;
    // Sitting down on the way is stopping there.
    if (player.seat) return stopWalking();
    const p = store.peers.get(walkingTo.id);
    if (!p || !store.onMyFloor(p)) {
      toast(p ? `${p.name} left the floor before you got there` : 'They left the office', 'warn');
      return stopWalking();
    }
    const at = whereIs(p);
    if (Math.hypot(at.x - player.pos.x, at.z - player.pos.z) < NEAR_ENOUGH && Math.abs(at.y - player.pos.y) < 1) return arrivedAt(at);
    if (now < walkingTo.replanAt) return;
    walkingTo.replanAt = now + 800;
    // Round the office's rooms and up its stairs; on a map of its own, round what's in the way on its floor.
    player.walkPath(inOffice() ? wayTo(player.pos, at, officeWing()) : ctx.world().nav.route([player.pos.x, player.pos.z], [at.x, at.z]).slice(1).map(([x, z]) => ({ x, z })));
  }

  ctx.ticks.add('steer', ({ now }) => walkTick(now));

  player.onPathEnd = (why) => {
    if (errand) return errandEnd(why);
    if (!walkingTo) return;
    if (why === 'cancelled') return void (walkingTo = null);
    const p = store.peers.get(walkingTo.id);
    if (!p) return stopWalking();
    const at = whereIs(p);
    // As near as the way goes (they're behind a desk, or on the couch): that'll do.
    if (Math.hypot(at.x - player.pos.x, at.z - player.pos.z) < 3) return arrivedAt(at);
    if (why === 'stuck') {
      toast(`🚧 Couldn't find a way over to ${p.name}`, 'warn');
      stopWalking();
    } else walkingTo.replanAt = 0;
  };

  // ---- Walking over to something, then using it (Shift+Enter in the palette) -----------------------
  /** What you're on your way to (see walkThen): where to stand, what it's called, what to turn to and what to do there. */
  let errand: { at: { x: number; z: number }; what: string; face?: { x: number; z: number }; then: () => void } | null = null;

  /**
   * Walks you over to `at` on this floor and does `then` when you get there, as if you'd walked up
   * and pressed E. Where there's no walking to be done (up on the roof, riding the elevator, on the
   * ladder, driving a car) it just does it. A key of yours takes over, and then it doesn't happen.
   */
  function walkThen(at: { x: number; y?: number; z: number }, what: string, then: () => void, face?: { x: number; z: number }) {
    if (core.upTop || core.trip || ctx.activities.running('climber') || ctx.activities.running('driver')) return then();
    closeAllModals();
    if (player.seat) parts.seating.standUp();
    ctx.activities.stopAll('errand');
    if (walkingTo) stopWalking();
    errand = { at, what, face, then };
    toast(`🚶 Walking over to ${what}`);
    const to = { x: at.x, y: at.y ?? 0, z: at.z };
    // As walkTick does: round the office's rooms (and its back office), or round what's in the way on a map of its own.
    player.walkPath(inOffice() ? wayTo(player.pos, to, officeWing()) : ctx.world().nav.route([player.pos.x, player.pos.z], [to.x, to.z]).slice(1).map(([x, z]) => ({ x, z })));
  }

  function errandEnd(why: 'arrived' | 'cancelled' | 'stuck') {
    const e = errand!;
    errand = null;
    if (why === 'cancelled') return;
    if (why === 'stuck') toast(`🚧 Couldn't find a way over to ${e.what}, so here it is from where you are`, 'warn');
    else if (e.face) arrivedAt(e.face);
    else stopWalking();
    e.then();
  }

  return { walkTo, stopWalkingTo, walkThen };
}
