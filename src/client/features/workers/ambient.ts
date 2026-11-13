// The ambient half of a wanderer's life (see features/workers/wander.ts): the lines over its head,
// where it goes when it fancies a change, what it does when it gets there — and the little social
// moments around it: a hello when paths cross, and congratulations when someone finishes a task.
import type { NavGrid, Pt } from '../../../shared/nav';
import { PERSONA_LINES, personaFor } from '../../../shared/personas';
import type { WorkerInfo } from '../../../shared/protocol';
import {
  applyVisit, pick, pickKind, spotLine, styled, type SpotKind,
} from '../../../shared/traits';
import { SPOTS, TONE_BG, type Spot } from './spots';
import { spotTaken } from './crowd';
import type { Roamer } from './roamer';
import { store } from '../../state';
import { disposeSprite, textSprite } from '../../world/toon';

/** How close someone has to be, still out and about, to hear the news. */
const CHEER_REACH = 7;
/** Two walkers this close (and this often at most) say hi without stopping. */
const GREET_REACH = 1.5;
const GREET_EVERY = 25;
/** Seconds a pass-by hello stays up. */
const GREET_SECS = 1.6;
const LINE_SECS = 2.6;

/** What it says when it clocks a coworker walking past. */
const GREET = ['¡eh!', 'buenas', 'cómo vas', '¿todo bien?', 'qué tal', 'ahí va la competencia', '*choca el hombro*'];
/** What it says when someone nearby just finished something. */
const CHEER = ['¡bien hecho!', '¡por fin!', 'ese era tuyo', '¡qué buena!', 'merecido', '¡así se hace!', 'cuéntame cómo lo lograste'];
/** What it asks the coworker nearest to it, now and then, while it's standing about. */
const ASK = ['¿viste eso?', '¿tú también odias los lunes?', '¿qué opinas del último PR?', '¿ya probaste el café nuevo?', '¿cómo va esa tarea?', '¿me recomiendas ese spot?'];
/** How it answers, when it feels like it. */
const ANSWER = ['jaja, total', 'ni me digas', 'buen punto', 'la verdad, ni idea', 'cuéntame más', 'tienes razón', 'eso pensé yo también'];

interface Deps {
  roamers: Map<string, Roamer>;
  nav: () => NavGrid;
  worker: (id: string) => WorkerInfo | undefined;
  /** The wander clock, for bubble lifetimes and greet cooldowns. */
  now: () => number;
  stayFor: (c: Roamer, kind: SpotKind | undefined) => number;
  walkTo: (c: Roamer, target: Pt | null) => void;
  /** How `a` feels about `b`, -1 (rivals) to 1 (friends) — the office's social map (wander.ts). */
  affinityOf: (a: string, b: string) => number;
  /** A small warm feeling between two workers (a question answered kindly warms the pair a touch). */
  warm?: (a: string, b: string) => void;
}

export class Ambient {
  constructor(private d: Deps) {}

  /** The lines its persona says (empty for shells and persona-less desks). */
  personaLines(c: Roamer): readonly string[] {
    const w = this.d.worker(c.id);
    const persona = w?.kind === 'agent' ? personaFor(store.project?.dir, c.desk.def.id) : undefined;
    return (persona && PERSONA_LINES[persona.id]) || [];
  }

  /** A line over its head for a turn or so, in its own colours. */
  say(c: Roamer, text: string, secs = LINE_SECS) {
    this.dropBubble(c);
    const sprite = textSprite(text, { bg: TONE_BG[c.traits.tone], color: '#fffaf3', size: 30 });
    sprite.position.set(0, 2.1, 0);
    c.model.root.add(sprite);
    c.bubble = { sprite, until: this.d.now() + secs };
  }

  dropBubble(c: Roamer) {
    if (!c.bubble) return;
    c.model.root.remove(c.bubble.sprite);
    disposeSprite(c.bubble.sprite);
    delete c.bubble;
  }

  /** It finished a task: whoever's out and about nearby says so, and the cheerful ones hop. */
  cheerFor(finished: Roamer) {
    const fp = finished.model.root.position;
    for (const c of this.d.roamers.values()) {
      if (c === finished || c.state === 'seated' || c.state === 'chat' || c.bubble) continue;
      if (c.model.root.position.distanceTo(fp) > CHEER_REACH) continue;
      if (c.rng() > 0.25 + 0.6 * c.traits.sociability) continue;
      this.say(c, styled(c.traits, pick(c.rng, CHEER), c.rng));
      if (c.rng() < 0.3 + 0.5 * c.traits.energy) c.model.celebrate();
    }
  }

  /**
   * Two workers' paths crossed: the keener one says hi on the move — no stopping, no hard
   * feelings, just an office being an office. At most once in a while per pair.
   */
  passBy(a: Roamer, b: Roamer) {
    const now = this.d.now();
    if (now - a.lastGreet < GREET_EVERY || now - b.lastGreet < GREET_EVERY) return;
    if (a.bubble || b.bubble || a.state !== 'walk' || b.state !== 'walk') return;
    const sociable = (a.traits.sociability + b.traits.sociability) / 2;
    if (Math.max(a.rng(), b.rng()) > 0.2 + 0.7 * sociable) return;
    const speaker = a.traits.sociability >= b.traits.sociability ? a : b;
    this.say(speaker, styled(speaker.traits, pick(speaker.rng, GREET), speaker.rng), GREET_SECS);
    speaker.lastGreet = now;
  }

