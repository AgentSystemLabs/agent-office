import * as THREE from 'three';
import { nearestWalkable, route, type Pt } from '../../../shared/nav';
import { Person } from '../../world/character';
import { cardSprite, disposeSprite } from '../../world/toon';
import type { Interactable } from '../../world/types';
import { CAST } from './cast';
import type { Snapshot } from './simulation';
import { EMOTE_BY_ID, type EmoteId } from '../../../shared/emotes';
import { MANNER, type GestureCue } from './choreography';
import { GesturePlayer } from './performance';

/** A feature can supply a dedicated work space without changing the character bible or schedule. */
export interface AmbientSpace {
  nav: { nearestWalkable(p: Pt): Pt; route(from: Pt, to: Pt): Pt[] };
  homes: Readonly<Record<string, Pt>>;
  adapt(snapshot: Snapshot): Snapshot;
}

interface Actor {
  person: Person;
  it: Interactable;
  path: Pt[];
  destination: string;
  line: string;
  label?: THREE.Sprite;
  bubble?: THREE.Sprite;
  gestures: GesturePlayer;
  greeting?: { at: number; cue?: GestureCue };
}

/** Ambient cast never takes a worker seat, collider, socket or agent session. */
export class AmbientWorld {
  readonly root = new THREE.Group();
  readonly actors = new Map<string, Actor>();
  private viewerEmote: EmoteId | null = null;
  private greetedAt = -Infinity;

  constructor(private space?: AmbientSpace) {
    this.root.name = 'ambient-office';
    for (const p of CAST) {
      const person = new Person(p.name, p.color, p.look);
      person.setLabel(p.name, null);
      const label = person.root.children.find((child): child is THREE.Sprite => child instanceof THREE.Sprite);
      label?.scale.multiplyScalar(0.75);
      person.root.name = `ambient-${p.id}`;
      const home = space?.homes[p.id] ?? p.home;
      const at = space ? space.nav.nearestWalkable(home) : nearestWalkable(home);
      person.root.position.set(at[0], 0, at[1]);
      const it: Interactable = { kind: 'ambientnpc', decorId: p.id, x: at[0], z: at[1], radius: 2.2, off: true };
      person.root.userData.interact = it;
      // Simple costume cues on the existing chibi rigs, without copying model assets.
      if (['michael', 'dwight', 'jim', 'david', 'andy'].includes(p.id)) {
        const material = new THREE.MeshToonMaterial({ color: p.id === 'dwight' ? '#72543b' : '#34415c' });
        const geometry = new THREE.BoxGeometry(0.065, 0.28, 0.03);
        const tie = new THREE.Mesh(geometry, material);
        tie.position.set(0, 1.13, 0.205);
        person.root.add(tie);
      }
      this.root.add(person.root);
      this.actors.set(p.id, { person, it, path: [], destination: '', line: '', label, gestures: new GesturePlayer() });
    }
  }

  usable(): Interactable[] {
    return this.root.visible ? [...this.actors.values()].filter((a) => !a.it.off).map((a) => a.it) : [];
  }

