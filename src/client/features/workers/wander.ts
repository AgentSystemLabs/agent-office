import * as THREE from 'three';
import type { NavGrid, Pt } from '../../../shared/nav';
import { PERSONA_LINES, personaFor } from '../../../shared/personas';
import type { WorkerInfo } from '../../../shared/protocol';
import { isBusy } from '../../../shared/status';
import {
  applyVisit, chatLine, chatOutcome, freshNeeds, makeRng, mutter, pick, pickKind, relation, spotLine, styled, tickNeeds,
  type Needs, type Rng, type SpotKind, type Tone, type Traits, traitsFor,
} from '../../../shared/traits';
import { SPOTS, TONE_BG, type Spot } from './spots';
import { MindChats } from './mind-client';
import { separate, spotTaken } from './crowd';
import { store } from '../../state';
import { disposeSprite, textSprite } from '../../world/toon';
import type { Worker } from '../../world/character';
import type { DeskView } from '../../world/types';

/*
 * Office workers with nothing to do getting up and living a little. Every worker is dealt its own
 * character (shared/traits.ts) from a seed of floor + desk + its own id, so a fresh hire is always a
 * different person: how restless, how sociable, how patient, how fast it walks, how it talks, where
 * it likes to hang out, and a small quirk. Idle workers build up needs (fun, company, calm), pick a
 * haunt that answers them, do something there, mutter to themselves, bump into each other, chat in
 * their own voice (and their persona's), and remember who they get on with. The moment a worker has
 * work again (or needs you) it turns for home.
 */

/** Walking pace (m/s). */
const WALK = 2.4;
/** Seconds hopping down off its seat, or up onto it. */
const HOP = 0.5;
/** A worker's feet are this far above its origin (see features/workers/leaving.ts). */
const FEET = 0.07;
/** Base waits (s); each worker's energy and patience stretch or shrink them. */
const LEAVE_MIN = 10;
const LEAVE_SPAN = 50;
const STAY_MIN = 8;
const STAY_SPAN = 28;
/** How often it looks around for someone to stop and chat with, and how far apart they can be. */
const CHAT_EVERY = 7;
const CHAT_REACH = 20;
/** Seconds each line stays up. */
const LINE_SECS = 2.6;

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Frame-rate independent smoothing: the same feel at 30, 60 or 144 fps. */
const smooth = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);
/** How fast it turns while walking (rad/s), in its hops, and facing its spot; and how fast its feet find the floor. */
const TURN_RATE = 11;
const HOP_TURN = 10;
const FACE_RATE = 8;
const GROUND_RATE = 14;

/** What it says when it clocks you wandering past. */
const HELLO = ['¡hola!', 'tú otra vez', 'hola, vecino', '*saluda*', '¿necesitas algo?', 'qué bonito día'];

type State = 'seated' | 'down' | 'walk' | 'linger' | 'chat' | 'up';

interface Roamer {
  id: string;
  model: Worker;
  desk: DeskView;
  /** Who it is: dealt from a seed when it's hired, and its own generator from then on. */
  traits: Traits;
  rng: Rng;
  needs: Needs;
  state: State;
  /** Where it's off to: a spot in SPOTS, a chat rendezvous, or its seat. */
  spot: Spot | null;
  /** Walking to a chat rendezvous: who it's meeting (cleared on arrival). */
  chatWith?: string;
  /** Mid-chat: who it's with, when it started (synced with the partner's), the last turn shown, how many turns, how long it's waited for the partner, and what it said. */
  chat?: { partner: string; start: number; seen: number; turns: number; wait: number; said: string[] };
  /** A line over its head right now, and when it comes down. */
  bubble?: { sprite: THREE.Sprite; until: number };
  /** Seconds until its next aside (a mutter, a hum) while it's standing about. */
  asideIn: number;
  /** The kind of haunt it was at last, so it doesn't just go back. */
  lastKind: SpotKind | null;
  /** How seated it is, 0 standing to 1 sunk into the furniture (see the end of step). */
  sit: number;
  way: Pt[];
  next: number;
  hop: number;
  from: THREE.Vector3;
  heading: number;
  stepIn: number;
  /** Seconds it has left before it goes (seated) or comes home (lingering). */
  timer: number;
  /** Its status last tick, so a finished task can be told to the mind. */
  lastStatus?: string;
}

