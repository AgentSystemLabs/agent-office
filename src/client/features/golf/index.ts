/**
 * Golf off the balcony: the tee (a club out, a swing, the camera following the ball), everyone's balls
 * in the air or lying where they stopped, and your records, kept in this browser.
 */
import { GOLF_HOLE } from '../../../shared/layout';
import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { Golfer } from './controller';
import { DESK_KEYS } from '../../interaction';
import { store } from '../../state';
import { clip, h, toast } from '../../ui/dom';
import { BACKSWING_TIME, IMPACT, type Person } from '../../world/character';
import { GolfBalls, PIN_DISTANCE, TEE_BALL, fly, pinText, type Flight, type Hit, type Shot } from './world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    golf: true;
  }
}

export interface GolfDeps {
  /** Up off whatever you're sitting on (see features/seating). */
  standUp(): void;
  /** Stops a walk over to someone, if you're on one. */
  stopWalking(): void;
  /** Puts your cigarette out, if you're on a smoke break (see features/smoke). */
  stopSmoking(): void;
  /** Someone else on your floor, as you see them. */
  personOf(id: string): Person | undefined;
}

export function installGolf(ctx: Ctx, deps: GolfDeps) {
  // Everyone's balls, in the air or lying where they stopped.
  const balls = new GolfBalls();
  ctx.scene.add(balls.group);
  /** Your closest shot to the pin so far (meters) and how many you've holed in one, kept in this browser. */
  const GOLF_KEY = 'agent-office.golf';
  function golfRecord(): { best: number | null; holes: number } {
    try {
      const r = JSON.parse(localStorage.getItem(GOLF_KEY) ?? '{}') as { best?: unknown; holes?: unknown };
      return { best: typeof r.best === 'number' ? r.best : null, holes: typeof r.holes === 'number' ? r.holes : 0 };
    } catch {
      return { best: null, holes: 0 };
    }
  }
  function saveGolfRecord(r: { best: number | null; holes: number }) {
    try {
      localStorage.setItem(GOLF_KEY, JSON.stringify(r));
    } catch {
      // private window: it's only for this visit then
    }
  }
  /** Until when (performance.now()) the tee has no ball on it: someone just hit it, and is teeing up the next. */
  let teeEmptyUntil = 0;
  /** A shot off the tee on this floor, by you or someone else: where it goes is worked out the same way everywhere. */
  function shotHere(shot: Shot): Flight {
    return fly(shot, ctx.player.street, ctx.office.stack.state.index);
  }
  const golf = new Golfer(ctx.player, ctx.me, ctx.camera, {
    holding: (on) => ctx.net.send({ t: 'act', golf: on }),
    hit: (shot) => {
      ctx.net.send({ t: 'golf', ...shot });
      balls.launch(shotHere(shot), store.profile.name, true);
      ctx.sound.golf('hit');
    },
    ball: () => balls.mine,
    street: () => ctx.player.street,
    done: () => ctx.hint.invalidate(),
  });
  ctx.activities.add({
    id: 'golf',
    active: () => golf.active,
    // The club goes back for anything but the office moving you off your floor (takenAway leaves it out).
    stop: (why) => {
      if (why !== 'taken') golf.stop();
    },
    // At the golf tee, E puts the club back (Space swings, see Golfer); nothing else is in reach, and no emotes mid-swing.
    key: (e) => {
      if (e.code !== 'KeyF' && e.code !== 'KeyG' && !(e.code in DESK_KEYS) && !/^(?:Digit|Numpad)[1-6]$/.test(e.code)) return false;
      if (e.code === 'KeyE') golf.stop();
      return true;
    },
    hint: (el) => renderGolfHint(el),
    takesCamera: true,
    hidesHands: true,
    // Both hands are on the club at the tee: no mug in them (see feelTheCoffee in core/loop.ts).
    bothHands: true,
  });
  ctx.ticks.add('play', ({ dt }) => {
    // Pulled away from the tee (sat down, off up the ladder, into the elevator): the club goes back.
    if (golf.active && (ctx.trip() || ctx.activities.running('hanger') || ctx.activities.running('climber') || ctx.player.seat || ctx.upTop())) golf.stop();
    golf.update(dt);
  });
  // The balls in the air (none up on the roof, where the darts are), and the next one on the tee.
  ctx.ticks.add('play', ({ dt, now }) => {
    balls.update(dt);
    ctx.office.tee.ball.visible = golf.doing !== 'watch' && now > teeEmptyUntil;
  });
  balls.onHit = (hit: Hit, mine: boolean) => {
    // Your own ball's heard wherever it lands (the camera's following it); anyone else's from where it is.
    const at = mine ? undefined : hit.at;
    if (hit.kind === 'cup') ctx.sound.golf('cup', at);
    else if (hit.kind === 'bounce') ctx.sound.golf(hit.lie === 'sand' || hit.lie === 'rough' ? 'thud' : 'bounce', at, hit.speed);
    else ctx.sound.golf(hit.kind, at, hit.speed);
  };
  balls.onRest = (f: Flight, who: string, mine: boolean) => {
    if (f.holed) {
      ctx.confetti.burst(GOLF_HOLE.x, ctx.player.street + 1.2, GOLF_HOLE.z, 260, 1.4);
      ctx.sound.golf('cheer');
    }
    if (!mine) {
      if (f.holed) toast(`🏆 ${who} got a hole in one!`);
      return;
    }
    const rec = golfRecord();
    if (f.holed) {
      rec.holes++;
      toast(rec.holes === 1 ? '🏆 HOLE IN ONE!' : `🏆 HOLE IN ONE! That's ${rec.holes}`);
    } else if (Number.isFinite(f.fromPin) && (rec.best === null || f.fromPin < rec.best)) {
      if (rec.best !== null) toast(`⛳ ${pinText(f.fromPin)} from the pin — your best yet!`);
      rec.best = f.fromPin;
    } else return;
    saveGolfRecord(rec);
  };

  /** Who's at the tee on this floor already, if anyone. */
  function teeTaken(): string | null {
    for (const p of store.peers.values()) if (p.id !== store.you && p.golfing && store.onMyFloor(p)) return p.name;
    return null;
  }

  /** E at the tee: take a club out and step up to the ball. */
  function teeOff() {
    if (golf.active || ctx.trip() || ctx.activities.running('climber')) return;
    const other = teeTaken();
    if (other) return toast(`🏌️ ${other} is on the tee — wait your turn`, 'warn');
    const carrying = ctx.carrying();
    if (carrying) return toast(`✋ Your hands are full: put #${carrying.issue} down first (Q)`, 'warn');
    if (ctx.player.seat) deps.standUp();
    ctx.activities.stopAll('start');
    deps.stopWalking();
    deps.stopSmoking();
    golf.start();
  }

  ctx.interactions.define('golf', {
    reach: 3.5,
    hint: () => {
      const other = teeTaken();
      if (other) return { k: `taken|${other}`, parts: [hintTitle('⛳ Golf tee'), aside(`🏌️ ${clip(other, 24)} is teeing off`)] };
      const { best, holes } = golfRecord();
      const about = [holes ? `🏆 ${holes} hole${holes === 1 ? '' : 's'} in one` : '', best !== null ? `your best ${pinText(best)} from the pin` : `the pin's ${Math.round(PIN_DISTANCE)} m out`].filter(Boolean).join(' · ');
      return { k: about, parts: [hintTitle('⛳ Golf tee'), aside(about), key('E', 'Tee off')] };
    },
    use: onE(() => teeOff()),
  });
  ctx.messages.on('golf', (msg) => theirShot(msg.id, { yaw: msg.yaw, loft: msg.loft, power: msg.power }));
  /** Someone else on the floor hit one: their swing, then their ball, off the same tee. */
  function theirShot(id: string, shot: Shot) {
    const p = store.peers.get(id);
    if (!p || !store.onMyFloor(p) || ctx.upTop()) return;
    deps.personOf(id)?.golfSwing(shot.power);
    const floor = store.floor;
    setTimeout(() => {
      if (store.floor !== floor || ctx.upTop()) return;
      balls.launch(shotHere(shot), p.name, false);
      teeEmptyUntil = performance.now() + 1800;
      ctx.sound.golf('hit', TEE_BALL);
    }, (BACKSWING_TIME + IMPACT) * 1000);
  }

  /** At the golf tee: how to aim and swing, or how to get back to it while the ball's out there. */
  function renderGolfHint(el: HTMLElement) {
    const title = (text: string) => h('span.title', {}, text);
    const stage = golf.doing;
    ctx.hint.draw(el, `golf|${stage}`, () =>
      stage === 'watch'
        ? [title('⛳ Fore!'), key('Space', 'Back to the tee'), key('E', 'Done')]
        : stage === 'charge' || stage === 'swing'
          ? [title('⛳ Let go to hit it'), aside('the fuller the meter, the further it goes')]
          : [key('Space', 'Hold to swing'), key('A D', 'Aim'), key('W S', 'Loft'), key('E', 'Done')],
    );
  }

  return { golf, balls };
}
