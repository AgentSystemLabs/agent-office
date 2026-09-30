/**
 * Sitting down: on a chair, a stool, the couch, the throne. Sitting there already, E gets you up, or
 * does what the seat's for (the TV from the couch, Minesweeper from the boss's chair, the bar's menu).
 */
import { seatPlace, type SeatDef, type SeatPlace } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import type { Arcade } from '../arcade/ui';
import { toast } from '../../ui/dom';
import type { Interactable } from '../../world/types';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    seat: true;
  }
}

export interface SeatingDeps {
  /** The screens shared on this floor, by who's sharing them (see features/voice). */
  shares(): [string, MediaStream][];
  /** Watches what's on the TV full screen (see features/voice). */
  watchShare(): void;
  /** The boss's monitor (see features/arcade). */
  arcade: Arcade;
  /** The bar's menu (see features/bar). */
  showBar(): void;
  /** What you can use where you are, and what's in the way of looking at it (see usable in input/pointer.ts). */
  usable(): (readonly Interactable[])[];
}

export function installSeating(ctx: Ctx, deps: SeatingDeps) {
  /** The free place on a seat nearest you, or null when everyone else on your floor has taken them all. */
  function freePlace(seat: SeatDef): SeatPlace | null {
    const taken = new Set<string>();
    for (const p of store.peers.values()) if (p.seat && p.id !== store.you && store.onMyFloor(p)) taken.add(p.seat);
    let best: SeatPlace | null = null;
    let bestD = Infinity;
    const player = ctx.player;
    for (let i = 0; i < seat.places.length; i++) {
      const place = seatPlace(seat, i);
      const d = Math.hypot(place.x - player.pos.x, place.z - player.pos.z);
      if (!taken.has(place.key) && d < bestD) {
        best = place;
        bestD = d;
      }
    }
    return best;
  }

  /** Someone else's screen is up on the TV. */
  function tvShowing(): boolean {
    return deps.shares().some(([who]) => who !== 'You');
  }

  /** E at a seat: sit down on it. Sitting there already, get up, or on the couch facing the TV, watch it. */
  function useSeat(seatId: string) {
    const seat = ctx.plan().seatingById.get(seatId);
    if (!seat) return;
    const player = ctx.player;
    if (player.seat?.seatId === seatId) {
      if (seat.tv && tvShowing()) deps.watchShare();
      else if (seat.game) deps.arcade.play();
      else if (seat.bar) deps.showBar();
      else standUp();
      return;
    }
    const place = freePlace(seat);
    if (!place) {
      toast(`No room on that ${seat.label.replace(/^\S+ /, '').toLowerCase()} right now`, 'warn');
      return;
    }
    player.sit(place);
    ctx.me.sit(place.hips);
    ctx.net.send({ t: 'sit', seat: place.key });
    // The couch in front of the TV is where you watch whoever's sharing.
    if (seat.tv && tvShowing()) deps.watchShare();
  }

  function standUp() {
    ctx.player.stand();
    gotUp();
  }
  ctx.messages.on('sit.refused', (msg) => {
    // Somebody on the floor got there first: back on your feet, next to them.
    if (ctx.player.seat?.key === msg.seat) {
      ctx.player.stand();
      // On your feet as far as everyone's concerned (the office still has you where you sat before).
      gotUp();
      toast(`${msg.by} got there first`, 'warn');
    }
  });

  /** On your feet again, by E or by walking off. */
  function gotUp() {
    ctx.me.sit(null);
    ctx.net.send({ t: 'sit' });
  }
  ctx.player.onStand = gotUp;

  /** What you're sitting on, so it's what E is about unless you're looking at something else. */
  function mySeat(): Interactable | null {
    const id = ctx.player.seat?.seatId;
    return (id && deps.usable()[0].find((it) => it.kind === 'seat' && it.seatId === id)) || null;
  }

  ctx.interactions.define('seat', {
    reach: 3,
    hint: (it) => {
      const seat = ctx.plan().seatingById.get(it.seatId ?? '');
      if (!seat) return { k: '', parts: [] };
      if (ctx.player.seat?.seatId === seat.id) {
        const tv = !!seat.tv && tvShowing();
        const use = tv ? 'Watch the TV' : seat.game ? 'Play Minesweeper' : seat.bar ? 'Order a drink' : '';
        return { k: `${seat.id}|sitting|${tv}`, parts: [hintTitle(seat.label), aside('sitting'), ...(use ? [key('E', use), key('W A S D', 'Get up')] : [key('E', 'Get up')])] };
      }
      const full = !freePlace(seat);
      return { k: `${seat.id}|${full}`, parts: [hintTitle(seat.label), seat.game ? aside('💣 Minesweeper on the monitor') : '', full ? aside('no room') : key('E', 'Sit down')] };
    },
    use: onE((it) => {
      if (it.seatId) useSeat(it.seatId);
    }),
  });

  return { freePlace, standUp, mySeat };
}