export class Wander {
  private roamers = new Map<string, Roamer>();
  private readonly tmp = new THREE.Vector3();
  /** Where everyone out and about is standing, for whatever asks (the same list each time). */
  private readonly out: THREE.Vector3[] = [];
  /** How each pair feels about the other, -1 (rivals) to 1 (friends), remembered while they're here. */
  private readonly affinity = new Map<string, number>();
  /** The office mind's scripts per pair (see mind-client.ts); procedural lines cover any miss. */
  private readonly mind: MindChats;
  private clock = 0;
  private chatIn = CHAT_EVERY;

  constructor(
    private parent: THREE.Object3D,
    private nav: () => NavGrid,
    /** The top of whatever is underfoot at (x, z) for feet at `y`. */
    private ground: (x: number, z: number, y: number) => number,
    private footstep: (x: number, y: number, z: number) => void,
    private worker: (id: string) => WorkerInfo | undefined,
    /** Where you are, so a worker out about can say hi (optional). */
    private playerAt?: () => { x: number; y: number; z: number },
  ) {
    this.mind = new MindChats(worker, () => store.project?.dir ?? '');
  }

  /** A worker sitting at `desk` now: it's dealt a character and starts its own count down to wandering off. */
  add(id: string, model: Worker, desk: DeskView) {
    // Floor + desk + the worker's own id: each hire, even at the same desk, is someone new.
    const traits = traitsFor(`${store.project?.dir ?? ''}|${desk.def.id}|${id}`);
    const rng = makeRng(traits.seed ^ 0x9e3779b9);
    const c: Roamer = {
      id, model, desk, traits, rng, needs: freshNeeds(rng), state: 'seated', spot: null, asideIn: 0, lastKind: null, sit: 0,
      way: [], next: 0, hop: 0, from: new THREE.Vector3(), heading: 0, stepIn: 0, timer: 0,
    };
    c.timer = this.leaveWait(c);
    this.roamers.set(id, c);
  }

  /** The character a worker was dealt (for panels), if it's here. */
  traitsOf(id: string): Traits | undefined {
    return this.roamers.get(id)?.traits;
  }

  /** Stops `id` wandering about (it's gone, or being sent home), leaving its model wherever it is. Where it stood, if it was out. */
  release(id: string): Pt | undefined {
    const c = this.roamers.get(id);
    if (!c) return undefined;
    this.roamers.delete(id);
    c.model.walking = false;
    c.model.gait = 1;
    this.dropBubble(c);
    if (c.state === 'seated') return undefined;
    const p = c.model.root.position;
    return [p.x, p.z];
  }

  /** Whether `id` is up out of its seat. */
  away(id: string): boolean {
    const c = this.roamers.get(id);
    return !!c && c.state !== 'seated';
  }

  /** Everyone out and about, for the doors to open (the same list each time, to save making one a frame). */
  positions(): THREE.Vector3[] {
    this.out.length = 0;
    for (const c of this.roamers.values()) if (c.state !== 'seated') this.out.push(c.model.root.position);
    return this.out;
  }

  /** The map changed or the floor's gone: nobody's wandering any more (their models are someone else's problem now). */
  clear() {
    this.roamers.clear();
    this.affinity.clear();
  }

  /** Whether it has nothing on: idle or done, awake, here, and not in a meeting. */
  private free(c: Roamer): boolean {
    const w = this.worker(c.id);
    return !!w && !isBusy(w.status) && w.status !== 'exited' && w.status !== 'offline' && !w.lost && !w.meeting;
  }