  update(snapshot: Snapshot, dt: number, t: number, show: boolean, quiet: boolean, busy: string | null, viewer: { x: number; z: number }, emote: EmoteId | null = null) {
    this.root.visible = show;
    const now = Date.now();
    const drift = Math.max(0, now - snapshot.sampledAt) / 1000;
    if (show && emote === 'wave' && this.viewerEmote !== emote && now - this.greetedAt > 10000) {
      const candidate = snapshot.people.filter(s => s.present && !s.attention && !s.gesture && s.person.id !== busy && !snapshot.scene?.beats.some(b => b.who === s.person.id))
        .map(s => ({ state: s, actor: this.actors.get(s.person.id)! }))
        .filter(({ actor }) => !actor.path.length && actor.person.root.position.distanceTo(new THREE.Vector3(viewer.x, 0, viewer.z)) < 3.5)
        .sort((a, b) => Math.hypot(a.actor.it.x - viewer.x, a.actor.it.z - viewer.z) - Math.hypot(b.actor.it.x - viewer.x, b.actor.it.z - viewer.z))[0];
      if (candidate) {
        const id = candidate.state.person.id;
        candidate.actor.greeting = { at: now, cue: MANNER[id].responds === null ? undefined : { key: `hello:${now}:${id}`, emote: MANNER[id].responds === 'facepalm' ? 'thumbs' : 'wave', age: 0 } };
        this.greetedAt = now;
      }
    }
    this.viewerEmote = emote;
    for (const state of snapshot.people) {
      const actor = this.actors.get(state.person.id)!;
      actor.person.root.visible = state.present || busy === state.person.id;
      actor.it.off = !show || !actor.person.root.visible;
      if (actor.it.off) {
        this.say(actor, '');
        continue;
      }
      const pos = actor.person.root.position;
      const occupied = busy === state.person.id;
      const destination = state.target.join(',');
      if (!occupied && destination !== actor.destination) {
        actor.destination = destination;
        const goal = this.space ? this.space.nav.nearestWalkable(state.target) : nearestWalkable(state.target);
        actor.path = this.space ? this.space.nav.route([pos.x, pos.z], goal) : route([pos.x, pos.z], goal);
      }
      let budget = Math.min(dt, 0.1) * 1.9;
      const moving = !occupied && actor.path.length > 0;
      while (budget > 0 && !occupied && actor.path.length) {
        const [x, z] = actor.path[0];
        const distance = Math.hypot(x - pos.x, z - pos.z);
        if (distance > 0.01) actor.person.root.rotation.y = Math.atan2(x - pos.x, z - pos.z);
        if (distance <= budget) {
          pos.set(x, 0, z);
          actor.path.shift();
          budget -= distance;
        } else {
          pos.x += (x - pos.x) / distance * budget;
          pos.z += (z - pos.z) / distance * budget;
          break;
        }
      }
      actor.it.x = pos.x;
      actor.it.z = pos.z;
      const seated = !moving && !occupied ? state.seat : undefined;
      actor.person.sit(seated?.hips ?? null);
      if (seated) actor.person.root.rotation.y = seated.facing;
      const other = state.attention ? this.actors.get(state.attention) : undefined;
      const engaged = !moving && !occupied && !!other && !other.it.off && !other.path.length && busy !== state.attention;
      let cue = !moving && !occupied && (!state.attention || engaged) && state.gesture ? { ...state.gesture, age: state.gesture.age + drift } : undefined;
      if (cue && cue.age >= EMOTE_BY_ID.get(cue.emote)!.seconds) cue = undefined;
      let focus = engaged ? other.person.root.position : undefined;
      if (actor.greeting) {
        const age = (now - actor.greeting.at) / 1000;
        if (age >= 2.2 || moving || occupied || state.attention || state.gesture) actor.greeting = undefined;
        else {
          focus = new THREE.Vector3(viewer.x, 0, viewer.z);
          cue = actor.greeting.cue ? { ...actor.greeting.cue, age } : undefined;
        }
      }
      if (focus) {
        const angle = Math.atan2(focus.x - pos.x, focus.z - pos.z);
        const delta = Math.atan2(Math.sin(angle - actor.person.root.rotation.y), Math.cos(angle - actor.person.root.rotation.y));
        actor.person.root.rotation.y += delta * Math.min(1, dt * 8);
      }
      actor.person.root.userData.performance = { stage: snapshot.performance?.stage, attention: engaged ? state.attention : undefined, gesture: cue?.emote, age: cue?.age };
      const distance = Math.hypot(pos.x - viewer.x, pos.z - viewer.z);
      if (actor.label) actor.label.visible = distance < 10;
      actor.person.setDoing(distance < 6 ? (occupied ? 'Helping you' : state.activity) : undefined);
      actor.person.holdMug(!moving && !cue && (state.activity.includes('lunch') || state.activity.includes('break')));
      actor.person.read(!moving && (state.activity.includes('Reading') || state.activity.includes('crossword')));
      // Quiet work has no speech bubbles; only the current speaker in a scene talks.
      this.say(actor, quiet || occupied || actor.path.length || distance > 10 || (state.attention && !engaged) ? '' : state.line ?? '');
      actor.person.emojiLift = actor.bubble ? actor.bubble.position.y + actor.bubble.scale.y - 2.42 + 0.55 : 0;
      actor.person.setVoiceLevel(actor.line ? 0.07 + Math.sin(t * 15) * 0.035 : 0);
      actor.gestures.update(actor.person, cue, dt, t, moving);
    }
  }

  private say(actor: Actor, line: string) {
    if (actor.line === line) return;
    actor.line = line;
    if (actor.bubble) {
      actor.person.root.remove(actor.bubble);
      disposeSprite(actor.bubble);
      actor.bubble = undefined;
    }
    if (!line) return;
    const bubble = cardSprite({ title: CAST.find(p => p.id === actor.it.decorId)!.name, body: line, bg: '#fff9e9', maxWidth: 420 });
    bubble.position.y = actor.person.bubbleY + 0.18;
    bubble.scale.multiplyScalar(Math.min(1, 3.2 / bubble.scale.x));
    actor.person.root.add(bubble);
    actor.bubble = bubble;
  }
}
