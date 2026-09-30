/**
 * Darts and axes at the rooftop bar: stepping up to the line, throws landing (yours and everyone's
 * up there) and chalked up on the board, and your best rounds, kept in this browser.
 */
import * as THREE from 'three';
import { ROUND, score, targetFrame, type BarGame, type Score, type Toss } from '../../../shared/bargames';
import type { Ctx, Hint } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { DESK_KEYS } from '../../interaction';
import { store } from '../../state';
import { Thrower } from './controller';
import { clip, h, toast } from '../../ui/dom';
import type { Person } from '../../world/character';
import type { Rooftop } from '../rooftop/world';

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    darts: true;
    axe: true;
  }
}

export interface BarGamesDeps {
  /** The roof, once it's built (see features/rooftop). */
  roof(): Rooftop | null;
  /** Up off whatever you're sitting on (see features/seating). */
  standUp(): void;
  /** Stops a walk over to someone, if you're on one. */
  stopWalking(): void;
  /** Someone else on your floor, as you see them. */
  personOf(id: string): Person | undefined;
}

export function installBarGames(ctx: Ctx, deps: BarGamesDeps) {
  /** Your best round at each (points), kept in this browser. */
  const THROW_KEY = 'agent-office.bargames';
  const throwBests: Partial<Record<BarGame, number>> = (() => {
    try {
      const r = JSON.parse(localStorage.getItem(THROW_KEY) ?? '{}') as Record<string, unknown>;
      const out: Partial<Record<BarGame, number>> = {};
      for (const g of ['darts', 'axe'] as BarGame[]) if (typeof r[g] === 'number') out[g] = r[g] as number;
      return out;
    } catch {
      return {};
    }
  })();
  function saveThrowBests() {
    try {
      localStorage.setItem(THROW_KEY, JSON.stringify(throwBests));
    } catch {
      // private window: it's only for this visit then
    }
  }
  /** The round being thrown at each game up here: whose, and what each throw of it has scored so far. */
  const rounds: Partial<Record<BarGame, { by: string; name: string; color: string; scores: Score[] }>> = {};
  const thrower = new Thrower(ctx.player, ctx.me, ctx.camera, ctx.canvas, {
    holding: (game) => ctx.net.send({ t: 'act', throwing: game }),
    toss: (toss, from, turn) => {
      ctx.net.send({ t: 'toss', ...toss });
      tossHere(store.you, toss, from, turn);
    },
    aim: (game, u, v) => deps.roof()?.games.aim(game, u, v),
    done: () => ctx.hint.invalidate(),
  });
  ctx.activities.add({
    id: 'thrower',
    active: () => thrower.active,
    // Back from the line for anything but the office moving you off your floor or the map changing (neither ever put the dart down).
    stop: (why) => {
      if (why !== 'taken' && why !== 'map') thrower.stop();
    },
    // At the dart board or the axe lane, E steps back (Space throws, see Thrower); nothing else is in reach, and no emotes mid-throw.
    key: (e) => {
      if (e.code !== 'KeyF' && e.code !== 'KeyG' && !(e.code in DESK_KEYS) && !/^(?:Digit|Numpad)[1-6]$/.test(e.code)) return false;
      if (e.code === 'KeyE') thrower.stop();
      return true;
    },
    hint: (el) => renderThrowHint(el),
    takesCamera: true,
    hidesHands: true,
  });

  ctx.ticks.add('play', ({ dt }) => {
    // Pulled away from the line (sat down, into the elevator): the dart or axe goes back.
    if (thrower.active && (ctx.trip() || ctx.activities.running('hanger') || ctx.activities.running('climber') || ctx.player.seat || !ctx.upTop())) thrower.stop();
    thrower.drunk = ctx.player.effects.sway;
    thrower.update(dt);
  });

  /** Who's at a game's line up here already, if anyone. */
  function lineTaken(game: BarGame): string | null {
    for (const p of store.peers.values()) if (p.id !== store.you && p.throwing === game && store.onMyFloor(p)) return p.name;
    return null;
  }

  /** E at the dart board or the axe lane: step up to the line with a dart (or an axe) in hand. */
  function stepUp(game: BarGame) {
    if (thrower.active || ctx.trip() || ctx.activities.running('climber')) return;
    const other = lineTaken(game);
    if (other) return toast(`${game === 'darts' ? '🎯' : '🪓'} ${other} is throwing — wait your turn`, 'warn');
    if (ctx.player.seat) deps.standUp();
    ctx.activities.stopAll('start');
    deps.stopWalking();
    thrower.start(game);
  }

  /** At the dart board or the axe lane: who's throwing, or your best round, and E to step up. */
  function throwHint(game: BarGame): Hint {
    const name = game === 'darts' ? '🎯 Darts' : '🪓 Axe throwing';
    const other = lineTaken(game);
    if (other) return { k: `taken|${other}`, parts: [hintTitle(name), aside(`${clip(other, 24)} is throwing`)] };
    const best = throwBests[game];
    const about = best !== undefined ? `your best round: ${best}` : game === 'darts' ? 'three darts a visit' : 'five axes a round';
    return { k: about, parts: [hintTitle(name), aside(about), key('E', game === 'darts' ? 'Step up to the oche' : 'Step up to the line')] };
  }
  ctx.interactions.define('darts', {
    reach: 4,
    hint: () => throwHint('darts'),
    use: onE(() => stepUp('darts')),
  });
  ctx.interactions.define('axe', {
    reach: 5.5,
    hint: () => throwHint('axe'),
    use: onE(() => stepUp('axe')),
  });

  /** What a throw says over the target as it lands. */
  function tossPop(game: BarGame, s: Score): string {
    if (game === 'darts') return s.points === 0 ? 'Miss' : s.label === 'Bull' ? 'BULL!' : s.label;
    return s.label === 'Killshot' ? 'KILLSHOT!' : s.label === 'Bull' ? 'BULLSEYE!' : s.points === 0 ? (s.label === 'Drop' ? 'Clank!' : '0') : `+${s.points}`;
  }

  /** A throw at a game up here, by you or anyone else: it flies, lands, and goes up on the chalkboard. */
  function tossHere(by: string, toss: Toss, from: THREE.Vector3, turn: number) {
    const r = deps.roof();
    if (!r || !ctx.upTop()) return;
    const { game } = toss;
    const mine = by === store.you;
    const peer = store.peers.get(by);
    let round = rounds[game];
    // A new round (or somebody else's): the last one's darts come out of the board first.
    if (toss.n === 1 || !round || round.by !== by) {
      r.games.clear(game);
      round = rounds[game] = { by, name: mine ? store.profile.name : (peer?.name ?? 'Someone'), color: mine ? store.profile.color : (peer?.color ?? '#8ecae6'), scores: [] };
      r.games.chalk(game, round);
      if (mine) thrower.setInfo('');
    }
    const it = round;
    ctx.sound.toss(game === 'darts' ? 'dart' : 'axe', from);
    r.games.launch(toss, from, turn, it.color, () => {
      const s = score(game, toss.u, toss.v, toss.stick);
      const at = r.games.point(game, toss.u, toss.v, new THREE.Vector3());
      ctx.sound.toss(game === 'darts' ? (s.label === 'Miss' ? 'wall' : 'board') : toss.stick ? 'thunk' : 'clank', at);
      // Somebody's next round started while this was on its way: it's still on the board, but not on theirs.
      if (rounds[game] !== it || it.scores.length >= ROUND[game]) return;
      it.scores.push(s);
      r.games.chalk(game, it);
      r.games.pop(game, tossPop(game, s), it.color);
      if (s.label === 'Killshot') {
        const f = targetFrame(game);
        ctx.sound.toss('cheer', at);
        ctx.confetti.burst(at.x + f.out.x * 0.3, at.y, at.z + f.out.z * 0.3, 90, 0.5);
      }
      const total = it.scores.reduce((a, x) => a + x.points, 0);
      const done = it.scores.length === ROUND[game];
      if (mine) thrower.setInfo(`${it.scores.map((x) => x.label).join(' · ')}  =  ${total}`);
      if (done) roundOver(game, it.name, mine, total);
    });
  }

  /** The last throw of a round landed: how it went, and a cheer for a great one. */
  function roundOver(game: BarGame, name: string, mine: boolean, total: number) {
    const great = game === 'darts' ? total === 180 : total >= 30;
    if (great) {
      const f = targetFrame(game);
      ctx.sound.toss('cheer', f);
      ctx.confetti.burst(f.x + f.out.x * 0.5, f.y + 0.4, f.z + f.out.z * 0.5, 200, 0.9);
    }
    const what = game === 'darts' ? (total === 180 ? 'ONE HUNDRED AND EIGHTY!' : `${total} with three darts`) : `${total} of 40 with five axes`;
    const icon = game === 'darts' ? '🎯' : '🪓';
    if (!mine) {
      if (great) toast(`${icon} ${name}: ${what}`);
      return;
    }
    const best = throwBests[game];
    const beat = best === undefined || total > best;
    if (beat) {
      throwBests[game] = total;
      saveThrowBests();
    }
    toast(`${icon} ${what}${beat && best !== undefined ? ' — your best yet!' : ''}`);
  }

  ctx.messages.on('toss', (msg) => theirToss(msg.id, { game: msg.game, u: msg.u, v: msg.v, stick: msg.stick, n: msg.n }));
  /** Someone else up here threw one: their arm goes, then it flies from their hand. */
  function theirToss(id: string, toss: Toss) {
    const p = store.peers.get(id);
    if (!p || !store.onMyFloor(p) || !ctx.upTop()) return;
    const person = deps.personOf(id);
    const release = (from: THREE.Vector3, turn: number) => tossHere(id, toss, from, turn);
    if (person) person.tossAuto(release);
    else release(new THREE.Vector3(p.x, p.y + 1.5, p.z), 0);
  }

  /** At the dart board or the axe lane: how to aim and throw, and how to step back. */
  function renderThrowHint(el: HTMLElement) {
    const stage = thrower.doing;
    ctx.hint.draw(el, `throw|${stage === 'wind'}`, () => (stage === 'wind' ? [h('span.title', {}, 'Let go in the green!')] : [key('Mouse', 'Aim'), key('Space', 'Hold to throw'), key('E', 'Step back')]));
  }

  // At the oche or the line, the view narrows onto the target.
  ctx.view.add({ fov: (fov) => (thrower.active ? thrower.fov : fov) });

  /** Up on the roof again: whatever was thrown up there while you were away, you didn't see, so the boards start clean. */
  function freshBoards(r: Rooftop) {
    for (const g of ['darts', 'axe'] as BarGame[]) {
      r.games.clear(g);
      r.games.chalk(g, null);
      delete rounds[g];
    }
  }

  return { thrower, freshBoards };
}