  /** How long it sits at its desk before getting up: restless workers don't last long. */
  private leaveWait(c: Roamer): number {
    return (LEAVE_MIN + c.rng() * LEAVE_SPAN) * (1.5 - c.traits.energy);
  }

  /** How long it stays at a haunt: patient workers stay longer, and an arcade or the DJ booth holds people. */
  private stayFor(c: Roamer, kind: SpotKind | undefined): number {
    const sticky = kind === 'arcade' || kind === 'dj' ? 1.3 : 1;
    return (STAY_MIN + c.rng() * STAY_SPAN) * (0.6 + c.traits.patience * 0.8) * sticky;
  }

  private key(a: string, b: string) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  update(dt: number) {
    this.clock += dt;
    for (const c of this.roamers.values()) {
      tickNeeds(c.needs, c.traits, dt);
      this.step(c, dt);
      // A task that just finished is something it can learn from (the mind writes it down).
      const w = this.worker(c.id);
      if (c.lastStatus === 'working' && w?.status === 'done') this.mind.learn(c, w.prompt ?? w.title ?? '');
      c.lastStatus = w?.status;
      if (c.bubble && this.clock >= c.bubble.until) this.dropBubble(c);
    }
    // Who's still got nothing to do decides afresh every tick (a status can change mid-walk).
    for (const c of this.roamers.values()) {
      if (this.free(c)) {
        if (c.state === 'seated') {
          c.timer -= dt;
          if (c.timer <= 0) this.goOut(c);
        } else if (c.state === 'linger') {
          c.timer -= dt;
          if (c.timer <= 0) this.goHome(c);
        }
      } else if (c.state !== 'seated') this.goHome(c);
    }
    separate(this.roamers.values());
    // Relationships cool without contact: affinity drifts back toward neutral, so the office's
    // social map evolves instead of only ever warming up.
    for (const [k, v] of this.affinity) {
      const d = v * Math.exp(-dt / 900);
      if (Math.abs(d) < 0.03) this.affinity.delete(k);
      else this.affinity.set(k, d);
    }
    // Now and then, two workers out about stop for a chat.
    this.chatIn -= dt;
    if (this.chatIn <= 0) {
      this.chatIn = CHAT_EVERY + Math.random() * CHAT_EVERY;
      this.startChat();
    }
  }

  /**
   * Two workers out and about, close enough to be worth it, walk to a point between them and trade
   * lines. Who stops for whom depends on how sociable the first is, what it needs, and how it
   * feels about each of them; each speaks in its own voice and persona.
   */
  private startChat() {
    const out = [...this.roamers.values()].filter((c) => c.state === 'linger' && this.free(c) && !c.chatWith);
    if (out.length < 2) return;
    // The most company-starved, sociable worker out there looks for someone first.
    const a = out.reduce((best, c) => (c.traits.sociability * (0.5 + c.needs.social) > best.traits.sociability * (0.5 + best.needs.social) ? c : best));
    if (a.rng() > 0.3 + 0.7 * a.traits.sociability) return;
    const pa = a.model.root.position;
    const near = out.filter((c) => c !== a && c.model.root.position.distanceTo(pa) < CHAT_REACH);
    if (!near.length) return;
    // Friends are likelier to be picked, rivals least (though not never: it's an office).
    const weights = near.map((c) => 0.4 + c.traits.sociability + (this.affinity.get(this.key(a.id, c.id)) ?? 0));
    let x = a.rng() * weights.reduce((s, w) => s + w, 0);
    let b = near[near.length - 1];
    for (let i = 0; i < near.length; i++) if ((x -= Math.max(0.05, weights[i])) <= 0) { b = near[i]; break; }
    const pb = b.model.root.position;
    const mx = (pa.x + pb.x) / 2;
    const mz = (pa.z + pb.z) / 2;
    const d = Math.hypot(pb.x - pa.x, pb.z - pa.z) || 1;
    const ux = (pb.x - pa.x) / d;
    const uz = (pb.z - pa.z) / d;
    const nav = this.nav();
    for (const [c, sgn] of [[a, -1], [b, 1]] as const) {
      // A little sideways jitter each, so the nav grid doesn't collapse both onto the same cell.
      const [sx, sz] = nav.nearestWalkable([
        mx + ux * 0.9 * sgn - uz * (c.rng() - 0.5) * 0.8,
        mz + uz * 0.9 * sgn + ux * (c.rng() - 0.5) * 0.8,
      ]);
      c.spot = { x: sx, z: sz, rotY: 0 };
      c.chatWith = sgn < 0 ? b.id : a.id;
      this.walkTo(c, [sx, sz]);
    }
    // The walk over takes a few seconds: ask the office mind for their script now, so it's
    // usually ready by the time they face each other.
    const turns = 4 + Math.round(((a.traits.sociability + b.traits.sociability) / 2) * 4);
    this.mind.ask(a, b, turns);
  }