  /**
   * It asks the coworker nearest to it something, now and then — the question hangs over its own
   * head, and whoever heard it can answer on their next aside (see answerHeard).
   */
  askAround(c: Roamer) {
    let best: Roamer | undefined;
    let bd = 3.5;
    for (const o of this.d.roamers.values()) {
      if (o === c || o.state === 'seated' || o.bubble) continue;
      const d = c.model.root.position.distanceTo(o.model.root.position);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    if (!best) return;
    best.heard = { from: c.id, until: this.d.now() + 7 };
    this.say(c, styled(c.traits, pick(c.rng, ASK), c.rng));
  }

  /** It answers a question someone just asked it, when it feels like it — and the pair warms a touch. */
  answerHeard(c: Roamer): boolean {
    const h = c.heard;
    c.heard = undefined;
    if (!h || this.d.now() >= h.until || c.bubble) return false;
    if (c.rng() > 0.3 + 0.6 * c.traits.sociability) return false;
    this.say(c, styled(c.traits, pick(c.rng, ANSWER), c.rng));
    this.d.warm?.(h.from, c.id);
    return true;
  }

  /** Idle long enough: hops down and walks to a haunt it fancies right now. */
  goOut(c: Roamer) {
    const nav = this.d.nav();
    // Somewhere it isn't already, nobody else has claimed, and that the floor plan can reach.
    const here = c.state === 'seated' ? null : c.spot;
    const options = SPOTS.filter(
      (s) => nav.walkable(s.x, s.z)
        && !(here && Math.hypot(s.x - here.x, s.z - here.z) < 1.2)
        && !spotTaken(this.d.roamers.values(), c, s.x, s.z),
    );
    if (!options.length) {
      c.timer = 10 + c.rng() * 50;
      return;
    }
    // Social initiative: now and then it goes looking for whoever it gets on with, and where it
    // lands leans toward friends and crowds, away from rivals.
    let friendKind: SpotKind | undefined;
    let best = 0;
    for (const o of this.d.roamers.values()) {
      if (o === c || o.state === 'seated' || !o.spot?.kind) continue;
      const a = this.d.affinityOf(c.id, o.id);
      if (a > best) {
        best = a;
        friendKind = o.spot.kind;
      }
    }
    let kinds = [...new Set(options.map((s) => s.kind!))];
    if (best > 0.35 && friendKind && kinds.includes(friendKind) && c.rng() < 0.4 * c.traits.sociability * (0.5 + c.needs.social)) kinds = [friendKind];
    const kind = pickKind(c.traits, c.needs, c.rng, c.lastKind, kinds);
    const ofKind = options.filter((s) => s.kind === kind);
    const pool = ofKind.length ? ofKind : options;
    // Each spot scores by who's near it: friends pull, rivals push away, a crowd calls to the lonely.
    const score = (s: Spot): number => {
      let w = 1;
      for (const o of this.d.roamers.values()) {
        if (o === c || o.state === 'seated') continue;
        const p = o.model.root.position;
        const d = Math.hypot(p.x - s.x, p.z - s.z);
        if (d > 9) continue;
        const a = this.d.affinityOf(c.id, o.id);
        if (a > 0.35) w += a * 1.6 * (1 - d / 9);
        else if (a < -0.25 && d < 3) w *= 0.15;
        else if (c.needs.social > 0.55 && d < 4) w += 0.4;
      }
      return w;
    };
    let total = 0;
    const weights = pool.map((s) => (total += score(s)));
    let r = c.rng() * total;
    const spot = pool[weights.findIndex((w) => (r -= w) <= 0)] ?? pool[0];
    // Each worker stands or sits its own little way: a jittered spot nobody else claimed (a tighter
    // jitter on furniture, where the places are closer together), so two at the couch don't overlap.
    const spread = spot.seat !== undefined ? 0.4 : 0.9;
    let x = spot.x;
    let z = spot.z;
    for (let tries = 0; tries < 4; tries++) {
      // Keep the last walkable cell even if it's taken: the nav grid can collapse different jitters
      // onto the same point, and separate() sorts out whoever ends up too close.
      const [jx, jz] = nav.nearestWalkable([spot.x + (c.rng() - 0.5) * spread, spot.z + (c.rng() - 0.5) * spread]);
      x = jx;
      z = jz;
      if (!spotTaken(this.d.roamers.values(), c, jx, jz)) break;
    }
    c.spot = { ...spot, x, z };
    c.timer = this.d.stayFor(c, spot.kind);
    this.d.walkTo(c, [x, z]);
  }

  /** It's reached a haunt: eases a need, says something about the place, and reacts the way it would. */
  arrive(c: Roamer) {
    const kind = c.spot?.kind;
    if (kind) {
      applyVisit(c.needs, kind);
      if (c.rng() < 0.55) this.say(c, spotLine(c.traits, kind, c.rng));
      // The arcade and the DJ booth get real excitement; everything else a happy hop now and then.
      if (kind === 'arcade' || kind === 'dj' || kind === 'jukebox') c.model.celebrate();
      else if (c.rng() < 0.3 + 0.3 * c.traits.energy) c.model.celebrate();
    }
    c.asideIn = 3 + c.rng() * 5;
  }
}
