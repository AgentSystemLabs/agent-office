// The ambient half of a wanderer's life (see features/workers/wander.ts): the lines over its head,
// where it goes when it fancies a change, what it does when it gets there — and the little social
// moments around it: a hello when paths cross, and congratulations when someone finishes a task.
import type { NavGrid, Pt } from '../../../shared/nav';
import { PERSONA_LINES, personaFor } from '../../../shared/personas';
import type { WorkerInfo } from '../../../shared/protocol';
import {
  applyVisit, pick, pickKind, spotLine, styled, type SpotKind,
} from '../../../shared/traits';
import { SPOTS, TONE_BG } from './spots';
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

interface Deps {
  roamers: Map<string, Roamer>;
  nav: () => NavGrid;
  worker: (id: string) => WorkerInfo | undefined;
  /** The wander clock, for bubble lifetimes and greet cooldowns. */
  now: () => number;
  stayFor: (c: Roamer, kind: SpotKind | undefined) => number;
  walkTo: (c: Roamer, target: Pt | null) => void;
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
    const kinds = [...new Set(options.map((s) => s.kind!))];
    const kind = pickKind(c.traits, c.needs, c.rng, c.lastKind, kinds);
    const ofKind = options.filter((s) => s.kind === kind);
    const spot = ofKind[Math.floor(c.rng() * ofKind.length)] ?? options[0];
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