  /** The lines its persona says (empty for shells and persona-less desks). */
  private personaLines(c: Roamer): readonly string[] {
    const w = this.worker(c.id);
    const persona = w?.kind === 'agent' ? personaFor(store.project?.dir, c.desk.def.id) : undefined;
    return (persona && PERSONA_LINES[persona.id]) || [];
  }

  /** A line over its head for a turn or so, in its own colours. */
  private say(c: Roamer, text: string, secs = LINE_SECS) {
    this.dropBubble(c);
    const sprite = textSprite(text, { bg: TONE_BG[c.traits.tone], color: '#fffaf3', size: 30 });
    sprite.position.set(0, 2.1, 0);
    c.model.root.add(sprite);
    c.bubble = { sprite, until: this.clock + secs };
  }

  private dropBubble(c: Roamer) {
    if (!c.bubble) return;
    c.model.root.remove(c.bubble.sprite);
    disposeSprite(c.bubble.sprite);
    delete c.bubble;
  }

  /** Idle long enough: hops down and walks to a haunt it fancies right now. */
  private goOut(c: Roamer) {
    const nav = this.nav();
    // Somewhere it isn't already, nobody else has claimed, and that the floor plan can reach.
    const here = c.state === 'seated' ? null : c.spot;
    const options = SPOTS.filter(
      (s) => nav.walkable(s.x, s.z)
        && !(here && Math.hypot(s.x - here.x, s.z - here.z) < 1.2)
        && !spotTaken(this.roamers.values(), c, s.x, s.z),
    );
    if (!options.length) {
      c.timer = LEAVE_MIN + c.rng() * LEAVE_SPAN;
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
      if (!spotTaken(this.roamers.values(), c, jx, jz)) break;
    }
    c.spot = { ...spot, x, z };
    c.timer = this.stayFor(c, spot.kind);
    this.walkTo(c, [x, z]);
  }

  /** Back to its desk: from the spot it's at, or from mid-chat, mid-hop, anywhere. */
  private goHome(c: Roamer) {
    if (c.spot?.kind) c.lastKind = c.spot.kind;
    c.spot = null;
    c.chatWith = undefined;
    delete c.chat;
    c.timer = this.leaveWait(c);
    this.walkTo(c, null);
  }

