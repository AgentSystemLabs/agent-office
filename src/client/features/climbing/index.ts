/**
 * The ladder and the fire poles between floors: up or down the ladder through the hatches, down a pole
 * (a twirl round it on the bottom floor), and what that does to your view on the way.
 */
import * as THREE from 'three';
import { LADDER, POLE, POLES, WALL_HEIGHT } from '../../../shared/layout';
import type { FloorInfo } from '../../../shared/protocol';
import { Climber, type Arrival, type Grip, type Way } from './controller';
import type { Ctx } from '../../core/context';
import { builtFloors } from '../../core/floors';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { DESK_KEYS } from '../../interaction';
import { store } from '../../state';
import { $, h, toast } from '../../ui/dom';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    ladder: true;
    pole: true;
  }
}

export interface ClimbingDeps {
  /** Through the ceiling up the ladder, or through the floor down one (see travel in core/travel.ts). */
  travel(floorId: string, how: Grip, at: Arrival): void;
  /** Up off whatever you're sitting on (see features/seating). */
  standUp(): void;
  /** Stops a walk over to someone, if you're on one. */
  stopWalking(): void;
}

export function installClimbing(ctx: Ctx, deps: ClimbingDeps) {
  const { office } = ctx;
  /** The floor above yours (1) or below it (-1), if there is one. */
  function floorThere(way: Way): FloorInfo | undefined {
    const floors = builtFloors();
    const i = floors.findIndex((f) => f.id === store.floor);
    return i < 0 ? undefined : floors[i + way];
  }
  const climber = new Climber(ctx.player, {
    floorThere: (way) => floorThere(way)?.name,
    travel: (way, how, at) => {
      const f = floorThere(way);
      if (f) deps.travel(f.id, how, at);
      else climber.abort();
    },
    sound: (kind, speed = 0) => {
      const sound = ctx.sound;
      if (kind === 'grab') sound.rung(true);
      else if (kind === 'rung') sound.rung();
      else if (kind === 'slide') sound.slide();
      else if (kind === 'twirl') sound.twirl();
      else if (kind === 'bonk') {
        sound.bonk();
        toast(`🔝 ${store.currentFloor()?.name ?? 'This'} is the top floor — the hatch won't budge`);
      } else if (kind === 'land') {
        sound.poleLanding(speed);
        landed(speed);
      }
    },
    done: () => ctx.hint.invalidate(),
  });
  ctx.activities.add({
    id: 'climber',
    active: () => climber.active,
    // Off the ladder or the pole for anything but walking over to someone (that waits till you're off, see walkTick).
    stop: (why) => {
      if (why !== 'walk') climber.abort();
    },
    // On the ladder, E gets you off it (and nothing else is in reach); W, S and Space climb.
    key: (e) => {
      if (e.code !== 'KeyE' && e.code !== 'KeyF' && !(e.code in DESK_KEYS)) return false;
      if (e.code === 'KeyE') climber.letGo();
      return true;
    },
    hint: (el) => renderClimbHint(el),
  });
  /** Down the pole onto the mat: the view shakes, dust flies, and there's the floor you're on now. */
  function landed(speed: number) {
    ctx.shake(Math.min(1, speed / 7), true);
    const at = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const player = ctx.player;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      at.set(player.pos.x + Math.sin(a) * 0.3, player.pos.y + 0.08, player.pos.z + Math.cos(a) * 0.3);
      ctx.smoke.exhale(at, dir.set(Math.sin(a), 0.15, Math.cos(a)).normalize());
    }
    const f = store.currentFloor();
    toast(`🚒 Wheee! Down to ${f?.name ?? 'the floor below'}`);
  }
  office.stack.onHatch = (where, open) => ctx.sound.hatch({ x: LADDER.x + 0.3, y: where === 'floor' ? 0 : WALL_HEIGHT, z: LADDER.z }, open);
  // Speed lines round the edge of the screen, sliding down a pole.
  const whoosh = h('div', { id: 'whoosh' });
  $('app').append(whoosh);

  /** E at the ladder: onto it, facing the wall. */
  function grabLadder() {
    if (ctx.trip() || climber.active) return;
    if (!floorThere(1) && !floorThere(-1)) return toast('No other floors yet — add a project in the elevator', 'warn');
    if (ctx.player.seat) deps.standUp();
    ctx.activities.stopAll('start');
    deps.stopWalking();
    climber.grabLadder();
  }

  /** E at a fire pole: down it, if there's a floor below; else (on the bottom floor) a spin round it. */
  function usePole(i: number) {
    const spot = POLES[i];
    if (ctx.trip() || climber.active || !spot) return;
    if (ctx.player.seat) deps.standUp();
    ctx.activities.stopAll('start');
    deps.stopWalking();
    if (office.stack.polesGoDown()) climber.slide(spot);
    else climber.twirl(spot);
  }
  // Before the cars get a go at you (see their 'moved' tick): a car only shoves you down at the street, never at a pole's hole up on a floor.
  ctx.ticks.add('moved', () => {
    const player = ctx.player;
    // Walked into a pole's hole: you grab the pole on your way down it.
    const hole = ctx.inOffice() && office.stack.polesGoDown() ? office.stack.poles().find((s) => Math.hypot(player.pos.x - s.x, player.pos.z - s.z) < POLE.hole - 0.15) : undefined;
    if (hole && !climber.active && !ctx.trip() && !player.seat && player.enabled && player.pos.y > -1.35 && player.pos.y < 0.6) climber.slide(hole);
  });

  ctx.interactions.define('ladder', {
    reach: 3,
    hint: () => {
      const up = floorThere(1)?.name;
      const down = floorThere(-1)?.name;
      const where = [up && `⬆ ${up}`, down && `⬇ ${down}`].filter(Boolean).join(' · ');
      return { k: where, parts: [hintTitle('🪜 Ladder'), aside(where || 'no other floors yet'), key('E', 'Climb on')] };
    },
    use: onE(() => grabLadder()),
  });
  ctx.interactions.define('pole', {
    reach: 4,
    hint: () => {
      if (office.stack.polesGoDown()) {
        const down = floorThere(-1)?.name ?? 'the floor below';
        return { k: `down|${down}`, parts: [hintTitle('🚒 Fire pole'), aside(`down to ${down}`), key('E', 'Slide down!')] };
      }
      const up = floorThere(1)?.name ?? 'upstairs';
      return { k: `landing|${up}`, parts: [hintTitle('🚒 Fire pole'), aside(`comes down from ${up}`), key('E', 'Twirl')] };
    },
    use: onE((it) => {
      if (it.pole !== undefined) usePole(it.pole);
    }),
  });

  /** On the ladder: which way it goes from here, and how to get off. Down a pole: just hold on. */
  function renderClimbHint(el: HTMLElement) {
    const title = (text: string) => h('span.title', {}, text);
    const l = climber.ladder;
    let k: string;
    let parts: (HTMLElement | string)[];
    if (l) {
      const up = floorThere(1)?.name;
      const down = floorThere(-1)?.name;
      const atFloor = l.y < 0.4 && l.y > -0.05;
      const busy = l.waiting || l.auto;
      k = `ladder|${up}|${down}|${atFloor}|${busy}`;
      parts = busy
        ? [title('🪜 Climbing…')]
        : [title('🪜 On the ladder'), up ? key('W', `Up to ${up}`) : aside('top floor'), key('S', down ? `Down to ${down}` : atFloor ? 'Step off' : 'Down'), key('E', atFloor ? 'Step off' : 'Let go')];
    } else {
      const how = climber.sliding;
      k = `pole|${how}`;
      parts = [title(how === 'twirl' ? '🚒 Wheee!' : '🚒 Wheeeeeee!')];
    }
    ctx.hint.draw(el, k, () => parts);
  }

  /** How fast you're sliding down a pole, 0 to 1: none when the system asks for less motion. */
  const rush = () => (ctx.reduceMotion.matches ? 0 : climber.rush);
  ctx.view.add({
    // On the ladder or a pole, you're drawn holding on to it (and the hatches open for you).
    grip: () => climber.grip,
    // Down a pole: the view widens and the edges streak past.
    fov: (fov) => fov + rush() * 16,
    update: () => {
      const r = rush();
      whoosh.style.opacity = r > 0.02 ? String(r * 0.85) : '0';
    },
  });

  return { climber };
}