  /** Sets off for `target` (a spot), or for its seat (null), from wherever it is. */
  private walkTo(c: Roamer, target: Pt | null): void {
    c.model.stopDancing();
    if (c.state === 'seated') {
      if (!target) return;
      this.detach(c);
      c.way = this.nav().wayFrom(c.desk.def, target);
      c.from.copy(c.model.root.position);
      c.state = 'down';
      c.hop = 0;
      c.next = 0;
      return;
    }
    const p = c.model.root.position;
    const here: Pt = [p.x, p.z];
    // Mid-hop onto its seat and wanted back out (it got idle again): finishes the hop, then sets off again.
    if (c.state === 'up' && target) {
      c.state = 'seated';
      this.seat(c);
      return this.walkTo(c, target);
    }
    // Still getting down: from where it lands, it heads the new way.
    if (c.state === 'down') {
      const land = c.way[0];
      c.way = [land, ...(target ? this.nav().route(land, target) : this.nav().wayTo(land, c.desk.def)).slice(1)];
      return;
    }
    // Mid-hop up off its seat and wanted home: it finishes the arc and sits back down by itself.
    if (c.state === 'up' && !target) return;
    c.way = target ? this.nav().route(here, target) : this.nav().wayTo(here, c.desk.def);
    c.next = 1;
    c.state = 'walk';
  }

  /** Out of its seat, into the room, keeping where it is in the world. */
  private detach(c: Roamer) {
    const root = c.model.root;
    const pos = root.getWorldPosition(this.tmp).clone();
    const scale = root.getWorldScale(new THREE.Vector3()).x;
    const turn = root.getWorldQuaternion(new THREE.Quaternion());
    this.parent.add(root);
    root.position.copy(pos);
    c.heading = new THREE.Euler().setFromQuaternion(turn, 'YXZ').y;
    root.rotation.set(0, c.heading, 0);
    root.scale.setScalar(scale);
  }

  /** Back in its seat: from here on it's where every worker sits. */
  private seat(c: Roamer) {
    const root = c.model.root;
    c.state = 'seated';
    c.model.walking = false;
    c.model.gait = 1;
    this.dropBubble(c);
    c.desk.seatAnchor.add(root);
    root.position.set(0, 0, 0);
    root.rotation.set(0, 0, 0);
    root.scale.setScalar(1);
  }

  /** It's reached a haunt: eases a need, says something about the place, and reacts the way it would. */
  private arrive(c: Roamer) {
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

  private step(c: Roamer, dt: number) {
    const root = c.model.root;
    const pos = root.position;
    if (c.state === 'seated') return;
    if (c.state === 'down') {
      // Down off the seat in a little arc, turning to face the way it's going.
      c.hop = Math.min(1, c.hop + dt / HOP);
      const [x0, z0] = c.way[0];
      const floor = this.ground(x0, z0, c.from.y + 0.5) - FEET;
      pos.set(THREE.MathUtils.lerp(c.from.x, x0, c.hop), THREE.MathUtils.lerp(c.from.y, floor, c.hop) + Math.sin(c.hop * Math.PI) * 0.3, THREE.MathUtils.lerp(c.from.z, z0, c.hop));
      const [x1, z1] = c.way[1] ?? c.way[0];
      if (x1 !== x0 || z1 !== z0) c.heading = Math.atan2(x1 - x0, z1 - z0);
      root.rotation.set(0, root.rotation.y + wrap(c.heading - root.rotation.y) * smooth(HOP_TURN, dt), 0);
      if (c.hop >= 1) {
        c.state = 'walk';
        c.next = 1;
      }
      return;
    }
    if (c.state === 'up') {
      // Up onto the seat in a little arc, turning to face the desk.
      c.hop = Math.min(1, c.hop + dt / HOP);
      const seat = c.desk.seatAnchor.getWorldPosition(this.tmp);
      pos.set(THREE.MathUtils.lerp(c.from.x, seat.x, c.hop), THREE.MathUtils.lerp(c.from.y, seat.y, c.hop) + Math.sin(c.hop * Math.PI) * 0.3, THREE.MathUtils.lerp(c.from.z, seat.z, c.hop));
      root.rotation.set(0, root.rotation.y + wrap(c.desk.def.rotY + Math.PI - root.rotation.y) * smooth(HOP_TURN, dt), 0);
      if (c.hop >= 1) this.seat(c);
      return;
    }
    if (c.state === 'walk') {
      // Which way the next corner sends it.
      let target = root.rotation.y;
      if (c.next < c.way.length) {
        const [tx, tz] = c.way[c.next];
        const dx = tx - pos.x;
        const dz = tz - pos.z;
        if (dx * dx + dz * dz > 1e-8) target = Math.atan2(dx, dz);
      }
      // It slows a touch while it's still turning toward its heading, so it doesn't skate round the corners.
      const speedFactor = 0.6 + 0.4 * Math.max(0, Math.cos(wrap(target - root.rotation.y)));
      // Its own pace: brisk ones stride, mellow ones amble.
      const pace = c.model.pace * c.traits.pace;
      let move = WALK * pace * speedFactor * dt;
      while (move > 0 && c.next < c.way.length) {
        const [x, z] = c.way[c.next];
        const dx = x - pos.x;
        const dz = z - pos.z;
        const d = Math.hypot(dx, dz);
        if (d <= move) {
          pos.x = x;
          pos.z = z;
          move -= d;
          c.next++;
        } else {
          pos.x += (dx / d) * move;
          pos.z += (dz / d) * move;
          move = 0;
        }
      }
      // Turn toward where it's going at a walk's pace, and keep its feet going as fast as it really moves.
      const turn = wrap(target - root.rotation.y);
      root.rotation.y += THREE.MathUtils.clamp(turn, -TURN_RATE * dt, TURN_RATE * dt);
      c.heading = root.rotation.y;
      c.model.walking = c.next < c.way.length;
      c.model.gait = 1.15 * speedFactor * (0.9 + 0.2 * c.traits.energy) * c.traits.pace;
      if (c.model.walking) {
        c.stepIn -= dt;
        if (c.stepIn <= 0) {
          c.stepIn += Math.PI / (9 * pace * speedFactor);
          this.footstep(pos.x, pos.y, pos.z);
        }
      } else if (c.spot) {
        // At its spot: a chat rendezvous if it's still on, a hang-out spot otherwise.
        const meet = c.chatWith;
        c.chatWith = undefined;
        const p = meet && this.roamers.get(meet);
        if (p && (p.chatWith === c.id || p.chat?.partner === c.id)) {
          c.state = 'chat';
          // Both sides work the turn count out the same way, so they agree on when it ends.
          const turns = 4 + Math.round(((c.traits.sociability + p.traits.sociability) / 2) * 4);
          c.chat = { partner: meet, start: this.clock, seen: -1, turns, wait: 0, said: [] };
          c.timer = 0;
          c.stepIn = 2;
        } else {
          c.state = 'linger';
          c.timer = this.stayFor(c, c.spot.kind);
          c.stepIn = 2 + c.rng() * 4;
          this.arrive(c);
        }
      } else {
        // Back beside its seat: up onto it.
        c.state = 'up';
        c.hop = 0;
        c.from.copy(pos);
      }
    } else if (c.state === 'linger') {
      // Lingering: standing about at its spot, now and then a hop for joy, and its own little asides.
      c.stepIn -= dt;
      if (c.stepIn <= 0) {
        const kind = c.spot?.kind;
        const lively = kind === 'arcade' || kind === 'dj' || kind === 'jukebox' ? 0.7 : 0.3;
        c.stepIn += 3 + c.rng() * 5;
        if (c.rng() < lively * (0.5 + c.traits.energy)) c.model.cheer(1.4);
      }
      c.asideIn -= dt;
      if (c.asideIn <= 0 && !c.bubble) {
        c.asideIn = 6 + c.rng() * 10;
        // You walking past is worth a hello now and then, in its own voice.
        const you = this.playerAt?.();
        const near = you && Math.hypot(pos.x - you.x, pos.z - you.z) < 3.2;
        const text = near && c.rng() < 0.3 + 0.4 * c.traits.sociability
          ? styled(c.traits, pick(c.rng, HELLO), c.rng)
          : c.rng() < 0.5 ? mutter(c.traits, c.rng) : c.spot?.kind ? spotLine(c.traits, c.spot.kind, c.rng) : null;
        if (text) this.say(c, text);
      }
    } else if (c.state === 'chat') {
      // Stopped for a chat: facing who it's with, trading lines on shared turns.
      const chat = c.chat!;
      const p = this.roamers.get(chat.partner);
      const committed = !!p && (p.chatWith === c.id || p.chat?.partner === c.id);
      if (!committed) {
        this.goHome(c);
        return;
      }
      const pp = p!.model.root.position;
      c.heading = Math.atan2(pp.x - pos.x, pp.z - pos.z);
      root.rotation.y += wrap(c.heading - root.rotation.y) * smooth(FACE_RATE, dt);
      if (p!.state !== 'chat') {
        // Still walking over: wait a spell for it, then give up and head home.
        chat.wait += dt;
        if (chat.wait > 8) this.goHome(c);
      } else {
        chat.wait = 0;
        // Both sides count the same turns from the later of their two start times, so they never talk over each other.
        const start = Math.max(chat.start, p!.chat!.start);
        const t = Math.floor((this.clock - start) / LINE_SECS);
        if (t > chat.seen) {
          chat.seen = t;
          const first = c.id < chat.partner;
          if (t >= chat.turns) {
            this.finishChat(c, p!, first);
            this.goHome(c);
            return;
          }
          if ((t % 2 === 0) === first) {
            const rel = relation(this.affinity.get(this.key(c.id, chat.partner)) ?? 0);
            // The office mind's script when it came back in time, its own procedural voice otherwise.
            const script = this.mind.script(c.id, chat.partner);
            const mine = script ? (script.aId === c.id ? script.a : script.b) : null;
            const scripted = mine?.[Math.floor(t / 2)];
            const line = scripted ?? chatLine(c.traits, rel, t, t >= chat.turns - 2, c.rng, this.personaLines(c));
            this.say(c, line);
            chat.said.push(line);
            // A lively talker gestures.
            if (c.rng() < 0.15 + 0.25 * c.traits.energy) c.model.cheer(0.8);
          }
        }
      }
    }
    // Up and down steps as it goes, and facing its spot once it's there.
    const g = this.ground(pos.x, pos.z, pos.y + FEET + 0.35) - FEET;
    pos.y += (g - pos.y) * smooth(GROUND_RATE, dt);
    if (c.state === 'linger' && c.spot) root.rotation.y += wrap(c.spot.rotY - root.rotation.y) * smooth(FACE_RATE, dt);
    // On furniture it sits: up onto the seat's height and leaning back, easing in and out of it.
    const wantSit = c.state === 'linger' && c.spot?.seat !== undefined ? 1 : 0;
    c.sit += (wantSit - c.sit) * smooth(5, dt);
    if (c.sit > 0.01) {
      pos.y += c.sit * (c.spot!.seat! - 0.15);
      root.rotation.x = -c.sit * 0.32;
    }
  }

  /** A chat's over: both feel less lonely, the mind notes what to remember, and how it went shifts how they feel about each other. */
  private finishChat(c: Roamer, p: Roamer, first: boolean) {
    c.needs.social = Math.max(0, c.needs.social - 0.6);
    // Tell the mind what this one said, so it remembers the other worker next time (fire-and-forget).
    if (c.chat?.said.length) this.mind.reflect(c, p, c.chat.said);
    if (!first) return;
    const k = this.key(c.id, p.id);
    const prev = this.affinity.get(k) ?? 0;
    this.affinity.set(k, Math.max(-1, Math.min(1, prev + chatOutcome(c.traits, p.traits, c.rng))));
    // Both are done with this pair's script; the next chat asks for a fresh one.
    this.mind.forget(c.id, p.id);
  }
}